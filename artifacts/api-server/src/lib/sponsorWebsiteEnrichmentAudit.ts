import { db, sponsorLicenceWebsiteEnrichmentAuditsTable } from "@workspace/db";
import type {
  InsertSponsorLicenceWebsiteEnrichmentAudit,
  SponsorWebsiteConfidence,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";

const LEGAL_SUFFIXES =
  /\b(limited|ltd|plc|llp|lp|incorporated|inc|corporation|corp|company|co)\b\.?/gi;
const GENERIC_BRAND_WORDS = new Set([
  "and", "the", "uk", "group", "services", "service", "solutions", "limited",
  "ltd", "plc", "llp", "care", "health", "healthcare", "company",
]);
const SUPPORTED_DIRECT_ATS = new Set(["ashby", "greenhouse", "lever"]);

export function sponsorOrganisationKey(organisationName: string): string {
  return organisationName.normalize("NFKC").trim().toLocaleLowerCase("en-GB");
}

export function sponsorSearchBrand(organisationName: string): string {
  const tradingName = organisationName.match(/\b(?:t\/a|trading\s+as)\s+(.+)$/i)?.[1];
  const base = (tradingName ?? organisationName)
    .replace(LEGAL_SUFFIXES, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return base || organisationName.trim();
}

export function buildSponsorSearchQueries(input: {
  organisationName: string;
  townCity?: string | null;
}): string[] {
  const exact = input.organisationName.trim();
  const brand = sponsorSearchBrand(exact);
  const searchBrand = brand.toLocaleLowerCase("en-GB") === exact.toLocaleLowerCase("en-GB")
    ? exact
    : brand;
  const queries = [
    `"${exact}" official website`,
    `"${searchBrand}" careers jobs`,
    `"${searchBrand}" "${input.townCity?.trim() || "United Kingdom"}" careers`,
  ];
  return [...new Set(queries)];
}

export function scoreSponsorWebsiteCandidate(input: {
  resultTitleMatchesEmployer: boolean;
  resultSnippetMatchesEmployer: boolean;
  domainMatchesBrand: boolean;
  locationMatches: boolean;
  sectorMatches: boolean;
  officialPageIdentityConfirmed: boolean;
  excludedSource: boolean;
}): { score: number; confidence: SponsorWebsiteConfidence } {
  if (input.excludedSource) return { score: -10, confidence: "low" };
  const score =
    Number(input.resultTitleMatchesEmployer) * 3 +
    Number(input.resultSnippetMatchesEmployer) * 2 +
    Number(input.domainMatchesBrand) * 2 +
    Number(input.locationMatches) +
    Number(input.sectorMatches);
  if (input.officialPageIdentityConfirmed && score >= 5) {
    return { score, confidence: "high" };
  }
  if (score >= 2) return { score, confidence: "medium" };
  return { score, confidence: "low" };
}

export function sponsorAtsClassification(provider: string | null | undefined): string | null {
  if (!provider?.trim()) return null;
  return SUPPORTED_DIRECT_ATS.has(provider.trim().toLowerCase())
    ? "supported_ats_discovered"
    : "unsupported_ats_discovered";
}

export async function persistSponsorWebsiteAuditRun(
  records: InsertSponsorLicenceWebsiteEnrichmentAudit[],
): Promise<void> {
  if (process.env.NODE_ENV !== "development") {
    throw new Error("Sponsor website enrichment audit writes are development-only.");
  }
  if (records.length === 0) return;
  const recordKeys = new Set<string>();
  for (const record of records) {
    if (
      typeof record.runId !== "string" ||
      !record.runId.trim() ||
      typeof record.organisationKey !== "string" ||
      !record.organisationKey.trim()
    ) {
      throw new Error("Every sponsor website audit row must have a run ID and organisation key.");
    }
    const compositeKey = `${record.runId}\u0000${record.organisationKey}`;
    if (recordKeys.has(compositeKey)) {
      throw new Error(`Duplicate organisation in sponsor website audit run ${record.runId}.`);
    }
    recordKeys.add(compositeKey);
  }

  await db.transaction(async (tx) => {
    for (const record of records) {
      await tx
        .insert(sponsorLicenceWebsiteEnrichmentAuditsTable)
        .values(record)
        .onConflictDoUpdate({
          target: [
            sponsorLicenceWebsiteEnrichmentAuditsTable.runId,
            sponsorLicenceWebsiteEnrichmentAuditsTable.organisationKey,
          ],
          set: {
            ...record,
            updatedAt: new Date(),
          },
        });
    }
  });
}

export async function getSponsorWebsiteAuditRunCount(runId: string): Promise<number> {
  const rows = await db
    .select({ id: sponsorLicenceWebsiteEnrichmentAuditsTable.id })
    .from(sponsorLicenceWebsiteEnrichmentAuditsTable)
    .where(and(
      eq(sponsorLicenceWebsiteEnrichmentAuditsTable.runId, runId),
    ));
  return rows.length;
}