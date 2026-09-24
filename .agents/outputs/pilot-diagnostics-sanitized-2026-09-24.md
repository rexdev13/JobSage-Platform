# Sanitized vacancy-collection diagnostics

All examples below use public employer names and public URLs. No candidate records, CVs, applications, or private contact details are included.

## Incorrect careers-page mappings
- **A P L CONSTRUCTION LTD** — official website `https://www.aplconstruction.co.uk/`; stored careers URL is `https://www.aplconstruction.co.uk/photo-gallery`. No ATS provider is recorded. The crawl completed but this is a photo-gallery page, not a careers listing.
- **B S Accessories Ltd T/A Fancy Jewellers** — official website `https://fj-gold.com`; stored careers URL is `https://fj-gold.com/?p=1201&post_type=product`, a product page. The latest recorded crawl was partial after a request timeout.
- **59 Studio Ltd / Journey** — official site `https://59.studio/`; stored URL `https://job-boards.greenhouse.io/journey/jobs/5229593007` is a specific Greenhouse listing rather than a board root. The official Join page was reported to display Journey Greenhouse roles, but the database mapping remains unverified. Board identifier candidate: `journey`; do not treat this as a validated mapping until official evidence is rechecked.
- **60X Ltd** — official site `https://www.60x.ai/`; stored Ashby URL `https://jobs.ashbyhq.com/60x` is a board root and the official site links to it, but the stored mapping status remains unverified and no direct feed result is included here.

## Failed extraction example
- **A Keys Construction Ltd** — official website `https://akeysconstruction.com/`; no saved careers URL. Its check failed because `robots.txt` could not be checked after a request timeout. This is a temporary access failure, not evidence that the employer has no vacancies.
- Other pilot failures include temporary host pacing/backoff and robots-check timeouts. Keep these outcomes separate from permanent invalid mappings and verified-empty sources.

## Inconclusive vacancy/application-page checks
- **BMC Software Ltd** — a prior bounded one-off check recorded nine new job URLs as inconclusive because `jobs.bmc.com` was paced/in backoff. They are not counted as live by that check. The development database also contains older/other BMC records, so the whole current BMC table is not the same nine-row cohort.
- Public examples from the current unverified BMC cohort include `https://jobs.bmc.com/Careers/JobDetail/Sr-Data-Scientist-India/47230` and `https://jobs.bmc.com/Careers/JobDetail/Sr-Data-Scientist-Canada/47422`; both have no stored application URL and remain unverified with the pacing/backoff reason. Do not label them live or dead from an inconclusive attempt.
- The currently stored BMC `Technical Support` structured job-card example is `https://jobs.bmc.com/Careers/SearchJobs?1273=1190358&1273_format=1340&listFilterMode=1` and is recorded live; its application URL field is empty.

## Confirmed location-matcher edge case
- `regionsFromLocationText("New York")` currently returns `Yorkshire and the Humber`. A naive region-based count would classify all eight 9fin New York records as UK. The 9fin pilot CSV therefore buckets only the exact labels London/Belfast as UK and New York as non-UK; this code issue is intentionally not changed in this export.
