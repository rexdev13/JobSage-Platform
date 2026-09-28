import fs from "node:fs";
import path from "node:path";
import { ObjectStorageService } from "../src/lib/objectStorage";

const CSV_FILENAME = "final-approved-production-url-import.csv";
const LINK_TTL_MS = 6 * 60 * 60 * 1000;
const URL_OUTPUT = "/tmp/jobsage-final-import-signed-url.txt";
const EXPIRY_OUTPUT = "/tmp/jobsage-final-import-signed-expiry.txt";

async function main(): Promise<void> {
  const csvPath = path.resolve(
    process.cwd(),
    "../production-url-resolution-2026-09-28",
    CSV_FILENAME,
  );
  const buffer = fs.readFileSync(csvPath);
  const storage = new ObjectStorageService();
  let storageKey: string | undefined;

  try {
    storageKey = await storage.saveFileBuffer({
      buffer,
      contentType: "text/csv",
    });

    await storage.trySetObjectEntityAclPolicy(storageKey, {
      owner: "temporary-download-link",
      visibility: "private",
    });

    const objectFile = await storage.getObjectEntityFile(storageKey);
    await objectFile.setMetadata({
      contentType: "text/csv; charset=utf-8",
      contentDisposition: `attachment; filename="${CSV_FILENAME}"`,
      cacheControl: "private, no-store",
    });

    const privateDir = storage.getPrivateObjectDir().replace(/^\/+|\/+$/g, "");
    const entityPath = storageKey.replace(/^\/objects\//, "");
    const [bucketName, ...objectParts] = `${privateDir}/${entityPath}`.split("/");
    const objectName = objectParts.join("/");
    if (!bucketName || !objectName) {
      throw new Error("Could not resolve the private object path.");
    }

    const expiresAt = new Date(Date.now() + LINK_TTL_MS);
    const response = await fetch(
      "http://127.0.0.1:1106/object-storage/signed-object-url",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bucket_name: bucketName,
          object_name: objectName,
          method: "GET",
          expires_at: expiresAt.toISOString(),
        }),
        signal: AbortSignal.timeout(30_000),
      },
    );

    if (!response.ok) {
      throw new Error(`Could not sign the private download URL (${response.status}).`);
    }

    const result = (await response.json()) as { signed_url?: unknown };
    if (typeof result.signed_url !== "string" || !result.signed_url.startsWith("https://")) {
      throw new Error("The storage service did not return a valid HTTPS download URL.");
    }

    fs.writeFileSync(URL_OUTPUT, result.signed_url, { mode: 0o600 });
    fs.writeFileSync(EXPIRY_OUTPUT, expiresAt.toISOString(), { mode: 0o600 });
    console.log(JSON.stringify({ uploadedBytes: buffer.length, expiresAt: expiresAt.toISOString() }));
  } catch (error) {
    if (storageKey) {
      try {
        const objectFile = await storage.getObjectEntityFile(storageKey);
        await objectFile.delete();
      } catch {
        // Preserve the original signing/upload error.
      }
    }
    throw error;
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});