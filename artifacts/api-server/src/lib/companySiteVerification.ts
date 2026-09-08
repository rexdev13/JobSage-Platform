import { db, sponsorLicenceVacanciesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { EXPIRATION_PHRASES, softNotFoundReason } from "./linkHealth";
import { fetchCompanySitePage, COMPANY_SITE_EMPLOYER_BUDGET_MS } from "./companySiteHttp";
import { isBlockedVacancyUrl, isValidVacancyUrlForSource } from "./vacancyUrlPolicy";

export type CompanySiteVerificationItem = {
  id: number;
  url: string | null | undefined;
};

type VerificationOutcome = "live" | "dead" | "inconclusive" | "skipped";

async function writeDead(id: number, reason: string): Promise<"dead"> {
  await db
    .update(sponsorLicenceVacanciesTable)
    .set({
      liveness: "dead",
      lastVerifiedAt: new Date(),
      livenessReason: reason.slice(0, 500),
    })
    .where(eq(sponsorLicenceVacanciesTable.id, id));
  return "dead";
}

export async function verifyCompanySiteStoredLink(
  id: number,
  url: string | null | undefined,
  deadlineMs?: number,
): Promise<VerificationOutcome> {
  if (!url || !isValidVacancyUrlForSource(url, "company_site") || isBlockedVacancyUrl(url)) {
    return url ? writeDead(id, "invalid or blocked company-site vacancy URL") : "skipped";
  }
  const originHostname = new URL(url).hostname;
  const result = await fetchCompanySitePage(
    url,
    originHostname,
    Math.min(
      Date.now() + COMPANY_SITE_EMPLOYER_BUDGET_MS,
      deadlineMs ?? Number.POSITIVE_INFINITY,
    ),
  );
  if (!result.ok) {
    if (
      result.kind === "unsafe" ||
      result.status === 404 ||
      result.status === 410
    ) {
      return writeDead(id, result.reason);
    }
    await db
      .update(sponsorLicenceVacanciesTable)
      .set({ lastVerifiedAt: new Date(), livenessReason: result.reason.slice(0, 500) })
      .where(eq(sponsorLicenceVacanciesTable.id, id))
      .catch(() => {});
    return "inconclusive";
  }
  const softNotFound = softNotFoundReason(result.url, result.body);
  if (softNotFound) {
    return writeDead(id, softNotFound);
  }
  if (
    isBlockedVacancyUrl(result.url) ||
    !isValidVacancyUrlForSource(result.url, "company_site")
  ) {
    return writeDead(id, "redirected to a blocked or non-vacancy destination");
  }
  const lowerBody = result.body.toLowerCase();
  const expirationPhrase = EXPIRATION_PHRASES.find((phrase) => lowerBody.includes(phrase));
  if (expirationPhrase) {
    return writeDead(id, `expiration phrase: "${expirationPhrase}"`);
  }
  if (/\/(?:login|log-in|signin|sign-in|account)(?:\/|$)/i.test(new URL(result.url).pathname)) {
    return writeDead(id, "login wall: redirected to sign-in page");
  }
  await db
    .update(sponsorLicenceVacanciesTable)
    .set({ liveness: "live", lastVerifiedAt: new Date(), livenessReason: null })
    .where(eq(sponsorLicenceVacanciesTable.id, id));
  return "live";
}

export function queueCompanySiteVerificationBatch(
  items: CompanySiteVerificationItem[],
): void {
  const withUrls = items.filter(
    (item): item is { id: number; url: string } => typeof item.url === "string" && item.url !== "",
  );
  if (withUrls.length === 0) return;
  void (async () => {
    for (const item of withUrls) {
      await verifyCompanySiteStoredLink(item.id, item.url).catch(() => {});
    }
    console.info(`[company-site-verify] ingestion batch complete (${withUrls.length} links)`);
  })();
}