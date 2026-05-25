import { db } from "@workspace/db";
import { sponsorLicencesTable, sponsorLicenceSyncLogTable } from "@workspace/db";
import { sql } from "drizzle-orm";

const DEFAULT_REGISTER_URL =
  "https://assets.publishing.service.gov.uk/media/6a10190c0026f30a6d421c71/2026-05-22_-_Worker_and_Temporary_Worker.csv";

function getRegisterUrl(): string {
  return process.env["SPONSOR_LICENCE_REGISTER_URL"] ?? DEFAULT_REGISTER_URL;
}

interface ParsedRow {
  organisationName: string;
  townCity: string | null;
  county: string | null;
  route: string | null;
  subRoute: string | null;
  rating: string | null;
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
    throw new Error(`HTTP ${resp.status} ${resp.statusText} fetching register`);
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
    throw new Error(`HTTP ${resp.status} ${resp.statusText} fetching register`);
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
  const url = getRegisterUrl();
  console.log("[sponsor-sync] Starting sync from", url);

  const syncedAt = new Date();

  try {
    const rows = await downloadAndParse(url);
    console.log(`[sponsor-sync] Parsed ${rows.length} records`);

    if (rows.length === 0) throw new Error("No records parsed from register");

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
