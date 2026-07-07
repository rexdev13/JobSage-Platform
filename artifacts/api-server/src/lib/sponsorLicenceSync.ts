import { db } from "@workspace/db";
import { sponsorLicencesTable, sponsorLicenceSyncLogTable } from "@workspace/db";
import { sql, lt } from "drizzle-orm";
import { classifyByKeyword } from "./industryClassifier";

export type SyncTriggeredBy = "scheduler" | "manual";

const DEFAULT_REGISTER_URL =
  "https://assets.publishing.service.gov.uk/media/6a47768c1c8bd7ce25a5ea44/SP_-_Worker_and_Temporary_Worker_Web_Register_-_2026-07-03.csv";

const GOV_UK_REGISTER_PAGE =
  "https://www.gov.uk/government/publications/register-of-licensed-sponsors-workers";

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
    console.warn("[sponsor-sync] No CSV/XLSX found on register page — using default URL");
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

function parseTypeRating(raw: string): { route: string | null; rating: string | null } {
  const trimmed = raw.trim();
  if (!trimmed) return { route: null, rating: null };

  const parenMatch = /^(.+?)\s*\((.+?)\)\s*$/.exec(trimmed);
  if (parenMatch) {
    return {
      route: (parenMatch[1] ?? "").trim() || null,
      rating: (parenMatch[2] ?? "").trim() || null,
    };
  }

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

interface SyncDiff {
  rows: ParsedRow[];
  addedCount: number;
  updatedCount: number;
  removedCount: number;
  existingCount: number;
  existingNames: Set<string>;
}

async function attemptSync(url: string): Promise<SyncDiff> {
  const rows = await downloadAndParse(url);
  console.log(`[sponsor-sync] Parsed ${rows.length} records`);

  if (rows.length === 0) throw new Error("No records parsed from register");

  // Load existing org names to compute a real record-level diff.
  // We key on organisation_name (the stable identifier in the register).
  const existingRows = await db
    .select({ organisationName: sponsorLicencesTable.organisationName })
    .from(sponsorLicencesTable);

  const existingCount = existingRows.length;

  if (existingCount > 0 && rows.length < existingCount * 0.5) {
    throw new Error(
      `Safety guard triggered: new data has ${rows.length} rows but DB already has ${existingCount}. ` +
      `Refusing to truncate — possible corrupt/partial source file. ` +
      `Set SPONSOR_LICENCE_REGISTER_URL to override.`,
    );
  }

  // Build org name sets for true diff computation
  const existingNames = new Set(existingRows.map((r) => r.organisationName.toLowerCase().trim()));
  const newNames = new Set(rows.map((r) => r.organisationName.toLowerCase().trim()));

  const addedCount = rows.filter((r) => !existingNames.has(r.organisationName.toLowerCase().trim())).length;
  const removedCount = existingRows.filter((r) => !newNames.has(r.organisationName.toLowerCase().trim())).length;
  const updatedCount = rows.filter((r) => existingNames.has(r.organisationName.toLowerCase().trim())).length;

  return { rows, addedCount, updatedCount, removedCount, existingCount, existingNames };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runSponsorLicenceSync(triggeredBy: SyncTriggeredBy = "scheduler"): Promise<void> {
  const url = getRegisterUrl() ?? await resolveLatestRegisterUrl();
  console.log(`[sponsor-sync] Starting sync from ${url} (triggered by: ${triggeredBy})`);

  const startMs = Date.now();
  const syncedAt = new Date();

  const MAX_ATTEMPTS = 3;
  const RETRY_DELAY_MS = 30_000;

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const { rows, addedCount, updatedCount, removedCount, existingNames } = await attemptSync(url);

      // Process in batches of 500:
      // - UPDATE existing orgs via a bulk VALUES clause (no unique constraint needed)
      // - INSERT new orgs directly
      // This preserves existing IDs (and thus user bookmarks) for continuing orgs.
      const BATCH = 500;
      for (let i = 0; i < rows.length; i += BATCH) {
        const batch = rows.slice(i, i + BATCH);

        const toUpdate = batch.filter((r) => existingNames.has(r.organisationName.toLowerCase().trim()));
        const toInsert = batch.filter((r) => !existingNames.has(r.organisationName.toLowerCase().trim()));

        if (toUpdate.length > 0) {
          // Single UPDATE statement for the whole sub-batch using a VALUES table
          await db.execute(sql`
            UPDATE sponsor_licences AS sl
            SET
              town_city   = d.town_city,
              county      = d.county,
              route       = d.route,
              sub_route   = d.sub_route,
              rating      = d.rating,
              industry    = d.industry,
              synced_at   = d.synced_at
            FROM (VALUES ${sql.join(
              toUpdate.map((r) =>
                sql`(${r.organisationName}::text, ${r.townCity}::text, ${r.county}::text, ${r.route}::text, ${r.subRoute}::text, ${r.rating}::text, ${r.industry}::text, ${syncedAt}::timestamptz)`
              ),
              sql`, `
            )}) AS d(organisation_name, town_city, county, route, sub_route, rating, industry, synced_at)
            WHERE sl.organisation_name = d.organisation_name
          `);
        }

        if (toInsert.length > 0) {
          await db.insert(sponsorLicencesTable).values(
            toInsert.map((r) => ({ ...r, syncedAt })) as any
          );
          // Track newly inserted names so later batches don't re-insert them
          for (const r of toInsert) {
            existingNames.add(r.organisationName.toLowerCase().trim());
          }
        }
      }

      // Remove orgs that were in the old register but not the new one
      await db
        .delete(sponsorLicencesTable)
        .where(lt(sponsorLicencesTable.syncedAt, syncedAt));

      const durationMs = Date.now() - startMs;

      await db.insert(sponsorLicenceSyncLogTable).values({
        status: "success",
        recordCount: rows.length,
        addedCount,
        updatedCount,
        removedCount,
        durationMs,
        triggeredBy,
        errorMessage: null,
      });

      console.log(
        `[sponsor-sync] Sync complete — ${rows.length} records, ` +
        `+${addedCount} added, ~${updatedCount} updated, -${removedCount} removed, ` +
        `${durationMs}ms (attempt ${attempt}/${MAX_ATTEMPTS})`,
      );
      return;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.error(`[sponsor-sync] Attempt ${attempt}/${MAX_ATTEMPTS} failed:`, lastError.message);

      if (attempt < MAX_ATTEMPTS) {
        console.log(`[sponsor-sync] Retrying in ${RETRY_DELAY_MS / 1000}s...`);
        await sleep(RETRY_DELAY_MS);
      }
    }
  }

  const durationMs = Date.now() - startMs;
  const msg = lastError?.message ?? "Unknown error";
  console.error("[sponsor-sync] All attempts failed. Existing data preserved.");

  await db.insert(sponsorLicenceSyncLogTable).values({
    status: "error",
    recordCount: null,
    addedCount: null,
    updatedCount: null,
    removedCount: null,
    durationMs,
    triggeredBy,
    errorMessage: msg.slice(0, 2000),
  }).catch(() => {});

  throw lastError ?? new Error("Sync failed after all retries");
}
