# Sponsor vacancy scan operations

This is the standalone pipeline under `sp-full`. It reads the Home Office workers register and writes local CSVs. It does not import into the JobSage database or submit applications.

```sh
cd sp-full
npm ci
node run.js register
node run.js cron --sector healthcare --limit 100 --concurrency 8 --results-file data/live/results.jsonl --out-dir output/live
node run.js export --max-age-hours 48 --results-file data/live/results.jsonl --out-dir output/live
```

Schedule `cron` with the host's scheduler, for example `0 * * * * cd /path/to/JobSage-Platform/sp-full && /usr/bin/node run.js cron --limit 500 --concurrency 8 >> /var/log/sponsor-scan.log 2>&1`. Use a persistent `data/` volume so runs resume. It reserves up to 80% of each run for sponsors with saved websites and the rest for unsourced discovery, selecting the least recently checked in each group. It appends the latest record per sponsor, prevents concurrent runs with `data/cron.lock`, and exports only recent complete records. Measure runtime and successful scans per hour on the deployment host before choosing a schedule; a 48-hour export window requires enough capacity to refresh the desired cohort. A new process on a different host needs a shared scheduler or database lease; the file lock only protects processes sharing a filesystem.

Use `--industry Engineering`, `--industry Construction`, or another exact evidence label for evidence-backed sector pilots. Use `--name "Exact register name"` for a single reviewed sponsor. These filters do not relax the name-and-town identity checks. The scanner also loads `artifacts/non-healthcare-company-websites-all-sectors.csv` by default; pass `--evidence-file` to use another snapshot. High-confidence exact name-and-town website evidence may be promoted, while medium, low and unverified rows retain review-required status.

Use `--careers-evidence-only` for a bounded lane containing sponsors that already have a saved careers URL. Use `--no-site` with that lane when the saved URL is a supported ATS tenant and the purpose is a fast direct-feed refresh. Explicit review flags from `--reference-file` always override website confidence.

Scheduled discovery can use a bounded `--priority-pattern "University|NHS|Bank"`
to place likely high-volume employer names first inside the normal saved-site and
unknown-site quotas. The pattern changes scan order only; it does not relax
website, employer identity, vacancy, freshness, or import-review checks.

`--reference-file /path/to/reviewed-vacancies.csv` may supply public ATS or careers hints with the columns `sponsor_name,apply_url,application_mode,sponsor_match_status`. The scanner always refetches the public source. It carries the supplied review status into each row and sets `import_eligible=false` for division, group, brand, conflicting, or other review-required matches.

In this repository, `register` selects Skilled Worker sponsors by default and applies exact name-and-town industry evidence from `artifacts/non-healthcare-company-websites-all-sectors.csv` where available. Use `--all-worker-routes` only for an explicit broader audit. `discover` and `cron` first check saved URLs from `exports/sponsor-websites-production.csv` before guessing domains. In a standalone deployment, copy these files or pass `--industry-file /path/to/industry.csv` and `--sites-file /path/to/websites.csv`. A saved URL still has to respond and match the employer identity before it is crawled.

`output/vacancies.csv` has one row per vacancy with the title, UK location, direct apply URL, application mode, source and freshness evidence. Employer-specific hosted ATS tenants such as Greenhouse, Ashby and Workday are exported as `company_website`; `job_board` is reserved for multi-employer boards. `sponsorship_status` remains `unknown`: a sponsor licence and a live advert do not prove that a particular role offers sponsorship. `output/companies.csv` includes websites, careers pages, per-sponsor runtime, source diagnostics and public role mailboxes. Public role mailboxes are labelled `employer_level_review_required`; they are never exported as a verified `send_cv` application mode. The employer and contact scope still need review before any guarded import or candidate action.

`--recruitment-email-evidence-only` selects the bounded cohort with a saved recruitment-labelled mailbox. A mailbox is written to `send-cv-routes.csv` only when a freshly fetched official page explicitly instructs candidates to send, submit, attach, forward, or email a CV, and the sponsor website identity is guarded-import eligible. A generic mailbox alone is never enough.

The register does not contain websites or sectors. Industry labels come from exact name-and-town matches to the repository evidence when available; the fallback coarse sector classification is inferred and incomplete, and `other` is not an industry. Domain guesses need title/name confirmation. A site-linked ATS feed can produce many real vacancies; name-only board probing is research-only (`--probe-unverified`) and its jobs are excluded from export. Existing results older than 48 hours are excluded by default. `--max-age-hours` changes that window. Refresh the register regularly, and monitor counts and request failures on each scan.

This scanner has no guarantee of thousands of vacancies per sector or mode. The number depends on verified sponsor websites, readable feeds, current hiring and UK locations. The most useful next source of coverage is a reviewed employer-website mapping and verified board references, followed by per-provider readers and live apply-link checks before database import.

## 8 October 2026 local live evidence

The official register downloaded that day contained 143,186 rows. The default exact route filter grouped these to 122,386 Skilled Worker name-and-town organisations, of which 7,462 had exact local industry evidence. A clean isolated live run wrote 237 unique current UK vacancy links: Monzo 54, 9fin 21, Vertical Aerospace 6, and Nuffield Health 156. Ten links each were deep-checked for Monzo, 9fin, and Nuffield; all six Vertical links were deep-checked. The remaining links came from live public source responses in the same run. Duplicate apply URLs: zero.

Only Monzo's 54 rows had the supplied `exact-register-name` status. The other 183 rows remain blocked from guarded import by brand/legal-name, group-entity, or division-scope review. Every row retains `sponsorship_status=unknown`. The scanner verified no suitable Send CV recruitment mailbox in this run. The attached 482-row browser collection remains comparison evidence, not scanner output.
