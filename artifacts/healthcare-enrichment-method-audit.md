# Healthcare sponsor enrichment method audit

**Audit date:** 2026-09-27
**Scope:** Existing repository records only. No new enrichment, website crawl, database access, production change, or deployment was performed for this audit.

## Best-performing method

The strongest completed Healthcare result by volume was the **six-batch website-and-careers enrichment**, not an ATS-first scan. It processed 3,000 unique sponsor rows in six 500-row batches. It started with a guarded development export, used CQC as a source of candidate leads, queried SponsorList when CQC supplied no website candidate, then accepted a website only after a safe HTTPS fetch and first-party employer identity check. Careers pages had to be employer-hosted or directly linked and successfully checked. CQC, SponsorList, and search results were leads—not proof. No ATS mappings were accepted. [Batch reconciliation, lines 7–18, 22–43](healthcare-sponsor-website-batches-1-6-reconciliation.md); [batch 1 report, lines 19–26](healthcare-sponsor-website-enrichment-batch1-report.md)

Across those 3,000 rows, the reports recorded:

| Evidence or outcome | Count |
|---|---:|
| Website claims | 755: 533 high, 222 medium |
| Careers claims | 362: 285 high, 77 medium |
| High-confidence website writes to development | 533 |
| High-confidence grouped careers writes to development | 270 |
| Medium-confidence sponsor rows held for review | 268 |
| ATS mappings accepted | 0 |
| Rows with no accepted website claim | 2,245 |

The 3,000 figure is **sponsors checked**, not useful sources. The inspected reports do not show “500 useful sources.” The 755 website and 362 careers counts are evidence claims; the 803 high-confidence writes are the website plus grouped careers records. The 268 medium-confidence rows stayed out of the applied values. [Reconciliation, lines 18, 22–42](healthcare-sponsor-website-batches-1-6-reconciliation.md)

The run used `.local/reports/sponsor-enrichment/jobsage-sponsor-base-export.csv` (25,349 rows exported from 142,918 development records) and `scripts/data/cache/cqc-directory-2026-09-14.csv` (96,394 parsed records). Exact `industry=Healthcare` yielded 4,808 rows; 4,766 needed enrichment. Social Care and other labels were excluded. SponsorList was a public lead source. The export package also produced `jobsage-company-site-existing.csv`, `jobsage-existing-vacancy-sources.csv`, the header-only `jobsage-website-enrichment-import-template.csv`, source-readiness report, `final-report.md`, and `export-manifest.json`. [Batch reconciliation, lines 7–12](healthcare-sponsor-website-batches-1-6-reconciliation.md); [export report, lines 39–59, 72–79](../.local/reports/sponsor-enrichment/final-report.md)

## Other runs and what they show

- **Vacancy routing batch 2:** 200 Healthcare sponsors checked; 42 company-website routes, 0 ATS/job-board routes, 0 Send CV routes, 158 unverified. Confidence was 15 high, 27 medium, 0 low, 158 unverified: 42/200 useful routes (21%). It used the sponsor export, CQC leads, SponsorList, and existing company-site/vacancy-source files; Bing was not configured. [Batch 2 report, lines 21–70](healthcare-vacancy-source-routing-batch2-200-report.md)
- **Vacancy routing batch 1:** 100 sponsors checked; 9 company websites, 6 job-board/ATS routes, 4 Send CV routes, 81 unverified. Confidence was 18 high, 1 medium, 0 low, 81 unverified. Useful-route yield was 19%. [Batch 1 report, lines 17–57](healthcare-vacancy-source-routing-batch1-100-report.md)
- **Recent unresolved pilot:** 50 batch-2-unverified sponsors; 1 medium-confidence Send CV route and 49 unverified. Bing was not configured and made 0 queries, so it did not measure search’s potential contribution. [Pilot report, lines 23–40, 42–69, 108–121](healthcare-vacancy-source-routing-search-pilot-50-report.md)
- **Direct ATS/feed checks:** the cross-sector ATS sample found 4 active feeds among 139 employers (1 verified, 2 probable, 1 uncertain), and no supported job-returning feed for the 10-employer Healthcare/Social Care sample. A separate Healthcare mapping-only scan found 0 mappings among 38 candidates; its retry scanned 18 and also found 0. These samples are too small to prove that sectors lack ATS vacancies, but they do not support using ATS-first discovery as the main method. [ATS audit, lines 6–12, 64–83](../ats-coverage-summary.md); [source scan](../.agents/outputs/healthcare-direct-source-test-2026-09-26/source-scan.json); [retry](../.agents/outputs/healthcare-direct-source-test-2026-09-26/source-scan-retry-results.json)

Search was not a meaningful contributor to the strong website/careers result: two initial search exercises were recorded, but no API key was configured and no result was accepted. The routing batch and pilot reports likewise show Bing unavailable or 0 queries. Do not call search ineffective on this evidence; it was not properly tested. [Batch 1 enrichment report, lines 21–26](healthcare-sponsor-website-enrichment-batch1-report.md); [batch 2 routing report, lines 21–29](healthcare-vacancy-source-routing-batch2-200-report.md)

