import { db } from "@workspace/db";
import { sponsorLicencesTable, sponsorLicenceSyncLogTable } from "@workspace/db";
import { sql } from "drizzle-orm";

const DEFAULT_REGISTER_URL =
  "https://assets.publishing.service.gov.uk/media/6824bc5e8d0c8b5e0e3f5e98/2025-05-14_-_Worker_and_Temporary_Worker.xlsx";

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

async function downloadAndParse(url: string): Promise<ParsedRow[]> {
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

  // Find the header row — the Home Office file sometimes has blank rows at top
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
  // The register may have a combined "Type & Rating" column or separate Route/SubRoute/Rating columns
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
      // Example: "Worker-A Rating-Skilled Worker" or "Worker | A-Rating | Skilled Worker"
      const parts = combined.split(/[-|]/).map((p) => p.trim()).filter(Boolean);
      if (parts.length >= 1) route = parts[0] ?? null;
      if (parts.length >= 2) {
        const p1 = parts[1] ?? "";
        if (/rating/i.test(p1)) {
          rating = p1;
          if (parts.length >= 3) subRoute = parts.slice(2).join(" ");
        } else {
          subRoute = p1;
          if (parts.length >= 3) rating = parts[2] ?? null;
        }
      }
    } else {
      if (routeCol >= 0) route = String(row[routeCol] ?? "").trim() || null;
      if (subRouteCol >= 0) subRoute = String(row[subRouteCol] ?? "").trim() || null;
      if (ratingCol >= 0) rating = String(row[ratingCol] ?? "").trim() || null;
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

export async function runSponsorLicenceSync(): Promise<void> {
  const url = getRegisterUrl();
  console.log("[sponsor-sync] Starting sync from", url);

  const syncedAt = new Date();

  try {
    const rows = await downloadAndParse(url);
    console.log(`[sponsor-sync] Parsed ${rows.length} records`);

    if (rows.length === 0) throw new Error("No records parsed from XLSX");

    // Truncate and re-insert — the register is a full snapshot
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
