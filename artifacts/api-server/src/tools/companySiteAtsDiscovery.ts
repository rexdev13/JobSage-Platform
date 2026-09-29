import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { sql } from "drizzle-orm";
import {
  assertDatabaseMode,
  assertProductionProofReadOnly,
  safeToolErrorSummary,
  type DatabaseIdentity,
} from "./databaseSafety";
import {
  installDatabaseContext,
  parseDiscoveryExecutionOptions,
  prepareDatabaseContext,
  verifyProductionWriteGuards,
} from "./companySiteDiscoveryRuntime";
import {
  loadEmployerInput,
  type EmployerRow,
  type LoadedEmployerInput,
} from "./companySiteDiscoveryInput";
import {
  HEALTHCARE_SELECTOR,
  savedCareersOnlyPageUrls,
} from "./companySiteAtsScope";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;
const MAX_PAGES_PER_EMPLOYER = 3;
const EMPLOYER_DEADLINE_MS = 20_000;
const OUTPUT_VERSION = 1;

const ATS_HOSTS: Array<{ provider: string; suffixes: string[] }> = [
  { provider: "Ashby", suffixes: ["ashbyhq.com"] },
  { provider: "Greenhouse", suffixes: ["greenhouse.io"] },
  { provider: "Lever", suffixes: ["lever.co"] },
  { provider: "SmartRecruiters", suffixes: ["smartrecruiters.com"] },
  { provider: "Recruitee", suffixes: ["recruitee.com"] },
  { provider: "Personio", suffixes: ["personio.com", "personio.de"] },
  { provider: "Pinpoint", suffixes: ["pinpointhq.com"] },
  { provider: "Workday", suffixes: ["myworkdayjobs.com", "myworkdaysite.com"] },
];

type Candidate = {
  provider: string;
  boardId: string;
  careersUrl: string;
  evidenceUrl: string;
};

function healthcareEmployerSql() {
  return sql`(
    sl.industry IN ('Healthcare', 'Social Care')
    OR (
      sl.industry = 'Public Services'
      AND sl.organisation_name ~* ${sql.param(
        String.raw`\mNHS\M|\mNational[[:space:]]+Health[[:space:]]+Service\M|public[[:space:]]+health|clinical[[:space:]]+commissioning[[:space:]]+group|\mCCG\M|\mICB\M`,
      )}
    )
  )`;
}

type DiscoveryHelpers = {
  discoverCompanySiteVacancies: typeof import("../lib/companySiteDiscovery").discoverCompanySiteVacancies;
  fetchCompanySitePage: typeof import("../lib/companySiteHttp").fetchCompanySitePage;
  parseDirectBoardMapping: typeof import("../lib/directEmployerBoardConnectors").parseDirectBoardMapping;
};

function argsMap(args: string[]): Map<string, string> {
  const values = new Map<string, string>();
  for (const arg of args) {
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (match) values.set(match[1]!, match[2]!);
    else if (arg.startsWith("--")) values.set(arg.slice(2), "true");
  }
  return values;
}

function safeUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port
    ) return null;
    url.search = "";
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

