import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse as parseCsv } from "csv-parse/sync";
import { db, pool, sponsorLicencesTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { validatePublishedContactEmail } from "../lib/publishedContactEmail";

/**
 * Backfills sponsor_licences.website and contact_email from the repo's
 * verified company-website sector cohort CSVs
 * (artifacts/company-websites-by-sector/*-company-websites.csv).
 *
 * These CSVs were produced by the sponsor-website enrichment programme and
 * carry first-party-verified official_website_url values plus previously
 * harvested published contact emails. Only empty target columns are filled —
 * existing values are never overwritten.
 *
 * Usage:
 *   tsx src/tools/backfillSponsorWebsitesFromCsv.ts <csv>[,<csv>...] [--dry-run]
 */
type Row = {
  sponsor_licence_id?: string;
  organisation_name?: string;
  normalized_organisation_name?: string;
  existing_website?: string;
  existing_contact_email?: string;
  existing_careers_url?: string;
  official_website_url?: string;
  website_confidence?: string;
};

function cleanUrl(value: string | undefined): string | null {
  const raw = value?.trim() ?? "";
  if (!raw) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const fileArgs = args.filter((arg) => !arg.startsWith("--"));
  const csvPaths: string[] = [];
  for (const fileArg of fileArgs) {
    csvPaths.push(...fileArg.split(",").map((part) => resolve(part.trim())));
  }
  if (csvPaths.length === 0) {
    throw new Error("Provide at least one sector CSV path.");
  }

  const seen = new Set<string>();
  let rowsRead = 0;
  let websiteSet = 0;
  let emailSet = 0;
  let careersSet = 0;
  let skippedExisting = 0;
  let skippedInvalid = 0;
  let missingSponsor = 0;
  let ambiguousSponsor = 0;

  const sponsorRows = await db
    .select({
      id: sponsorLicencesTable.id,
      organisationName: sponsorLicencesTable.organisationName,
      website: sponsorLicencesTable.website,
      contactEmail: sponsorLicencesTable.contactEmail,
    })
    .from(sponsorLicencesTable);
  const sponsorByName = new Map<string, typeof sponsorRows>();
  for (const sponsor of sponsorRows) {
    const key = sponsor.organisationName.trim().toLowerCase();
    const list = sponsorByName.get(key) ?? [];
    list.push(sponsor);
    sponsorByName.set(key, list);
  }

  for (const csvPath of csvPaths) {
    const text = await readFile(csvPath, "utf8");
    const rows = parseCsv(text, {
      columns: true,
      skip_empty_lines: true,
      bom: true,
      trim: true,
    }) as Row[];
    for (const row of rows) {
      rowsRead += 1;
      const nameKey = (row.organisation_name ?? "").trim().toLowerCase();
      if (!nameKey || seen.has(nameKey)) continue;
      seen.add(nameKey);

      const website = cleanUrl(row.official_website_url) ?? cleanUrl(row.existing_website);
      const careersUrl = cleanUrl(row.existing_careers_url);
      const email = validatePublishedContactEmail(row.existing_contact_email ?? null);
      if (!website && !email && !careersUrl) {
        skippedInvalid += 1;
        continue;
      }

      const candidates = sponsorByName.get(nameKey) ?? [];
      if (candidates.length === 0) {
        missingSponsor += 1;
        continue;
      }
      if (candidates.length > 1) {
        ambiguousSponsor += 1;
        continue;
      }
      const sponsor = candidates[0]!;

      const needsWebsite = Boolean(website) && !sponsor.website?.trim();
      const needsEmail = Boolean(email) && !sponsor.contactEmail?.trim();
      const needsCareers = Boolean(careersUrl) && needsWebsite &&
        careersUrl !== null && website !== null &&
        new URL(careersUrl).hostname === new URL(website).hostname;
      if (!needsWebsite && !needsEmail && !needsCareers) {
        skippedExisting += 1;
        continue;
      }
      if (!dryRun) {
        await db.execute(sql`
          UPDATE sponsor_licences
          SET website = CASE WHEN ${needsWebsite} THEN ${website} ELSE website END,
              contact_email = CASE WHEN ${needsEmail} THEN ${email} ELSE contact_email END
          WHERE id = ${sponsor.id}
        `);
        if (needsCareers && careersUrl) {
          // careers_url lives on the company-site check row; seeding it gives
          // discovery a first-party hint to verify rather than discover from scratch.
          await db.execute(sql`
            INSERT INTO sponsor_licence_company_site_checks
              (organisation_name, careers_url, updated_at)
            VALUES (${sponsor.organisationName}, ${careersUrl}, NOW())
            ON CONFLICT (organisation_name) DO UPDATE
            SET careers_url = COALESCE(sponsor_licence_company_site_checks.careers_url, EXCLUDED.careers_url),
                updated_at = NOW()
          `);
        }
      }
      if (needsWebsite) websiteSet += 1;
      if (needsEmail) emailSet += 1;
      if (needsCareers) careersSet += 1;
    }
  }

  console.log(JSON.stringify({
    dryRun,
    files: csvPaths.length,
    rowsRead,
    uniqueSponsors: seen.size,
    websiteSet,
    emailSet,
    careersSet,
    skippedExisting,
    skippedInvalid,
    missingSponsor,
    ambiguousSponsor,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error("[backfill-sponsor-websites] Failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
