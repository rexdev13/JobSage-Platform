import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  RESOLVER_CLASSIFICATIONS,
  RESOLVER_OUTPUT_COLUMNS,
  normalizeImportUrl,
  runProductionSponsorUrlResolver,
  withResolverColumns,
  type ProductionApplyAudit,
  type ProductionCareersTarget,
  type ProductionIdentityMapping,
  type ProductionSponsorTarget,
  type ResolverResult,
  type ResolverClassification,
} from "./productionSponsorUrlResolverCore";
import {
  parseCsvObjects,
  stringifyCsv,
} from "./sponsor-contact-discovery/csv";

const DEFAULTS = {
  audit: "artifacts/production-url-resolution-2026-09-28/production-apply-audit.json",
  reconciliation: "artifacts/production-sponsor-website-careers-reconciliation-dry-run.csv",
  sponsors: "artifacts/production-url-resolution-2026-09-28/production-sponsor-targets.csv",
  careers: "artifacts/production-url-resolution-2026-09-28/production-careers-site-checks.csv",
  mappings: "artifacts/production-url-resolution-2026-09-28/production-crosswalk-counts.csv",
  crosswalkDir: "artifacts/production-url-resolution-2026-09-28/crosswalk-pages",
  outDir: "artifacts/production-url-resolution-2026-09-28",
};

type Config = {
  audit: string;
  reconciliation: string;
  sponsors: string;
  careers: string;
  mappings: string;
  crosswalkDir: string;
  outDir: string;
};

function resolveWorkspacePath(path: string): string {
  const absolutePath = resolve(path);
  if (path.startsWith("/")) return absolutePath;
  if (existsSync(absolutePath)) return absolutePath;
  const workspaceRelativePath = resolve(process.cwd(), "..", path);
  if (existsSync(workspaceRelativePath) || process.cwd().endsWith("/scripts")) {
    return workspaceRelativePath;
  }
  return absolutePath;
}

function usage(): string {
  return [
    "Read-only production sponsor website/careers resolver.",
    "Usage:",
    "  pnpm --filter @workspace/scripts run sponsor-url-resolution -- [options]",
    "",
    "Options:",
    `  --audit <json>                 (default: ${DEFAULTS.audit})`,
    `  --reconciliation <csv>         (default: ${DEFAULTS.reconciliation})`,
    `  --production-sponsors <csv>    (default: ${DEFAULTS.sponsors})`,
    `  --production-careers <csv>     (default: ${DEFAULTS.careers})`,
    `  --production-mappings <csv>    (default: ${DEFAULTS.mappings})`,
    `  --production-crosswalk-dir <dir> (default: ${DEFAULTS.crosswalkDir})`,
    `  --out-dir <directory>          (default: ${DEFAULTS.outDir})`,
    "  --help",
    "",
    "This command only reads snapshots and writes local reports. It has no apply mode.",
  ].join("\n");
}