## Inputs, tools, and outputs

- The export command was `NODE_ENV=development pnpm --filter @workspace/scripts sponsor-enrichment-export --confirm-development-db`. It used a development-only, read-only transaction. [Export CLI README, lines 5–29](../scripts/README-sponsor-contact-discovery.md)
- Discovery used `scripts/src/healthcareSponsorWebsiteBatch.ts` (`healthcare-sponsor-websites`); development import/dry-run used `scripts/src/healthcareSponsorWebsiteImport.ts`. Reports preserve the six enrichment CSVs and reports, per-batch dry-run/diff/applied records, the medium-review CSV, and the reconciliation report. The reports do not preserve the exact shell invocation for each of the six discovery batches; they document the script’s offset/limit behavior instead. [Reconciliation, lines 45–52](healthcare-sponsor-website-batches-1-6-reconciliation.md); [batch 1 report, lines 92–97](healthcare-sponsor-website-enrichment-batch1-report.md)
- Later route discovery used `scripts/src/vacancySourceRoutingBatch.ts`, documented in `scripts/README-vacancy-source-routing.md`; the batch 1, batch 2, and unresolved-pilot CSV/report/checkpoint files are under `artifacts/`.
- Direct-feed work used `ats-coverage-summary.md`, `scripts/src/scanHealthcareDirectSources.ts`, and the API-server direct ATS connectors/pipeline. Its reports are coverage CSV/JSON/summary files and the Healthcare source-scan, retry, dry-run, and apply JSON records. The ATS coverage audit used development database reads and public ATS GETs, not production data. [ATS audit, lines 3–4, 132–134](../ats-coverage-summary.md)

The six-batch enrichment used a development export and wrote reviewed high-confidence values to the development `heliumdb`; it did not access or write production. The audit/reporting work here did not run those scripts or access a database. [Reconciliation, lines 34–43](healthcare-sponsor-website-batches-1-6-reconciliation.md)

Previously discovered vacancy URLs were used by the **later routing runner** as candidate leads, not accepted as employer websites by themselves. A cached vacancy source can be considered as a company-site lead only with identity/host checks; ATS URLs are separately classified. Do not infer a company website merely from a vacancy URL. [Routing README, lines 98–114](../scripts/README-vacancy-source-routing.md); [runner source, `knownSourceCandidates`](../scripts/src/vacancySourceRoutingBatch.ts)

## Recommendation for non-Healthcare sectors

Repeat the evidence process, **not the Healthcare-specific CQC script unchanged**: begin with the guarded development export and existing-state files; use an official registry appropriate to the sector if one is available; treat every registry, SponsorList, search, or saved-vacancy URL as a lead; verify identity and a hiring route on the employer’s site; keep medium-confidence evidence for review; and start with a capped 50-row pilot. Keep direct ATS lookups as a low-cost check when an exact board mapping is known, not the primary discovery strategy. Do not extrapolate these sample yields to a whole sector.

The generic `vacancy-source-routing` runner supports an exact sector label, bounded concurrency, cache, and separate output paths. Example **for a future run only; it was not executed in this audit**:

```bash
pnpm --filter @workspace/scripts vacancy-source-routing \
  -- \
  --sector Technology \
  --batch-number 1 \
  --batch-size 50 \
  --offset 0 \
  --input .local/reports/sponsor-enrichment/jobsage-sponsor-base-export.csv \
  --known-sites-file .local/reports/sponsor-enrichment/jobsage-company-site-existing.csv \
  --known-sources-file .local/reports/sponsor-enrichment/jobsage-existing-vacancy-sources.csv \
  --output artifacts/technology-vacancy-source-routing-pilot-50.csv \
  --report artifacts/technology-vacancy-source-routing-pilot-50-report.md \
  --progress artifacts/technology-vacancy-source-routing-pilot-50-progress.json \
  --search-disabled \
  --cache-enabled \
  --max-concurrency 3 \
  --fresh
```

Replace `Technology` with the exact `industry` value for the chosen sector and use a new sector-specific output name. If that sector already has a routing CSV, add `--previous-file <prior-sector-csv>` so IDs are not repeated. Only enable Bing when it is already configured; report actual query counts. Do not use the Healthcare website-enrichment script or CQC data for another sector without an appropriate source adapter. [Runner README, lines 21–52, 67–94](../scripts/README-vacancy-source-routing.md)

**Avoid:** ATS-first broad discovery as the main approach, or importing directory/search matches without first-party verification. The direct Healthcare ATS sample had no hits, while the strongest historical yield came from verified company websites/careers pages. Also avoid treating the 3,000 checked rows as 3,000 sources or treating unverified rows as proof that no vacancies exist.

**Safety confirmation:** This audit only read existing files and wrote this report. It did not run enrichment or website checks, query a database, change production data, import findings, or deploy.