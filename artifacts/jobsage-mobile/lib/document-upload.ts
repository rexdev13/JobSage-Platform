import { uploadDocument } from "@workspace/api-client-react";
import * as Crypto from "expo-crypto";
import * as DocumentPicker from "expo-document-picker";
import { Directory, File as ExpoFile, Paths } from "expo-file-system";
import * as Network from "expo-network";
import { Platform } from "react-native";

export const MAX_DOCUMENT_UPLOAD_BYTES = 5 * 1024 * 1024;

const STAGING_DIRECTORY = "jobsage-document-uploads";
const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
};
const ALLOWED_MIME_TYPES = [...new Set(Object.values(MIME_BY_EXTENSION))];
const ALLOWED_EXTENSIONS = new Set(Object.keys(MIME_BY_EXTENSION));

export class DocumentUploadError extends Error {}

export interface StagedDocument {
  filename: string;
  mimeType: string;
  size: number;
  file: Blob;
  stagingDirectoryUri: string | null;
}

export interface DocumentUploadProgress {
  loaded: number;
  total: number;
  percent: number;
}

let interruptedUploadCleanupReady = Platform.OS === "web";

/**
 * Remove native upload staging left behind if JOBSAGE was interrupted while
 * picking, uploading, or retrying a document.
 */
export function cleanupInterruptedDocumentUploads(): void {
  if (Platform.OS === "web") {
    interruptedUploadCleanupReady = true;
    return;
  }

  const staging = new Directory(Paths.cache, STAGING_DIRECTORY);
  if (staging.exists) staging.delete();
  interruptedUploadCleanupReady = true;
}

function ensureInterruptedUploadsCleaned(): void {
  if (interruptedUploadCleanupReady) return;
  try {
    cleanupInterruptedDocumentUploads();
  } catch {
    throw new DocumentUploadError(
      "JOBSAGE could not clear an interrupted upload. Restart the app before selecting another document.",
    );
  }
}