function parseArgs(args: string[]): Config | null {
  const config = { ...DEFAULTS };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--") continue;
    if (arg === "--help" || arg === "-h") return null;
    if (arg === "--apply") {
      throw new Error("This resolver is dry-run only; production writes use the protected admin import path.");
    }
    const value = args[++index];
    if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value.`);
    if (arg === "--audit") config.audit = value;
    else if (arg === "--reconciliation") config.reconciliation = value;
    else if (arg === "--production-sponsors") config.sponsors = value;
    else if (arg === "--production-careers") config.careers = value;
    else if (arg === "--production-mappings") config.mappings = value;
    else if (arg === "--production-crosswalk-dir") config.crosswalkDir = value;
    else if (arg === "--out-dir") config.outDir = value;
    else throw new Error(`Unknown option: ${arg}`);
  }
  return config;
}

function countBy<T extends string>(
  rows: Array<Record<string, string>>,
  select: (row: Record<string, string>) => T,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const value = select(row) || "(missing)";
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

function parseProductionCrosswalkRows(rows: Array<Record<string, string>>): {
  mappings: ProductionIdentityMapping[];
  invalidRows: number;
} {
  const mappings: ProductionIdentityMapping[] = [];
  let invalidRows = 0;
  const requiredSnapshotKeys = [
    "organisationName",
    "townCity",
    "county",
    "region",
    "industry",
    "route",
    "subRoute",
  ];
  for (const row of rows) {
    let snapshot: Record<string, unknown>;
    try {
      snapshot = JSON.parse(row.identity_snapshot ?? "") as Record<string, unknown>;
    } catch {
      invalidRows += 1;
      continue;
    }
    if (
      !/^[a-f0-9]{64}$/.test(row.identity_key ?? "") ||
      !/^\d+$/.test(row.target_sponsor_licence_id ?? "") ||
      !["exact_unique", "manual_review"].includes(row.resolution_method ?? "") ||
      requiredSnapshotKeys.some((key) => typeof snapshot[key] !== "string")
    ) {
      invalidRows += 1;
      continue;
    }
    mappings.push({
      identity_key: row.identity_key,
      identity_snapshot: row.identity_snapshot,
      target_sponsor_licence_id: row.target_sponsor_licence_id,
      resolution_method: row.resolution_method,
    });
  }
  return { mappings, invalidRows };
}

type PreparedUrlWrite = {
  field: "website" | "careers";
  targetId: string;
  url: string;
  sourceRefs: Set<string>;
};

function collectPreparedUrlWrites(results: ResolverResult[]): PreparedUrlWrite[] {
  const writes = new Map<string, PreparedUrlWrite>();
  const add = (field: "website" | "careers", targetId: string, url: string, sourceRef: string) => {
    if (!/^\d+$/.test(targetId) || !normalizeImportUrl(url)) {
      throw new Error(`Safe resolver row ${sourceRef} has an invalid production target or URL.`);
    }
    const key = `${field}:${targetId}`;
    const existing = writes.get(key);
    if (existing && existing.url !== url) {
      throw new Error(`Conflicting safe URLs target ${field} production row ${targetId}.`);
    }
    const record = existing ?? { field, targetId, url, sourceRefs: new Set<string>() };
    record.sourceRefs.add(sourceRef);
    writes.set(key, record);
  };

  for (const result of results) {
    if (result.classification !== "safe_auto_resolve") continue;
    const sourceRef = result.source.source_ref ?? "";
    const field = (result.source.field ?? "").trim().toLowerCase();
    const url = result.source.candidate_url ?? "";
    if (field === "website") {
      for (const targetId of result.resolvedSponsorIds) {
        if ((result.targetCurrentValues[targetId] ?? "") === "") {
          add("website", targetId, url, sourceRef);
        }
      }
    } else if (
      field === "careers" &&
      result.resolvedCareersId &&
      result.currentValue === ""
    ) {
      add("careers", result.resolvedCareersId, url, sourceRef);
    }
  }
  return [...writes.values()].sort(
    (left, right) => left.field.localeCompare(right.field) || Number(left.targetId) - Number(right.targetId),
  );
}

function sqlText(value: string): string {
  if (value.includes("\0")) throw new Error("Verification SQL input contains a PostgreSQL-incompatible NUL byte.");
  return `'${value.replace(/'/g, "''")}'`;
}

function expectedValuesCte(name: string, field: "website" | "careers", writes: PreparedUrlWrite[]): string {
  const selected = writes.filter((write) => write.field === field);
  if (selected.length === 0) {
    return `${name}(target_id, expected_url, source_refs) AS (\n  SELECT NULL::bigint, NULL::text, NULL::text WHERE FALSE\n)`;
  }
  const values = selected.map((write) => {
    const sourceRefs = [...write.sourceRefs].sort().join("|");
    return `  (${write.targetId}::bigint, ${sqlText(write.url)}, ${sqlText(sourceRefs)})`;
  });
  return `${name}(target_id, expected_url, source_refs) AS (\n  VALUES\n${values.join(",\n")}\n)`;
}

