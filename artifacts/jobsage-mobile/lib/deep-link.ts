import { safeInternalPath } from "@workspace/mobile-core";

const PUBLIC_PATHS = new Set([
  "/",
  "/login",
  "/register",
  "/employer/register",
  "/privacy",
  "/terms",
  "/account-deletion",
  "/extension-privacy",
  "/help",
  "/support",
]);

export type DeepLinkDecision =
  | { kind: "invalid" }
  | { kind: "login"; path: string }
  | { kind: "forbidden" }
  | { kind: "open"; path: string };

/**
 * Parse only JOBSAGE's custom scheme. Route authorization remains enforced by
 * the canonical web route and API; this gate prevents unsafe/external targets,
 * unauthenticated private destinations, and cross-account notification links.
 */
export function resolveJobsageDeepLink(
  rawUrl: string | null | undefined,
  actor: { id: string; role: string | null } | null,
): DeepLinkDecision {
  if (!rawUrl || rawUrl.length > 4096) return { kind: "invalid" };

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { kind: "invalid" };
  }

  if (parsed.protocol !== "jobsage-mobile:") return { kind: "invalid" };

  const hostPath = parsed.hostname ? `/${parsed.hostname}${parsed.pathname === "/" ? "" : parsed.pathname}` : parsed.pathname;
  const path = safeInternalPath(`${hostPath || "/"}${parsed.search}${parsed.hash}`);
  if (!path) return { kind: "invalid" };

  const pathname = path.split(/[?#]/, 1)[0] || "/";
  const accountId = parsed.searchParams.get("accountId");
  if (accountId && (!actor || accountId !== actor.id)) return { kind: "forbidden" };

  if (!actor && !PUBLIC_PATHS.has(pathname)) return { kind: "login", path };
  if (pathname.startsWith("/companion") && actor?.role !== "candidate") return { kind: "forbidden" };

  return { kind: "open", path };
}
