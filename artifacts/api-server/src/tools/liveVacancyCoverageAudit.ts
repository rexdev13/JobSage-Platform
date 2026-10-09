import fs from "node:fs";
import path from "node:path";

type BoardAdvert = {
  organisationName: string;
  employer: string;
  title: string;
  location: string | null;
  salary: string | null;
  url: string;
  description: string | null;
  postedDate: string | null;
  targetRegions: string[] | null;
  boardName: string | null;
  externalId: string | null;
  sourceType: "job_board";
  contactEmail: string | null;
  contactEvidenceUrl: string | null;
  closesAt?: Date | null;
};

type SponsorCompany = {
  name?: string;
  town?: string;
  sector?: string;
  industry?: string;
};

function normaliseEmployer(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(?:the|limited|ltd|plc|llp)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function arg(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function csvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function writeCsv(file: string, headers: readonly string[], rows: readonly Record<string, unknown>[]): void {
  fs.writeFileSync(
    file,
    [headers.join(","), ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(","))].join("\n") + "\n",
  );
}

async function main(): Promise<void> {
  // Imports in the production modules construct a lazy pg Pool. All database
  // callbacks are injected below, so this URL is never contacted.
  process.env.DATABASE_URL ||= "postgresql://no-write-audit:invalid@127.0.0.1:1/no-write-audit";
  process.env.DATABASE_READ_ONLY = "true";
  process.env.JOBSAGE_NO_WRITE_PUBLIC_FEED_AUDIT = "true";

  const source = arg("source", "all");
  if (!new Set(["all", "reed", "additional", "free"]).has(source ?? "")) {
    throw new Error("--source must be all, reed, additional, or free");
  }
  const perCategoryLimit = Math.max(1, Math.min(40, Number(arg("per-category-limit", "40"))));
  const deadlineMinutes = Math.max(1, Number(arg("deadline-minutes", "20")));
  const deadlineMs = Date.now() + deadlineMinutes * 60_000;
  const outputDir = path.resolve(arg("out-dir", path.resolve(process.cwd(), "output", "live-coverage-audit"))!);
  const companiesFile = path.resolve(
    arg("companies-file", path.resolve(process.cwd(), "..", "..", "sp-full", "data", "companies.json"))!,
  );
  const companies = JSON.parse(fs.readFileSync(companiesFile, "utf8")) as SponsorCompany[];
  const sponsorNames = [...new Set(companies.map((company) => company.name?.trim()).filter((name): name is string => Boolean(name)))];
  const sponsorByName = new Map(companies.map((company) => [company.name?.trim().toLowerCase(), company]));
  const sponsorAliases = new Map<string, Set<string>>();
  for (const name of sponsorNames) {
    const key = normaliseEmployer(name);
    if (!key) continue;
    const names = sponsorAliases.get(key) ?? new Set<string>();
    names.add(name);
    sponsorAliases.set(key, names);
  }
  const collected = new Map<string, BoardAdvert>();
  const matchStatuses = new Map<string, string>();
  const persist = async (adverts: readonly BoardAdvert[]) => {
    let inserted = 0;
    for (const advert of adverts) {
      if (collected.has(advert.url)) continue;
      collected.set(advert.url, advert);
      matchStatuses.set(
        advert.url,
        advert.organisationName.trim().toLowerCase() === advert.employer.trim().toLowerCase()
          ? "exact-register-name"
          : "normalised-register-name-match",
      );
      inserted++;
    }
    return { inserted, updated: 0, revived: 0 };
  };
  const noVisibilityWrite = async () => ({ live: 0, candidateVisible: 0 });
  const startedAt = Date.now();
  const metrics: Record<string, unknown> = {
    generatedAt: new Date().toISOString(),
    mode: "no-write",
    sponsorCount: sponsorNames.length,
    perCategoryLimit,
  };

  if (source === "all" || source === "reed") {
    const reed = await import("../lib/reedProfessionBackfill");
    reed.clearReedProfessionBackfillCooldown();
    const requestedCategories = new Set(
      (arg("category", "") ?? "").split(",").map((value) => value.trim().toUpperCase()).filter(Boolean),
    );
    const targets = requestedCategories.size > 0
      ? reed.REED_PROFESSION_BACKFILL_TARGETS.filter((target) => requestedCategories.has(target.category))
      : reed.REED_PROFESSION_BACKFILL_TARGETS;
    metrics.reedRequestedCategories = [...requestedCategories];
    metrics.reedTargetCount = targets.length;
    metrics.reed = await reed.runReedProfessionBackfill({
      loadSponsors: async () => sponsorNames,
      targets,
      perCategoryLimit,
      totalPersistLimit: reed.REED_PROFESSION_BACKFILL_TOTAL_PERSIST_LIMIT,
      persist,
      readVisibility: noVisibilityWrite,
      recordMetrics: async () => {},
      deadlineMs,
    });
  }

  if ((source === "all" || source === "additional") && Date.now() < deadlineMs) {
    const additional = await import("../lib/additionalBoardProfessionBackfill");
    additional.clearAdditionalBoardBackfillState();
    const plan = additional.getAdditionalBoardBackfillPlan();
    const page = additional.getAdditionalBoardBackfillPage(0, plan.length);
    metrics.additional = await additional.runAdditionalBoardProfessionBackfill({
      sources: page.sources,
      loadSponsors: async () => sponsorNames,
      perCategoryLimit,
      persist,
      readVisibility: noVisibilityWrite,
      recordSourceMetrics: async () => {},
      deadlineMs,
    });
  }

  if ((source === "all" || source === "free") && Date.now() < deadlineMs) {
    const { ALL_FREE_BOARD_SOURCES } = await import("../lib/freeBoardSourceRegistry");
    const requestedIds = new Set(
      (arg("source-id", "nhs-jobs,teaching-vacancies,nhs-scotland,jobs-ac-uk,charityjob") ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    );
    metrics.freeConfiguredSourceIds = ALL_FREE_BOARD_SOURCES.map((item) => item.id);
    metrics.freeRequestedSourceIds = [...requestedIds];
    const maxPages = Math.max(1, Number(arg("max-pages-per-source", "20")));
    const freeMetrics: Record<string, unknown>[] = [];
    for (const board of ALL_FREE_BOARD_SOURCES.filter((item) => requestedIds.has(item.id))) {
      let cursor: string | null = null;
      const seenExternalIds = new Set<string>();
      let pages = 0;
      let recordsFetched = 0;
      let sponsorMatched = 0;
      let ambiguous = 0;
      let unmatched = 0;
      let error: string | null = null;
      let completed = false;
      while (pages < Math.min(maxPages, board.maxPagesPerRun) && Date.now() < deadlineMs) {
        try {
          let page: Awaited<ReturnType<typeof board.fetchPage>> | null = null;
          let lastError: unknown = null;
          for (let attempt = 1; attempt <= 3 && Date.now() < deadlineMs; attempt++) {
            try {
              page = await board.fetchPage({ cursor, deadlineMs, seenExternalIds });
              break;
            } catch (caught) {
              lastError = caught;
              if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 750));
            }
          }
          if (!page) throw lastError ?? new Error("Public source page failed without an error.");
          pages++;
          recordsFetched += page.recordsFetched ?? page.adverts.length;
          for (const advert of page.adverts) {
            if (advert.externalId) seenExternalIds.add(advert.externalId);
            const exact = sponsorByName.has(advert.employer.trim().toLowerCase())
              ? advert.employer.trim()
              : null;
            const candidates = exact
              ? new Set([sponsorByName.get(exact.toLowerCase())?.name ?? exact])
              : sponsorAliases.get(normaliseEmployer(advert.employer)) ?? new Set<string>();
            if (candidates.size !== 1) {
              if (candidates.size > 1) ambiguous++;
              else unmatched++;
              continue;
            }
            const canonical = [...candidates][0]!;
            const resolved = { ...advert, organisationName: canonical, employer: advert.employer } as BoardAdvert;
            if (!collected.has(resolved.url)) {
              collected.set(resolved.url, resolved);
              matchStatuses.set(resolved.url, exact ? "exact-register-name" : "unique-normalised-register-name");
              sponsorMatched++;
            }
          }
          if (page.stopAfterPage || !page.nextCursor || page.nextCursor === cursor) {
            completed = true;
            break;
          }
          cursor = page.nextCursor;
        } catch (caught) {
          error = caught instanceof Error ? caught.message : String(caught);
          break;
        }
      }
      freeMetrics.push({
        sourceId: board.id,
        boardName: board.boardName,
        pages,
        recordsFetched,
        sponsorMatched,
        ambiguous,
        unmatched,
        complete: completed,
        nextCursor: cursor,
        error,
      });
    }
    metrics.free = freeMetrics;
  }

  const { classifyVacancyCategory } = await import("../lib/sponsorVacancyRoles");
  const rows = [...collected.values()].map((advert) => {
    const sponsor = sponsorByName.get(advert.organisationName.trim().toLowerCase());
    return {
      sponsor_name: advert.organisationName,
      sponsor_town: sponsor?.town ?? "",
      sponsor_sector: sponsor?.sector ?? "",
      sponsor_industry: sponsor?.industry ?? "",
      vacancy_category: classifyVacancyCategory(advert.title, advert.description) ?? "",
      title: advert.title,
      employer: advert.employer,
      location: advert.location ?? "",
      apply_url: advert.url,
      application_mode: "job_board",
      source: advert.boardName ?? "",
      external_id: advert.externalId ?? "",
      posted_date: advert.postedDate ?? "",
      closes_at: advert.closesAt?.toISOString() ?? "",
      contact_email: advert.contactEmail ?? "",
      contact_evidence_url: advert.contactEvidenceUrl ?? "",
      sponsor_match_status: matchStatuses.get(advert.url) ?? "normalised-register-name-match",
      sponsorship_status: "unknown",
      freshness_status: "current_source_observation",
      candidate_visibility_status: "not_imported",
    };
  });
  const headers = [
    "sponsor_name", "sponsor_town", "sponsor_sector", "sponsor_industry", "vacancy_category",
    "title", "employer", "location", "apply_url", "application_mode", "source", "external_id",
    "posted_date", "closes_at", "contact_email", "contact_evidence_url", "sponsor_match_status",
    "sponsorship_status", "freshness_status", "candidate_visibility_status",
  ] as const;
  fs.mkdirSync(outputDir, { recursive: true });
  writeCsv(path.join(outputDir, "vacancies.csv"), headers, rows);
  metrics.uniqueVacancies = rows.length;
  metrics.runtimeMs = Date.now() - startedAt;
  metrics.bySource = Object.fromEntries(
    [...new Set(rows.map((row) => row.source))].sort().map((name) => [name, rows.filter((row) => row.source === name).length]),
  );
  metrics.byCategory = Object.fromEntries(
    [...new Set(rows.map((row) => row.vacancy_category))].sort().map((name) => [name || "unclassified", rows.filter((row) => row.vacancy_category === name).length]),
  );
  fs.writeFileSync(path.join(outputDir, "metrics.json"), JSON.stringify(metrics, null, 2) + "\n");
  console.log(JSON.stringify(metrics, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
