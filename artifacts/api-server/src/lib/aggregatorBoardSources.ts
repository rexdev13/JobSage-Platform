/**
 * Aggregator job-board APIs (Jooble + Adzuna) as free-board sources.
 * Both are queried with weak-sector keywords; each fetchPage performs exactly
 * one API call so the free-tier rate budgets are spent predictably.
 * Keys come from env: JOOBLE_API_KEY, ADZUNA_APP_ID, ADZUNA_APP_KEY.
 * A missing key makes that source return an empty first page (no-op).
 */
import {
  makeAdvert,
  type FreeBoardPage,
  type FreeBoardSource,
} from "./freeBoardSources";

export const AGGREGATOR_WEAK_SECTOR_KEYWORDS: readonly string[] = [
  "security guard", "security officer", "door supervisor", "cctv",
  "care assistant", "support worker", "care worker", "domiciliary care",
  "beauty therapist", "hairdresser", "nail technician", "aesthetic practitioner",
  "cleaner", "housekeeper", "domestic assistant",
  "warehouse operative", "production operative", "machine operator",
  "cnc machinist", "welder", "fabricator", "assembler", "forklift driver",
  "factory worker", "packer",
  "chef", "kitchen porter", "kitchen assistant", "waiter", "barista", "hospitality",
  "farm worker", "agricultural worker", "horticulture", "gardener",
  "retail assistant", "sales assistant", "shop assistant",
  "hgv driver", "delivery driver", "bus driver", "van driver",
  "hotel receptionist", "maintenance engineer", "groundworker", "labourer",
];

type Cursor = { k: number; p: number };

function parseCursor(raw: string | null): Cursor {
  if (!raw) return { k: 0, p: 1 };
  try {
    const parsed = JSON.parse(raw) as Partial<Cursor>;
    return { k: Math.max(0, parsed.k ?? 0), p: Math.max(1, parsed.p ?? 1) };
  } catch {
    return { k: 0, p: 1 };
  }
}

const MAX_PAGES_PER_KEYWORD = 8;

function nextCursor(k: number, p: number, morePages: boolean): string | null {
  if (morePages && p < MAX_PAGES_PER_KEYWORD) return JSON.stringify({ k, p: p + 1 });
  const nk = k + 1;
  return nk < AGGREGATOR_WEAK_SECTOR_KEYWORDS.length ? JSON.stringify({ k: nk, p: 1 }) : null;
}

async function postJson(url: string, body: unknown, deadlineMs: number): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.min(15_000, Math.max(1, deadlineMs - Date.now())));
  try {
    const response = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`API returned HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

// Keyed API access is authorized by contract, not governed by robots.txt,
// so this plain GET skips the robots-gated fetchText path on purpose.
async function getJson(url: string, deadlineMs: number): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.min(15_000, Math.max(1, deadlineMs - Date.now())));
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`API returned HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function warnedMissingKey(source: string, envVar: string): void {
  console.warn(`[${source}] ${envVar} not set — source disabled`);
}

export const AGGREGATOR_BOARD_SOURCES: readonly FreeBoardSource[] = [
  {
    id: "jooble",
    provider: "jooble",
    boardName: "Jooble",
    parserVersion: "jooble-api-v1",
    maxPagesPerRun: 200,
    async fetchPage({ cursor, deadlineMs }): Promise<FreeBoardPage> {
      const key = process.env["JOOBLE_API_KEY"];
      if (!key) { warnedMissingKey("jooble", "JOOBLE_API_KEY"); return { adverts: [], nextCursor: null }; }
      const { k, p } = parseCursor(cursor);
      const keywords = AGGREGATOR_WEAK_SECTOR_KEYWORDS[k];
      if (!keywords) return { adverts: [], nextCursor: null };
      const text = await postJson(`https://jooble.org/api/${encodeURIComponent(key)}`, {
        keywords,
        location: "United Kingdom",
        page: p,
      }, deadlineMs);
      const data = JSON.parse(text) as {
        totalCount?: number;
        jobs?: Array<{
          id?: string | number; title?: string; company?: string; link?: string;
          location?: string; salary?: string; snippet?: string; updated?: string; type?: string;
        }>;
      };
      const jobs = Array.isArray(data.jobs) ? data.jobs : [];
      const source = { id: "jooble", provider: "jooble", boardName: "Jooble", parserVersion: "jooble-api-v1" };
      const adverts = jobs
        .filter((j) => j.title && j.link && j.company?.trim())
        .map((j) => makeAdvert(source, {
          externalId: j.id ?? j.link, title: j.title, employer: j.company ?? "", url: j.link,
          location: j.location, salary: j.salary, description: j.snippet, postedDate: j.updated,
          metadata: { keyword: keywords, jobType: j.type },
        }));
      const morePages = jobs.length > 0 && (data.totalCount ?? 0) > p * jobs.length;
      return {
        adverts,
        nextCursor: nextCursor(k, p, morePages),
        recordsFetched: jobs.length,
        reportedTotal: data.totalCount ?? undefined,
      };
    },
  },
  {
    id: "adzuna",
    provider: "adzuna",
    boardName: "Adzuna",
    parserVersion: "adzuna-api-v1",
    maxPagesPerRun: 200,
    async fetchPage({ cursor, deadlineMs }): Promise<FreeBoardPage> {
      const appId = process.env["ADZUNA_APP_ID"];
      const appKey = process.env["ADZUNA_APP_KEY"];
      if (!appId || !appKey) { warnedMissingKey("adzuna", "ADZUNA_APP_ID/ADZUNA_APP_KEY"); return { adverts: [], nextCursor: null }; }
      const { k, p } = parseCursor(cursor);
      const keywords = AGGREGATOR_WEAK_SECTOR_KEYWORDS[k];
      if (!keywords) return { adverts: [], nextCursor: null };
      const url = new URL(`https://api.adzuna.com/v1/api/jobs/gb/search/${p}`);
      url.searchParams.set("app_id", appId);
      url.searchParams.set("app_key", appKey);
      url.searchParams.set("results_per_page", "50");
      url.searchParams.set("what", keywords);
      url.searchParams.set("content-type", "application/json");
      const text = await getJson(url.toString(), deadlineMs);
      const data = JSON.parse(text) as {
        count?: number;
        results?: Array<{
          id?: string | number; title?: string; company?: { display_name?: string };
          location?: { display_name?: string }; redirect_url?: string; created?: string;
          description?: string; salary_min?: number; salary_max?: number; category?: { label?: string };
        }>;
      };
      const jobs = Array.isArray(data.results) ? data.results : [];
      const source = { id: "adzuna", provider: "adzuna", boardName: "Adzuna", parserVersion: "adzuna-api-v1" };
      const adverts = jobs
        .filter((j) => j.title && j.redirect_url && j.company?.display_name?.trim())
        .map((j) => makeAdvert(source, {
          externalId: j.id ?? j.redirect_url, title: j.title, employer: j.company?.display_name ?? "",
          url: j.redirect_url, location: j.location?.display_name,
          salary: j.salary_min && j.salary_max
            ? `${Math.round(j.salary_min)}-${Math.round(j.salary_max)}`
            : j.salary_min ? `${Math.round(j.salary_min)}+` : undefined,
          description: j.description, postedDate: j.created,
          metadata: { keyword: keywords, category: j.category?.label },
        }));
      const morePages = jobs.length > 0 && (data.count ?? 0) > p * 50;
      return {
        adverts,
        nextCursor: nextCursor(k, p, morePages),
        recordsFetched: jobs.length,
        reportedTotal: data.count ?? undefined,
      };
    },
  },
];
