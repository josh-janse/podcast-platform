// src/workers/podcastGenerationWorker.js
const { Worker } = require('bullmq');
const IORedis = require('ioredis');
const { GoogleGenAI } = require('@google/genai');
const { createClient } = require('@supabase/supabase-js');

console.log('WORKER: Starting up...');

// --- Environment Variables ---
const redisHost = process.env.REDIS_HOST || 'localhost';
const redisPort = parseInt(process.env.REDIS_PORT || '6379', 10);
const googleApiKey = process.env.GOOGLE_API_KEY;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// --- Log Environment Variables (except sensitive keys in production) ---
console.log('WORKER: Redis Host:', redisHost);
console.log('WORKER: Redis Port:', redisPort);

if (!googleApiKey) {
  console.error("WORKER: GOOGLE_API_KEY is not set.");
  process.exit(1);
} else {
  console.log('WORKER: Google API Key is set.');
}

if (!supabaseUrl || !supabaseServiceRoleKey) {
  console.error("WORKER: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set. Worker cannot connect to Supabase.");
  process.exit(1);
} else {
  console.log('WORKER: Supabase URL is set.');
  console.log('WORKER: Supabase Service Role Key is present.');
}

// --- Initialize Supabase Admin Client ---
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  }
});
console.log('WORKER: Supabase admin client initialized.');

// --- Initialize GenAI client with proper error checking ---
let genAI;
try {
  genAI = new GoogleGenAI({ apiKey: googleApiKey });
  console.log('WORKER: Google GenAI client initialized successfully.');
} catch (error) {
  console.error('WORKER: Failed to initialize Google GenAI client:', error);
  process.exit(1);
}

