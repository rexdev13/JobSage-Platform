import { safeEmployerUrl } from "@workspace/mobile-core";

/**
 * One automatic basic-profile fill per application and employer page path.
 * Query strings and fragments are intentionally excluded from the in-memory key.
 */
export function applicationPrefillPageKey(applicationId: number, pageUrl: string): string | null {
  if (!Number.isSafeInteger(applicationId) || applicationId <= 0) return null;
  try {
    if (new URL(pageUrl).protocol !== "https:") return null;
  } catch {
    return null;
  }
  const safeUrl = safeEmployerUrl(pageUrl);
  if (!safeUrl) return null;

  try {
    const url = new URL(safeUrl);
    return `${applicationId}:${url.origin}${url.pathname}`;
  } catch {
    return null;
  }
}

/** Identifies a form step without retaining query data or entered field values. */
export function applicationAssistantStepKey(
  applicationId: number,
  pageUrl: string,
  questionSignatures: readonly string[],
): string | null {
  const pageKey = applicationPrefillPageKey(applicationId, pageUrl);
  if (!pageKey) return null;

  let hash = 2166136261;
  for (const character of questionSignatures.join("\n")) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `${pageKey}:${(hash >>> 0).toString(36)}`;
}