function createReadOnlyVerificationSql(writes: PreparedUrlWrite[], audit: ProductionApplyAudit): string {
  const safeAuditTarget = audit.target.replace(/[^a-zA-Z0-9:_-]/g, "_");
  return `-- READ ONLY: run only after the guarded production import reports success.
-- Source audit target: ${safeAuditTarget}
-- Expected target rows: ${writes.length}
-- Compare each returned actual_url with expected_url and confirm all status values are MATCH.
BEGIN TRANSACTION READ ONLY;

WITH
${expectedValuesCte("expected_sponsor_urls", "website", writes)},
${expectedValuesCte("expected_careers_urls", "careers", writes)}
SELECT
  'website' AS field,
  e.target_id,
  s.organisation_name,
  e.expected_url,
  s.website AS actual_url,
  e.source_refs,
  CASE WHEN s.id IS NOT NULL AND s.website = e.expected_url THEN 'MATCH' ELSE 'CHECK' END AS status
FROM expected_sponsor_urls e
LEFT JOIN sponsor_licences s ON s.id = e.target_id
UNION ALL
SELECT
  'careers' AS field,
  e.target_id,
  c.organisation_name,
  e.expected_url,
  c.careers_url AS actual_url,
  e.source_refs,
  CASE WHEN c.id IS NOT NULL AND c.careers_url = e.expected_url THEN 'MATCH' ELSE 'CHECK' END AS status
FROM expected_careers_urls e
LEFT JOIN sponsor_licence_company_site_checks c ON c.id = e.target_id
ORDER BY field, target_id;

COMMIT;
`;
}

function createGuardedApplyRunbook(input: {
  safeCandidateCount: number;
  safeTargetWriteCount: number;
  heldCount: number;
  audit: ProductionApplyAudit;
}): string {
  return `# Guarded production URL migration — apply and verification

Generated from read-only snapshots; no production change was performed.

## Before apply

1. Confirm the staging-table schema has been published to production.
2. Confirm no one has changed the sponsor URL snapshots since the resolver report was generated.
3. Open the published JOBSAGE super-admin page, **Sponsor website and careers import**.
4. Upload \`safe-auto-resolved.csv\` and run Preview. Do not use a local CLI or direct SQL for writes.
5. Confirm the page reports \`production\`, the imported safe target-write count is exactly ${input.safeTargetWriteCount}, and there are no collisions, unexpected identity conflicts, or existing-URL overwrites. The local resolver has ${input.safeCandidateCount} safe candidate rows; exact duplicate sponsor rows can make the target-write count larger.
6. If the preview differs, stop. Refresh production snapshots and rerun the read-only resolver; do not force the plan hash.

## Apply

After reviewing the preview and its plan hash, explicitly authorize the page's guarded apply button. The endpoint locks and rechecks target rows, writes only blank fields, and records an audit event. Preserve the event's plan hash, target-write count, and result.

To stage held candidates, upload the original full reconciliation CSV (not \`safe-auto-resolved.csv\`) and run Preview again. Confirm the published app reports \`production\`, then stage the rows the live preview classifies as held; the endpoint rechecks the exact plan hash and excludes safe and no-op rows. The offline resolver currently predicts ${input.heldCount} held candidate rows, but the live production preview is authoritative. Stop and refresh the snapshots if its result differs unexpectedly. Staging stores candidate/evidence/identity snapshots in the dedicated review table and does not change sponsor URLs or vacancy-discovery data.

## Read-only verification

After apply succeeds, run \`production-url-read-only-verification.sql\` with authorized read-only production database access. It checks every prepared sponsor website and careers URL target against the exact expected URL and returns one \`MATCH\`/ \`CHECK\` row per target. Proceed only if every expected row is present and \`MATCH\`.

Historical source audit snapshot: \`${input.audit.target}\` (created ${input.audit.createdAt}, covering ${input.audit.details.rowCount} rows). It records ${input.audit.details.websiteUpdates + input.audit.details.careersUpdates} target writes from that earlier apply; those are not the ${input.safeTargetWriteCount} new writes prepared here. The resolver itself does not access production, deploy, or start vacancy ingestion.
`;
}

function table(rows: Array<[string, number]>): string {
  if (!rows.length) return "_None._";
  return [
    "| Reason | Rows |",
    "|---|---:|",
    ...rows.map(([reason, count]) => `| ${reason.replace(/\|/g, "\\|")} | ${count.toLocaleString("en-GB")} |`),
  ].join("\n");
}

