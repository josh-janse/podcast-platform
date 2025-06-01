// src/app/api/process-document/route.ts

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { GoogleGenAI } from "@google/genai";

// Initialize the Google GenAI client with your API key
const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY! }); 

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
      .from('documents') // Your bucket name for user-uploaded source documents
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

    // Step 2: Upload to Google Gemini Files API using @google/genai SDK
    console.log(`Attempting to upload file "${originalName}" to Google Gemini Files API using @google/genai.`);
    
    // Create a File object from the Blob
    const fileToUpload = new File([fileDataBlob], originalName, { 
      type: fileDataBlob.type || 'application/octet-stream' 
    });

    // Upload using the new SDK pattern
    const uploadResponse = await ai.files.upload({
      file: fileToUpload,
      // Note: The new SDK might use different config options
      // Check if displayName is needed or if it's handled differently
    });
    
    let geminiFile = uploadResponse;
    
    console.log(`Initial upload complete via @google/genai. File Name: ${geminiFile.name}, State: ${geminiFile.state}`);

    // Step 3: Validate file upload response
    if (!geminiFile.name) {
      console.error('File upload succeeded but no name returned from Gemini');
      return NextResponse.json({ message: 'File upload failed: No file identifier returned from Gemini' }, { status: 500 });
    }

    // Extract the file name for type safety throughout the rest of the function
    const geminiFileName = geminiFile.name;

    // Step 4: Wait for the file to be processed (ACTIVE state)
    // Use string literals instead of enum since FileState may not exist
    while (geminiFile.state === 'PROCESSING') {
      console.log(`File is still processing (State: ${geminiFile.state}), retrying in 5 seconds...`);
      await new Promise((resolve) => setTimeout(resolve, 5000)); // Wait 5 seconds
      
      // Get updated file info using the validated file name
      geminiFile = await ai.files.get({ name: geminiFileName });
      console.log(`Current file state: ${geminiFile.state}`);
    }

    if (geminiFile.state === 'FAILED') {
      console.error(`File processing failed for ${geminiFileName}. State: ${geminiFile.state}`);
      // Optional: Delete the failed file from Gemini
      try {
        await ai.files.delete({ name: geminiFileName });
      } catch (deleteError) {
        console.warn('Failed to delete failed file from Gemini:', deleteError);
      }
      return NextResponse.json({ message: `File processing failed with Gemini. State: ${geminiFile.state}` }, { status: 500 });
    }

    if (geminiFile.state !== 'ACTIVE') {
      console.error(`File is not active after processing. State: ${geminiFile.state}`);
      return NextResponse.json({ message: `File processing resulted in an unexpected state: ${geminiFile.state}` }, { status: 500 });
    }

    console.log(`File processing complete. State: ${geminiFile.state}. URI: ${geminiFile.uri}`);
    
    // Step 5: Create metadata record in public.documents table
    // At this point we know geminiFile.name and geminiFile.uri are defined
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
          gemini_file_id: geminiFileName, // Use the validated file name
          gemini_file_uri: fileUri,
          gemini_file_state: geminiFile.state, // Store the final state
          status: 'PROCESSED', // Your internal status
       }) 
      .select()
      .single();

    if (insertError) {
        console.error('Error inserting document record into Supabase:', insertError);
        // Potentially delete the file from Gemini if DB insert fails to prevent orphans
        try {
          await ai.files.delete({ name: geminiFileName });
        } catch (deleteError) {
          console.warn('Failed to cleanup Gemini file after DB error:', deleteError);
        }
        return NextResponse.json({ message: `Error saving document metadata: ${insertError.message}` }, { status: 500 });
    }
    
    const documentId = documentRecord.id;
    console.log(`Document metadata saved to Supabase. DB Document ID: ${documentId}`);

    // Step 6: Add job to BullMQ for script generation
    // TODO: Implement BullMQ queue
    console.log(`Placeholder: Add job to BullMQ for documentId: ${documentId} and steeringPrompt: "${steeringPrompt}"`);

    return NextResponse.json({ 
      message: `File "${originalName}" uploaded and processed by Gemini. State: ${geminiFile.state}, URI: ${fileUri}. Document ID: ${documentId}`,
      userId: user.id,
      geminiFileUri: fileUri,
      geminiFileName: geminiFileName, // Use the validated file name
      geminiFileState: geminiFile.state,
      documentId: documentId, 
      data: { storagePath, originalName, steeringPrompt } 
    }, { status: 200 });

  } catch (error: any) {
    console.error('Error in /api/process-document:', error);
    
    // Better error handling
    let errorMessage = 'Internal Server Error';
    if (error instanceof Error) {
      errorMessage = error.message;
    } else if (typeof error === 'object' && error !== null && 'message' in error) {
      errorMessage = String(error.message);
    }
    
    // Check for specific Google AI errors
    if (error?.status) {
      console.error('Google AI API Error Status:', error.status);
    }
    
    return NextResponse.json({ 
      message: errorMessage, 
      errorDetail: String(error),
      ...(error?.status && { apiStatus: error.status })
    }, { status: 500 });
  }
}