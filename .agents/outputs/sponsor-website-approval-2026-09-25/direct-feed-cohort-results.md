# Direct-feed-only cohort test — 29 employers

## Outcome

The final cohort test passed its safety gates in development. Both runs selected the same 29 sponsor IDs. Direct vacancy ingestion used only verified ATS feeds; employers without a verified direct source were explicitly skipped. Generic HTML vacancy extraction and website filling were disabled. No production database or deployment was used.

| Measure | First successful pass | Repeat pass |
|---|---:|---:|
| Selected employers | 29 | 29 |
| Completed direct feeds | 3 | 3 |
| Failed | 0 | 0 |
| Skipped — no direct source | 26 | 26 |
| Advertisements found | 60 | 60 |
| Inserted | 1 | 0 |
| Updated | 59 | 60 |
| Rejected | 0 | 0 |
| Runtime | 107.4 s | 104.4 s |
| Providers | Ashby, Greenhouse | Ashby, Greenhouse |

The repeat pass inserted **zero** rows. The first pass inserted one previously missing direct-feed posting, updated 59 existing postings, and rejected none. The repeat pass updated 60 and rejected none.

## Per-employer counts

| Sponsor ID | Employer | Pass 1 status | Provider | Found | Inserted | Updated | Rejected | Pass 2 status | Found | Inserted | Updated | Rejected |
|---:|---|---|---|---:|---:|---:|---:|---|---:|---:|---:|---:|
| 154374 | B&B Singh Construction Ltd | skipped_no_direct_feed_source | — | 0 | 0 | 0 | 0 | skipped_no_direct_feed_source | 0 | 0 | 0 | 0 |
| 209772 | HBC Construction Limited | skipped_no_direct_feed_source | — | 0 | 0 | 0 | 0 | skipped_no_direct_feed_source | 0 | 0 | 0 | 0 |
| 339349 | Waa Construction Ltd | skipped_no_direct_feed_source | — | 0 | 0 | 0 | 0 | skipped_no_direct_feed_source | 0 | 0 | 0 | 0 |
| 165830 | ASME Engineering Ltd | skipped_no_direct_feed_source | — | 0 | 0 | 0 | 0 | skipped_no_direct_feed_source | 0 | 0 | 0 | 0 |
| 184620 | Cortex Engineering Solutions Ltd | skipped_no_direct_feed_source | — | 0 | 0 | 0 | 0 | skipped_no_direct_feed_source | 0 | 0 | 0 | 0 |
| 207098 | Grove Automation | skipped_no_direct_feed_source | — | 0 | 0 | 0 | 0 | skipped_no_direct_feed_source | 0 | 0 | 0 | 0 |
| 308015 | ROCKFORT ENGINEERING LIMITED | skipped_no_direct_feed_source | — | 0 | 0 | 0 | 0 | skipped_no_direct_feed_source | 0 | 0 | 0 | 0 |
| 337715 | Vertical Aerospace Group Ltd | completed | Ashby | 8 | 1 | 7 | 0 | completed | 8 | 0 | 8 | 0 |
| 167925 | B3 Insurance Ltd | skipped_no_direct_feed_source | — | 0 | 0 | 0 | 0 | skipped_no_direct_feed_source | 0 | 0 | 0 | 0 |
| 156835 | ABERDEEN DENTAL CARE LIMITED | skipped_no_direct_feed_source | — | 0 | 0 | 0 | 0 | skipped_no_direct_feed_source | 0 | 0 | 0 | 0 |
| 160527 | Aldbourne Nursing Home Ltd. | skipped_no_direct_feed_source | — | 0 | 0 | 0 | 0 | skipped_no_direct_feed_source | 0 | 0 | 0 | 0 |
| 165476 | Ashburton House Care Home Ltd | skipped_no_direct_feed_source | — | 0 | 0 | 0 | 0 | skipped_no_direct_feed_source | 0 | 0 | 0 | 0 |
| 186215 | Cumloden Manor Nursing Home Ltd | skipped_no_direct_feed_source | — | 0 | 0 | 0 | 0 | skipped_no_direct_feed_source | 0 | 0 | 0 | 0 |
| 188563 | DENTAL BEAUTY GROUP LTD | skipped_no_direct_feed_source | — | 0 | 0 | 0 | 0 | skipped_no_direct_feed_source | 0 | 0 | 0 | 0 |
| 190862 | Downside House Residential Care Home | skipped_no_direct_feed_source | — | 0 | 0 | 0 | 0 | skipped_no_direct_feed_source | 0 | 0 | 0 | 0 |
| 172517 | BLUE OCEAN RESTAURANT | skipped_no_direct_feed_source | — | 0 | 0 | 0 | 0 | skipped_no_direct_feed_source | 0 | 0 | 0 | 0 |
| 338423 | VIRUNDHU RESTAURANT LIMITED | skipped_no_direct_feed_source | — | 0 | 0 | 0 | 0 | skipped_no_direct_feed_source | 0 | 0 | 0 | 0 |
| 193423 | EDWARD TAYLOR TEXTILES LTD | skipped_no_direct_feed_source | — | 0 | 0 | 0 | 0 | skipped_no_direct_feed_source | 0 | 0 | 0 | 0 |
| 155292 | 59 Studio Ltd | completed | Greenhouse | 16 | 0 | 16 | 0 | completed | 16 | 0 | 16 | 0 |
| 156194 | A5 Products Limited | skipped_no_direct_feed_source | — | 0 | 0 | 0 | 0 | skipped_no_direct_feed_source | 0 | 0 | 0 | 0 |
| 206141 | Grand Finish Ltd | skipped_no_direct_feed_source | — | 0 | 0 | 0 | 0 | skipped_no_direct_feed_source | 0 | 0 | 0 | 0 |
| 215721 | INNOVATIVE IT SERVICES LIMITED | skipped_no_direct_feed_source | — | 0 | 0 | 0 | 0 | skipped_no_direct_feed_source | 0 | 0 | 0 | 0 |
| 222348 | KF TECH LTD | skipped_no_direct_feed_source | — | 0 | 0 | 0 | 0 | skipped_no_direct_feed_source | 0 | 0 | 0 | 0 |
| 312590 | Seaborn Software Ltd | skipped_no_direct_feed_source | — | 0 | 0 | 0 | 0 | skipped_no_direct_feed_source | 0 | 0 | 0 | 0 |
| 318007 | Solvo.ai Ltd. | skipped_no_direct_feed_source | — | 0 | 0 | 0 | 0 | skipped_no_direct_feed_source | 0 | 0 | 0 | 0 |
| 171839 | BIZ CLEANERS LIMITED | skipped_no_direct_feed_source | — | 0 | 0 | 0 | 0 | skipped_no_direct_feed_source | 0 | 0 | 0 | 0 |
| 172521 | BLUE ORCHID ASPLEY GUISE LTD T/A BLUE ORCHID | skipped_no_direct_feed_source | — | 0 | 0 | 0 | 0 | skipped_no_direct_feed_source | 0 | 0 | 0 | 0 |
| 172579 | BLUE WATER FOOD LTD | skipped_no_direct_feed_source | — | 0 | 0 | 0 | 0 | skipped_no_direct_feed_source | 0 | 0 | 0 | 0 |
| 250916 | Pliant Payments Limited | completed | Ashby | 36 | 0 | 36 | 0 | completed | 36 | 0 | 36 | 0 |