function sanitizedFilename(rawName: string): string {
  const basename = rawName.split(/[\\/]/).pop() ?? "";
  const cleaned = basename
    .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069"*:<>?|#%]/g, "")
    .replace(/^\.+/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  const extension = /\.([a-z0-9]+)$/i.exec(cleaned)?.[1]?.toLowerCase();

  if (!cleaned || !extension || !ALLOWED_EXTENSIONS.has(extension)) {
    throw new DocumentUploadError("Choose a PDF, image, Word document, or plain-text file.");
  }
  return cleaned;
}

function resolveMimeType(assetMimeType: string | null | undefined, filename: string): string {
  const supplied = assetMimeType?.split(";")[0]?.trim().toLowerCase();
  const extension = /\.([a-z0-9]+)$/i.exec(filename)?.[1]?.toLowerCase();
  const inferred = extension ? MIME_BY_EXTENSION[extension] : undefined;

  if (supplied && ALLOWED_MIME_TYPES.includes(supplied) && inferred && supplied !== inferred) {
    throw new DocumentUploadError("The selected file type does not match its filename extension.");
  }
  const mimeType = supplied && ALLOWED_MIME_TYPES.includes(supplied) ? supplied : inferred;

  if (!mimeType || !ALLOWED_MIME_TYPES.includes(mimeType)) {
    throw new DocumentUploadError("This document type is not supported.");
  }
  return mimeType;
}

export async function pickAndStageDocument(): Promise<StagedDocument | null> {
  ensureInterruptedUploadsCleaned();

  let result: DocumentPicker.DocumentPickerResult;
  try {
    result = await DocumentPicker.getDocumentAsync({
      type: ALLOWED_MIME_TYPES,
      copyToCacheDirectory: true,
      multiple: false,
    });
  } catch {
    throw new DocumentUploadError("The document picker could not be opened. Please try again.");
  }

  if (result.canceled) return null;
  const asset = result.assets[0];
  if (!asset) throw new DocumentUploadError("No document was selected.");

  const filename = sanitizedFilename(asset.name);
  const mimeType = resolveMimeType(asset.mimeType, filename);
  if (Platform.OS === "web") {
    const file = asset.file;
    if (!file) throw new DocumentUploadError("The selected browser file is no longer available.");
    if (file.size <= 0) throw new DocumentUploadError("The selected file is empty.");
    if (file.size > MAX_DOCUMENT_UPLOAD_BYTES) {
      throw new DocumentUploadError("Choose a file smaller than 5 MB.");
    }
    return {
      filename,
      mimeType,
      size: file.size,
      file,
      stagingDirectoryUri: null,
    };
  }

  const source = new ExpoFile(asset.uri);
  const size = asset.size ?? source.size;
  if (!size || size <= 0) throw new DocumentUploadError("The selected file is empty or unavailable.");
  if (size > MAX_DOCUMENT_UPLOAD_BYTES) {
    throw new DocumentUploadError("Choose a file smaller than 5 MB.");
  }

  const staging = new Directory(Paths.cache, STAGING_DIRECTORY, Crypto.randomUUID());
  try {
    staging.create({ intermediates: true });
    const stagedFile = new ExpoFile(staging, filename);
    source.copy(stagedFile);
    return {
      filename,
      mimeType,
      size,
      file: stagedFile,
      stagingDirectoryUri: staging.uri,
    };
  } catch {
    try {
      if (staging.exists) staging.delete();
    } catch {
      // The next startup cleanup removes the app-owned staging directory.
    }
    throw new DocumentUploadError("JOBSAGE could not prepare this file for upload. Please choose it again.");
  }
}

export function cleanupStagedDocument(document: StagedDocument): void {
  if (!document.stagingDirectoryUri) return;
  const staging = new Directory(document.stagingDirectoryUri);
  if (staging.exists) staging.delete();
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (typeof URL !== "undefined" && input instanceof URL) return input.toString();
  return (input as Request).url;
}

function responseHeaders(raw: string): Headers {
  const headers = new Headers();
  for (const line of raw.split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    headers.append(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
  }
  return headers;
}

function abortError(): Error {
  const error = new Error("Upload cancelled.");
  error.name = "AbortError";
  return error;
}

/**
 * The generated client still builds the multipart endpoint and bearer header;
 * XHR is only the transport because fetch does not expose native upload events.
 */
function createUploadProgressFetch(
  onProgress?: (progress: DocumentUploadProgress) => void,
): typeof fetch {
  return ((input: RequestInfo | URL, init: RequestInit = {}) => new Promise<Response>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const signal = init.signal;
    let settled = false;

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onSignalAbort);
      xhr.onload = null;
      xhr.onerror = null;
      xhr.onabort = null;
      xhr.ontimeout = null;
      xhr.upload.onprogress = null;
      callback();
    };

    const onSignalAbort = () => {
      try {
        xhr.abort();
      } finally {
        finish(() => reject(abortError()));
      }
    };

    if (signal?.aborted) {
      finish(() => reject(abortError()));
      return;
    }

    try {
      xhr.open((init.method ?? "GET").toUpperCase(), requestUrl(input), true);
      xhr.timeout = 120_000;
      new Headers(init.headers).forEach((value, name) => {
        // XHR must add the multipart boundary for FormData itself.
        if (name.toLowerCase() !== "content-type") xhr.setRequestHeader(name, value);
      });

      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable || event.total <= 0 || !onProgress) return;
        try {
          onProgress({
            loaded: event.loaded,
            total: event.total,
            percent: Math.min(100, Math.round((event.loaded / event.total) * 100)),
          });
        } catch {
          // UI progress listeners must never interrupt the file transfer.
        }
      };

      xhr.onload = () => {
        finish(() => {
          if (xhr.status < 200 || xhr.status > 599) {
            reject(new TypeError("The upload connection ended before a response was received."));
            return;
          }
          try {
            resolve(new Response(xhr.responseText ?? "", {
              status: xhr.status,
              statusText: xhr.statusText,
              headers: responseHeaders(xhr.getAllResponseHeaders()),
            }));
          } catch (error) {
            reject(error);
          }
        });
      };
      xhr.onerror = () => finish(() => reject(new TypeError("The upload connection failed. Check your network and try again.")));
      xhr.onabort = () => finish(() => reject(abortError()));
      xhr.ontimeout = () => finish(() => reject(new DocumentUploadError("Upload timed out. Your selected file is ready to retry.")));
      signal?.addEventListener("abort", onSignalAbort, { once: true });
      if (signal?.aborted) {
        onSignalAbort();
        return;
      }
      xhr.send(init.body ?? null);
    } catch (error) {
      finish(() => reject(error));
    }
  })) as typeof fetch;
}

export async function uploadStagedDocument(
  document: StagedDocument,
  signal: AbortSignal,
  onProgress?: (progress: DocumentUploadProgress) => void,
): ReturnType<typeof uploadDocument> {
  if (signal.aborted) throw new DocumentUploadError("Upload cancelled.");

  const network = await Network.getNetworkStateAsync();
  if (network.isConnected === false || network.isInternetReachable === false) {
    throw new DocumentUploadError("You appear to be offline. Reconnect and retry this upload.");
  }

  // Keep the generated endpoint, response parsing, and shared bearer-token
  // logic while using XHR's upload events for real transfer progress.
  const requestOptions = {
    signal,
    fetcher: createUploadProgressFetch(onProgress),
  } as RequestInit & { fetcher: typeof fetch };

  return uploadDocument({ file: document.file }, requestOptions);
}
