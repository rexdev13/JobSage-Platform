import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import { discoverCompanySiteVacancies } from "./companySiteDiscovery";
import { fetchCompanySitePage } from "./companySiteHttp";
import {
  hasPositiveAtsFeedEvidence,
  parseDirectBoardMapping,
} from "./directEmployerBoardConnectors";
import { loadWorkflowReport, saveWorkflowReport, type WorkflowReport } from "./companySiteWorkflowReports";

export const SUPPORTED_PROVIDERS = [
  "Ashby", "Greenhouse", "Lever", "SmartRecruiters", "Recruitee", "Personio", "Pinpoint", "Workday",
] as const;
type Provider = typeof SUPPORTED_PROVIDERS[number];
type Employer = {
  organisation_name: string; website: string; careers_url: string | null;
  ats_provider: string | null; ats_board_id: string | null; ats_mapping_status: string | null;
  ats_mapping_evidence_url: string | null;
};
type Mapping = { organisationName: string; websiteOrigin: string; provider: string; boardId: string; careersUrl: string; evidenceUrl: string };
type Counts = { companySiteCheckRows: string; verifiedMappingRows: string; sponsorVacancyRows: string; companySiteVacancyRows: string };
class WorkflowRollback extends Error {}

function safeUrl(value: string | null | undefined): URL | null {
  try {
    const u = new URL(value ?? "");
    if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
    u.search = ""; u.hash = ""; return u;
  } catch { return null; }
}
function providerForHost(host: string): Provider | null {
  const h = host.toLowerCase();
  const found = SUPPORTED_PROVIDERS.find((p) => {
    const suffix = { Ashby: "ashbyhq.com", Greenhouse: "greenhouse.io", Lever: "lever.co", SmartRecruiters: "smartrecruiters.com", Recruitee: "recruitee.com", Personio: "personio.", Pinpoint: "pinpointhq.com", Workday: "myworkdayjobs.com" }[p];
    return h === suffix || h.endsWith(`.${suffix}`) || (p === "Personio" && /jobs\.personio\.(?:de|com)$/.test(h));
  });
  return found ?? null;
}
function anchors(body: string, pageUrl: string): string[] {
  const result: string[] = [];
  for (const match of body.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi)) {
    try { const u = new URL(match[1]!, pageUrl); if (safeUrl(u.toString())) result.push(u.toString()); } catch { /* reject malformed links */ }
  }
  return [...new Set(result)];
}
async function counts(tx: { execute: typeof db.execute }): Promise<Counts> {
  const result = await tx.execute<{ c: string; v: string; s: string; site: string }>(sql`
    SELECT
      (SELECT count(*) FROM sponsor_licence_company_site_checks)::text c,
      (SELECT count(*) FROM sponsor_licence_company_site_checks WHERE ats_mapping_status='verified')::text v,
      (SELECT count(*) FROM sponsor_licence_vacancies)::text s,
      (SELECT count(*) FROM sponsor_licence_vacancies WHERE source_type='company_site')::text site
  `);
  const row = result.rows[0]; if (!row) throw new Error("Unable to read workflow row counts.");
  return { companySiteCheckRows: row.c, verifiedMappingRows: row.v, sponsorVacancyRows: row.s, companySiteVacancyRows: row.site };
}
function countsEqual(a: Counts, b: Counts): boolean {
  return Object.keys(a).every((key) => a[key as keyof Counts] === b[key as keyof Counts]);
}
function nameFilter(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((name) => typeof name !== "string")) {
    throw new Error("organisationNames must be an array of strings.");
  }
  const names = value as string[];
  const clean = names.map((n) => n.trim()).filter(Boolean);
  if (!clean.length || clean.length > 5 || new Set(clean.map((n) => n.toLowerCase())).size !== clean.length) throw new Error("organisationNames must contain 1–5 unique non-empty names.");
  return clean;
}
function providerFilter(providers?: unknown): Provider[] | undefined {
  if (providers === undefined) return undefined;
  if (!Array.isArray(providers) || providers.length < 1 || providers.some((p) => !SUPPORTED_PROVIDERS.includes(p as Provider))) throw new Error(`providers must contain only supported providers: ${SUPPORTED_PROVIDERS.join(", ")}.`);
  return [...new Set(providers)] as Provider[];
}
async function selectEmployers(tx: { execute: typeof db.execute }, limit: number, names?: string[]): Promise<Employer[]> {
  const result = await tx.execute<Employer>(sql`
    SELECT DISTINCT ON (lower(btrim(sl.organisation_name)))
      sl.organisation_name, trim(sl.website) website, cs.careers_url, cs.ats_provider,
      cs.ats_board_id, cs.ats_mapping_status, cs.ats_mapping_evidence_url
    FROM sponsor_licences sl
    LEFT JOIN sponsor_licence_company_site_checks cs ON cs.organisation_name=sl.organisation_name
    WHERE sl.website IS NOT NULL AND trim(sl.website) <> ''
      AND (${names === undefined ? sql`TRUE` : sql`lower(btrim(sl.organisation_name)) = ANY(${sql.param(names.map((n) => n.toLowerCase()))}::text[])`})
    ORDER BY lower(btrim(sl.organisation_name)), sl.id LIMIT ${limit}
  `);
  return result.rows;
}
async function inspectEmployer(employer: Employer, providers?: Provider[]): Promise<Record<string, unknown>[]> {
  const root = safeUrl(employer.website);
  const common = { organisationName: employer.organisation_name, websiteOrigin: root?.origin ?? null };
  if (!root) return [{ ...common, status: "rejected", rejectionReason: "invalid_or_non_https_employer_website" }];
  const employerDeadline = Date.now() + 20_000;
  const saved = [root.toString(), employer.careers_url, employer.ats_mapping_evidence_url]
    .filter((u): u is string => Boolean(u && safeUrl(u) && new URL(u).hostname.toLowerCase() === root.hostname.toLowerCase()));
  const candidates = new Map<string, Mapping>();
  for (const pageUrl of [...new Set(saved)].slice(0, 3)) {
    const page = await fetchCompanySitePage(pageUrl, root.hostname, employerDeadline, 1_000_000, { readOnly: true, noHostState: true, noProcessCache: true });
    if (!page.ok) continue;
    for (const link of anchors(page.body, page.url)) {
      const provider = providerForHost(new URL(link).hostname);
      if (!provider || (providers && !providers.includes(provider))) continue;
      const parsed = parseDirectBoardMapping(provider, link, { firstPartyEvidenceUrl: page.url });
      if (parsed) candidates.set(`${parsed.provider}:${parsed.boardId.toLowerCase()}`, { organisationName: employer.organisation_name, websiteOrigin: root.origin, provider: parsed.provider, boardId: parsed.boardId, careersUrl: parsed.evidenceUrl, evidenceUrl: page.url });
    }
  }
  const records: Record<string, unknown>[] = [];
  for (const candidate of candidates.values()) {
    const feed = await discoverCompanySiteVacancies(employer.organisation_name, employer.website, {
      knownCareersUrl: candidate.careersUrl, knownAtsBoardId: candidate.boardId, knownCareersMappingVerified: true,
      knownCareersEvidenceUrl: candidate.evidenceUrl, checkGeneric: false, checkAts: true, directFeedsOnly: true,
      readOnly: true, noHostState: true, noProcessCache: true, deadlineMs: employerDeadline,
    });
    const identity = feed.directFeedIdentity;
    const record = {
      ...candidate,
      status: "verified_feed",
      confidence: "high",
      feedComplete: feed.completion === "complete" && feed.atsCompleted,
      identityVerified: identity?.status === "matched",
      feedIdentityStatus: identity?.status ?? "unproven",
      identityClaims: identity?.claims ?? [],
      advertsExtracted: feed.advertsExtracted,
      advertsAccepted: feed.adverts.length,
      evidenceUrl: candidate.evidenceUrl,
    };
    const positive = hasPositiveAtsFeedEvidence(record, candidate.organisationName);
    records.push({
      ...record,
      status: positive ? "verified_feed" : "uncertain",
      confidence: positive ? "high" : "none",
      rejectionReason: positive
        ? null
        : identity?.reason ?? (feed.adverts.length === 0 ? "empty_feed_no_valid_listings" : "feed_not_complete"),
    });
  }
  return records.length > 0
    ? records
    : [{ ...common, status: "rejected", rejectionReason: "no_supported_first_party_ats_link_on_saved_employer_pages", confidence: "none", feedComplete: false, advertsExtracted: 0 }];
}

