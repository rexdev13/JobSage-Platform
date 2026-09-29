# 9fin direct Ashby feed — current development recheck

Captured 2026-09-24 16:52:34 UTC from the public Ashby posting API through the current direct-board connector. No database writes were made in this recheck.

## Source result
- Employer: 9fin Limited; official careers page: https://9fin.com/careers.
- Mapping: Ashby board `9fin`; saved official evidence URL: https://jobs.ashbyhq.com/9fin/form/talent-community.
- Feed: https://api.ashbyhq.com/posting-api/job-board/9fin; complete response, 1 page, 33 adverts returned.
- The current development database already contains 33 unique platform IDs. All 33 source listing URLs match a stored row.
- Feed location labels: London 24, Belfast 1, New York 8. Using those exact city labels, 25 are UK, 8 non-UK, 0 unknown.
- Stored verification: 6 live, 27 unverified, 0 dead, 0 inconclusive.

## Candidate-visible subset
- Queried the 13 profession category feeds with `sourceType=company_site`, `onlyVerifiedLive=true`, and `requireSpecificVacancyUrl=true`.
- No location preference or personal candidate profile was used. Six unique live roles were visible under both Engineering and IT (6 per category, not 12 distinct jobs); all six are in London.
- See `9fin-direct-feed-current-roles-2026-09-24.csv` for each source job, exact URL, current development verification state, and category visibility.

## Scope and caveats
- This is a fresh read-only reconstruction, not the original historical 9fin per-employer export; no original 9fin CSV/report was present in the current workspace. An earlier audit snapshot said the feed returned 33 jobs while none were stored; the current development state now contains all 33, so do not conflate the two snapshots.
- Request elapsed time was not captured. No import/upsert was run for this export; persistence changes for this recheck are not applicable.
- The current region helper returns `Yorkshire and the Humber` for the exact source string `New York`. Do not use that helper result as proof that New York vacancies are UK-based; the CSV uses exact source city labels for the location buckets.
- This snapshot is separate from the broader company-site pilot cohort, which reported one newly candidate-visible BMC role. Do not add the counts without aligning cohort dates and filters.
