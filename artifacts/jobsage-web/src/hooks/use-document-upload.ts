import { useState } from "react";
import { useRequestUploadUrl, useRegisterDocument } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { getListMyDocumentsQueryKey } from "@workspace/api-client-react";

export function useDocumentUpload() {
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  
  const queryClient = useQueryClient();
  const getUrlMutation = useRequestUploadUrl();
  const registerMutation = useRegisterDocument();

  const uploadFile = async (file: File) => {
    setIsUploading(true);
    setProgress(0);
    setError(null);

    if (file.size > 5 * 1024 * 1024) {
      setError("File exceeds maximum size of 5MB.");
      setIsUploading(false);
      return false;
    }

    try {
      // 1. Get presigned URL
      setProgress(10);
      const { uploadURL, objectPath } = await getUrlMutation.mutateAsync({
        data: {
          name: file.name,
          size: file.size,
          contentType: file.type,
        }
      });

      // 2. Upload file directly to GCS via PUT
      setProgress(40);
      const xhr = new XMLHttpRequest();
      await new Promise<void>((resolve, reject) => {
        xhr.upload.addEventListener("progress", (event) => {
          if (event.lengthComputable) {
            const percentage = Math.round((event.loaded / event.total) * 50) + 40;
            setProgress(percentage);
          }
        });
        
        xhr.addEventListener("load", () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else reject(new Error(`Upload failed with status ${xhr.status}`));
        });
        
        xhr.addEventListener("error", () => reject(new Error("Network error during upload")));
        
        xhr.open("PUT", uploadURL);
        xhr.setRequestHeader("Content-Type", file.type);
        xhr.send(file);
      });

      // 3. Register document in database
      setProgress(90);
      await registerMutation.mutateAsync({
        data: {
          filename: file.name,
          mimeType: file.type,
          objectPath: objectPath,
          fileSize: file.size,
        }
      });

      setProgress(100);
      
      // 4. Invalidate cache
      queryClient.invalidateQueries({ queryKey: getListMyDocumentsQueryKey() });
      
      return true;
    } catch (err) {
      console.error("Upload error:", err);
      setError(err instanceof Error ? err.message : "Failed to upload document");
      return false;
    } finally {
      setIsUploading(false);
    }
  };

  return { uploadFile, isUploading, progress, error };
}
