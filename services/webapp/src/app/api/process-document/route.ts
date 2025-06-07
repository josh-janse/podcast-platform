// src/app/api/process-document/route.ts

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { GoogleGenAI } from "@google/genai";
import { podcastGenerationQueue } from 'shared/src/queues';

// Initialize the Google GenAI client with your API key
const apiKey = process.env.GOOGLE_API_KEY;
if (!apiKey) {
  console.error("GOOGLE_API_KEY is not set. Please check your environment variables.");
}
const ai = new GoogleGenAI({ apiKey: apiKey! });

export async function POST(request: Request) {
  console.log("Received request in /api/process-document");

  const supabase = await createClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    console.error("API authentication error:", authError ? authError.message : "User not found.");
    return NextResponse.json({ message: authError?.message || 'Authentication required' }, { status: 401 });
  }
  console.log("Authenticated user ID:", user.id);

  try {
    const body = await request.json();
    const { storagePath, originalName, steeringPrompt } = body;

    if (!storagePath || !originalName) {
      console.error("Missing storagePath or originalName in request body");
      return NextResponse.json({ message: 'Missing required fields: storagePath and originalName' }, { status: 400 });
    }

    console.log('Received data in API route: (User, Path, Name, Prompt)', user.id, storagePath, originalName, steeringPrompt);

    // Step 1: Download file from Supabase Storage
    console.log(`Attempting to download file from Supabase Storage at path: ${storagePath}`);
    const { data: fileDataBlob, error: downloadError } = await supabase.storage
      .from('documents')
      .download(storagePath);

    if (downloadError) {
      console.error('Error downloading file from Supabase Storage:', downloadError);
      return NextResponse.json({ message: `Error downloading file: ${downloadError.message}` }, { status: 500 });
    }
    if (!fileDataBlob) {
      console.error('No file data received from Supabase Storage download.');
      return NextResponse.json({ message: 'Failed to retrieve file data from storage.' }, { status: 500 });
    }
    console.log(`Successfully downloaded file "${originalName}" from Supabase Storage. Size: ${fileDataBlob.size} bytes.`);

    const mimeType = fileDataBlob.type || 'application/octet-stream';

    // Step 2: Upload to Google Gemini Files API
    console.log(`Attempting to upload file "${originalName}" to Google Gemini Files API.`);
    const fileToUpload = new File([fileDataBlob], originalName, {
      type: mimeType // Use the defined mimeType
    });

    const uploadResponse = await ai.files.upload({
      file: fileToUpload,
    });

    let geminiFile = uploadResponse;
    console.log(`Initial upload complete via @google/genai. File Name: ${geminiFile.name}, State: ${geminiFile.state}`);

    // Step 3: Validate file upload response and wait for processing
    if (!geminiFile.name) {
      console.error('File upload succeeded but no name returned from Gemini');
      return NextResponse.json({ message: 'File upload failed: No file identifier returned from Gemini' }, { status: 500 });
    }
    const geminiFileName = geminiFile.name;

    while (geminiFile.state === 'PROCESSING') {
      console.log(`File is still processing (State: ${geminiFile.state}), retrying in 5 seconds...`);
      await new Promise((resolve) => setTimeout(resolve, 5000));
      geminiFile = await ai.files.get({ name: geminiFileName });
      console.log(`Current file state: ${geminiFile.state}`);
    }

    if (geminiFile.state !== 'ACTIVE') {
      console.error(`File processing failed or resulted in an unexpected state: ${geminiFile.state}`);
      try {
        if(geminiFile.state === 'FAILED') await ai.files.delete({ name: geminiFileName });
      } catch (deleteError) {
        console.warn('Failed to delete failed/stale file from Gemini:', deleteError);
      }
      return NextResponse.json({ message: `File processing resulted in state: ${geminiFile.state}` }, { status: 500 });
    }
    console.log(`File processing complete. State: ${geminiFile.state}. URI: ${geminiFile.uri}`);

    // Step 4: Create metadata record in public.documents table
    const fileUri = geminiFile.uri;
    if (!fileUri) {
      console.error('Missing file URI after processing');
      return NextResponse.json({ message: 'File processing incomplete: Missing file URI' }, { status: 500 });
    }

    const { data: documentRecord, error: insertError } = await supabase
      .from('documents')
      .insert({
        user_id: user.id,
        original_name: originalName,
        storage_path: storagePath,
        gemini_file_id: geminiFileName,
        gemini_file_uri: fileUri,
        gemini_file_state: geminiFile.state,
        mime_type: mimeType,
        status: 'PROCESSED_AWAITING_SCRIPT',
      })
      .select()
      .single();

    if (insertError) {
      console.error('Error inserting document record into Supabase:', insertError);
      try {
        await ai.files.delete({ name: geminiFileName });
      } catch (deleteError) {
        console.warn('Failed to cleanup Gemini file after DB error:', deleteError);
      }
      return NextResponse.json({ message: `Error saving document metadata: ${insertError.message}` }, { status: 500 });
    }

    const documentId = documentRecord.id;
    console.log(`Document metadata saved to Supabase. DB Document ID: ${documentId}`);

    // Step 5: Add job to BullMQ for script generation
    const jobData = {
      documentId: documentId,
      userId: user.id,
      steeringPrompt: steeringPrompt || null,
      originalName: originalName,
    };

    try {
      const job = await podcastGenerationQueue.add('generate-script', jobData);
      console.log(`Job added to podcastGenerationQueue. Job ID: ${job.id}, Data:`, jobData);
    } catch (queueError: any) {
      console.error('Error adding job to BullMQ queue:', queueError);
      return NextResponse.json({
        message: `File processed and metadata saved, but failed to queue for script generation: ${queueError.message}`,
        documentId: documentId,
      }, { status: 500 });
    }

    return NextResponse.json({
      message: `File "${originalName}" uploaded and processed. Queued for podcast generation. Document ID: ${documentId}`,
      documentId: documentId,
    }, { status: 200 });

  } catch (error: any) {
    console.error('Error in /api/process-document:', error);
    let errorMessage = 'Internal Server Error';
    if (error instanceof Error) {
      errorMessage = error.message;
    }
    return NextResponse.json({
      message: errorMessage,
      errorDetail: String(error),
    }, { status: 500 });
  }
}
