import type { CompanySiteFetchResult } from "./companySiteHttp";

export type CompanySiteEvidenceSource =
  | "employer_site"
  | "operator_supplied_first_party_evidence";

export type CompanySiteEvidencePage = {
  url: string;
  body: string;
  source: CompanySiteEvidenceSource;
};

export type CompanySiteEvidenceAttempt = {
  url: string;
  source: CompanySiteEvidenceSource;
  fetched: boolean;
  status?: number;
  failureKind?: string;
  reason?: string;
  invalidFirstParty?: boolean;
  notAttemptedAfterRateLimit?: boolean;
  notAttemptedReason?: "page_limit" | "deadline";
};

export async function fetchCompanySiteEvidencePages(input: {
  scheduled: Array<{ url: string; source: CompanySiteEvidenceSource }>;
  originHostname: string;
  deadlineMs: number;
  noHostState: boolean;
  fetchPage: (
    url: string,
    originHostname: string,
    deadlineMs: number,
    maxBytes: number,
    options: { readOnly: true; noHostState: boolean },
  ) => Promise<CompanySiteFetchResult>;
}): Promise<{ pages: CompanySiteEvidencePage[]; attempts: CompanySiteEvidenceAttempt[] }> {
  const pages: CompanySiteEvidencePage[] = [];
  const attempts: CompanySiteEvidenceAttempt[] = [];
  const rateLimitedHosts = new Set<string>();
  for (const [index, item] of input.scheduled.entries()) {
    if (Date.now() >= input.deadlineMs) {
      attempts.push(...input.scheduled.slice(index).map((unattempted) => ({
        url: unattempted.url,
        source: unattempted.source,
        fetched: false,
        failureKind: "deadline",
        reason: "not attempted because the employer deadline was reached",
        notAttemptedReason: "deadline" as const,
      })));
      break;
    }
    const host = new URL(item.url).hostname.toLowerCase();
    if (rateLimitedHosts.has(host)) {
      attempts.push({
        url: item.url,
        source: item.source,
        fetched: false,
        failureKind: "rate_limited",
        reason: "not retried after a rate limit on this host",
        notAttemptedAfterRateLimit: true,
      });
      continue;
    }
    const response = await input.fetchPage(
      item.url,
      input.originHostname,
      input.deadlineMs,
      1_000_000,
      { readOnly: true, noHostState: input.noHostState },
    );
    if (response.ok) {
      pages.push({ url: response.url, body: response.body, source: item.source });
      attempts.push({
        url: response.url,
        source: item.source,
        fetched: true,
        status: response.status,
      });
      continue;
    }
    attempts.push({
      url: item.url,
      source: item.source,
      fetched: false,
      ...(response.status === undefined ? {} : { status: response.status }),
      failureKind: response.kind,
      reason: response.reason.slice(0, 300),
    });
    if (response.kind === "rate_limited" || response.status === 429) {
      rateLimitedHosts.add(host);
    }
  }
  return { pages, attempts };
}
