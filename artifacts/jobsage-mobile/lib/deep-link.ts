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
const PUSH_PATHS = new Set([
  "/inbox",
  "/applications",
  "/calendar",
  "/eligibility",
  "/documents",
  "/opportunities",
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
  if (/%(?:2f|5c|0d|0a)/i.test(`${parsed.pathname}${parsed.search}${parsed.hash}`)) {
    return { kind: "invalid" };
  }

  const hostPath = parsed.hostname ? `/${parsed.hostname}${parsed.pathname === "/" ? "" : parsed.pathname}` : parsed.pathname;
  const path = safeInternalPath(`${hostPath || "/"}${parsed.search}${parsed.hash}`);
  if (!path) return { kind: "invalid" };

  const pathname = path.split(/[?#]/, 1)[0] || "/";
  const accountScoped = parsed.searchParams.has("accountId");
  const accountId = parsed.searchParams.get("accountId");
  if (accountScoped && (!accountId || (actor && accountId !== actor.id))) return { kind: "forbidden" };
  if (accountScoped && !actor && PUBLIC_PATHS.has(pathname)) return { kind: "forbidden" };

  if (!actor && !PUBLIC_PATHS.has(pathname)) return { kind: "login", path };
  if (pathname.startsWith("/companion") && actor?.role !== "candidate") return { kind: "forbidden" };

  return { kind: "open", path };
}

export function resolvePushDestination(
  destination: unknown,
  accountId: unknown,
  actor: { id: string; role: string | null } | null,
): DeepLinkDecision {
  if (typeof destination !== "string" || destination.length > 512) return { kind: "invalid" };
  const path = safeInternalPath(destination);
  if (!path || !PUSH_PATHS.has(path.split(/[?#]/, 1)[0] || "/")) return { kind: "invalid" };
  if (typeof accountId !== "string" || accountId.length === 0) return { kind: "invalid" };
  if (!actor) {
    const separator = path.includes("?") ? "&" : "?";
    return { kind: "login", path: `${path}${separator}accountId=${encodeURIComponent(accountId)}` };
  }
  if (accountId !== actor.id) return { kind: "forbidden" };
  return { kind: "open", path };
}

/** Remove the one-use account binding only after sign-in proves the same account. */
export function authorizeDeepLinkAfterLogin(path: string, accountId: string): string | null {
  const safePath = safeInternalPath(path);
  if (!safePath || !accountId) return null;
  let parsed: URL;
  try {
    parsed = new URL(safePath, "https://jobsage.invalid");
  } catch {
    return null;
  }
  const expectedAccountId = parsed.searchParams.get("accountId");
  if (parsed.searchParams.has("accountId") && expectedAccountId !== accountId) return null;
  parsed.searchParams.delete("accountId");
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}
