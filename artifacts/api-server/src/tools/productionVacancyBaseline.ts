/**
 * Read-only, repeatable production inventory audit. No collectors or HTTP calls.
 * Install the existing verified read-only database context BEFORE importing
 * modules which construct the shared pool. Never export raw records/contacts.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { prepareDatabaseContext, installDatabaseContext } from "./companySiteDiscoveryRuntime";
import { assertDatabaseMode, assertProductionProofReadOnly, safeToolErrorSummary } from "./databaseSafety";

function argumentsMap(): Map<string, string> {
  return new Map(process.argv.slice(2).map((argument) => {
    const [key, ...value] = argument.replace(/^--/, "").split("=");
    return [key!, value.join("=")];
  }));
}

async function main(): Promise<void> {
  const args = argumentsMap();
  if (!["production-readonly", "production-proof-readonly"].includes(args.get("db-mode") ?? "")) {
    throw new Error("This audit only accepts an explicitly confirmed production read-only mode.");
  }
  const context = prepareDatabaseContext(args);
  installDatabaseContext(context);
  const { pool, db } = await import("@workspace/db");
  try {
    // The platform's production reader and the direct read-only connection can
    // reach different PostgreSQL instances. Independently compare immutable
    // public vacancy anchors, not just their host/start-time fingerprints.
    const maxId = Number(args.get("anchor-max-id"));
    const anchorHash = args.get("expected-anchor-hash");
    const nameHash = args.get("expected-database-name-hash");
    if (!Number.isSafeInteger(maxId) || maxId <= 0 || !/^[a-f0-9]{32}$/.test(anchorHash ?? "") || !/^[a-f0-9]{32}$/.test(nameHash ?? "")) {
      throw new Error("An independently confirmed production anchor max ID, anchor hash and database-name hash are required.");
    }
    const proof = (await pool.query(`
      WITH anchors AS (
        SELECT id,title,organisation_name FROM sponsor_licence_vacancies
        WHERE id <= $1 ORDER BY id DESC LIMIT 100
      ) SELECT md5(current_database()) AS name_hash,
        md5(string_agg(id::text||':'||title||':'||organisation_name,'|' ORDER BY id)) AS anchor_hash
      FROM anchors
    `, [maxId])).rows[0];
    if (proof.name_hash !== nameHash || proof.anchor_hash !== anchorHash) {
      throw new Error("Read-only target does not match the independently confirmed production vacancy anchors.");
    }
    if (context.mode === "production-proof-readonly") {
      const identity = await assertProductionProofReadOnly(db);
      if (!context.expectedFingerprint || identity.fingerprint !== context.expectedFingerprint) {
        throw new Error("Read-only proof connection fingerprint does not match.");
      }
    } else {
      await assertDatabaseMode(db, context.mode, context.expectedFingerprint!);
    }
    const [
      { getCandidateVacancyStatus },
      { classifyUkVacancyLocation },
      { classifyVacancyCategory, classifyVacancyCategoryWithEvidence },
      { isManualLabourTitle },
      { isValidVacancyUrlForSource },
      { ALL_FREE_BOARD_SOURCES },
      { REFERENCE_ATS_TARGETS },
    ] = await Promise.all([
      import("../lib/vacancyLiveness"),
      import("../lib/ukVacancyLocation"),
      import("../lib/sponsorVacancyRoles"),
      import("../lib/vacancyTitlePolicy"),
      import("../lib/vacancyUrlPolicy"),
      import("../lib/freeBoardSourceRegistry"),
      import("../lib/referenceAtsTargets"),
    ]);
    const client = await pool.connect();
    let snapshot: Record<string, unknown>;
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      await client.query("SET LOCAL statement_timeout = '30s'");
      const clock = (await client.query("SELECT now() AS now, current_setting('transaction_read_only') AS read_only")).rows[0];
      if (clock.read_only !== "on") throw new Error("Audit transaction is not read-only.");
      const now = new Date(clock.now);
      const rows = (await client.query(`
        SELECT v.id, v.organisation_name AS "organisationName", v.title, v.description,
          v.location, v.target_regions AS "targetRegions", v.source_metadata AS "sourceMetadata",
          v.source_type AS "sourceType", v.board_name AS "boardName", v.liveness,
          v.last_verified_at AS "lastVerifiedAt", v.last_discovered_at AS "lastDiscoveredAt",
          v.source_missing_since AS "sourceMissingSince", v.source_missing_observations AS "sourceMissingObservations",
          v.closes_at AS "closesAt", v.expires_at AS "expiresAt", v.closed_reason AS "closedReason",
          v.company_vacancy_evidence AS "companyVacancyEvidence",
          v.company_evidence_legacy_until AS "companyEvidenceLegacyUntil",
          v.url, v.application_url AS "applicationUrl", s.industry
        FROM sponsor_licence_vacancies v LEFT JOIN (
          SELECT DISTINCT ON (lower(btrim(organisation_name))) organisation_name, industry
          FROM sponsor_licences ORDER BY lower(btrim(organisation_name)), id
        ) s ON lower(btrim(s.organisation_name))=lower(btrim(v.organisation_name))
        ORDER BY v.id
      `)).rows;
      const totals: Record<string, number> = {};
      const byStatus: Record<string, number> = {};
      const bySource: Record<string, number> = {};
      const bySector: Record<string, number> = {};
      const byIndustry: Record<string, number> = {};
      const byAge: Record<string, number> = {};
      const byEmployer: Record<string, number> = {};
      const classificationBasis: Record<string, number> = {};
      const industriesBySector: Record<string, Record<string, number>> = {};
      const duplicateUrls = new Map<string, number>();
      const increment = (target: Record<string, number>, key: string) => { target[key] = (target[key] ?? 0) + 1; };
      const inc = (key: string) => increment(totals, key);
      for (const row of rows) {
        inc("stored");
        const status = getCandidateVacancyStatus({ ...row, now });
        increment(byStatus, status);
        if (row.liveness === "live") inc("liveFlag");
        if (row.liveness === "live" && row.lastVerifiedAt && now.getTime() - new Date(row.lastVerifiedAt).getTime() <= 48 * 3600_000) inc("freshLiveFlag");
        const uk = classifyUkVacancyLocation(row);
        if (uk !== "confirmed_uk") { inc(`location:${uk}`); continue; }
        inc("confirmedUk");
        if (status !== "visible") continue;
        inc("ukAndVisibilityStatus");
        if (isManualLabourTitle(row.title)) { inc("manualTitleExcluded"); continue; }
        const category = classifyVacancyCategory(row.title, row.description);
        if (!category) { inc("unclassifiedNotRelevantToProfessionFeed"); continue; }
        const url = row.applicationUrl ?? row.url;
        if (row.sourceType === "company_site" && !isValidVacancyUrlForSource(url, "company_site")) {
          inc("companyRouteRejected"); continue;
        }
        if (!url?.trim()) { inc("noApplyUrl"); continue; }
        inc("candidateEligibleInventory");
        increment(bySector, category);
        increment(bySource, row.boardName ?? row.sourceType ?? "legacy-null");
        increment(byIndustry, row.industry ?? "Unknown");
        increment(byEmployer, row.organisationName);
        const age = (now.getTime() - new Date(row.lastVerifiedAt).getTime()) / 3600_000;
        increment(byAge, age < 6 ? "0-6h" : age < 24 ? "6-24h" : "24-48h");
        increment(classificationBasis, classifyVacancyCategoryWithEvidence(row.title, row.description).reason);
        industriesBySector[category] ??= {};
        increment(industriesBySector[category]!, row.industry ?? "Unknown");
        duplicateUrls.set(url, (duplicateUrls.get(url) ?? 0) + 1);
        if (isValidVacancyUrlForSource(url, row.sourceType)) inc("specificVacancyApplyRoute");
        else inc("inventoryUrlNotSpecificVacancy");
      }
      const extra: Record<string, unknown> = {};
      const queries: Record<string, string> = {
        sponsorsByIndustry: `SELECT industry,count(*) AS licence_rows,count(DISTINCT lower(btrim(organisation_name))) AS employers,
          count(DISTINCT lower(btrim(organisation_name))) FILTER (WHERE nullif(btrim(website),'') IS NOT NULL) AS with_website
          FROM sponsor_licences GROUP BY industry ORDER BY employers DESC`,
        companyFunnelByIndustry: `WITH s AS (SELECT DISTINCT ON(lower(btrim(organisation_name))) organisation_name,industry,website FROM sponsor_licences ORDER BY lower(btrim(organisation_name)),id)
          SELECT s.industry,count(*) AS employers,count(*) FILTER(WHERE nullif(btrim(s.website),'') IS NOT NULL) AS website,
          count(*) FILTER(WHERE c.careers_url IS NOT NULL) AS careers_mapping,
          count(*) FILTER(WHERE c.ats_provider IS NOT NULL) AS ats_detected,
          count(*) FILTER(WHERE c.ats_mapping_status='verified') AS ats_verified,
          count(*) FILTER(WHERE c.probe_status='ok_for_crawl') AS probe_ok,
          count(*) FILTER(WHERE c.ats_mapping_status='verified' AND c.probe_status='ok_for_crawl') AS verified_and_probe_ok,
          count(*) FILTER(WHERE c.last_outcome='complete') AS last_complete,
          sum(c.last_adverts_found) AS latest_attempt_adverts_not_unique
          FROM s LEFT JOIN sponsor_licence_company_site_checks c ON lower(btrim(c.organisation_name))=lower(btrim(s.organisation_name)) GROUP BY s.industry ORDER BY employers DESC`,
        companyErrors: `SELECT last_outcome,left(last_error,180) AS error,count(*) AS employers
          FROM sponsor_licence_company_site_checks WHERE last_error IS NOT NULL GROUP BY 1,2 ORDER BY employers DESC LIMIT 20`,
        sourceObservations: `SELECT source_id,provider,source_type,count(*) AS observations,
          count(DISTINCT vacancy_id) AS vacancies,count(*) FILTER(WHERE missing_since IS NOT NULL) AS missing,
          min(first_seen_at) AS first_seen,max(last_seen_at) AS last_seen FROM vacancy_source_observations GROUP BY 1,2,3 ORDER BY observations DESC`,
        sourceStates: `SELECT source_id,provider,board_name,last_run_at,last_success_at,last_outcome,reported_total,consecutive_failures,next_retry_at,left(last_error,200) AS last_error FROM vacancy_source_states ORDER BY source_id`,
        jobs7d: `SELECT job_kind,triggered_by,status,count(*) AS runs,sum(checked_count) AS checked,sum(error_count) AS errors,
          min(created_at) AS first_run,max(created_at) AS last_run,round(avg(duration_ms)) AS avg_ms
          FROM vacancy_sync_log WHERE created_at>=now()-interval '7 days' GROUP BY 1,2,3 ORDER BY 1,2,3`,
        jobs48hMetrics: `SELECT job_kind,count(*) AS runs,sum(checked_count) AS checked,
          sum(coalesce((metrics->>'live')::numeric,0)) AS live_results,
          sum(coalesce((metrics->>'dead')::numeric,0)) AS dead_results,
          sum(coalesce((metrics->>'inconclusive')::numeric,0)) AS inconclusive_results,
          sum(coalesce((metrics->>'inserted')::numeric,0)) AS inserted,
          sum(coalesce((metrics->>'updated')::numeric,0)) AS updated,
          sum(coalesce((metrics->>'revived')::numeric,0)) AS revived,
          sum(coalesce((metrics->>'recordsFetched')::numeric,0)) AS fetched_not_unique,
          sum(coalesce((metrics->>'sponsorMatched')::numeric,0)) AS matched_not_unique,
          sum(coalesce((metrics->>'advertsExtracted')::numeric,0)) AS extracted_not_unique
          FROM vacancy_sync_log WHERE created_at>=now()-interval '48 hours' GROUP BY job_kind ORDER BY job_kind`,
        verificationCurrentState: `SELECT source_type,coalesce(board_name,'unlabelled') AS board,count(*) AS rows,
          count(*) FILTER(WHERE last_verified_at>=now()-interval '48 hours') AS touched48h,
          count(*) FILTER(WHERE last_verified_at>=now()-interval '48 hours' AND liveness='live') AS live48h,
          count(*) FILTER(WHERE last_discovered_at>=now()-interval '48 hours') AS rediscovered48h,
          count(*) FILTER(WHERE created_at>=now()-interval '48 hours') AS created48h FROM sponsor_licence_vacancies GROUP BY 1,2 ORDER BY rows DESC`,
        livenessWaste: `SELECT count(*) AS before,count(*) FILTER(WHERE (v.closes_at IS NULL OR v.closes_at>=now()) AND (v.expires_at IS NULL OR v.expires_at>=now()) AND coalesce(v.closed_reason,'') !~* '(closed|filled|no longer accepting|closing date has passed)') AS after
          FROM sponsor_licence_vacancies v WHERE coalesce(nullif(btrim(v.application_url),''),v.url) IS NOT NULL
          AND v.source_type IN('job_board','company_site') AND v.liveness<>'dead'
          AND (v.last_verified_at IS NULL OR v.last_verified_at<now()-interval '6 hours')
          AND EXISTS(SELECT 1 FROM vacancy_source_observations o WHERE o.vacancy_id=v.id)`,
        contactEvidence: `SELECT status,contact_source,count(*) AS employers,
          count(*) FILTER(WHERE nullif(btrim(contact_email),'') IS NOT NULL) AS with_email,
          count(*) FILTER(WHERE nullif(btrim(contact_email),'') IS NOT NULL AND contact_evidence_url IS NOT NULL) AS email_with_provenance_not_sendcv_verification,
          count(*) FILTER(WHERE contact_extracted_at>=now()-interval '48 hours') AS recent
          FROM sponsor_licence_contact_enrichments GROUP BY 1,2 ORDER BY employers DESC`,
        curatedAndEmployerSchema: `SELECT table_name,string_agg(column_name,',' ORDER BY ordinal_position) AS columns
          FROM information_schema.columns WHERE table_schema='public' AND table_name IN('roles','job_listings') GROUP BY table_name`,
      };
      for (const [name, query] of Object.entries(queries)) extra[name] = (await client.query(query)).rows;
      snapshot = {
        capturedAt: now.toISOString(), transactionReadOnly: true,
        databaseFingerprint: context.expectedFingerprint,
        scope: "Union of sponsor-vacancy inventory eligible for supported profession feeds before per-candidate preferences, registration, scoring, pagination and curated-role deduplication. Not an individual candidate's result count.",
        totals, byStatus, bySector, bySource, byIndustry, byAge, byEmployer, classificationBasis, industriesBySector,
        exactApplyUrlGroups: duplicateUrls.size,
        repeatedExactApplyUrlRows: [...duplicateUrls.values()].reduce((sum, n) => sum + n - 1, 0),
        registeredFreeBoards: ALL_FREE_BOARD_SOURCES.map(({ id, provider }) => ({ id, provider })),
        referenceAtsTargetCount: REFERENCE_ATS_TARGETS.length,
        ...extra,
      };
      await client.query("ROLLBACK");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally { client.release(); }
    const output = path.resolve(args.get("output") ?? "generated-artifacts/vacancy-coverage-2026-10-21/baseline.json");
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, JSON.stringify(snapshot, null, 2) + "\n");
    process.stdout.write(JSON.stringify({ output, capturedAt: snapshot.capturedAt, totals: snapshot.totals, bySector: snapshot.bySector, bySource: snapshot.bySource, livenessWaste: snapshot.livenessWaste }) + "\n");
  } finally { await pool.end(); }
}

main().catch((error) => {
  process.stderr.write(safeToolErrorSummary(error) + "\n");
  process.exitCode = 1;
});
