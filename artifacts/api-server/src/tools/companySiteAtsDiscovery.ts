import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { sql } from "drizzle-orm";
import { assertDatabaseMode, safeToolErrorSummary } from "./databaseSafety";
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
    const names = organisationNames?.map((name) => name.trim().toLowerCase());
    const employerFilter = names === undefined
      ? sql`TRUE`
      : sql`lower(btrim(sl.organisation_name)) = ANY(${sql.param(names)}::text[])`;
    const result = await tx.execute<EmployerRow>(sql`
      SELECT DISTINCT ON (lower(btrim(sl.organisation_name)))
        sl.organisation_name,
        trim(sl.website) AS website,
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
      ORDER BY lower(btrim(sl.organisation_name)), sl.id
      LIMIT ${limit}
    `);
    return result.rows;
  });
}

async function pagesForEmployer(
  employer: EmployerRow,
  deadlineMs: number,
  helpers: DiscoveryHelpers,
  noHostState: boolean,
): Promise<Array<{ url: string; body: string }>> {
  const root = safeUrl(employer.website);
  if (!root) return [];
  const urls: string[] = [root.toString()];
  for (const saved of [employer.careers_url, employer.ats_mapping_evidence_url]) {
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

  const pages = await pagesForEmployer(
    employer,
    Date.now() + EMPLOYER_DEADLINE_MS,
    helpers,
    noHostState,
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
        deadlineMs: Date.now() + EMPLOYER_DEADLINE_MS,
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

async function main(): Promise<void> {
  const args = argsMap(process.argv.slice(2));
  const proofOutput = args.get("proof-output");
  let loadedInput: LoadedEmployerInput | undefined;
  let databasePool: { end: () => Promise<void> } | undefined;
  let context: ReturnType<typeof prepareDatabaseContext> | undefined;
  let identity: Awaited<ReturnType<typeof assertDatabaseMode>> | undefined;
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
      productionWritesDisabled: context.mode === "production-readonly",
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
            productionWritesDisabled: args.get("db-mode") === "production-readonly",
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