// --- Redis Connection for BullMQ ---
const workerConnection = new IORedis(redisPort, redisHost, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

workerConnection.on('connect', () => {
  console.log('WORKER: Successfully connected to Redis for BullMQ.');
});

workerConnection.on('error', (err) => {
  console.error('WORKER: Redis connection error for BullMQ:', err);
});

// --- BullMQ Job Processor ---
const processor = async (job) => {
  console.log(`WORKER: Processing job ${job.id} for queue ${job.name}`);
  console.log('WORKER: Job data:', job.data);

  const { documentId, userId, steeringPrompt, originalName: originalNameFromJob } = job.data;

  try {
    await job.updateProgress(5);
    console.log(`WORKER: (Data from job) Starting script generation for documentId: ${documentId}, originalName: ${originalNameFromJob}`);

    // 1. Fetch document details from Supabase `documents` table
    console.log(`WORKER: Attempting to fetch document details from Supabase for documentId: ${documentId}`);
    const { data: document, error: docError } = await supabaseAdmin
      .from('documents')
      .select('gemini_file_uri, original_name, gemini_file_id, gemini_file_state, status, mime_type')
      .eq('id', documentId)
      .single();

    if (docError) {
      console.error(`WORKER: Supabase error fetching document ${documentId}:`, docError);
      throw new Error(`Supabase error fetching document ${documentId}: ${docError.message}`);
    }

    if (!document) {
      console.error(`WORKER: Document not found in Supabase for ID: ${documentId}. This indicates a data integrity issue.`);
      throw new Error(`Document not found in Supabase for ID: ${documentId}.`);
    }

    console.log(`WORKER: Successfully fetched document details from Supabase for ${document.original_name}:`, document);
    await job.updateProgress(10);

    // 2. Use Gemini generative model to analyze content and generate script.
    if (!document.gemini_file_uri) {
        throw new Error(`WORKER: Gemini file URI is missing for document ${documentId}`);
    }
    console.log(`WORKER: Starting content analysis for Gemini file: ${document.gemini_file_uri}`);
    
    // Determine mimeType
    const fileMimeType = document.mime_type || 'application/octet-stream';
    console.log(`WORKER: Using MimeType: ${fileMimeType} for Gemini File: ${document.gemini_file_uri}`);

    const fileInput = {
        fileUri: document.gemini_file_uri,
        mimeType: fileMimeType,
    };
    
    // Construct a detailed system instruction
    let systemInstruction = `You are an expert AI podcast script writer. Your task is to generate an engaging and informative conversational script between two distinct AI hosts (e.g., "Alex" and "Samira") based on the provided document.`;
    systemInstruction += `\nThe script should explore the key points, main arguments, interesting facts, and potential discussion topics from the document.`;
    if (steeringPrompt && steeringPrompt.trim() !== "") {
        systemInstruction += `\nPay close attention to the following steering prompt from the user to guide the conversation: "${steeringPrompt}". Ensure the discussion aligns with this prompt.`;
    } else {
        systemInstruction += `\nSince no specific steering prompt was provided, focus on a balanced overview of the document's core themes.`;
    }
    systemInstruction += `\nFormat the output as a script with clear speaker labels (e.g., ALEX:, SAMIRA:). The conversation should flow naturally, with hosts building on each other's points, asking clarifying questions, and perhaps offering different perspectives if appropriate. Aim for a script that would be suitable for a 5-10 minute audio segment. Ensure the language is accessible and engaging for a general audience. Do not include any pre-amble or post-amble, only the script itself.`;

    const contents = [
        { 
            role: "user", 
            parts: [
                { text: systemInstruction },
                { fileData: fileInput }
            ] 
        }
    ];
    
    console.log("WORKER: Sending request to Gemini API");
    await job.updateProgress(20);

    // Use the new @google/genai SDK API structure
    const response = await genAI.models.generateContent({
        model: 'gemini-2.5-flash-preview-04-17',
        contents: contents,
        generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 8192,
        }
    });
    
    await job.updateProgress(60);

    // Error handling for Gemini response
    if (!response || !response.text) {
        console.error('WORKER: Gemini response is missing or invalid:', response);
        throw new Error('Gemini API returned invalid response');
    }
    
    const scriptContent = response.text;
    if (!scriptContent || scriptContent.trim() === "") {
        console.warn("WORKER: Gemini generated empty script content.");
        throw new Error("Gemini generated empty script content.");
    }
    
    console.log('WORKER: Successfully generated script content from Gemini.');
    console.log('WORKER: Generated script content (first 200 chars):', scriptContent.substring(0, 200) + "...");
    await job.updateProgress(70);

    // 3. Save generated script to Supabase `podcasts` table.
    console.log(`WORKER: Saving generated script to 'podcasts' table for document ${document.original_name}.`);
    const { data: podcastRecord, error: podcastInsertError } = await supabaseAdmin
      .from('podcasts')
      .insert({
        user_id: userId,
        document_id: documentId,
        title: `Podcast about ${document.original_name.replace(/\.[^/.]+$/, "")}`, // Create a simple title
        steering_prompt: steeringPrompt,
        script: { content: scriptContent }, // Store script as a JSON object
        status: 'SCRIPT_GENERATED', // Set initial status
        language: 'en', // Default language, can be made dynamic later
      })
      .select() // Select the newly created record to get its ID
      .single();

    if (podcastInsertError) {
      console.error(`WORKER: Supabase error inserting podcast record:`, podcastInsertError);
      throw new Error(`Failed to save generated script to Supabase: ${podcastInsertError.message}`);
    }
    
    console.log(`WORKER: Successfully saved podcast script to DB. New Podcast ID: ${podcastRecord.id}`);
    await job.updateProgress(85);

    // 4. Update status in `documents` table.
    console.log(`WORKER: Updating status for document ${documentId} to SCRIPT_GENERATION_COMPLETE.`);
    const { error: docUpdateError } = await supabaseAdmin
      .from('documents')
      .update({ status: 'SCRIPT_GENERATION_COMPLETE' })
      .eq('id', documentId);

    if (docUpdateError) {
      // This is not a critical failure; the main task (script generation and saving) succeeded.
      // We log a warning but don't fail the job.
      console.warn(`WORKER: Failed to update document status for documentId ${documentId}, but continuing as script was saved. Error:`, docUpdateError);
    }
    
    await job.updateProgress(95);

    // 5. Clean up the Gemini file (no longer needed after script generation)
    console.log(`WORKER: Cleaning up Gemini file: ${document.gemini_file_id}`);
    try {
      await genAI.files.delete({ name: document.gemini_file_id });
      console.log(`WORKER: Successfully deleted Gemini file: ${document.gemini_file_id}`);
    } catch (cleanupError) {
      // Don't fail the job if cleanup fails - script generation was successful
      console.warn(`WORKER: Failed to delete Gemini file ${document.gemini_file_id}:`, cleanupError.message);
    }

    await job.updateProgress(100);
    console.log(`WORKER: Job ${job.id} fully completed. Document: ${document.original_name}, Podcast ID: ${podcastRecord.id}`);
    
    return {
      success: true,
      documentId: documentId,
      podcastId: podcastRecord.id, // Return the new podcast ID
      fetchedDocumentName: document.original_name,
      scriptPreview: scriptContent.substring(0, 200) + "...",
      message: `Script generated and saved for ${document.original_name}.`
    };

  } catch (error) {
    console.error(`WORKER: Error processing job ${job.id} for documentId ${documentId}:`, error.message);
    console.error(error.stack);
    
    // Clean up Gemini file on error as well
    if (document?.gemini_file_id) {
      console.log(`WORKER: Attempting to clean up Gemini file after error: ${document.gemini_file_id}`);
      try {
        await genAI.files.delete({ name: document.gemini_file_id });
        console.log(`WORKER: Successfully deleted Gemini file after error: ${document.gemini_file_id}`);
      } catch (cleanupError) {
        console.warn(`WORKER: Failed to delete Gemini file after error ${document.gemini_file_id}:`, cleanupError.message);
      }
    }
    
    throw error;
  }
};

// --- BullMQ Worker Instance ---
const worker = new Worker('podcast-generation', processor, {
  connection: workerConnection,
  concurrency: 5,
  limiter: { max: 10, duration: 1000 }
});

// --- Worker Event Listeners ---
worker.on('completed', (job, result) => {
  console.log(`WORKER: Job ${job.id} completed successfully. Result:`, result);
});

worker.on('failed', (job, err) => {
  const jobId = job ? job.id : 'unknown';
  console.error(`WORKER: Job ${jobId} failed with error: ${err.message}`);
});

worker.on('error', err => {
  console.error('WORKER: Error in BullMQ worker controller:', err);
});

worker.on('active', (job) => {
  console.log(`WORKER: Job ${job.id} is now active.`);
});

worker.on('progress', (job, progress) => {
  console.log(`WORKER: Job ${job.id} reported progress:`, progress);
});

console.log('WORKER: Podcast Generation Worker started using CommonJS. Waiting for jobs...');

// --- Graceful Shutdown ---
const gracefulShutdown = async (signal) => {
  console.log(`WORKER: Received ${signal}. Closing worker and Redis connection...`);
  try {
    await worker.close();
    await workerConnection.quit();
  } catch (err) {
    console.error('WORKER: Error during graceful shutdown:', err);
  }
  console.log('WORKER: Shutdown complete.');
  process.exit(0);
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));