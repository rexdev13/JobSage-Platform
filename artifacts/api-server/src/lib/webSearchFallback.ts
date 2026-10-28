/**
 * Keyless web search for sponsor discovery tools.
 * Order: Brave Search API (when BRAVE_API_KEY set and quota remains) →
 * Bing HTML results (keyless; ~1 req / 1.5s polite delay handled by callers).
 * Returns plain result URLs+snippets so callers stay engine-agnostic.
 */

export interface WebSearchResult {
  url: string;
  title: string;
  description: string;
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function decodeBingRedirect(href: string): string | null {
  try {
    const u = new URL(href);
    if (!u.hostname.endsWith("bing.com")) return href.startsWith("http") ? href : null;
    const enc = u.searchParams.get("u");
    if (!enc) return null;
    const raw = enc.startsWith("a1") ? enc.slice(2) : enc;
    const b64 = raw.replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4 === 0 ? b64 : b64 + "=".repeat(4 - (b64.length % 4));
    const decoded = Buffer.from(pad, "base64").toString("utf8");
    return decoded.startsWith("http") ? decoded : null;
  } catch {
    return null;
  }
}

async function braveSearch(q: string, count: number): Promise<WebSearchResult[] | null> {
  const key = process.env["BRAVE_API_KEY"];
  if (!key) return null;
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", q);
  url.searchParams.set("count", String(count));
  const res = await fetch(url, {
    headers: { "X-Subscription-Token": key, Accept: "application/json" },
  });
  if (res.status === 402 || res.status === 429) return null; // quota gone → fall through
  if (!res.ok) throw new Error(`brave HTTP ${res.status}`);
  const data = (await res.json()) as {
    web?: { results?: Array<{ url?: string; title?: string; description?: string }> };
  };
  return (data.web?.results ?? [])
    .filter((r): r is { url: string; title?: string; description?: string } => Boolean(r.url))
    .map((r) => ({ url: r.url, title: r.title ?? "", description: r.description ?? "" }));
}

function extractTag(block: string, re: RegExp): string {
  return block.match(re)?.[1]?.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&")
    .replace(/&#\d+;/g, " ").trim() ?? "";
}

export async function bingSearch(q: string, count = 10): Promise<WebSearchResult[]> {
  const url = new URL("https://www.bing.com/search");
  url.searchParams.set("q", q);
  url.searchParams.set("count", String(Math.min(30, count)));
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "en-GB,en;q=0.9" } });
  if (!res.ok) throw new Error(`bing HTTP ${res.status}`);
  const html = await res.text();
  const out: WebSearchResult[] = [];
  for (const m of html.matchAll(/<li class="b_algo"[\s\S]*?<h2[^>]*><a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>([\s\S]*?)<\/li>/g)) {
    const decoded = decodeBingRedirect(m[1].replace(/&amp;/g, "&"));
    if (!decoded) continue;
    out.push({
      url: decoded,
      title: extractTag(m[2], /([\s\S]*)/),
      description: extractTag(m[3], /<p[^>]*>([\s\S]*?)<\/p>/),
    });
    if (out.length >= count) break;
  }
  return out;
}

/** Brave when keyed and in quota, otherwise Bing. null when both fail. */
export async function webSearch(q: string, count = 8): Promise<WebSearchResult[] | null> {
  const brave = await braveSearch(q, count).catch(() => null);
  if (brave && brave.length > 0) return brave;
  const bing = await bingSearch(q, count).catch(() => null);
  return bing && bing.length > 0 ? bing : null;
}
