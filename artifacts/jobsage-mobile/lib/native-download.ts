import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import * as Crypto from "expo-crypto";
import { createMobileSessionGrant } from "@workspace/api-client-react";

import { isFirstPartyUrl, resolveFirstPartyUrl } from "@/lib/workspace-config";
import { getNativeSessionToken, getNativeSessionUserId } from "@/context/AuthContext";

const MAX_BYTES = 25 * 1024 * 1024;
const TIMEOUT_MS = 45_000;
const ALLOWED_EXT = /\.(pdf|docx?|txt|rtf|csv|xlsx?|pptx?|png|jpe?g|ics|zip)$/i;

export class DownloadError extends Error {}

/** Strips path separators, control characters and unexpected extensions. */
export function safeFilename(raw: string | null | undefined, fallback = "JOBSAGE-download.pdf"): string {
  const base = (raw ?? "").split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069"*:<>?|#%]/g, "")
    .replace(/^\.+/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  if (!cleaned || !ALLOWED_EXT.test(cleaned)) return fallback;
  return cleaned;
}

function filenameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const star = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (star) {
    try {
      return decodeURIComponent(star[1]);
    } catch {
      return null;
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain ? plain[1] : null;
}

const tempFiles = new Map<string, { directory: Directory; ownerId: string }>();
let privateExportCacheHealthy = false;
export function cleanupPrivateExportFiles() {
  privateExportCacheHealthy = false;
  const directory = new Directory(Paths.cache, "jobsage-private-exports");
  if (directory.exists) directory.delete();
  privateExportCacheHealthy = true;
}

export function cleanupTempDownloads(ownerId?: string) {
  for (const [uri, entry] of tempFiles) {
    if (ownerId && entry.ownerId !== ownerId) continue;
    try {
      if (entry.directory.exists) entry.directory.delete();
      tempFiles.delete(uri);
    } catch {
      // Keep the entry so a later cleanup can retry.
    }
  }
}

/** Cleans one viewer-owned temporary download without touching other shares. */
export function cleanupTempDownload(uri: string, ownerId: string) {
  const entry = tempFiles.get(uri);
  if (!entry) return;
  if (entry.ownerId !== ownerId) {
    throw new DownloadError("This temporary file belongs to a different signed-in account.");
  }
  if (entry.directory.exists) entry.directory.delete();
  tempFiles.delete(uri);
}

/**
 * Downloads a first-party file to the cache and opens the system share sheet.
 * Use a single-use exchange to establish a host-scoped HttpOnly cookie.
 * The file request has no Authorization header, so redirects cannot forward
 * a long-lived bearer token. Reject any final off-origin or HTML response.
 */
export async function downloadAndShare(options: {
  url: string;
  filename?: string;
  token: string | null;
  fallbackName?: string;
  share?: boolean;
  privateExport?: { expectedAccountId: string; confirmed: true } & (
    | { password: string; emailCodeProof?: never }
    | { password?: never; emailCodeProof: string }
  );
}): Promise<{ uri: string; filename: string; mimeType: string }> {
  const target = resolveFirstPartyUrl(options.url);
  if (!target) throw new DownloadError("This download is not from JOBSAGE and was blocked.");
  if (options.privateExport && !privateExportCacheHealthy) throw new DownloadError("Private-file cleanup must finish before exporting. Restart JOBSAGE.");
  if (options.share !== false && !(await Sharing.isAvailableAsync())) throw new DownloadError("Sharing is not available on this device.");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const ownerId = getNativeSessionUserId();
  const privateExport = options.privateExport;
  const validReauthentication = privateExport && (
    (typeof privateExport.password === "string" && privateExport.password.length > 0
      && privateExport.password.length <= 1024 && !privateExport.emailCodeProof)
    || (typeof privateExport.emailCodeProof === "string"
      && privateExport.emailCodeProof.length >= 40 && privateExport.emailCodeProof.length <= 128
      && !privateExport.password)
  );
  if (privateExport && (privateExport.expectedAccountId !== ownerId
    || new URL(target).pathname !== "/api/privacy/export" || privateExport.confirmed !== true
    || !validReauthentication)) {
    clearTimeout(timer);
    throw new DownloadError("Review this export in the signed-in account.");
  }
  let response: Response;
  try {
    if (!ownerId || !options.token || getNativeSessionToken() !== options.token) throw new DownloadError("Please sign in again to download this file.");
    const bytes = await Crypto.getRandomBytesAsync(32);
    const verifier = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
    const challenge = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier);
    const destination = new URL(target);
    const grant = await createMobileSessionGrant({
      challenge, audience: "web", nextPath: options.privateExport ? "/privacy-settings" : destination.pathname + destination.search,
    }, { signal: controller.signal, headers: { Authorization: `Bearer ${options.token}` } });
    response = await fetch(new URL("/api/auth/mobile/session-exchange", target).href, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code: grant.code, verifier }).toString(),
      redirect: "follow",
      credentials: "include",
      signal: controller.signal,
    });
    if (options.privateExport) {
      if (!response.ok || !response.url || !isFirstPartyUrl(response.url)
        || getNativeSessionUserId() !== ownerId || getNativeSessionToken() !== options.token) {
        throw new DownloadError("Please sign in again to download this file.");
      }
      response = await fetch(target, {
        method: "POST", redirect: "error", credentials: "include", signal: controller.signal,
        headers: { "Content-Type": "application/json", "Origin": new URL(target).origin, "x-jobsage-privacy-account": ownerId! },
        body: JSON.stringify(options.privateExport),
      });
    }
  } catch (e) {
    clearTimeout(timer);
    if (e instanceof DownloadError) throw e;
    if (controller.signal.aborted) throw new DownloadError("The download timed out. Please try again.");
    throw new DownloadError("The download could not be started. Check your connection and try again.");
  }

  try {
    if (!response.url || !isFirstPartyUrl(response.url)) {
      throw new DownloadError("The file is hosted elsewhere and could not be downloaded securely.");
    }
    if (response.status === 401 || response.status === 403) {
      throw new DownloadError("Please sign in again to download this file.");
    }
    if (!response.ok) throw new DownloadError(`The download failed (${response.status}).`);
    if (options.privateExport && !/^application\/zip(?:;|$)/i.test(response.headers.get("content-type") ?? "")) {
      throw new DownloadError("The export response was not a ZIP archive. No file was shared.");
    }
    if (/text\/html/i.test(response.headers.get("content-type") ?? "")) {
      throw new DownloadError("This link is not a document. Please open it in JOBSAGE.");
    }
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (declared > MAX_BYTES) throw new DownloadError("This file is too large to download on mobile.");
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_BYTES) throw new DownloadError("This file is too large to download on mobile.");
    if (!ownerId || getNativeSessionUserId() !== ownerId || getNativeSessionToken() !== options.token) throw new DownloadError("Your account changed during this download. Please try again.");

    const name = safeFilename(
      options.filename || filenameFromDisposition(response.headers.get("content-disposition")),
      options.fallbackName,
    );
    // Separate directories preserve the friendly filename without collisions.
    // Never delete another download while a chooser or attachment still uses it.
    const directory = new Directory(Paths.cache, options.privateExport ? "jobsage-private-exports" : "jobsage-downloads", Crypto.randomUUID());
    const file = new File(directory, name);
    tempFiles.set(file.uri, { directory, ownerId });
    try {
      directory.create({ intermediates: true });
      file.create();
      file.write(new Uint8Array(buffer));
      clearTimeout(timer);
      const mimeType = response.headers.get("content-type")?.split(";")[0] || "application/octet-stream";
      if (options.share !== false) await Sharing.shareAsync(file.uri, {
        mimeType, dialogTitle: name,
      });
      return { uri: file.uri, filename: name, mimeType };
    } finally {
      if (options.privateExport) {
        try { if (directory.exists) directory.delete(); tempFiles.delete(file.uri); }
        catch {
          privateExportCacheHealthy = false;
          throw new DownloadError("JOBSAGE could not clear its temporary export copy. Restart JOBSAGE before requesting another archive.");
        }
      }
    }
  } finally {
    clearTimeout(timer);
  }
}