function fieldCounts(
  results: ReturnType<typeof runProductionSponsorUrlResolver>["results"],
  classification?: ResolverClassification,
): string {
  const filtered = classification
    ? results.filter((item) => item.classification === classification)
    : results;
  const counts = new Map<string, number>();
  for (const item of filtered) {
    const field = item.source.field || "(missing)";
    counts.set(field, (counts.get(field) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([field, count]) => `${field}: ${count}`)
    .join(", ") || "none";
}

function sampleTable(
  results: ReturnType<typeof runProductionSponsorUrlResolver>["results"],
  classification: ResolverClassification,
): string {
  const samples = results
    .filter((item) => item.classification === classification)
    .slice(0, 3);
  if (!samples.length) return "_No rows._";
  return [
    "| Source ref | Field | Organisation | URL | Target | Reason |",
    "|---|---|---|---|---:|---|",
    ...samples.map((item) => [
      item.source.source_ref,
      item.source.field,
      item.source.organisation_name,
      item.source.candidate_url,
      item.resolvedSponsorId || "—",
      item.reason,
    ].map((value) => String(value ?? "").replace(/\|/g, "\\|")).join(" | "))
      .map((line) => `| ${line} |`),
  ].join("\n");
}

function createVacancyCommandPlan(): string {
  return `# Bounded production vacancy run plan — not executed

## Safety status

This plan did not call the vacancy worker. Use it only for a later, separately approved production run, after any sponsor URL changes have been reviewed and applied through the protected production importer. The resolver did not deploy or alter production. Already-running services may continue their own schedules independently; check their status before running this plan.

## Production path

Use the authenticated production HTTP worker at \`POST $PRODUCTION_API_ORIGIN/api/internal/vacancy-jobs\`, not the development-only \`vacancy:sponsor-websites\` CLI. There is no production direct-feeds-only job kind.

The production \`company_site\` job includes verified direct ATS feeds when a saved mapping supports one, then the normal company-site discovery path. Feed adapters run only with a verified mapping and keep their completeness/evidence rules. Employers without a usable direct feed can go through ordinary site discovery. This is one employer cohort, not one vacancy; one employer may yield multiple roles.

The endpoint requires the \`x-jobsage-job-secret\` header backed by the Replit secret \`VACANCY_JOB_SECRET\`. It refuses the request unless \`VACANCY_AI_WEB_SEARCH_DAILY_CAP\` is zero. Company-site batches default to at most 10 employers and cannot exceed 10; this pilot explicitly asks for one.

## One-request pilot command

Before running it later:

1. Confirm the production deployment contains the approved worker code and that the production AI web-search cap is still zero.
2. Check the external scheduler's latest batch history. Pause or coordinate it so this request is not competing with another caller.
3. Load the API origin and secret into the shell securely. Do not paste the secret into chat, shell history, or logs; do not enable shell tracing.
4. Run exactly one request and review the full response. Do not loop or automatically retry.

\`\`\`sh
: "\${PRODUCTION_API_ORIGIN:?Set the canonical production API origin}"
: "\${VACANCY_JOB_SECRET:?Load this from Replit Secrets without printing it}"
curl --fail-with-body --silent --show-error --max-time 30 \\
  "$PRODUCTION_API_ORIGIN/api/internal/vacancy-jobs" \\
  -H "x-jobsage-job-secret: $VACANCY_JOB_SECRET" \\
  -H "content-type: application/json" \\
  --data '{"kind":"company_site","limit":1}'
\`\`\`

## Verify and stop

- Accept only a successful response showing \`selected\` no greater than 1, with \`errors: 0\`; retain \`upserted\`, duration, and the recorded \`company_site\` batch kind for review.
- Stop after this single employer, even if \`done\` is false. A false value means more eligible work remains; it is not permission to drain the queue.
- If the endpoint returns HTTP 409, respect \`Retry-After\` and verify the active batch has finished before considering another request. For HTTP 504 or a client timeout, do not retry immediately: the batch may still be settling. Check production batch history and the shared writer-lock status first.
- Review inserted/updated roles against company identity, source evidence, liveness, and candidate-visibility gates before approving a larger cohort.
- Only after the one-employer result is reviewed should an operator decide whether to run another explicitly bounded batch. Never run the development-only direct-feed switch against production.
`;
}

function createSummary(input: {
  audit: ProductionApplyAudit;
  reconciliationRows: Array<Record<string, string>>;
  sponsors: ProductionSponsorTarget[];
  careersTargets: ProductionCareersTarget[];
  mappingRows: Array<Record<string, string>>;
  crosswalkRows: ProductionIdentityMapping[];
  invalidCrosswalkRows: number;
  results: ReturnType<typeof runProductionSponsorUrlResolver>["results"];
  counts: Record<ResolverClassification, number>;
  safeWriteTargetCount: number;
}): string {
  const originalReasonRows = Object.entries(input.audit.details.counts)
    .sort(([a], [b]) => a.localeCompare(b)) as Array<[string, number]>;
  const resolverRows = RESOLVER_CLASSIFICATIONS.map(
    (classification) => [classification, input.counts[classification]] as [string, number],
  );
  const preflightDispositionRows = Object.entries(
    countBy(input.reconciliationRows, (row) => row.disposition || "(missing)"),
  ).sort(([a], [b]) => a.localeCompare(b)) as Array<[string, number]>;
  const crosswalkMethodCounts = new Map<string, number>();
  for (const row of input.crosswalkRows) {
    crosswalkMethodCounts.set(
      row.resolution_method,
      (crosswalkMethodCounts.get(row.resolution_method) ?? 0) + 1,
    );
  }
  const mappingMethodRows = [...crosswalkMethodCounts.entries()]
    .sort(([a], [b]) => a.localeCompare(b));
  const aggregateMappingRows = input.mappingRows
    .map((row) => [row.resolution_method || "(missing)", Number(row.rows) || 0] as [string, number])
    .sort(([a], [b]) => a.localeCompare(b));
  const safeAutoCount = input.counts.safe_auto_resolve;
  const safeNoopCount = input.counts.safe_noop_already_done;
  const manualMappings = input.crosswalkRows
    .filter((row) => row.resolution_method === "manual_review").length;
  const date = new Date().toISOString();

  const sampleSections = RESOLVER_CLASSIFICATIONS.map((classification) =>
    `### ${classification}\n\n${sampleTable(input.results, classification)}`,
  ).join("\n\n");

  return `# Production URL resolver dry-run

Generated: ${date}

## Scope and safety

- The resolver only reads captured production snapshots and writes local reports; it does not write production, deploy, or call a vacancy worker. Already-running services may continue their own schedules independently.
- Production apply audit: ${input.audit.createdAt}; plan hash: \`${input.audit.target}\`.
- Audit row count: ${input.audit.details.rowCount.toLocaleString("en-GB")}; reconciliation rows: ${input.reconciliationRows.length.toLocaleString("en-GB")}.
- Current snapshots: ${input.sponsors.length.toLocaleString("en-GB")} production sponsor targets and ${input.careersTargets.length.toLocaleString("en-GB")} production careers-site rows.
- Safe rows in this resolver: ${safeAutoCount.toLocaleString("en-GB")} rows across ${input.safeWriteTargetCount.toLocaleString("en-GB")} distinct blank production targets. They are prepared only, not applied.
- Already-present or duplicate no-ops: ${safeNoopCount.toLocaleString("en-GB")}.

## Original production apply reasons

These are the exact aggregate counts stored in the production audit event.

${table(originalReasonRows)}

## New resolver classifications

${table(resolverRows)}

Rows by field: ${fieldCounts(input.results)}.

Safe auto-resolved rows by field: ${fieldCounts(input.results, "safe_auto_resolve")}.

## Preflight context (not the production audit)

The reconciliation CSV was created before the production apply. Its disposition counts differ from the later production audit and are included only as context; they were not substituted for the audited counts.

${table(preflightDispositionRows)}

## Identity mapping lookup

Validated row-level production crosswalk snapshots supplied to the resolver:

${table(mappingMethodRows)}

The aggregate export reports:

${table(aggregateMappingRows)}

Manual-review mappings found in the row-level snapshot: ${manualMappings.toLocaleString("en-GB")}; rows with malformed snapshot fields were ignored: ${input.invalidCrosswalkRows.toLocaleString("en-GB")}. A manual mapping selects one target only when its normalized snapshot hash and current production target identity both agree with the candidate.

## Row-level audit limitation

The production audit stores the plan hash and aggregate reason counts, but no \`source_ref\`-level outcomes. It is therefore not possible to truthfully attach an original production-audit reason to each candidate row. The row-level files below classify candidates from the reconciliation input against current production sponsor and careers-site values. Original aggregate counts above remain exact; the older preflight disposition is preserved in each row but is not treated as the applied status.

## Prepared apply path (not executed)

Use the production super-admin page **Sponsor website and careers import** and upload \`safe-auto-resolved.csv\`. Run the read-only preview first. Apply only if the page reports the production environment and its safe-write count equals the ${input.safeWriteTargetCount.toLocaleString("en-GB")} prepared blank target writes; do not compare that figure to the safe candidate-row count when one candidate fans out to identical duplicate rows. Confirm there are no target URL collisions or existing-value overwrites. The apply endpoint is transaction- and plan-hash-guarded, locks and rechecks each production target, updates blank fields only, and records an audit event.

The \`safe-auto-resolved.csv\` is intentionally not applied from a local CLI. This environment has read-only production SQL access and no production admin session. Stage held rows only through the published production page after the staging schema has been published; the separate staging table is not a vacancy-discovery source. Manual identity and URL-conflict rows remain held until a reviewer supplies evidence. Never bypass the preview.

The generated \`guarded-production-apply-runbook.md\` records the exact checks, and \`production-url-read-only-verification.sql\` contains only SELECT statements in a read-only transaction for every prepared target. Run the verification only after a successful guarded apply; every returned row must report \`MATCH\`.

Resolver rerun command (read-only; uses the captured snapshots):

\`\`\`sh
pnpm --filter @workspace/scripts run sponsor-url-resolution -- \\
  --audit artifacts/production-url-resolution-2026-09-28/production-apply-audit.json \\
  --reconciliation artifacts/production-sponsor-website-careers-reconciliation-dry-run.csv \\
  --production-sponsors artifacts/production-url-resolution-2026-09-28/production-sponsor-targets.csv \\
  --production-careers artifacts/production-url-resolution-2026-09-28/production-careers-site-checks.csv \\
  --production-mappings artifacts/production-url-resolution-2026-09-28/production-crosswalk-counts.csv \\
  --production-crosswalk-dir artifacts/production-url-resolution-2026-09-28/crosswalk-pages \\
  --out-dir artifacts/production-url-resolution-2026-09-28
\`\`\`

Refresh the production snapshots and audit first if production changes before review. This script has no \`--apply\` option.

## Next phase

The bounded production vacancy plan is saved separately in \`next-phase-vacancy-command-plan.md\`. It was not executed. Production has no direct-feeds-only command; its authenticated \`company_site\` HTTP job uses verified direct ATS feeds where available and otherwise follows the normal company-site discovery path. Check already-running service schedules before using the plan.

## Samples by resolver classification

${sampleSections}
`;
}

async function main(): Promise<void> {
  const config = parseArgs(process.argv.slice(2));
  if (!config) {
    console.log(usage());
    return;
  }
  const crosswalkDir = resolveWorkspacePath(config.crosswalkDir);
  const crosswalkFiles = (await readdir(crosswalkDir))
    .filter((name) => /^production-crosswalk-\d+\.csv$/.test(name))
    .sort();
  if (crosswalkFiles.length === 0) {
    throw new Error(`No production-crosswalk-###.csv snapshots found in ${crosswalkDir}.`);
  }
  const [auditText, reconciliationText, sponsorsText, careersText, mappingsText, ...crosswalkTexts] =
    await Promise.all([
    readFile(resolveWorkspacePath(config.audit), "utf8"),
    readFile(resolveWorkspacePath(config.reconciliation), "utf8"),
    readFile(resolveWorkspacePath(config.sponsors), "utf8"),
    readFile(resolveWorkspacePath(config.careers), "utf8"),
    readFile(resolveWorkspacePath(config.mappings), "utf8"),
    ...crosswalkFiles.map((name) => readFile(resolve(crosswalkDir, name), "utf8")),
  ]);
  const audit = JSON.parse(auditText) as ProductionApplyAudit;
  const reconciliationRows = parseCsvObjects(reconciliationText);
  const sponsors = parseCsvObjects(sponsorsText) as ProductionSponsorTarget[];
  const careersTargets = parseCsvObjects(careersText) as ProductionCareersTarget[];
  const mappingRows = parseCsvObjects(mappingsText);
  const rawCrosswalkRows = crosswalkTexts.flatMap((text) => parseCsvObjects(text));
  const { mappings: crosswalkRows, invalidRows: invalidCrosswalkRows } =
    parseProductionCrosswalkRows(rawCrosswalkRows);
  const run = runProductionSponsorUrlResolver({
    audit,
    reconciliationRows,
    sponsors,
    careersTargets,
    mappings: crosswalkRows,
  });
  const sourceColumns = [...new Set([
    ...reconciliationRows.flatMap((row) => Object.keys(row)),
    ...RESOLVER_OUTPUT_COLUMNS,
  ])];
  const outputRows = run.results.map(withResolverColumns);
  const byClassification = new Map<ResolverClassification, typeof outputRows>();
  for (const classification of RESOLVER_CLASSIFICATIONS) {
    byClassification.set(
      classification,
      outputRows.filter((row) => row.resolver_classification === classification),
    );
  }
  const safeRows = byClassification.get("safe_auto_resolve") ?? [];
  const preparedWrites = collectPreparedUrlWrites(run.results);
  const safeWriteTargetCount = preparedWrites.length;

  const outDir = resolveWorkspacePath(config.outDir);
  await mkdir(outDir, { recursive: true });
  for (const [classification, rows] of byClassification) {
    const fileName = classification === "safe_auto_resolve"
      ? "safe-auto-resolved.csv"
      : classification === "safe_noop_already_done"
        ? "safe-noop-already-done.csv"
        : classification === "needs_manual_identity_resolution"
          ? "manual-identity-resolution.csv"
          : classification === "needs_manual_url_conflict_review"
            ? "manual-url-conflicts.csv"
            : classification === "needs_manual_low_confidence_review"
              ? "low-confidence-review.csv"
              : "unresolved-missing-data.csv";
    await writeFile(
      resolve(outDir, fileName),
      stringifyCsv(rows, sourceColumns),
      "utf8",
    );
  }
  const summary = createSummary({
    audit,
    reconciliationRows,
    sponsors,
    careersTargets,
    mappingRows,
    crosswalkRows,
    invalidCrosswalkRows,
    results: run.results,
    counts: run.counts,
    safeWriteTargetCount,
  });
  const summaryPath = resolve(outDir, "prod-url-resolution-summary.md");
  await mkdir(dirname(summaryPath), { recursive: true });
  await writeFile(summaryPath, summary, "utf8");
  await writeFile(
    resolve(outDir, "next-phase-vacancy-command-plan.md"),
    createVacancyCommandPlan(),
    "utf8",
  );
  await writeFile(
    resolve(outDir, "production-url-read-only-verification.sql"),
    createReadOnlyVerificationSql(preparedWrites, audit),
    "utf8",
  );
  await writeFile(
    resolve(outDir, "guarded-production-apply-runbook.md"),
    createGuardedApplyRunbook({
      safeCandidateCount: safeRows.length,
      safeTargetWriteCount: safeWriteTargetCount,
      heldCount: reconciliationRows.length - safeRows.length -
        (run.counts.safe_noop_already_done ?? 0),
      audit,
    }),
    "utf8",
  );

  console.log([
    `Rows classified: ${run.results.length}`,
    `safe_auto_resolve: ${run.counts.safe_auto_resolve}`,
    `safe_noop_already_done: ${run.counts.safe_noop_already_done}`,
    `manual identity: ${run.counts.needs_manual_identity_resolution}`,
    `manual URL conflict: ${run.counts.needs_manual_url_conflict_review}`,
    `low-confidence review: ${run.counts.needs_manual_low_confidence_review}`,
    `missing data: ${run.counts.unresolved_due_to_missing_data}`,
    `Prepared target writes: ${safeWriteTargetCount}`,
    `Reports: ${outDir}`,
  ].join("\n"));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});