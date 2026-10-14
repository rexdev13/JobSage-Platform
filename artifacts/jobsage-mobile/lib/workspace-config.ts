import { safeInternalPath } from "@workspace/mobile-core";
import * as Crypto from "expo-crypto";

const domain = process.env.EXPO_PUBLIC_DOMAIN?.trim() ?? "";

function resolveOrigin(): string | null {
  if (!domain || /[\s/\\@]/.test(domain)) return null;
  try {
    const url = new URL(`https://${domain}`);
    return url.origin;
  } catch {
    return null;
  }
}

/** Canonical first-party origin, derived only from EXPO_PUBLIC_DOMAIN. */
export const WORKSPACE_ORIGIN: string | null = resolveOrigin();

/** Optional start path, e.g. "/dashboard". Falls back to the website root. */
export const WORKSPACE_START_PATH: string =
  safeInternalPath(process.env.EXPO_PUBLIC_WORKSPACE_PATH?.trim() || "/") ?? "/";

export function isFirstPartyUrl(value: string): boolean {
  if (!WORKSPACE_ORIGIN) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.origin === WORKSPACE_ORIGIN && !url.username && !url.password;
  } catch {
    return false;
  }
}

/** Resolves a relative or absolute first-party URL; returns null if foreign. */
export function resolveFirstPartyUrl(value: string): string | null {
  if (!WORKSPACE_ORIGIN) return null;
  if (value.startsWith("/")) {
    const path = safeInternalPath(value);
    return path ? `${WORKSPACE_ORIGIN}${path}` : null;
  }
  return isFirstPartyUrl(value) ? new URL(value).href : null;
}

export function workspaceUrl(path: string): string | null {
  const safe = safeInternalPath(path);
  return WORKSPACE_ORIGIN && safe ? `${WORKSPACE_ORIGIN}${safe}` : null;
}

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
  return out;
}

export interface NativeProof {
  verifier: string;
  challenge: string;
  channel: string;
}

/**
 * Cryptographic proof held only in native memory. The verifier never enters
 * page JavaScript; only the SHA-256 challenge and message channel are injected.
 */
export async function createNativeProof(): Promise<NativeProof> {
  const verifier = toHex(Crypto.getRandomBytes(32));
  const channel = toHex(Crypto.getRandomBytes(24));
  const challenge = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, {
    encoding: Crypto.CryptoEncoding.HEX,
  });
  return { verifier, challenge, channel };
}
