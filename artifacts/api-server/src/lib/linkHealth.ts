import net from "node:net";
import { lookup as dnsLookup } from "node:dns/promises";

// Shared dead-link detection used by both the click-time apply check
// (routes/applications.ts) and the background vacancy liveness sweep
// (lib/vacancyLivenessSweep.ts).

export const EXPIRATION_PHRASES = [
  "vacancy has closed",
  "this vacancy is closed",
  "no longer accepting applications",
  "no longer available",
  "deadline has passed",
  "position has been filled",
  "job has expired",
  "this job posting has expired",
  "applications are now closed",
] as const;

// SSRF guard: the health check fetches a user-influenced URL server-side, so
// only publicly routable hosts are ever fetched. Private, loopback, link-local,
// CGNAT, and unresolvable hosts are rejected outright — no legitimate employer
// apply link points at them.
export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split(".").map(Number);
    const [a, b] = [parts[0]!, parts[1]!];
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // CGNAT
      (a === 169 && b === 254) || // link-local / cloud metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  const lower = ip.toLowerCase();
  return (
    lower === "::" || lower === "::1" ||
    lower.startsWith("fe80") || lower.startsWith("fc") || lower.startsWith("fd") ||
    (lower.startsWith("::ffff:") && isPrivateIp(lower.slice(7)))
  );
}

export async function isPubliclyRoutableHost(hostname: string): Promise<boolean> {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    return false;
  }
  if (net.isIP(host)) return !isPrivateIp(host);
  if (!host.includes(".")) return false; // bare intranet hostnames
  try {
    const addrs = await dnsLookup(host, { all: true });
    return addrs.length > 0 && addrs.every((a) => !isPrivateIp(a.address));
  } catch {
    return false; // unresolvable — dead for the candidate anyway
  }
}

const DEFAULT_HEALTH_CHECK_TIMEOUT_MS = 2500;
const BODY_SNIFF_BYTES = 15 * 1024;
const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const MAX_REDIRECT_HOPS = 5;

export type HealthVerdict = { verdict: "alive" | "dead" | "unsafe"; reason: string };

/**
 * Fetch the destination and decide if it is dead (404/410/5xx, or an
 * expiration banner in the first 15KB of body text). Redirects are followed
 * manually with a per-hop SSRF check so a public host cannot bounce the
 * server-side fetch into a private/internal target ("unsafe" verdict).
 * Throws on timeout or network/bot-block failure — callers treat throws as
 * "inconclusive".
 */
export async function checkDestinationDead(
  url: string,
  opts: { timeoutMs?: number } = {},
): Promise<HealthVerdict> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_HEALTH_CHECK_TIMEOUT_MS);
  try {
    let currentUrl = url;
    for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
      // Per-hop SSRF check (the first hop is pre-validated by some callers, but
      // re-checking here keeps this function safe on its own).
      const target = new URL(currentUrl);
      if (!(await isPubliclyRoutableHost(target.hostname))) {
        return { verdict: "unsafe", reason: `redirect to non-public host ${target.hostname}` };
      }
      const resp = await fetch(currentUrl, {
        signal: controller.signal,
        redirect: "manual",
        headers: {
          "User-Agent": BROWSER_USER_AGENT,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-GB,en;q=0.9",
        },
      });
      if (resp.status >= 300 && resp.status < 400) {
        const location = resp.headers.get("location");
        resp.body?.cancel().catch(() => {});
        if (!location) return { verdict: "alive", reason: "" }; // 3xx without Location — inconclusive
        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }
      if (resp.status === 404 || resp.status === 410 || resp.status >= 500) {
        resp.body?.cancel().catch(() => {});
        return { verdict: "dead", reason: `HTTP ${resp.status}` };
      }
      const contentType = resp.headers.get("content-type") ?? "";
      if (contentType.includes("html") || contentType.includes("text")) {
        let text = "";
        let bytesRead = 0;
        const reader = resp.body?.getReader();
        if (reader) {
          const decoder = new TextDecoder();
          while (bytesRead < BODY_SNIFF_BYTES) {
            const { done, value } = await reader.read();
            if (done) break;
            bytesRead += value.byteLength;
            text += decoder.decode(value, { stream: true });
          }
          reader.cancel().catch(() => {});
        }
        const lower = text.toLowerCase();
        const phrase = EXPIRATION_PHRASES.find((p) => lower.includes(p));
        if (phrase) return { verdict: "dead", reason: `expiration phrase: "${phrase}"` };
      } else {
        resp.body?.cancel().catch(() => {});
      }
      return { verdict: "alive", reason: "" };
    }
    return { verdict: "dead", reason: "too many redirects" };
  } finally {
    clearTimeout(timer);
  }
}