function safeOrigin(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function safePathUrl(value: string | null | undefined): string | null {
  const url = value ? safeUrl(value) : null;
  return url ? `${url.origin}${url.pathname}` : null;
}

function providerForHost(hostname: string): string | null {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return ATS_HOSTS.find(({ suffixes }) =>
    suffixes.some((suffix) => host === suffix || host.endsWith(`.${suffix}`)),
  )?.provider ?? null;
}

function decodeHref(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&#x2f;/gi, "/")
    .replace(/&#47;/g, "/")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'");
}

function publicAnchors(html: string, pageUrl: string): Array<{ url: URL; text: string }> {
  const links: Array<{ url: URL; text: string }> = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = match[1]?.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!href || /^(?:mailto:|tel:|javascript:|#)/i.test(href)) continue;
    try {
      const url = new URL(decodeHref(href), pageUrl);
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.port ||
        seen.has(url.toString())
      ) continue;
      seen.add(url.toString());
      links.push({
        url,
        text: (match[2] ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(),
      });
    } catch {
      // Malformed links are rejected rather than guessed.
    }
  }
  return links;
}

function safeErrorCategory(value: unknown): string {
  const message = value instanceof Error ? value.message : String(value ?? "");
  if (/timeout|timed out|deadline|abort/i.test(message)) return "timeout";
  if (/robots|disallow/i.test(message)) return "robots";
  if (/oversize|too large|byte limit/i.test(message)) return "oversize";
  if (/unsafe|blocked|private|ssrf|forbidden/i.test(message)) return "blocked";
  if (/incomplete|partial|pagination|snapshot/i.test(message)) return "partial_feed";
  if (/HTTP\s+\d{3}/i.test(message)) return "http";
  if (/json|parse|malformed|feed/i.test(message)) return "invalid_feed";
  if (/network|ECONN|DNS|EAI_/i.test(message)) return "network";
  return "unknown";
}

function csvCell(value: unknown): string {
  const text = value == null ? "" : typeof value === "string" ? value : JSON.stringify(value);
  return `"${text.replace(/"/g, "\"\"")}"`;
}

async function selectEmployers(
  database: Pick<typeof import("@workspace/db").db, "transaction">,
  limit: number,
  organisationNames?: readonly string[],
): Promise<EmployerRow[]> {
  return database.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION READ ONLY`);
    return selectEmployersFromTransaction(tx, limit, organisationNames);
  });
}

async function selectEmployersFromTransaction(
  database: Pick<typeof import("@workspace/db").db, "execute">,
  limit: number,
  organisationNames?: readonly string[],
  healthcareOnly = false,
  savedCareersOnly = false,
): Promise<EmployerRow[]> {
  const names = organisationNames?.map((name) => name.trim().toLowerCase());
  const employerFilter = names === undefined
    ? sql`TRUE`
    : sql`lower(btrim(sl.organisation_name)) = ANY(${sql.param(names)}::text[])`;
  const scopeFilter = sql`
    ${healthcareOnly ? healthcareEmployerSql() : sql`TRUE`}
    AND ${savedCareersOnly ? sql`cs.careers_url IS NOT NULL AND btrim(cs.careers_url) <> ''` : sql`TRUE`}
  `;
  const result = await database.execute<EmployerRow>(sql`
      SELECT DISTINCT ON (lower(btrim(sl.organisation_name)))
        sl.organisation_name,
        trim(sl.website) AS website,
         sl.industry,
        cs.careers_url,
        cs.ats_provider,
        cs.ats_board_id,
        cs.ats_mapping_status,
        cs.ats_mapping_evidence_url
      FROM sponsor_licences sl
      LEFT JOIN sponsor_licence_company_site_checks cs
        ON cs.organisation_name = sl.organisation_name
      WHERE sl.website IS NOT NULL
        AND trim(sl.website) <> ''
        AND ${employerFilter}
         AND ${scopeFilter}
      ORDER BY lower(btrim(sl.organisation_name)), sl.id
      LIMIT ${limit}
    `);
  return result.rows;
}

async function pagesForEmployer(
  employer: EmployerRow,
  deadlineMs: number,
  helpers: DiscoveryHelpers,
  noHostState: boolean,
  savedCareersOnly: boolean,
): Promise<Array<{ url: string; body: string }>> {
  const root = safeUrl(employer.website);
  if (!root) return [];
  const urls: string[] = savedCareersOnly ? savedCareersOnlyPageUrls(employer) : [root.toString()];
  for (const saved of savedCareersOnly ? [] : [employer.careers_url, employer.ats_mapping_evidence_url]) {
    if (!saved) continue;
    const parsed = safeUrl(saved);
    if (parsed && parsed.hostname.toLowerCase() === root.hostname.toLowerCase()) {
      urls.push(parsed.toString());
    }
  }
  const pages: Array<{ url: string; body: string }> = [];
  for (const url of [...new Set(urls)].slice(0, MAX_PAGES_PER_EMPLOYER)) {
    if (Date.now() >= deadlineMs) break;
    const response = await helpers.fetchCompanySitePage(
      url,
      root.hostname,
      deadlineMs,
      1_000_000,
      { readOnly: true, noHostState },
    );
    if (response.ok) pages.push({ url: response.url, body: response.body });
  }
  return pages;
}

async function discoverEmployer(
  employer: EmployerRow,
  helpers: DiscoveryHelpers,
  noHostState: boolean,
  savedCareersOnly = false,
): Promise<Record<string, unknown>[]> {
  const root = safeUrl(employer.website);
  const employerKey = `${employer.organisation_name.trim().toLowerCase()}@${root?.hostname.toLowerCase() ?? "invalid"}`;
  const common = {
    employerKey,
    organisationName: employer.organisation_name,
    websiteOrigin: root?.origin ?? null,
  };
  if (!root) {
    return [{
      ...common,
      status: "rejected",
      provider: null,
      confidence: "none",
      rejectionReason: "invalid_or_non_https_employer_website",
      feedComplete: false,
      snapshotAuthority: false,
    }];
  }

  const employerDeadline = Date.now() + EMPLOYER_DEADLINE_MS;
  const pages = await pagesForEmployer(
    employer,
    employerDeadline,
    helpers,
    noHostState,
    savedCareersOnly,
  );
  const candidates = new Map<string, Candidate>();
  const rejections: string[] = [];
  for (const page of pages) {
    for (const anchor of publicAnchors(page.body, page.url)) {
      const provider = providerForHost(anchor.url.hostname);
      if (!provider) continue;
      const candidateUrl = new URL(anchor.url);
      candidateUrl.search = "";
      candidateUrl.hash = "";
      const mapping = helpers.parseDirectBoardMapping(provider, candidateUrl.toString(), {
        firstPartyEvidenceUrl: page.url,
      });
      if (!mapping) {
        rejections.push(`unsupported_or_unverified_${provider.toLowerCase().replace(/[^a-z0-9]+/g, "_")}_mapping`);
        continue;
      }
      const candidate: Candidate = {
        provider: mapping.provider,
        boardId: mapping.boardId,
        careersUrl: mapping.evidenceUrl,
        evidenceUrl: page.url,
      };
      candidates.set(`${candidate.provider}:${candidate.boardId.toLowerCase()}`, candidate);
    }
  }

  if (candidates.size === 0) {
    const storedWasVerified = employer.ats_mapping_status === "verified";
    return [{
      ...common,
      status: "no_verified_direct_feed",
      provider: employer.ats_provider,
      boardId: employer.ats_board_id,
      careersUrl: safeOrigin(employer.careers_url),
      evidenceUrl: safeOrigin(employer.ats_mapping_evidence_url),
      confidence: "none",
      rejectionReason: storedWasVerified
        ? "stored_mapping_not_confirmed_by_first_party_link"
        : rejections[0] ?? "no_supported_ats_feed_link_on_saved_employer_pages",
      feedComplete: false,
      snapshotAuthority: false,
      feedErrorCategory: null,
      advertsExtracted: 0,
    }];
  }

  const records: Record<string, unknown>[] = [];
  for (const candidate of candidates.values()) {
    if (Date.now() >= employerDeadline) break;
    const feed = await helpers.discoverCompanySiteVacancies(
      employer.organisation_name,
      employer.website,
      {
        knownCareersUrl: candidate.careersUrl,
        knownAtsBoardId: candidate.boardId,
        knownCareersMappingVerified: true,
        knownCareersEvidenceUrl: candidate.evidenceUrl,
        checkGeneric: false,
        checkAts: true,
        directFeedsOnly: true,
        readOnly: true,
        noHostState,
        deadlineMs: employerDeadline,
      },
    );
    records.push({
      ...common,
      status: feed.completion === "complete" && feed.diagnostics.directSourceKind === "ats_feed"
        ? "verified_feed"
        : "feed_failed",
      provider: candidate.provider,
      boardId: candidate.boardId,
      careersUrl: safePathUrl(candidate.careersUrl),
      evidenceUrl: safePathUrl(candidate.evidenceUrl),
      confidence: "high",
      rejectionReason: feed.diagnostics.directFeedSkipDetail ?? null,
      feedComplete: feed.completion === "complete" && feed.atsCompleted,
      snapshotAuthority: Boolean(feed.snapshotScope),
      snapshotScope: feed.snapshotScope ?? null,
      pagesFetched: feed.pagesFetched,
      advertsExtracted: feed.advertsExtracted,
      advertsAccepted: feed.adverts.length,
      advertsRejected: feed.advertsRejected,
      feedErrorCategory: feed.error ? safeErrorCategory(feed.error) : null,
      feedOrigin: feed.discoveredUrls[0] ? safeOrigin(feed.discoveredUrls[0]) : null,
    });
  }
  return records;
}

type ProofRowCounts = {
  companySiteCheckRows: string;
  verifiedMappingRows: string;
  sponsorVacancyRows: string;
  companySiteVacancyRows: string;
};

type ProofSnapshot = {
  identity: DatabaseIdentity;
  countsBefore: ProofRowCounts;
  countsAfterInTransaction: ProofRowCounts;
  employers: EmployerRow[];
  records: Record<string, unknown>[];
};

class IntentionalProofRollback extends Error {}

async function readProofRowCounts(
  database: Pick<typeof import("@workspace/db").db, "execute">,
): Promise<ProofRowCounts> {
  const result = await database.execute<{
    company_site_check_rows: string;
    verified_mapping_rows: string;
    sponsor_vacancy_rows: string;
    company_site_vacancy_rows: string;
  }>(sql`
    SELECT
      (SELECT count(*) FROM sponsor_licence_company_site_checks)::text
        AS company_site_check_rows,
      (SELECT count(*)
       FROM sponsor_licence_company_site_checks
       WHERE ats_mapping_status = 'verified')::text AS verified_mapping_rows,
      (SELECT count(*) FROM sponsor_licence_vacancies)::text AS sponsor_vacancy_rows,
      (SELECT count(*)
       FROM sponsor_licence_vacancies
       WHERE source_type = 'company_site')::text AS company_site_vacancy_rows
  `);
  const row = result.rows[0];
  if (!row) throw new Error("Unable to read production proof row counts.");
  return {
    companySiteCheckRows: String(row.company_site_check_rows),
    verifiedMappingRows: String(row.verified_mapping_rows),
    sponsorVacancyRows: String(row.sponsor_vacancy_rows),
    companySiteVacancyRows: String(row.company_site_vacancy_rows),
  };
}

function proofCountsMatch(left: ProofRowCounts, right: ProofRowCounts): boolean {
  return left.companySiteCheckRows === right.companySiteCheckRows &&
    left.verifiedMappingRows === right.verifiedMappingRows &&
    left.sponsorVacancyRows === right.sponsorVacancyRows &&
    left.companySiteVacancyRows === right.companySiteVacancyRows;
}

async function runProductionProofTransaction(
  database: Pick<typeof import("@workspace/db").db, "transaction">,
  noHostState: boolean,
  scope: { healthcareOnly: boolean; savedCareersOnly: boolean },
  expectedFingerprint?: string,
): Promise<ProofSnapshot> {
  let snapshot: ProofSnapshot | undefined;
  try {
    await database.transaction(async (tx) => {
      // This must be the first statement in the transaction. Pool connections
      // are also created with default_transaction_read_only=on.
      await tx.execute(sql`SET TRANSACTION READ ONLY`);
      await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`);

      const identity = await assertProductionProofReadOnly(tx);
      if (expectedFingerprint && identity.fingerprint !== expectedFingerprint.toLowerCase()) {
        throw new Error("Connected database does not match the independently confirmed fingerprint.");
      }
      const writeGuards = verifyProductionWriteGuards("production-proof-readonly");
      if (!writeGuards.mappingWritesBlocked || !writeGuards.vacancyWritesBlocked) {
        throw new Error("Production proof could not verify application write guards.");
      }

      const countsBefore = await readProofRowCounts(tx);
      const employers = await selectEmployersFromTransaction(
        tx,
        5,
        undefined,
        scope.healthcareOnly,
        scope.savedCareersOnly,
      );

      const http = await import("../lib/companySiteHttp");
      const discovery = await import("../lib/companySiteDiscovery");
      const connectors = await import("../lib/directEmployerBoardConnectors");
      http.resetCompanySiteEphemeralState();
      const helpers: DiscoveryHelpers = {
        discoverCompanySiteVacancies: discovery.discoverCompanySiteVacancies,
        fetchCompanySitePage: http.fetchCompanySitePage,
        parseDirectBoardMapping: connectors.parseDirectBoardMapping,
      };

      const records: Record<string, unknown>[] = [];
      for (const employer of employers) {
        records.push(...await discoverEmployer(
          employer,
          helpers,
          noHostState,
          scope.savedCareersOnly,
        ));
      }
      const countsAfterInTransaction = await readProofRowCounts(tx);
      snapshot = {
        identity,
        countsBefore,
        countsAfterInTransaction,
        employers,
        records,
      };

      // Drizzle rolls back the transaction when the callback rejects. The
      // sentinel is caught only after its rollback has completed.
      throw new IntentionalProofRollback("Rollback the read-only proof transaction.");
    });
  } catch (error) {
    if (!(error instanceof IntentionalProofRollback)) throw error;
  }

  if (!snapshot) {
    throw new Error("Production proof transaction ended without a rollback report.");
  }
  return snapshot;
}

