type UploadUrlResponse = {
  uploadURL: string;
  storageKey: string;
};

async function getResponseError(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json() as { error?: unknown };
    if (typeof body.error === "string" && body.error.trim()) return body.error;
  } catch {
    // Use the fallback when the server didn't return a JSON error envelope.
  }
  return `${fallback} (HTTP ${response.status})`;
}

export async function uploadIdentityFile(file: File, basePath: string): Promise<string> {
  const urlRes = await fetch(`${basePath}/api/storage/uploads/request-url`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: file.name,
      size: file.size,
      contentType: file.type,
    }),
  });

  if (!urlRes.ok) {
    throw new Error(await getResponseError(urlRes, "Failed to get upload URL"));
  }

  const result = await urlRes.json() as UploadUrlResponse;
  if (
    typeof result.uploadURL !== "string" ||
    typeof result.storageKey !== "string" ||
    !result.storageKey
  ) {
    throw new Error("The upload service returned an invalid response.");
  }

  const putRes = await fetch(result.uploadURL, {
    method: "PUT",
    body: file,
    headers: { "Content-Type": file.type },
  });
  if (!putRes.ok) throw new Error("Failed to upload file. Please try again.");

  return result.storageKey;
}
