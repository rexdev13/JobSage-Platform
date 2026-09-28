import { readFile, writeFile } from "node:fs/promises";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { assertDatabaseFingerprint, safeToolErrorSummary } from "./databaseSafety";
import { parseDirectBoardMapping } from "../lib/directEmployerBoardConnectors";

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

function proposalFromRecord(record: DiscoveryRecord): MappingProposal | null {
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

async function readInput(filePath: string | undefined): Promise<string> {
  if (filePath) return await readFile(filePath, "utf8");
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function main(): Promise<void> {
  const args = argsMap(process.argv.slice(2));
  const environment = args.get("environment") ?? "development";
  const apply = args.get("apply") === "true";
  const replaceVerified = args.get("replace-verified") === "true";
  const inputPath = args.get("input");
  const outputPath = args.get("output");
  if (environment !== "development" && environment !== "production") {
    throw new Error("--environment must be development or production");
  }
  if (environment === "production") {
    if (
      process.env.NODE_ENV !== "production" ||
      args.get("confirm-production-mapping-only") !== "true"
    ) {
      throw new Error(
        "Production imports require NODE_ENV=production and --confirm-production-mapping-only=true.",
      );
    }
  } else if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing a development label while NODE_ENV=production.");
  }
  if (apply && environment === "development") {
    const expectedFingerprint = args.get("expected-db-fingerprint");
    if (
      process.env.NODE_ENV !== "development" ||
      args.get("confirm-dev-mapping-only") !== "true" ||
      !expectedFingerprint
    ) {
      throw new Error(
        "Development mapping writes require NODE_ENV=development, --confirm-dev-mapping-only=true, and --expected-db-fingerprint.",
      );
    }
    await assertDatabaseFingerprint(expectedFingerprint);
  }

  const input = JSON.parse(await readInput(inputPath)) as {
    records?: DiscoveryRecord[];
  };
  if (!Array.isArray(input.records)) {
    throw new Error("Input must be a read-only ATS discovery JSON report with a records array.");
  }

  const rejects: Array<{ organisationName: string | null; reason: string }> = [];
  const proposals = new Map<string, MappingProposal>();
  for (const record of input.records) {
    const proposal = proposalFromRecord(record);
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
  await db.transaction(async (tx) => {
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
    environment,
    mode: apply ? "mapping_only_apply" : "dry_run",
    productionApprovalRequired: environment === "production",
    writesAllowed: apply,
    mappingRowsChanged: changes.filter((change) => change.status === "updated").length,
    mappingProposals: proposals.size,
    rejected: rejects,
    changes,
    rollback: changes
      .filter((change) => change.status === "updated")
      .map(({ organisationName, before }) => ({ organisationName, restore: before })),
  };
  const output = `${JSON.stringify(report, null, 2)}\n`;
  if (outputPath) await writeFile(outputPath, output, "utf8");
  process.stdout.write(output);
}

main().catch((error) => {
  console.error(
    "Company-site mapping import failed:",
    safeToolErrorSummary(error),
  );
  process.exitCode = 1;
});