import { db } from "@workspace/db";
import { sponsorLicencesTable, sponsorLicenceSyncLogTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { classifyByKeyword } from "./industryClassifier";

// Updated July 2026 — GOV.UK publishes a new file each month.
// If resolveLatestRegisterUrl() fails, this is the safe fallback.
const DEFAULT_REGISTER_URL =
  "https://assets.publishing.service.gov.uk/media/6a47768c1c8bd7ce25a5ea44/SP_-_Worker_and_Temporary_Worker_Web_Register_-_2026-07-03.csv";

const GOV_UK_REGISTER_PAGE =
  "https://www.gov.uk/government/publications/register-of-licensed-sponsors-workers";

/**
 * Fetches the GOV.UK register page and extracts the most recent CSV/XLSX URL.
 * Tries multiple patterns to handle GOV.UK page restructures.
 * Falls back to SPONSOR_LICENCE_REGISTER_URL env var, then DEFAULT_REGISTER_URL.
 */
async function resolveLatestRegisterUrl(): Promise<string> {
  try {
    const resp = await fetch(GOV_UK_REGISTER_PAGE, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; JOBSAGE/1.0; +https://jobsage.co.uk)",
        "Accept": "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching register page`);
    const html = await resp.text();

    // Pattern 1: full URL in href or text (covers most GOV.UK asset CDN patterns)
    const patterns = [
      /https:\/\/assets\.publishing\.service\.gov\.uk\/media\/[a-f0-9]+\/[^\s"'<>]+\.(?:csv|xlsx)/gi,
      /https:\/\/assets\.publishing\.service\.gov\.uk\/[^\s"'<>]+Worker[^\s"'<>]+\.(?:csv|xlsx)/gi,
    ];

    for (const pattern of patterns) {
      const matches = [...html.matchAll(pattern)];
      if (matches.length > 0) {
        const url = matches[0]![0]!;
        console.log("[sponsor-sync] Resolved latest register URL:", url);
        return url;
      }
    }
    console.warn("[sponsor-sync] No CSV/XLSX found on register page (html length:", html.length, ") — using default URL");
  } catch (err) {
    console.warn("[sponsor-sync] Failed to resolve latest register URL:", err instanceof Error ? err.message : err);
  }
  return DEFAULT_REGISTER_URL;
}

function getRegisterUrl(): string | null {
  return process.env["SPONSOR_LICENCE_REGISTER_URL"] ?? null;
}

interface ParsedRow {
  organisationName: string;
  townCity: string | null;
  county: string | null;
  route: string | null;
  subRoute: string | null;
  rating: string | null;
  industry: string | null;
}

function normaliseKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findCol(headers: string[], ...candidates: string[]): number {
  for (const c of candidates) {
    const norm = normaliseKey(c);
    const idx = headers.findIndex((h) => normaliseKey(h) === norm);
    if (idx >= 0) return idx;
  }
  return -1;
}

/**
 * Parse "Type & Rating" values like:
 *   "Worker (A rating)"          → route=Worker,  rating=A rating,  subRoute from Route col
 *   "Temporary Worker (A rating)" → route=Temporary Worker, rating=A rating
 *   "Worker-A Rating"             → (older XLSX style)
 */
function parseTypeRating(raw: string): { route: string | null; rating: string | null } {
  const trimmed = raw.trim();
  if (!trimmed) return { route: null, rating: null };

  // Pattern: "Worker (A rating)" or "Temporary Worker (B rating)"
  const parenMatch = /^(.+?)\s*\((.+?)\)\s*$/.exec(trimmed);
  if (parenMatch) {
    return {
      route: (parenMatch[1] ?? "").trim() || null,
      rating: (parenMatch[2] ?? "").trim() || null,
    };
  }

  // Older dash-separated style: "Worker-A Rating-Skilled Worker"
  const parts = trimmed.split(/[-|]/).map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 1) {
    const route = parts[0] ?? null;
    const rating = parts.length >= 2 ? (parts[1] ?? null) : null;
    return { route, rating };
  }

  return { route: trimmed, rating: null };
}

async function downloadAndParseCSV(url: string): Promise<ParsedRow[]> {
  const { parse } = await import("csv-parse");

  const resp = await fetch(url, {
    headers: { "User-Agent": "JOBSAGE/1.0 (sponsor-licence-sync)" },
    signal: AbortSignal.timeout(120_000),
  });

  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} ${resp.statusText} fetching register from ${url}`);
  }

  const text = await resp.text();

  return new Promise((resolve, reject) => {
    parse(
      text,
      { columns: true, skip_empty_lines: true, trim: true, bom: true },
      (err, records: Record<string, string>[]) => {
        if (err) return reject(err);

        const results: ParsedRow[] = [];
        for (const record of records) {
          const org = (record["Organisation Name"] ?? "").trim();
          if (!org) continue;

          const typeRating = record["Type & Rating"] ?? "";
          const { route, rating } = parseTypeRating(typeRating);
          const subRoute = (record["Route"] ?? "").trim() || null;

          results.push({
            organisationName: org,
            townCity: (record["Town/City"] ?? "").trim() || null,
            county: (record["County"] ?? "").trim() || null,
            route,
            subRoute,
            rating,
            industry: classifyByKeyword(org),
          });
        }
        resolve(results);
      },
    );
  });
}

async function downloadAndParseXLSX(url: string): Promise<ParsedRow[]> {
  const { default: XLSX } = await import("xlsx");

  const resp = await fetch(url, {
    headers: { "User-Agent": "JOBSAGE/1.0 (sponsor-licence-sync)" },
    signal: AbortSignal.timeout(120_000),
  });

  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} ${resp.statusText} fetching register from ${url}`);
  }

  const buf = await resp.arrayBuffer();
  const workbook = XLSX.read(new Uint8Array(buf), { type: "array" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("XLSX has no sheets");

  const sheet = workbook.Sheets[sheetName];
  const rows: string[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" }) as string[][];

  if (rows.length < 2) throw new Error("XLSX appears empty");

  let headerRowIdx = 0;
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const row = rows[i];
    if (row && row.some((c) => normaliseKey(String(c)).includes("organisation"))) {
      headerRowIdx = i;
      break;
    }
  }

  const headers = (rows[headerRowIdx] ?? []).map((h) => String(h));
  const orgCol = findCol(headers, "Organisation Name", "OrganisationName", "Organisation");
  const townCol = findCol(headers, "Town/City", "Town", "City", "TownCity");
  const countyCol = findCol(headers, "County");
  const typeRatingCol = findCol(headers, "Type & Rating", "TypeRating", "Type&Rating");
  const routeCol = findCol(headers, "Route", "Worker Route");
  const subRouteCol = findCol(headers, "Sub Route", "SubRoute");
  const ratingCol = findCol(headers, "Rating");

  if (orgCol < 0) throw new Error("Could not find Organisation Name column in XLSX");

  const results: ParsedRow[] = [];
  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const org = String(row[orgCol] ?? "").trim();
    if (!org) continue;

    let route: string | null = null;
    let subRoute: string | null = null;
    let rating: string | null = null;

    if (typeRatingCol >= 0) {
      const combined = String(row[typeRatingCol] ?? "").trim();
      const parsed = parseTypeRating(combined);
      route = parsed.route;
      rating = parsed.rating;
    } else {
      if (routeCol >= 0) route = String(row[routeCol] ?? "").trim() || null;
      if (ratingCol >= 0) rating = String(row[ratingCol] ?? "").trim() || null;
    }

    if (subRouteCol >= 0) subRoute = String(row[subRouteCol] ?? "").trim() || null;
    // For XLSX with Route column but no SubRoute column, use routeCol as subRoute
    else if (routeCol >= 0 && typeRatingCol >= 0) {
      subRoute = String(row[routeCol] ?? "").trim() || null;
    }

    results.push({
      organisationName: org,
      townCity: townCol >= 0 ? (String(row[townCol] ?? "").trim() || null) : null,
      county: countyCol >= 0 ? (String(row[countyCol] ?? "").trim() || null) : null,
      route,
      subRoute,
      rating,
      industry: classifyByKeyword(org),
    });
  }

  return results;
}

async function downloadAndParse(url: string): Promise<ParsedRow[]> {
  const lowerUrl = url.toLowerCase().split("?")[0] ?? "";
  if (lowerUrl.endsWith(".csv")) {
    return downloadAndParseCSV(url);
  }
  return downloadAndParseXLSX(url);
}

export async function runSponsorLicenceSync(): Promise<void> {
  // Prefer explicit env var, otherwise auto-resolve the latest URL from GOV.UK
  const url = getRegisterUrl() ?? await resolveLatestRegisterUrl();
  console.log("[sponsor-sync] Starting sync from", url);

  const syncedAt = new Date();

  try {
    const rows = await downloadAndParse(url);
    console.log(`[sponsor-sync] Parsed ${rows.length} records`);

    if (rows.length === 0) throw new Error("No records parsed from register");

    // Safety guard: abort if the new dataset is less than 50% of what's already in the DB.
    // This catches cases where a truncated/corrupt file would silently replace good data.
    const [{ existingCount }] = await db
      .select({ existingCount: sql<number>`cast(count(*) as int)` })
      .from(sponsorLicencesTable);
    if (existingCount > 0 && rows.length < existingCount * 0.5) {
      throw new Error(
        `Safety guard triggered: new data has ${rows.length} rows but DB already has ${existingCount}. ` +
        `Refusing to truncate — possible corrupt/partial source file. ` +
        `Set SPONSOR_LICENCE_REGISTER_URL to override.`,
      );
    }

    // Note: AI classification is intentionally skipped here to keep sync fast.
    // Rows with industry=null (no keyword match) are picked up by the industry backfill
    // process which runs on server startup and handles AI classification in the background.

    await db.transaction(async (tx) => {
      await tx.execute(sql`TRUNCATE TABLE sponsor_licences RESTART IDENTITY`);
      const BATCH = 500;
      for (let i = 0; i < rows.length; i += BATCH) {
        const batch = rows.slice(i, i + BATCH).map((r) => ({ ...r, syncedAt }));
        await tx.insert(sponsorLicencesTable).values(batch);
      }
    });

    await db.insert(sponsorLicenceSyncLogTable).values({
      status: "success",
      recordCount: rows.length,
      errorMessage: null,
    });

    console.log(`[sponsor-sync] Sync complete — ${rows.length} records`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[sponsor-sync] Sync failed:", msg);
    await db.insert(sponsorLicenceSyncLogTable).values({
      status: "error",
      recordCount: null,
      errorMessage: msg.slice(0, 2000),
    }).catch(() => {});
    throw err;
  }
}
