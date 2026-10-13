import { safeInternalPath } from "@workspace/mobile-core";

/** Start unauthenticated users at sign-in instead of the public marketing home. */
export function workspaceEntryPath(path: string): string {
  const safe = safeInternalPath(path);
  return safe && safe !== "/" ? safe : "/login";
}
