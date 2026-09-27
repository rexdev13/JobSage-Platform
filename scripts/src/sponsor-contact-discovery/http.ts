import { lookup } from "node:dns/promises";
import net from "node:net";

const MAX_PAGE_BYTES = 1_000_000;
const MAX_REDIRECTS = 3;
const DEFAULT_TIMEOUT_MS = 12_000;
const USER_AGENT = "JOBSAGE sponsor contact discovery/1.0";
const robotsCache = new Map<string, string | null>();
const hostLastRequest = new Map<string, number>();

export type PublicSiteFetcherMetrics = {
  httpRequestsMade: number;
  cacheHits: number;
};

function isPrivateIp(address: string): boolean {
  if (net.isIPv4(address)) {
    const [a, b] = address.split(".").map(Number);
    return a === 10 || a === 127 || (a === 169 && b === 254) ||
      (a === 172 && b !== undefined && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || a === 0;
  }
  const value = address.toLowerCase();
  return value === "::1" || value.startsWith("fc") || value.startsWith("fd") ||
    value.startsWith("fe8") || value.startsWith("fe9") || value.startsWith("fea") ||
    value.startsWith("feb");
}

function publicHost(hostname: string): Promise<void> {
  return lookup(hostname, { all: true, verbatim: true }).then((addresses) => {
    if (!addresses.length || addresses.some(({ address }) => isPrivateIp(address))) {
      throw new Error(`private or unresolved destination: ${hostname}`);
    }
  });
}

function normaliseHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, "");
}

function sameSite(hostname: string, baseHost: string): boolean {
  const host = normaliseHost(hostname);
  const base = normaliseHost(baseHost);
  return host === base || host.endsWith(`.${base}`) || base.endsWith(`.${host}`);
}

async function waitForHost(hostname: string, delayMs: number): Promise<void> {
  const previous = hostLastRequest.get(normaliseHost(hostname)) ?? 0;
  const wait = Math.max(0, delayMs - (Date.now() - previous));
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  hostLastRequest.set(normaliseHost(hostname), Date.now());
}

function robotsAllows(robots: string | null, path: string): boolean {
  if (robots === null) return false;
  let applies = false;
  for (const line of robots.split(/\r?\n/)) {
    const [rawKey, rawValue = ""] = line.split("#", 1)[0]!.split(":", 2);
    const key = rawKey.trim().toLowerCase();
    const value = rawValue.trim();
    if (key === "user-agent") applies = value === "*" || value.toLowerCase() === USER_AGENT.toLowerCase();
    if (key === "disallow" && applies && value && path.startsWith(value)) return false;
  }
  return true;
}

async function getRobots(
  origin: string,
  delayMs: number,
  metrics?: PublicSiteFetcherMetrics,
): Promise<string | null> {
  const cached = robotsCache.get(origin);
  if (cached !== undefined) {
    if (metrics) metrics.cacheHits += 1;
    return cached;
  }
  const robotsUrl = `${origin}/robots.txt`;
  try {
    await waitForHost(new URL(origin).hostname, delayMs);
    if (metrics) metrics.httpRequestsMade += 1;
    const response = await fetch(robotsUrl, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/plain" },
      redirect: "error",
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
    const body = response.ok ? await response.text() : response.status === 404 ? "" : null;
    robotsCache.set(origin, body);
    return body;
  } catch {
    robotsCache.set(origin, null);
    return null;
  }
}

export type PageResult = {
  url: string;
  body: string;
  contentType: string;
};

export class PublicSiteFetcher {
  constructor(
    private readonly delayMs = 1_500,
    private readonly metrics?: PublicSiteFetcherMetrics,
  ) {}

  async fetch(url: string, confirmedHost?: string): Promise<PageResult> {
    let current = new URL(url);
    const baseHost = confirmedHost ?? current.hostname;
    for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
      if (current.protocol !== "https:" || !sameSite(current.hostname, baseHost)) {
        throw new Error("redirect left the confirmed HTTPS employer domain");
      }
      await publicHost(current.hostname);
      const robots = await getRobots(current.origin, this.delayMs, this.metrics);
      if (!robotsAllows(robots, current.pathname)) throw new Error("robots.txt disallows this page");
      await waitForHost(current.hostname, this.delayMs);
      if (this.metrics) this.metrics.httpRequestsMade += 1;
      const response = await fetch(current, {
        headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml,text/plain;q=0.8" },
        redirect: "manual",
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) throw new Error("redirect without location");
        current = new URL(location, current);
        continue;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const contentLength = Number(response.headers.get("content-length") ?? "0");
      if (contentLength > MAX_PAGE_BYTES) throw new Error("page exceeds size limit");
      const body = await response.text();
      if (Buffer.byteLength(body, "utf8") > MAX_PAGE_BYTES) throw new Error("page exceeds size limit");
      return { url: current.toString(), body, contentType: response.headers.get("content-type") ?? "" };
    }
    throw new Error("too many redirects");
  }
}