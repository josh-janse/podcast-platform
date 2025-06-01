// src/app/upload/page.tsx
"use client";

import { useState, ChangeEvent, FormEvent, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { User } from "@supabase/supabase-js";

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [steeringPrompt, setSteeringPrompt] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const supabase = createClient();

  useEffect(() => {
    const getUser = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        setUser(session.user);
      } else {
        // Handle case where user is not authenticated, e.g., redirect or show message
        // For now, we'll assume auth guards are handled at a higher level (e.g., middleware or layout)
        console.warn("User not authenticated on upload page.");
        setMessage("Error: User not authenticated. Please log in.");
      }
    };
    getUser();
  }, []);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files[0]) {
      setFile(event.target.files[0]);
      setMessage(null); // Clear previous messages
    }
  };

  const handlePromptChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setSteeringPrompt(event.target.value);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!file) {
      setMessage("Please select a file to upload.");
      return;
    }
    if (!user) {
      setMessage("Error: User not identified. Cannot upload file.");
      return;
    }

    setIsLoading(true);
    setMessage("Uploading file to Supabase Storage...");

    try {
      const userId = user.id;
      const filePath = `${userId}/${Date.now()}-${file.name}`;
      
      // Upload file to Supabase Storage
      // The bucket name is 'documents' [cite: 129]
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from("documents") // Bucket name [cite: 129]
        .upload(filePath, file); 

      if (uploadError) {
        console.error("Error uploading file:", uploadError);
        setMessage(`Error uploading file: ${uploadError.message}`);
        setIsLoading(false);
        return;
      }

      if (uploadData) {
        // path was uploadData.path, but Supabase v2 Storage .upload() returns { path: string }
        // where path is the full path including the bucket name.
        // However, the Technical Architecture doc implies storagePath should be just the file path within the bucket.
        // Let's use the `filePath` variable we constructed, as it's the path within the bucket.
        // Supabase JS SDK v2 for storage.upload returns data: { path: Key }
        // The `Key` is the full path to the object in the bucket, which is what `filePath` is.
        // So, `uploadData.path` (which is our `filePath`) is correct.
        
        setMessage(`File "${file.name}" uploaded. Processing document...`);
        console.log("File uploaded to Supabase Storage. Path:", uploadData.path);
        console.log("Calling /api/process-document with:", {
          storagePath: uploadData.path, // This is the full path including user folder etc.
          originalName: file.name,
          steeringPrompt: steeringPrompt,
        });

        try {
          const response = await fetch('/api/process-document', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              storagePath: uploadData.path, // Send the full path returned by Supabase Storage
              originalName: file.name,
              steeringPrompt: steeringPrompt,
            }),
          });

          const result = await response.json();

          if (!response.ok) {
            console.error("API call failed:", result);
            throw new Error(result.message || `Failed to process document (status: ${response.status})`);
          }
          
          console.log("API call successful:", result);
          setMessage(`Document processing initiated: ${result.message}`);
          // Optionally clear the form on success
          // setFile(null); 
          // const fileInput = document.getElementById('document') as HTMLInputElement;
          // if (fileInput) fileInput.value = "";
          // setSteeringPrompt("");

        } catch (apiError: any) {
          console.error("Error calling /api/process-document:", apiError);
          setMessage(`Error initiating document processing: ${apiError.message}`);
        }
      }

    } catch (error: any) {
      console.error("Submission error:", error);
      setMessage(`Error: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="container mx-auto py-10">
      <Card className="max-w-2xl mx-auto">
        <CardHeader>
          <CardTitle className="text-2xl font-bold">Create New Podcast</CardTitle>
          <CardDescription>
            Upload your source document and provide a steering prompt to guide the AI hosts.
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="document">Source Document</Label>
              <Input
                id="document"
                type="file"
                onChange={handleFileChange}
                accept=".pdf,.docx,.txt,.md"
                disabled={isLoading || !user}
              />
              {file && <p className="text-sm text-muted-foreground">Selected: {file.name}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="steering-prompt">Steering Prompt (Optional)</Label>
              <Textarea
                id="steering-prompt"
                placeholder="e.g., Focus on the historical context and key figures mentioned..."
                value={steeringPrompt}
                onChange={handlePromptChange}
                maxLength={500}
                className="resize-none"
                rows={4}
                disabled={isLoading || !user}
              />
              <p className="text-sm text-muted-foreground">
                {steeringPrompt.length} / 500 characters
              </p>
            </div>
          </CardContent>
          <CardFooter className="flex flex-col items-start space-y-4">
            <Button type="submit" className="w-full sm:w-auto" disabled={isLoading || !file || !user}>
              {isLoading ? "Processing..." : "Upload & Generate"}
            </Button>
            {message && (
              <p className={`text-sm ${message.includes("Error:") || message.startsWith("Please select") ? "text-red-600" : "text-muted-foreground"}`}>
                {message}
              </p>
            )}
             {!user && !isLoading && <p className="text-sm text-red-600">Please log in to upload documents.</p>}
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}