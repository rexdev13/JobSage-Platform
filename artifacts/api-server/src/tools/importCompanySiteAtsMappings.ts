import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { sql } from "drizzle-orm";
import { assertDatabaseMode, safeToolErrorSummary } from "./databaseSafety";
import {
  assertWritesAllowed,
  installDatabaseContext,
  prepareDatabaseContext,
  type DiscoverySourceEnvironment,
} from "./companySiteDiscoveryRuntime";

type DiscoveryRecord = {
  organisationName?: string;
  websiteOrigin?: string | null;
  status?: string;
  provider?: string | null;
  boardId?: string | null;
  careersUrl?: string | null;
  evidenceUrl?: string | null;
  confidence?: string;
  feedComplete?: boolean;
  feedErrorCategory?: string | null;
};

type MappingProposal = {
  organisationName: string;
  websiteOrigin: string;
  provider: string;
  boardId: string;
  careersUrl: string;
  evidenceUrl: string;
};

type CurrentMapping = {
  organisation_name: string;
  ats_provider: string | null;
  ats_board_id: string | null;
  ats_mapping_status: string | null;
  ats_mapping_evidence_url: string | null;
  careers_url: string | null;
};

type DiscoveryReportInput = {
  environment?: DiscoverySourceEnvironment;
  dbMode?: string;
  safety?: {
    database?: { fingerprint?: string };
    employerInputSource?: {
      declaredEnvironment?: DiscoverySourceEnvironment;
      declaredSource?: string;
    };
  };
  records?: DiscoveryRecord[];
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

function safeSiteUrl(value: string | null | undefined): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    url.search = "";
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function proposalFromRecord(
  record: DiscoveryRecord,
  parseDirectBoardMapping: typeof import("../lib/directEmployerBoardConnectors").parseDirectBoardMapping,
): MappingProposal | null {
  if (
    record.status !== "verified_feed" ||
    record.confidence !== "high" ||
    record.feedComplete !== true ||
    record.feedErrorCategory ||
    !record.organisationName ||
    !record.websiteOrigin ||
    !record.provider ||
    !record.boardId ||
    !record.careersUrl ||
    !record.evidenceUrl
  ) return null;

  const website = safeSiteUrl(record.websiteOrigin);
  const evidence = safeSiteUrl(record.evidenceUrl);
  const careers = safeSiteUrl(record.careersUrl);
  if (
    !website || !evidence || !careers ||
    evidence.hostname.toLowerCase() !== website.hostname.toLowerCase()
  ) return null;

  const mapping = parseDirectBoardMapping(record.provider, careers.toString(), {
    firstPartyEvidenceUrl: evidence.toString(),
  });
  if (!mapping || mapping.boardId.toLowerCase() !== record.boardId.toLowerCase()) return null;
  return {
    organisationName: record.organisationName.trim(),
    websiteOrigin: website.origin,
    provider: mapping.provider,
    boardId: mapping.boardId,
    careersUrl: mapping.evidenceUrl,
    evidenceUrl: evidence.toString(),
  };
}

async function readDiscoveryInput(filePath: string): Promise<{
  input: DiscoveryReportInput;
  path: string;
  sha256: string;
}> {
  const path = await realpath(resolve(filePath));
  const content = await readFile(path);
  if (content.byteLength > 10_000_000) {
    throw new Error("--input-file may not exceed 10 MB.");
  }
  let input: DiscoveryReportInput;
  try {
    input = JSON.parse(content.toString("utf8")) as DiscoveryReportInput;
  } catch {
    throw new Error("Discovery input is not valid JSON.");
  }
  if (!Array.isArray(input.records)) {
    throw new Error("Input must be a read-only ATS discovery JSON report with a records array.");
  }
  if (
    (input.environment !== "development" && input.environment !== "production") ||
    input.safety?.employerInputSource?.declaredEnvironment !== input.environment
  ) {
    throw new Error("Discovery input must declare a consistent employer-input environment.");
  }
  if (
    typeof input.safety?.employerInputSource?.declaredSource !== "string" ||
    !input.safety.employerInputSource.declaredSource.trim()
  ) {
    throw new Error("Discovery input must include a declared employer-data source.");
  }
  if (
    input.dbMode !== "development" &&
    input.dbMode !== "production-readonly"
  ) {
    throw new Error("Discovery input is missing its explicit dbMode provenance.");
  }
  if (!input.safety?.database?.fingerprint) {
    throw new Error("Discovery input is missing its database fingerprint.");
  }
  return {
    input,
    path,
    sha256: createHash("sha256").update(content).digest("hex"),
  };
}

async function main(): Promise<void> {
  const args = argsMap(process.argv.slice(2));
  const apply = args.get("apply") === "true";
  const replaceVerified = args.get("replace-verified") === "true";
  const inputPath = args.get("input-file") ?? args.get("input");
  const outputPath = args.get("output");
  if (!inputPath?.trim()) throw new Error("Mapping review requires --input-file=<discovery-report.json>.");
  const loaded = await readDiscoveryInput(inputPath);
  const modeContext = prepareDatabaseContext(args, process.env, loaded.input.environment);
  if (!modeContext.expectedFingerprint) {
    throw new Error("Mapping review requires --expected-db-fingerprint.");
  }
  const expectedFingerprint = modeContext.expectedFingerprint;
  assertWritesAllowed(modeContext.mode, apply, "mapping");
  if (loaded.input.dbMode !== modeContext.mode) {
    throw new Error("Discovery report dbMode does not match the selected database mode.");
  }
  if (
    loaded.input.safety?.database?.fingerprint?.toLowerCase() !==
    expectedFingerprint.toLowerCase()
  ) {
    throw new Error("Discovery report fingerprint does not match the declared database context.");
  }
  if (apply) {
    if (
      modeContext.mode !== "development" ||
      args.get("confirm-dev-mapping-only") !== "true"
    ) {
      throw new Error(
        "Mapping writes are development-only and require --confirm-dev-mapping-only=true.",
      );
    }
  }
  installDatabaseContext(modeContext);
  const databaseModule = await import("@workspace/db");
  try {
  const identity = await assertDatabaseMode(
    databaseModule.db,
    modeContext.mode,
    expectedFingerprint,
  );
  const { parseDirectBoardMapping } = await import("../lib/directEmployerBoardConnectors");

  const rejects: Array<{ organisationName: string | null; reason: string }> = [];
  const proposals = new Map<string, MappingProposal>();
  for (const record of loaded.input.records ?? []) {
    const proposal = proposalFromRecord(record, parseDirectBoardMapping);
    if (!proposal) {
      rejects.push({
        organisationName: record.organisationName ?? null,
        reason: "not_a_complete_high_confidence_verified_direct_feed",
      });
      continue;
    }
    const key = `${normalizeName(proposal.organisationName)}|${new URL(proposal.websiteOrigin).hostname}`;
    const previous = proposals.get(key);
    if (
      previous &&
      (previous.provider !== proposal.provider || previous.boardId !== proposal.boardId)
    ) {
      proposals.delete(key);
      rejects.push({
        organisationName: proposal.organisationName,
        reason: "multiple_direct_feed_mappings_for_same_employer_identity",
      });
      continue;
    }
    if (!proposals.has(key)) proposals.set(key, proposal);
  }

  const changes: Array<Record<string, unknown>> = [];
  const readOnly = !apply;
  await databaseModule.db.transaction(async (tx) => {
    if (readOnly) await tx.execute(sql`SET TRANSACTION READ ONLY`);
    for (const proposal of proposals.values()) {
      const sponsorResult = await tx.execute<{ organisation_name: string; website: string }>(sql`
        SELECT DISTINCT organisation_name, trim(website) AS website
        FROM sponsor_licences
        WHERE lower(regexp_replace(btrim(organisation_name), '\\s+', ' ', 'g'))
          = ${normalizeName(proposal.organisationName)}
          AND website IS NOT NULL
          AND trim(website) <> ''
      `);
      const matchingSponsors = sponsorResult.rows.filter((row) => {
        const site = safeSiteUrl(row.website);
        return site?.hostname.toLowerCase() === new URL(proposal.websiteOrigin).hostname.toLowerCase();
      });
      const exactNames = [...new Set(matchingSponsors.map((row) => row.organisation_name))];
      if (exactNames.length !== 1) {
        changes.push({
          organisationName: proposal.organisationName,
          status: "skipped",
          reason: exactNames.length === 0 ? "stable_name_and_website_identity_not_found" : "ambiguous_database_identity",
          before: null,
          after: null,
        });
        continue;
      }

      const [current] = (await tx.execute<CurrentMapping>(sql`
        SELECT organisation_name, ats_provider, ats_board_id, ats_mapping_status,
               ats_mapping_evidence_url, careers_url
        FROM sponsor_licence_company_site_checks
        WHERE organisation_name = ${exactNames[0]}
        LIMIT 1
      `)).rows;
      if (!current) {
        changes.push({
          organisationName: proposal.organisationName,
          status: "skipped",
          reason: "company_site_mapping_row_not_found",
          before: null,
          after: null,
        });
        continue;
      }

      const before = {
        atsProvider: current.ats_provider,
        atsBoardId: current.ats_board_id,
        atsMappingStatus: current.ats_mapping_status,
        atsMappingEvidenceUrl: current.ats_mapping_evidence_url,
        careersUrl: current.careers_url,
      };
      const sameMapping =
        current.ats_provider === proposal.provider &&
        current.ats_board_id?.toLowerCase() === proposal.boardId.toLowerCase() &&
        current.ats_mapping_status === "verified";
      if (sameMapping) {
        changes.push({
          organisationName: proposal.organisationName,
          status: "unchanged",
          reason: "same_verified_mapping",
          before,
          after: before,
        });
        continue;
      }
      if (current.ats_mapping_status === "verified" && !replaceVerified) {
        changes.push({
          organisationName: proposal.organisationName,
          status: "preserved",
          reason: "existing_verified_mapping_requires_explicit_replacement_approval",
          before,
          after: before,
        });
        continue;
      }

      const after = {
        atsProvider: proposal.provider,
        atsBoardId: proposal.boardId,
        atsMappingStatus: "verified",
        atsMappingEvidenceUrl: proposal.evidenceUrl,
        careersUrl: proposal.careersUrl,
      };
      if (apply) {
        await tx.execute(sql`
          UPDATE sponsor_licence_company_site_checks
          SET ats_provider = ${proposal.provider},
              ats_board_id = ${proposal.boardId},
              ats_mapping_status = 'verified',
              ats_mapping_evidence_url = ${proposal.evidenceUrl},
              careers_url = ${proposal.careersUrl}
          WHERE organisation_name = ${current.organisation_name}
        `);
      }
      changes.push({
        organisationName: proposal.organisationName,
        status: apply ? "updated" : "dry_run",
        reason: current.ats_mapping_status === "verified"
          ? "explicitly_approved_verified_mapping_replacement"
          : "blank_or_unverified_mapping",
        before,
        after,
      });
    }
  });

  const report = {
    environment: modeContext.sourceEnvironment,
    dbMode: modeContext.mode,
    mode: apply ? "mapping_only_apply" : "dry_run",
    productionApprovalRequired: modeContext.mode === "production-readonly",
    writesAllowed: apply,
    safety: {
      nodeEnvironment: modeContext.nodeEnvironment,
      database: {
        host: identity.databaseHost,
        name: identity.databaseName,
        role: identity.roleName,
        fingerprint: identity.fingerprint,
      },
      expectedFingerprintMatched: true,
      transactionReadOnly: identity.transactionReadOnly,
      defaultTransactionReadOnly: identity.defaultTransactionReadOnly,
      readOnlyRoleVerified: modeContext.mode === "production-readonly",
      productionWritesDisabled: modeContext.mode === "production-readonly",
      writeModeDisabled: !apply,
      employerInputSource: {
        type: "discovery-report-file",
        path: loaded.path,
        sha256: loaded.sha256,
        declaredEnvironment: loaded.input.environment,
        declaredSource: loaded.input.safety?.employerInputSource?.declaredSource ?? null,
      },
      mappingCheckStateSource: `same ${modeContext.mode} database`,
      cacheStateSource: "no cache/state files read",
      developmentStateAccessed: modeContext.mode === "development",
      assertions: {
        databaseFingerprintMatchesMode: true,
        inputSourceMatchesDatabaseMode: true,
        reportFingerprintMatchesDatabaseMode: true,
        productionReadOnlyRoleAndSessionVerified: modeContext.mode === "production-readonly",
        mappingWritesDisabled: modeContext.mode === "production-readonly" || !apply,
      },
    },
    mappingRowsChanged: changes.filter((change) => change.status === "updated").length,
    mappingProposals: proposals.size,
    vacancyImports: 0,
    rejected: rejects,
    changes,
    rollback: changes
      .filter((change) => change.status === "updated")
      .map(({ organisationName, before }) => ({ organisationName, restore: before })),
  };
  const output = `${JSON.stringify(report, null, 2)}\n`;
  if (outputPath) {
    const resolvedOutput = resolve(outputPath);
    await mkdir(dirname(resolvedOutput), { recursive: true });
    await writeFile(resolvedOutput, output, "utf8");
  }
  process.stdout.write(output);
  } finally {
    await databaseModule.pool.end();
  }
}

main().catch((error) => {
  console.error(
    "Company-site mapping import failed:",
    safeToolErrorSummary(error),
  );
  process.exitCode = 1;
});