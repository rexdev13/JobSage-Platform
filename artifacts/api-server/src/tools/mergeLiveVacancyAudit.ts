import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";

type Row = Record<string, string>;

const EMPLOYER_ATS_SOURCES = new Set([
  "algolia", "ashby", "bamboohr", "greenhouse", "lever", "oracle-cloud",
  "pinpoint", "recruitee", "smartrecruiters", "successfactors", "taleo",
  "teamtailor", "tribepad", "workable", "workday",
]);

function applicationModeFor(row: Row): "company_website" | "job_board" {
  if (row.application_mode === "company_website") return "company_website";
  return EMPLOYER_ATS_SOURCES.has((row.source ?? "").trim().toLowerCase())
    ? "company_website"
    : "job_board";
}

function canonicalUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_.+|source|ref|referrer|tracking|trk)$/i.test(key)) url.searchParams.delete(key);
    }
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.toString();
  } catch {
    return null;
  }
}

function csvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

async function main(): Promise<void> {
  process.env.DATABASE_URL ||= "postgresql://no-write-audit:invalid@127.0.0.1:1/no-write-audit";
  process.env.DATABASE_READ_ONLY = "true";
  const { classifyVacancyCategoryWithEvidence } = await import("../lib/sponsorVacancyRoles");
  const { isLikelyEditorialTitle, isManualLabourTitle } = await import("../lib/vacancyTitlePolicy");
  const root = path.resolve(process.cwd(), "..", "..");
  const inputFiles = [
    "artifacts/api-server/output/live-coverage-audit/nhs-jobs-300/vacancies.csv",
    "artifacts/api-server/output/live-coverage-audit/nhs-scotland-100/vacancies.csv",
    "artifacts/api-server/output/live-coverage-audit/jobs-ac-uk-100/vacancies.csv",
    "artifacts/api-server/output/live-coverage-audit/charityjob-100/vacancies.csv",
    "artifacts/api-server/output/live-coverage-audit/global-free-100/vacancies.csv",
    "artifacts/api-server/output/live-coverage-audit/teaching-vacancies-100/vacancies.csv",
    "artifacts/api-server/output/live-coverage-audit/reed-thin-100/vacancies.csv",
    "sp-full/output/live-20261008/vacancies.csv",
    "sp-full/output/evidence-ats-v2-20261008/vacancies.csv",
    "sp-full/output/careers-evidence-thin-v2-20261008/vacancies.csv",
    "sp-full/output/careers-evidence-other-20261009/vacancies.csv",
    "sp-full/output/sendcv-evidence-20261009/vacancies.csv",
  ].map((file) => path.join(root, file));
  const outputDir = path.join(process.cwd(), "output", "live-coverage-audit", "combined");
  const sendCvFiles = [
    path.join(root, "sp-full/output/sendcv-verify-20261009/send-cv-routes.csv"),
    path.join(root, "sp-full/output/sendcv-evidence-20261009/send-cv-routes.csv"),
  ];
  const rows: Row[] = [];
  for (const file of inputFiles) {
    if (!fs.existsSync(file)) throw new Error(`Missing audit input: ${file}`);
    rows.push(...parse(fs.readFileSync(file, "utf8"), { columns: true, skip_empty_lines: true, bom: true }) as Row[]);
  }

  const acceptedIdentity = new Set([
    "exact-register-name",
    "exact-name-town-website-confirmed",
    // The live collector emits this only when normalization resolves to one
    // and only one register organisation after harmless legal-name changes
    // (Ltd/Limited, The, punctuation, ampersand/and).
    "unique-normalised-register-name",
  ]);
  const merged = new Map<string, Row>();
  for (const raw of rows) {
    const applyUrl = canonicalUrl(raw.apply_url ?? "");
    if (!applyUrl || !(raw.title ?? "").trim() || !(raw.sponsor_name ?? "").trim()) continue;
    const suppliedCategory = (raw.vacancy_category ?? "").trim();
    const classification = suppliedCategory
      ? { category: suppliedCategory, confidence: "high", reason: "source_category" }
      : classifyVacancyCategoryWithEvidence(raw.title, raw.description ?? null);
    const category = classification.category ?? "";
    const identityEligible = acceptedIdentity.has(raw.sponsor_match_status ?? "");
    const titlePolicyEligible = !isManualLabourTitle(raw.title) && !isLikelyEditorialTitle(raw.title);
    const guardedImportEligible = identityEligible && Boolean(category) && titlePolicyEligible;
    const row: Row = {
      sponsor_name: raw.sponsor_name,
      sponsor_town: raw.sponsor_town ?? "",
      sponsor_sector: raw.sponsor_sector || raw.sector || "",
      sponsor_industry: raw.sponsor_industry || raw.industry || "",
      vacancy_category: category,
      classification_confidence: classification.confidence,
      classification_reason: classification.reason,
      title: raw.title,
      employer: raw.employer || raw.sponsor_name,
      location: raw.location ?? "",
      apply_url: applyUrl,
      application_mode: applicationModeFor(raw),
      source: raw.source ?? "",
      external_id: raw.external_id ?? "",
      observed_at: raw.observed_at || raw.posted_date || new Date().toISOString(),
      closes_at: raw.closes_at ?? "",
      sponsor_match_status: raw.sponsor_match_status ?? "",
      identity_import_eligible: String(identityEligible),
      title_policy_eligible: String(titlePolicyEligible),
      guarded_import_eligible: String(guardedImportEligible),
      sponsorship_status: raw.sponsorship_status || "unknown",
      freshness_status: raw.freshness_status || "current_source_observation",
      contact_email: raw.contact_email || raw.public_role_emails || "",
      contact_evidence_url: raw.contact_evidence_url || raw.contact_evidence_urls || "",
      send_cv_status: "not_verified",
      candidate_visibility_status: guardedImportEligible
        ? "eligible_after_import_and_persisted_liveness"
        : identityEligible
          ? !category
            ? "blocked_unclassified"
            : "blocked_title_policy"
          : "blocked_identity_review",
    };
    const previous = merged.get(applyUrl);
    if (!previous || previous.guarded_import_eligible !== "true" && guardedImportEligible) {
      merged.set(applyUrl, row);
    }
  }

  const output = [...merged.values()].sort((a, b) =>
    a.vacancy_category.localeCompare(b.vacancy_category) || a.sponsor_name.localeCompare(b.sponsor_name) || a.title.localeCompare(b.title),
  );
  const headers = [
    "sponsor_name", "sponsor_town", "sponsor_sector", "sponsor_industry", "vacancy_category",
    "classification_confidence", "classification_reason", "title",
    "employer", "location", "apply_url", "application_mode", "source", "external_id", "observed_at",
    "closes_at", "sponsor_match_status", "identity_import_eligible", "title_policy_eligible", "guarded_import_eligible",
    "sponsorship_status", "freshness_status", "contact_email", "contact_evidence_url", "send_cv_status",
    "candidate_visibility_status",
  ];
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(
    path.join(outputDir, "vacancies.csv"),
    [headers.join(","), ...output.map((row) => headers.map((header) => csvCell(row[header])).join(","))].join("\n") + "\n",
  );
  const guardedOutput = output.filter((row) => row.guarded_import_eligible === "true");
  fs.writeFileSync(
    path.join(outputDir, "guarded-vacancies.csv"),
    [headers.join(","), ...guardedOutput.map((row) => headers.map((header) => csvCell(row[header])).join(","))].join("\n") + "\n",
  );
  const sendCvRoutes = new Map<string, Row>();
  for (const file of sendCvFiles) {
    if (!fs.existsSync(file)) continue;
    for (const route of parse(fs.readFileSync(file, "utf8"), { columns: true, skip_empty_lines: true, bom: true }) as Row[]) {
      if (route.send_cv_status !== "verified_recruitment_route") continue;
      const key = `${route.sponsor_name.trim().toLowerCase()}|${route.recruitment_email.trim().toLowerCase()}`;
      sendCvRoutes.set(key, route);
    }
  }
  const sendCvOutput = [...sendCvRoutes.values()];
  const sendCvHeaders = [
    "sponsor_name", "sector", "industry", "town", "recruitment_email",
    "evidence_url", "verification_method", "send_cv_status", "checked_at",
  ];
  fs.writeFileSync(
    path.join(outputDir, "send-cv-routes.csv"),
    [sendCvHeaders.join(","), ...sendCvOutput.map((row) => sendCvHeaders.map((header) => csvCell(row[header])).join(","))].join("\n") + "\n",
  );
  const countBy = (key: string, filter?: (row: Row) => boolean) => Object.fromEntries(
    [...new Set(output.filter(filter ?? (() => true)).map((row) => row[key] || "unknown"))]
      .sort()
      .map((value) => [value, output.filter((row) => (filter?.(row) ?? true) && (row[key] || "unknown") === value).length]),
  );
  const categories = [...new Set(output.map((row) => row.vacancy_category).filter(Boolean))].sort();
  const professionCoverage = Object.fromEntries(categories.map((category) => {
    const categoryRows = output.filter((row) => row.vacancy_category === category);
    const guarded = categoryRows.filter((row) => row.guarded_import_eligible === "true");
    const modes = Object.fromEntries([...new Set(guarded.map((row) => row.application_mode))]
      .sort().map((mode) => [mode, guarded.filter((row) => row.application_mode === mode).length]));
    const sources = Object.fromEntries([...new Set(guarded.map((row) => row.source || "unknown"))]
      .sort().map((source) => [source, guarded.filter((row) => (row.source || "unknown") === source).length]));
    return [category, {
      collected: categoryRows.length,
      guarded: guarded.length,
      blocked: categoryRows.length - guarded.length,
      coverageLevel: guarded.length >= 1_000 ? "strong" : guarded.length >= 100 ? "moderate" : guarded.length > 0 ? "thin" : "empty",
      modes,
      sources,
    }];
  }));
  const metrics = {
    generatedAt: new Date().toISOString(),
    inputRows: rows.length,
    uniqueVacancies: output.length,
    duplicatesRemoved: rows.length - output.length,
    identityImportEligible: output.filter((row) => row.identity_import_eligible === "true").length,
    guardedImportEligible: output.filter((row) => row.guarded_import_eligible === "true").length,
    blockedUnclassified: output.filter((row) => row.candidate_visibility_status === "blocked_unclassified").length,
    blockedIdentityReview: output.filter((row) => row.candidate_visibility_status === "blocked_identity_review").length,
    blockedTitlePolicy: output.filter((row) => row.candidate_visibility_status === "blocked_title_policy").length,
    currentlyCandidateVisible: 0,
    verifiedSendCv: sendCvOutput.length,
    byMode: countBy("application_mode"),
    bySource: countBy("source"),
    guardedByMode: countBy("application_mode", (row) => row.guarded_import_eligible === "true"),
    guardedBySource: countBy("source", (row) => row.guarded_import_eligible === "true"),
    guardedByCategory: countBy("vacancy_category", (row) => row.guarded_import_eligible === "true"),
    guardedByClassificationConfidence: countBy(
      "classification_confidence",
      (row) => row.guarded_import_eligible === "true",
    ),
    acceptedIdentityByStatus: countBy(
      "sponsor_match_status",
      (row) => row.identity_import_eligible === "true",
    ),
    blockedIdentityByStatus: countBy(
      "sponsor_match_status",
      (row) => row.identity_import_eligible !== "true",
    ),
    professionCoverage,
  };
  fs.writeFileSync(path.join(outputDir, "metrics.json"), JSON.stringify(metrics, null, 2) + "\n");
  console.log(JSON.stringify(metrics, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