Only three of the 29 employers had verified supported direct mappings in the development data:

- Vertical Aerospace Group Ltd — Ashby: 8 found; pass 1 inserted 1 and updated 7; repeat inserted 0 and updated 8.
- 59 Studio Ltd — Greenhouse: 16 found; pass 1 and repeat each updated 16.
- Pliant Payments Limited — Ashby: 36 found; pass 1 and repeat each updated 36.

The other 26 were skipped because no verified direct feed or explicitly approved schema.org page was present. No schema.org sources were approved in this cohort.

## Candidate visibility samples

The candidate-list visibility gate counted 61 visible vacancies before the successful pass 1 and 62 after it; pass 2 remained at 62. Samples below are from the candidate visibility query and include the evidence kind used by the visibility gate.

- **ROCKFORT ENGINEERING LIMITED: 2 visible**
  - - Control and Software Engineer — structured_job_card (company_site)
  - - Vehicle Systems Design and Integration Engineer — structured_job_card (company_site)
- **Vertical Aerospace Group Ltd: 8 visible**
  - Senior Stress Engineer — known_ats_posting (company_site)
  - PA Team Coordinator — known_ats_posting (company_site)
  - Senior Category Manager — known_ats_posting (company_site)
- **59 Studio Ltd: 16 visible**
  - Unreal Artist — known_ats_posting (company_site)
  - Technical Writer - Freelance — known_ats_posting (company_site)
  - Technical Director — known_ats_posting (company_site)
- **Pliant Payments Limited: 36 visible**
  - Sales Development Representative - DACH (m/f/d) — known_ats_posting (company_site)
  - Senior Partnerships Acquisition Manager- UK  (m/f/d) — known_ats_posting (company_site)
  - Business Development Manager, DACH (m/f/d) — known_ats_posting (company_site)

Rockfort Engineering's two visible rows are pre-existing structured_job_card evidence. That employer had no approved direct source and was skipped; this phase did not insert or update those rows. The 60 direct-feed rows visible after the first successful pass have known_ats_posting evidence.

## Database and identity notes

- The exact-ID preflight reconciled all 29 cohort entries to development sponsor rows and found three verified mappings: Ashby (Vertical Aerospace and Pliant Payments) and Greenhouse (59 Studio).
- Vertical Aerospace has three sponsor rows with the same legal name. All three had the same website and verified Ashby mapping. Direct-only processing accepts duplicate-name rows only when the website and all careers-source fields match; other modes retain the stricter identity check.
- An earlier guard-check attempt completed 59 Studio and Pliant before reporting a duplicate-row identity conflict for Vertical Aerospace. It inserted 0, updated 52 existing postings, and skipped 26 no-source employers. The final runs shown above were run after the identity check was narrowed to identical-source duplicates.

## Output files

- Pass 1 JSON: direct-feed-pass-1/report.json
- Pass 2 JSON: direct-feed-pass-2/report.json
- Reviewed input: auto-approved.csv