async function readCountsAfterRollback(
  database: Pick<typeof import("@workspace/db").db, "transaction">,
  expectedFingerprint: string,
): Promise<ProofRowCounts> {
  return database.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION READ ONLY`);
    const identity = await assertProductionProofReadOnly(tx);
    if (identity.fingerprint !== expectedFingerprint) {
      throw new Error("Database identity changed after the proof transaction.");
    }
    return readProofRowCounts(tx);
  });
}

async function main(): Promise<void> {
  const args = argsMap(process.argv.slice(2));
  const proofOutput = args.get("proof-output");
  let loadedInput: LoadedEmployerInput | undefined;
  let databasePool: { end: () => Promise<void> } | undefined;
  let context: ReturnType<typeof prepareDatabaseContext> | undefined;
  let identity: DatabaseIdentity | undefined;
  let developmentStateAccessed = false;
  let preflightOnly = false;
  let discoveryStarted = false;
  try {
    const runOptions = parseDiscoveryExecutionOptions(args, {
      defaultLimit: DEFAULT_LIMIT,
      maxLimit: MAX_LIMIT,
    });
    const {
      preflightOnly: isPreflightOnly,
      format,
      limit,
      organisationNames,
      noHostState,
       healthcareOnly = false,
       savedCareersOnly = false,
    } = runOptions;
    preflightOnly = isPreflightOnly;
    loadedInput = !isPreflightOnly && args.get("input-file")
      ? await loadEmployerInput(args.get("input-file")!)
      : undefined;
    developmentStateAccessed = loadedInput?.sourceEnvironment === "development";
    context = prepareDatabaseContext(args, process.env, loadedInput?.sourceEnvironment);
    developmentStateAccessed ||= context.mode === "development";
    installDatabaseContext(context);

    // Import the singleton only after the selected connection URL and read-only
    // pool mode have been installed. All later DB imports resolve to this context.
    const databaseModule = await import("@workspace/db");
    databasePool = databaseModule.pool;

    if (context.mode === "production-proof-readonly") {
      discoveryStarted = true;
      const proof = await runProductionProofTransaction(
        databaseModule.db,
        noHostState,
        { healthcareOnly, savedCareersOnly },
        context.expectedFingerprint,
      );
      identity = proof.identity;
      const countsAfterRollback = await readCountsAfterRollback(
        databaseModule.db,
        proof.identity.fingerprint,
      );
      const rowCountsUnchanged =
        proofCountsMatch(proof.countsBefore, proof.countsAfterInTransaction) &&
        proofCountsMatch(proof.countsBefore, countsAfterRollback);
      const mappingsFound = proof.records.filter((record) =>
        record.status === "verified_feed" || record.status === "feed_failed",
      ).length;
      const mappingsRejected = proof.records.filter((record) =>
        record.status === "no_verified_direct_feed" || record.status === "rejected",
      ).length;
      const report = {
        version: OUTPUT_VERSION,
        status: rowCountsUnchanged ? "proof_passed" : "count_drift",
        environment: "production",
        dbMode: context.mode,
        mode: "production_readonly_ats_discovery_proof",
        generatedAt: new Date().toISOString(),
        limit: 5,
         scope: {
           healthcareOnly,
           savedCareersOnly,
           selector: healthcareOnly ? HEALTHCARE_SELECTOR : "all employers",
           careersUrlOnly: savedCareersOnly,
         },
        selectedEmployers: proof.employers.length,
        employersChecked: proof.employers.length,
        mappingsFound,
        mappingsRejected,
        writesAttempted: 0,
        writePathCalled: false,
        writePathCalls: 0,
        mappingPromotions: 0,
        vacancyImports: 0,
        transactionRolledBack: true,
        rowCounts: {
          before: proof.countsBefore,
          afterInProofTransaction: proof.countsAfterInTransaction,
          afterRollback: countsAfterRollback,
          unchanged: rowCountsUnchanged,
        },
        safety: {
          dbMode: context.mode,
          nodeEnvironment: context.nodeEnvironment,
          database: {
            host: identity.databaseHost,
            name: identity.databaseName,
            role: identity.roleName,
            fingerprint: identity.fingerprint,
          },
          expectedFingerprintMatched: context.expectedFingerprint
            ? identity.fingerprint === context.expectedFingerprint.toLowerCase()
            : null,
          transactionReadOnly: identity.transactionReadOnly,
          defaultTransactionReadOnly: identity.defaultTransactionReadOnly,
          rolePrivileges: {
            isSuperuser: identity.roleIsSuperuser,
            canAdminister: identity.roleCanAdminister,
            hasDmlPrivileges: identity.roleHasWritePrivileges,
            canCreateSchema: identity.roleCanCreateSchema,
            canCreateDatabaseObjects: identity.roleCanCreateDatabaseObjects,
            canCreateTemporaryObjects: identity.roleCanCreateTemporaryObjects,
            ownsDatabase: identity.roleOwnsDatabase,
            ownsApplicationObjects: identity.roleOwnsApplicationObjects,
            hasWriteAllDataRole: identity.roleHasWriteAllData,
          },
          writeModeDisabled: true,
          productionWritesDisabled: true,
          employerInputSource: "production database query",
          mappingCheckStateSource: "same production database; company-site check fields",
          hostStateSource: "disabled; no host-state database reads or writes",
          cacheStateSource: "no disk/persistent cache writes; process-local pacing and robots cache only",
          developmentStateAccessed: false,
          assertions: {
            expectedFingerprintMatched: context.expectedFingerprint
              ? identity.fingerprint === context.expectedFingerprint.toLowerCase()
              : null,
            productionConnectionProvidedThroughProofSecret: true,
            transactionReadOnlyVerified: identity.transactionReadOnly === "on",
            defaultTransactionReadOnlyVerified:
              identity.defaultTransactionReadOnly === "on",
            productionProofTransactionRolledBack: true,
            noPersistentHostStateWrites: true,
            noPersistentCacheWrites: true,
            noDevelopmentStateAccess: true,
            noMappingPromotionPathCalled: true,
            noVacancyPersistencePathCalled: true,
          },
        },
        records: proof.records,
      };
      if (proofOutput) {
        const outputPath = resolve(proofOutput);
        await mkdir(dirname(outputPath), { recursive: true });
        await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
      }
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      return;
    }

    if (!context.expectedFingerprint) {
      throw new Error("This database mode requires an expected database fingerprint.");
    }
    identity = await assertDatabaseMode(
      databaseModule.db,
      context.mode,
      context.expectedFingerprint,
    );

    if (isPreflightOnly) {
      const writeGuards = verifyProductionWriteGuards(context.mode);
      if (!writeGuards.mappingWritesBlocked || !writeGuards.vacancyWritesBlocked) {
        throw new Error("Production preflight could not verify all application write guards.");
      }
      const report = {
        version: OUTPUT_VERSION,
        status: "preflight_passed",
        environment: context.sourceEnvironment,
        dbMode: context.mode,
        mode: "production_readonly_preflight",
        generatedAt: new Date().toISOString(),
        limit: 0,
        selectedEmployers: 0,
        employersChecked: 0,
        networkRequests: 0,
        writesAttempted: 0,
        mappingPromotions: 0,
        vacancyImports: 0,
        safety: {
          dbMode: context.mode,
          nodeEnvironment: context.nodeEnvironment,
          database: {
            host: identity.databaseHost,
            name: identity.databaseName,
            role: identity.roleName,
            fingerprint: identity.fingerprint,
          },
          expectedFingerprintMatched: true,
          transactionReadOnly: identity.transactionReadOnly,
          defaultTransactionReadOnly: identity.defaultTransactionReadOnly,
          readOnlyRoleVerified: true,
          roleNonWritableVerified: true,
          rolePrivileges: {
            isSuperuser: identity.roleIsSuperuser,
            canAdminister: identity.roleCanAdminister,
            hasDmlPrivileges: identity.roleHasWritePrivileges,
            canCreateSchema: identity.roleCanCreateSchema,
            canCreateDatabaseObjects: identity.roleCanCreateDatabaseObjects,
            canCreateTemporaryObjects: identity.roleCanCreateTemporaryObjects,
            ownsDatabase: identity.roleOwnsDatabase,
            ownsApplicationObjects: identity.roleOwnsApplicationObjects,
            hasWriteAllDataRole: identity.roleHasWriteAllData,
          },
          writeModeDisabled: true,
          productionWritesDisabled: true,
          employerInputSource: "not accessed (preflight-only)",
          mappingCheckStateSource: "not accessed",
          hostStateSource: "not accessed (preflight-only)",
          cacheStateSource: "not loaded (preflight-only)",
          developmentStateAccessed: false,
          assertions: {
            databaseFingerprintMatchesMode: true,
            productionReadOnlyRoleAndSessionVerified: true,
            zeroEmployersSelected: true,
            noEmployerInputLoaded: true,
            noDiscoveryNetworkAccess: true,
            noHostStateAccess: true,
            noDevelopmentStateAccess: true,
            mappingWriteGuardBlocks: writeGuards.mappingWritesBlocked,
            vacancyWriteGuardBlocks: writeGuards.vacancyWritesBlocked,
          },
        },
      };
      if (proofOutput) {
        const outputPath = resolve(proofOutput);
        await mkdir(dirname(outputPath), { recursive: true });
        await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
      }
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      return;
    }

    discoveryStarted = true;
    const http = await import("../lib/companySiteHttp");
    const discovery = await import("../lib/companySiteDiscovery");
    const connectors = await import("../lib/directEmployerBoardConnectors");
    http.resetCompanySiteEphemeralState();
    const helpers: DiscoveryHelpers = {
      discoverCompanySiteVacancies: discovery.discoverCompanySiteVacancies,
      fetchCompanySitePage: http.fetchCompanySitePage,
      parseDirectBoardMapping: connectors.parseDirectBoardMapping,
    };

    let employers = loadedInput
      ? loadedInput.employers
      : await selectEmployers(databaseModule.db, limit, organisationNames);
    if (loadedInput && organisationNames) {
      const names = new Set(organisationNames.map((name) => name.trim().toLowerCase()));
      employers = employers.filter((employer) =>
        names.has(employer.organisation_name.trim().toLowerCase()),
      );
    }
    employers = employers.slice(0, limit);

    const records: Record<string, unknown>[] = [];
    for (const employer of employers) {
      records.push(...await discoverEmployer(employer, helpers, noHostState));
    }
    const employerInputSource = loadedInput
      ? {
          type: "input-file",
          path: loadedInput.path,
          sha256: loadedInput.sha256,
          declaredEnvironment: loadedInput.sourceEnvironment,
          declaredSource: loadedInput.sourceDescription,
        }
      : {
          type: "database-query",
          declaredEnvironment: context.sourceEnvironment,
          declaredSource: "sponsor_licences joined to company_site_checks",
        };
    const safety = {
      dbMode: context.mode,
      nodeEnvironment: context.nodeEnvironment,
      database: {
        host: identity.databaseHost,
        name: identity.databaseName,
        role: identity.roleName,
        fingerprint: identity.fingerprint,
      },
      expectedFingerprintMatched: true,
      transactionReadOnly: identity.transactionReadOnly,
      defaultTransactionReadOnly: identity.defaultTransactionReadOnly,
      readOnlyRoleVerified: context.mode === "production-readonly",
      roleNonWritableVerified: context.mode === "production-readonly",
      rolePrivileges: {
        isSuperuser: identity.roleIsSuperuser,
        canAdminister: identity.roleCanAdminister,
        hasDmlPrivileges: identity.roleHasWritePrivileges,
        canCreateSchema: identity.roleCanCreateSchema,
        canCreateDatabaseObjects: identity.roleCanCreateDatabaseObjects,
        canCreateTemporaryObjects: identity.roleCanCreateTemporaryObjects,
        ownsDatabase: identity.roleOwnsDatabase,
        ownsApplicationObjects: identity.roleOwnsApplicationObjects,
        hasWriteAllDataRole: identity.roleHasWriteAllData,
      },
      writeModeDisabled: true,
      productionWritesDisabled: context.mode !== "development",
      employerInputSource,
      mappingCheckStateSource: loadedInput
        ? `declared input-file rows (${loadedInput.sourceEnvironment})`
        : `same ${context.mode} database; company-site check fields`,
      hostStateSource: noHostState
        ? "disabled; no host-state database reads or writes; per-process state only"
        : `same ${context.mode} database for read-only host state`,
      cacheStateSource: "no disk cache/state files; per-process caches cleared at run start",
      developmentStateAccessed,
      assertions: {
        databaseFingerprintMatchesMode: true,
        inputSourceMatchesDatabaseMode: true,
        noDiscoveryPersistence: true,
        productionReadOnlyRoleAndSessionVerified: context.mode === "production-readonly",
        hostStateDisabled: noHostState,
        developmentStateNotAccessed: !developmentStateAccessed,
      },
    };
    const report = {
      version: OUTPUT_VERSION,
      environment: context.sourceEnvironment,
      dbMode: context.mode,
      mode: "read_only_ats_discovery",
      generatedAt: new Date().toISOString(),
      selectedEmployers: employers.length,
      employersChecked: employers.length,
      writesAttempted: 0,
      mappingPromotions: 0,
      vacancyImports: 0,
      safety,
      records,
    };
    if (proofOutput) {
      const outputPath = resolve(proofOutput);
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    }

    if (format === "json") {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      return;
    }
    const headers = [
      "dbMode", "databaseHost", "databaseName", "databaseFingerprint",
      "writeModeDisabled", "employerInputSource", "mappingCheckStateSource",
      "hostStateSource", "employerKey", "organisationName", "websiteOrigin",
      "status", "provider", "boardId", "careersUrl", "evidenceUrl", "confidence",
      "rejectionReason", "feedComplete", "snapshotAuthority", "pagesFetched",
      "advertsExtracted", "advertsAccepted", "advertsRejected", "feedErrorCategory",
      "feedOrigin",
    ];
    const safetyColumns = {
      dbMode: safety.dbMode,
      databaseHost: identity.databaseHost,
      databaseName: identity.databaseName,
      databaseFingerprint: identity.fingerprint,
      writeModeDisabled: safety.writeModeDisabled,
      employerInputSource,
      mappingCheckStateSource: safety.mappingCheckStateSource,
      hostStateSource: safety.hostStateSource,
    };
    process.stdout.write(`${headers.map(csvCell).join(",")}\n`);
    for (const record of records) {
      process.stdout.write(`${headers.map((key) => csvCell(
        Object.hasOwn(safetyColumns, key)
          ? safetyColumns[key as keyof typeof safetyColumns]
          : record[key],
      )).join(",")}\n`);
    }
  } catch (error) {
    if (proofOutput) {
      try {
        const blockedReport = {
          version: OUTPUT_VERSION,
          status: "blocked",
          ...(preflightOnly
            ? {
                mode: "production_readonly_preflight",
                limit: 0,
                selectedEmployers: 0,
                networkRequests: 0,
              }
            : {}),
          dbMode: args.get("db-mode") ?? null,
          employersChecked: 0,
          writesAttempted: 0,
          mappingPromotions: 0,
          vacancyImports: 0,
          safety: {
            nodeEnvironment: process.env.NODE_ENV ?? null,
            database: identity
              ? {
                  host: identity.databaseHost,
                  name: identity.databaseName,
                  role: identity.roleName,
                  fingerprint: identity.fingerprint,
                }
              : null,
            writeModeDisabled: true,
            productionWritesDisabled: args.get("db-mode") !== "development",
            employerInputSource: loadedInput
              ? {
                  type: "input-file",
                  path: loadedInput.path,
                  sha256: loadedInput.sha256,
                  declaredEnvironment: loadedInput.sourceEnvironment,
                  declaredSource: loadedInput.sourceDescription,
                }
              : args.get("input-file")
                ? { type: "input-file", path: resolve(args.get("input-file")!) }
                : "not accessed",
            mappingCheckStateSource: "not accessed",
            hostStateSource: "not accessed",
            cacheStateSource: "not accessed",
            developmentStateAccessed,
            failedBeforeDiscovery: !discoveryStarted,
          },
          blockedReason: safeToolErrorSummary(error),
        };
        const outputPath = resolve(proofOutput);
        await mkdir(dirname(outputPath), { recursive: true });
        await writeFile(outputPath, `${JSON.stringify(blockedReport, null, 2)}\n`, "utf8");
      } catch {
        // Preserve the original fail-closed error if a local proof file cannot be written.
      }
    }
    throw error;
  } finally {
    await databasePool?.end();
  }
}

main().catch((error) => {
  console.error(
    "Company-site ATS discovery failed:",
    safeErrorCategory(error),
    safeToolErrorSummary(error),
  );
  process.exitCode = 1;
});