export async function runReadOnlyDiscovery(input: { limit?: unknown; organisationNames?: unknown; providers?: unknown; providerFilters?: unknown }): Promise<WorkflowReport> {
  const limit = input.limit === undefined ? 5 : input.limit;
  if (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > 5) throw new Error("limit must be an integer from 1 to 5.");
  const names = nameFilter(input.organisationNames);
  const providers = providerFilter(input.providers ?? input.providerFilters);
  let snapshot: { before: Counts; inside: Counts; employers: Employer[]; records: Record<string, unknown>[] } | undefined;
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`);
      await tx.execute(sql`SET TRANSACTION READ ONLY`);
      const before = await counts(tx);
      const employers = await selectEmployers(tx, limit as number, names);
      const records: Record<string, unknown>[] = [];
      for (const employer of employers) records.push(...await inspectEmployer(employer, providers));
      const inside = await counts(tx);
      snapshot = { before, inside, employers, records };
      throw new WorkflowRollback();
    });
  } catch (error) { if (!(error instanceof WorkflowRollback)) throw error; }
  if (!snapshot) throw new Error("Read-only discovery did not produce a rollback snapshot.");
  const after = await db.transaction(async (tx) => { await tx.execute(sql`SET TRANSACTION READ ONLY`); return counts(tx); });
  const unchanged = countsEqual(snapshot.before, snapshot.inside) && countsEqual(snapshot.before, after);
  const report = await saveWorkflowReport("discovery", {
    mode: "read_only_ats_discovery",
    status: unchanged ? "completed" : "proof_failed",
    parameters: input,
    employersChecked: snapshot.employers.length,
    records: snapshot.records,
    verifiedMappingCandidates: snapshot.records.filter((r) => r.status === "verified_feed"),
    rejectedOrUncertain: snapshot.records.filter((r) => r.status !== "verified_feed"),
    providerBreakdown: snapshot.records.reduce<Record<string, number>>((a, r) => {
      if (typeof r.provider === "string") a[r.provider] = (a[r.provider] ?? 0) + 1;
      return a;
    }, {}),
    rowCounts: { before: snapshot.before, afterInTransaction: snapshot.inside, afterRollback: after, unchanged },
    transactionRolledBack: true,
    writesAttempted: 0,
    vacancyImports: 0,
  });
  if (!unchanged) {
    throw new Error(`Read-only discovery could not prove unchanged row counts; reportId=${report.reportId}`);
  }
  return report;
}

type Proposal = { organisationName: string; websiteOrigin: string; provider: string; boardId: string; careersUrl: string; evidenceUrl: string };
function proposalsFrom(report: WorkflowReport, reviewed?: unknown): { proposals: Proposal[]; refused: Record<string, unknown>[] } {
  const records = Array.isArray(reviewed) ? reviewed : report.records;
  if (!Array.isArray(records)) throw new Error("Report has no records.");
  const proposals: Proposal[] = [];
  const refused: Record<string, unknown>[] = [];
  for (const value of records) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      refused.push({ status: "rejected", reason: "mapping_record_is_not_an_object" });
      continue;
    }
    const r = value as Record<string, unknown>;
    const organisationName = typeof r.organisationName === "string" ? r.organisationName : null;
    if (
      r.confidence !== "high" ||
      !hasPositiveAtsFeedEvidence(r, typeof r.organisationName === "string" ? r.organisationName : "")
    ) {
      refused.push({
        organisationName,
        status: "rejected",
        sourceStatus: typeof r.status === "string" ? r.status : "unknown",
        reason: "candidate_lacks_positive_identity_and_nonempty_feed_evidence",
      });
      continue;
    }
    if ([r.organisationName, r.websiteOrigin, r.provider, r.boardId, r.careersUrl, r.evidenceUrl].some((v) => typeof v !== "string")) {
      refused.push({ organisationName, status: "rejected", reason: "mapping_record_is_missing_required_fields" });
      continue;
    }
    const website = safeUrl(r.websiteOrigin as string); const evidence = safeUrl(r.evidenceUrl as string); const careers = safeUrl(r.careersUrl as string);
    if (!website || !evidence || !careers || evidence.hostname !== website.hostname) {
      refused.push({ organisationName, status: "rejected", reason: "mapping_evidence_is_unsafe_or_not_first_party" });
      continue;
    }
    const mapping = parseDirectBoardMapping(r.provider as string, careers.toString(), { firstPartyEvidenceUrl: evidence.toString() });
    if (!mapping || mapping.boardId.toLowerCase() !== String(r.boardId).toLowerCase()) {
      refused.push({ organisationName, status: "rejected", reason: "mapping_does_not_resolve_to_the_reported_supported_board" });
      continue;
    }
    proposals.push({ organisationName: r.organisationName as string, websiteOrigin: website.origin, provider: mapping.provider, boardId: mapping.boardId, careersUrl: mapping.evidenceUrl, evidenceUrl: evidence.toString() });
  }
  const grouped = new Map<string, Proposal[]>();
  for (const proposal of proposals) {
    const key = proposal.organisationName.trim().toLowerCase().replace(/\s+/g, " ");
    const group = grouped.get(key) ?? [];
    group.push(proposal);
    grouped.set(key, group);
  }
  const unambiguous: Proposal[] = [];
  for (const group of grouped.values()) {
    const identities = new Map<string, Proposal>();
    for (const proposal of group) {
      const key = `${proposal.websiteOrigin.toLowerCase()}\u0000${proposal.provider.toLowerCase()}\u0000${proposal.boardId.toLowerCase()}`;
      if (!identities.has(key)) identities.set(key, proposal);
    }
    if (identities.size > 1) {
      refused.push({
        organisationName: group[0]!.organisationName,
        status: "rejected",
        reason: "multiple_mapping_candidates_for_employer",
        candidates: [...identities.values()].map(({ provider, boardId, websiteOrigin }) => ({ provider, boardId, websiteOrigin })),
      });
      continue;
    }
    const proposal = identities.values().next().value as Proposal | undefined;
    if (proposal) unambiguous.push(proposal);
  }
  return { proposals: unambiguous, refused };
}
async function calculateChanges(proposals: Proposal[], tx: { execute: typeof db.execute }, allowOverwrite = false, lock = false): Promise<Record<string, unknown>[]> {
  const changes: Record<string, unknown>[] = [];
  for (const p of proposals) {
    const matches = await tx.execute<{ organisation_name: string; website: string }>(sql`SELECT DISTINCT organisation_name, trim(website) website FROM sponsor_licences WHERE lower(regexp_replace(btrim(organisation_name),'\\s+',' ','g'))=${p.organisationName.trim().toLowerCase().replace(/\s+/g, " ")} AND website IS NOT NULL AND trim(website)<>''`);
    const canonicalNames = new Set(matches.rows.map((row) => row.organisation_name));
    if (canonicalNames.size !== 1) {
      changes.push({
        organisationName: p.organisationName,
        status: "rejected",
        reason: canonicalNames.size ? "ambiguous_employer_identity" : "employer_identity_not_found",
      });
      continue;
    }
    const canonicalOrganisationName = [...canonicalNames][0]!;
    const websiteUrls = matches.rows.map((row) => safeUrl(row.website));
    const targetWebsite = safeUrl(p.websiteOrigin);
    const websiteOrigins = new Set(websiteUrls.filter((url): url is URL => url !== null).map((url) => url.origin.toLowerCase()));
    if (!targetWebsite || websiteUrls.some((url) => !url) || websiteOrigins.size !== 1 || !websiteOrigins.has(targetWebsite.origin.toLowerCase())) {
      changes.push({
        organisationName: canonicalOrganisationName,
        submittedOrganisationName: p.organisationName,
        status: "rejected",
        reason: "employer_website_not_unique_or_matching",
      });
      continue;
    }
    const currentResult = await tx.execute<Record<string, unknown>>(sql`SELECT organisation_name, ats_provider, ats_board_id, ats_mapping_status, ats_mapping_evidence_url, careers_url FROM sponsor_licence_company_site_checks WHERE organisation_name=${canonicalOrganisationName} ${lock ? sql`FOR UPDATE` : sql``}`);
    if (currentResult.rows.length !== 1) {
      changes.push({
        organisationName: canonicalOrganisationName,
        submittedOrganisationName: p.organisationName,
        status: "rejected",
        reason: currentResult.rows.length ? "ambiguous_mapping_rows" : "mapping_row_not_found",
      });
      continue;
    }
    const current = currentResult.rows[0];
    if (!current) continue;
    const before = { atsProvider: current.ats_provider, atsBoardId: current.ats_board_id, atsMappingStatus: current.ats_mapping_status, atsMappingEvidenceUrl: current.ats_mapping_evidence_url, careersUrl: current.careers_url };
    const after = { atsProvider: p.provider, atsBoardId: p.boardId, atsMappingStatus: "verified", atsMappingEvidenceUrl: p.evidenceUrl, careersUrl: p.careersUrl };
    const identity = { organisationName: canonicalOrganisationName, submittedOrganisationName: p.organisationName };
    if (current.ats_mapping_status === "verified" && !allowOverwrite) changes.push({ ...identity, status: "preserved", reason: "verified_overwrite_requires_review", before, after: before });
    else changes.push({ ...identity, websiteOrigin: targetWebsite.origin, status: "dry_run", before, after });
  }
  return changes;
}
export async function runMappingDryRun(input: { discoveryReportId?: unknown; reviewedMappingFile?: unknown; reviewed?: unknown; allowVerifiedOverwrite?: unknown }): Promise<WorkflowReport> {
  if (input.discoveryReportId !== undefined && input.reviewedMappingFile !== undefined) {
    throw new Error("Provide either discoveryReportId or reviewedMappingFile, not both.");
  }
  const stored = typeof input.discoveryReportId === "string" ? await loadWorkflowReport(input.discoveryReportId) : null;
  const reviewedFile = input.reviewedMappingFile && typeof input.reviewedMappingFile === "object"
    ? input.reviewedMappingFile as { records?: unknown[] }
    : null;
  const source = stored ?? (reviewedFile?.records ? {
    reportId: "reviewed-file",
    reportKind: "discovery" as const,
    generatedAt: new Date().toISOString(),
    records: reviewedFile.records,
  } satisfies WorkflowReport : null);
  if (!source || source.reportKind !== "discovery") throw new Error("A valid discovery report ID or reviewed mapping file is required.");
  const { proposals, refused } = proposalsFrom(source, reviewedFile?.records);
  const allowVerifiedOverwrite = input.reviewed === true && input.allowVerifiedOverwrite === true;
  const changes = await db.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION READ ONLY`);
    return calculateChanges(proposals, tx, allowVerifiedOverwrite);
  });
  return saveWorkflowReport("dry-run", {
    mode: "mapping_dry_run", sourceReportId: source.reportId, sourceRecords: source.records,
    proposals, refused, changes, mappingRowsChanged: changes.filter((c) => c.status === "dry_run").length,
    rollback: changes.map((c) => ({ organisationName: c.organisationName, restore: c.before ?? null })),
    reviewed: input.reviewed === true, allowVerifiedOverwrite,
    approvalToken: randomUUID(), writesAttempted: 0,
  });
}
export async function runMappingApply(input: { dryRunReportId?: unknown; approvalToken?: unknown }): Promise<WorkflowReport> {
  if (typeof input.dryRunReportId !== "string" || typeof input.approvalToken !== "string") throw new Error("dryRunReportId and approvalToken are required.");
  const dry = await loadWorkflowReport(input.dryRunReportId);
  if (!dry || dry.reportKind !== "dry-run" || dry.reviewed !== true) throw new Error("Only a reviewed dry-run report may be applied.");
  if (typeof dry.approvalToken !== "string" || input.approvalToken !== dry.approvalToken) throw new Error("approvalToken does not exactly match the reviewed dry-run report.");
  const changes = Array.isArray(dry.changes) ? dry.changes as Record<string, unknown>[] : [];
  const applicable = changes.filter((c) => c.status === "dry_run" && c.before && c.after);
  if (!applicable.length) throw new Error("Dry-run contains no approved mapping changes.");
  const report = await db.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`);
    const locked: Array<Record<string, unknown>> = [];
    for (const expected of applicable) {
      const websiteOrigin = expected.websiteOrigin;
      if (typeof expected.organisationName !== "string" || !expected.organisationName.trim() ||
        typeof websiteOrigin !== "string" || !safeUrl(websiteOrigin)) {
        throw new Error("Dry-run is missing a safe employer identity or website origin.");
      }
      const submittedName = typeof expected.submittedOrganisationName === "string"
        ? expected.submittedOrganisationName
        : expected.organisationName;
      const normalizedName = submittedName.trim().toLowerCase().replace(/\s+/g, " ");
      const sponsor = await tx.execute<{ organisation_name: string; website: string }>(sql`
        SELECT organisation_name, trim(website) website FROM sponsor_licences
        WHERE lower(regexp_replace(btrim(organisation_name),'\\s+',' ','g'))=${normalizedName}
          AND website IS NOT NULL AND trim(website)<>''
        FOR UPDATE
      `);
      const currentNames = new Set(sponsor.rows.map((row) => row.organisation_name));
      const currentWebsites = sponsor.rows.map((row) => safeUrl(row.website));
      const currentOrigins = new Set(currentWebsites
        .filter((url): url is URL => url !== null)
        .map((url) => url.origin.toLowerCase()));
      if (currentNames.size !== 1 || !currentNames.has(expected.organisationName) ||
        currentWebsites.some((url) => !url) || currentOrigins.size !== 1 ||
        !currentOrigins.has(websiteOrigin.toLowerCase())) {
        throw new Error("Sponsor identity or website changed since dry-run; rerun the dry-run.");
      }
      const result = await tx.execute<Record<string, unknown>>(sql`
        SELECT organisation_name, ats_provider, ats_board_id, ats_mapping_status,
               ats_mapping_evidence_url, careers_url
        FROM sponsor_licence_company_site_checks
        WHERE organisation_name=${expected.organisationName as string}
        FOR UPDATE
      `);
      const row = result.rows[0];
      if (result.rows.length !== 1 || !row) {
        throw new Error(`Mapping row missing or ambiguous for ${String(expected.organisationName)}; rerun dry-run.`);
      }
      const current = {
        atsProvider: row.ats_provider, atsBoardId: row.ats_board_id,
        atsMappingStatus: row.ats_mapping_status,
        atsMappingEvidenceUrl: row.ats_mapping_evidence_url, careersUrl: row.careers_url,
      };
      if (JSON.stringify(current) !== JSON.stringify(expected.before)) throw new Error("Mapping before-state changed; rerun dry-run.");
      locked.push({ ...expected, before: current });
    }
    const rollback = locked.map((c) => ({ organisationName: c.organisationName, restore: c.before }));
    const preCommit = await saveWorkflowReport("apply", { mode: "mapping_apply_intent", status: "intent_saved", dryRunReportId: dry.reportId, approvalTokenAccepted: true, changes: locked, rollback, audit: locked.map((c) => ({ organisationName: c.organisationName, fields: ["ats_provider", "ats_board_id", "ats_mapping_status", "ats_mapping_evidence_url", "careers_url"] })) });
    for (const c of locked) {
      const after = c.after as Record<string, string>;
      await tx.execute(sql`UPDATE sponsor_licence_company_site_checks SET ats_provider=${after.atsProvider}, ats_board_id=${after.atsBoardId}, ats_mapping_status='verified', ats_mapping_evidence_url=${after.atsMappingEvidenceUrl}, careers_url=${after.careersUrl} WHERE organisation_name=${c.organisationName}`);
    }
    return preCommit;
  });
  return saveWorkflowReport("apply", { mode: "mapping_apply_committed", status: "committed", intentReportId: report.reportId, dryRunReportId: dry.reportId, changes: report.changes, rollback: report.rollback, audit: report.audit });
}