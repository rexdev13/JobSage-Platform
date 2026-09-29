# Production URL resolver dry-run

Generated: 2026-09-28T12:32:00.980Z

## Scope and safety

- The resolver only reads captured production snapshots and writes local reports; it does not write production, deploy, or call a vacancy worker. Already-running services may continue their own schedules independently.
- Production apply audit: 2026-09-27T18:52:04.939521+00:00; plan hash: `plan:f2484e940b2029c32f2aed5443e8c3a991f668c09832e463a83eca1044bdbffd`.
- Audit row count: 6,007; reconciliation rows: 6,007.
- Current snapshots: 5,774 production sponsor targets and 8,810 production careers-site rows.
- Safe rows in this resolver: 224 rows across 459 distinct blank production targets. They are prepared only, not applied.
- Already-present or duplicate no-ops: 2,923.

## Original production apply reasons

These are the exact aggregate counts stored in the production audit event.

| Reason | Rows |
|---|---:|
| already_matches_production_noop | 540 |
| duplicate_candidate_same_target_noop | 10 |
| manual_review_ambiguous_identity | 1,025 |
| manual_review_careers_target | 299 |
| manual_review_development_value_conflict | 7 |
| manual_review_existing_production_value | 224 |
| manual_review_identity_conflict | 553 |
| manual_review_pilot_not_in_development | 4 |
| rejected_confidence | 1,388 |
| safe_to_import | 1,957 |

## New resolver classifications

| Reason | Rows |
|---|---:|
| safe_auto_resolve | 224 |
| safe_noop_already_done | 2,923 |
| needs_manual_identity_resolution | 596 |
| needs_manual_url_conflict_review | 312 |
| needs_manual_low_confidence_review | 1,826 |
| unresolved_due_to_missing_data | 126 |

Rows by field: careers: 362, website: 5645.

Safe auto-resolved rows by field: careers: 26, website: 198.

## Preflight context (not the production audit)

The reconciliation CSV was created before the production apply. Its disposition counts differ from the later production audit and are included only as context; they were not substituted for the audited counts.

| Reason | Rows |
|---|---:|
| already_matches_production_noop | 344 |
| conflict_existing_production_value | 196 |
| duplicate_candidate_same_target_noop | 13 |
| manual_review_ambiguous_production_match | 912 |
| manual_review_development_value_conflict | 20 |
| manual_review_identity_conflict | 352 |
| manual_review_incomplete_production_identity | 2 |
| manual_review_medium_confidence | 827 |
| manual_review_pilot_upgrade_not_imported_to_development | 4 |
| rejected_low_confidence | 1,162 |
| safe_to_import | 2,175 |

## Identity mapping lookup

Validated row-level production crosswalk snapshots supplied to the resolver:

| Reason | Rows |
|---|---:|
| exact_unique | 4,086 |

The aggregate export reports:

| Reason | Rows |
|---|---:|
| exact_unique | 4,086 |

Manual-review mappings found in the row-level snapshot: 0; rows with malformed snapshot fields were ignored: 0. A manual mapping selects one target only when its normalized snapshot hash and current production target identity both agree with the candidate.

## Row-level audit limitation

The production audit stores the plan hash and aggregate reason counts, but no `source_ref`-level outcomes. It is therefore not possible to truthfully attach an original production-audit reason to each candidate row. The row-level files below classify candidates from the reconciliation input against current production sponsor and careers-site values. Original aggregate counts above remain exact; the older preflight disposition is preserved in each row but is not treated as the applied status.

## Prepared apply path (not executed)

Use the production super-admin page **Sponsor website and careers import** and upload `safe-auto-resolved.csv`. Run the read-only preview first. Apply only if the page reports the production environment and its safe-write count equals the 459 prepared blank target writes; do not compare that figure to the safe candidate-row count when one candidate fans out to identical duplicate rows. Confirm there are no target URL collisions or existing-value overwrites. The apply endpoint is transaction- and plan-hash-guarded, locks and rechecks each production target, updates blank fields only, and records an audit event.

The `safe-auto-resolved.csv` is intentionally not applied from a local CLI. This environment has read-only production SQL access and no production admin session. Stage held rows only through the published production page after the staging schema has been published; the separate staging table is not a vacancy-discovery source. Manual identity and URL-conflict rows remain held until a reviewer supplies evidence. Never bypass the preview.

The generated `guarded-production-apply-runbook.md` records the exact checks, and `production-url-read-only-verification.sql` contains only SELECT statements in a read-only transaction for every prepared target. Run the verification only after a successful guarded apply; every returned row must report `MATCH`.

Resolver rerun command (read-only; uses the captured snapshots):

```sh
pnpm --filter @workspace/scripts run sponsor-url-resolution -- \
  --audit artifacts/production-url-resolution-2026-09-28/production-apply-audit.json \
  --reconciliation artifacts/production-sponsor-website-careers-reconciliation-dry-run.csv \
  --production-sponsors artifacts/production-url-resolution-2026-09-28/production-sponsor-targets.csv \
  --production-careers artifacts/production-url-resolution-2026-09-28/production-careers-site-checks.csv \
  --production-mappings artifacts/production-url-resolution-2026-09-28/production-crosswalk-counts.csv \
  --production-crosswalk-dir artifacts/production-url-resolution-2026-09-28/crosswalk-pages \
  --out-dir artifacts/production-url-resolution-2026-09-28
```

Refresh the production snapshots and audit first if production changes before review. This script has no `--apply` option.

## Next phase

The bounded production vacancy plan is saved separately in `next-phase-vacancy-command-plan.md`. It was not executed. Production has no direct-feeds-only command; its authenticated `company_site` HTTP job uses verified direct ATS feeds where available and otherwise follows the normal company-site discovery path. Check already-running service schedules before using the plan.

## Samples by resolver classification

### safe_auto_resolve

| Source ref | Field | Organisation | URL | Target | Reason |
|---|---|---|---|---:|---|
| non-healthcare-company-websites-all-sectors.csv:61:website | website | Leeds Buddhist Vihara Trust | https://www.leedsbuddhistvihara.org/ | 71383 | Unique production identity, blank target, high confidence in both environments, matching reviewed development value, and first-party or explicitly verified ATS evidence. |
| non-healthcare-company-websites-all-sectors.csv:95:website | website | LESSEL LIMITED | https://www.lessel.co.uk/ | 71763 | Unique production identity, blank target, high confidence in both environments, matching reviewed development value, and first-party or explicitly verified ATS evidence. |
| non-healthcare-company-websites-all-sectors.csv:209:website | website | LogicMonitor UK Limited | https://www.logicmonitor.com/ | 73432 | Unique production identity, blank target, high confidence in both environments, matching reviewed development value, and first-party or explicitly verified ATS evidence. |

### safe_noop_already_done

| Source ref | Field | Organisation | URL | Target | Reason |
|---|---|---|---|---:|---|
| non-healthcare-company-websites-all-sectors.csv:4:website | website | BIZ CLEANERS LIMITED | https://bizcleaners.co.uk/ | 17475 | The candidate URL already matches the current production field. |
| non-healthcare-company-websites-all-sectors.csv:9:website | website | BKW Instruments Ltd | https://www.bkwinstruments.co.uk/ | 17543 | The candidate URL already matches the current production field. |
| non-healthcare-company-websites-all-sectors.csv:11:website | website | BLACK BOX MEDIA MARKETING LTD | https://blackboxmediamarketing.co.uk/ | 17574 | The candidate URL already matches the current production field. |

### needs_manual_identity_resolution

| Source ref | Field | Organisation | URL | Target | Reason |
|---|---|---|---|---:|---|
| non-healthcare-company-websites-all-sectors.csv:22:website | website | BLANCO UK Limited | https://www.blanco.co.uk/ | — | 2 current production sponsor rows match all supplied identity fields; no single row has unique ownership evidence. |
| non-healthcare-company-websites-all-sectors.csv:23:website | website | BLANCO UK Limited | https://www.blanco.co.uk/ | — | 2 current production sponsor rows match all supplied identity fields; no single row has unique ownership evidence. |
| non-healthcare-company-websites-all-sectors.csv:67:website | website | Leeds Theatre Trust Limited | https://www.leedsplayhouse.org.uk/ | — | 2 current production sponsor rows match all supplied identity fields; no single row has unique ownership evidence. |

### needs_manual_url_conflict_review

| Source ref | Field | Organisation | URL | Target | Reason |
|---|---|---|---|---:|---|
| non-healthcare-company-websites-all-sectors.csv:1819:website | website | Arkema UK Ltd | https://www.arkema.com/ | 10164 | At least one exact matching production target already has a different URL. Existing production values are never overwritten automatically. |
| non-healthcare-company-websites-all-sectors.csv:3023:website | website | A Kola Construction Ltd | https://www.kolaconstruction.co.uk/ | 144835 | At least one exact matching production target already has a different URL. Existing production values are never overwritten automatically. |
| non-healthcare-company-websites-all-sectors.csv:3031:website | website | A2Z diy hardware plumbing and heating merchant ltd | https://www.a2zdiyltd.co.uk/ | 145318 | At least one exact matching production target already has a different URL. Existing production values are never overwritten automatically. |

### needs_manual_low_confidence_review

| Source ref | Field | Organisation | URL | Target | Reason |
|---|---|---|---|---:|---|
| non-healthcare-company-websites-all-sectors.csv:2:website | website | BITESIZE CONSULTING (CG) LTD | https://www.bitesizeconsulting.com/ | 17450 | The candidate is not high confidence and has no independent first-party ownership evidence sufficient to upgrade it. |
| non-healthcare-company-websites-all-sectors.csv:5:website | website | BIZDGE LIMITED | https://bizdge.com/ | 17485 | The candidate is not high confidence and has no independent first-party ownership evidence sufficient to upgrade it. |
| non-healthcare-company-websites-all-sectors.csv:7:website | website | BK.LEATHER LIMITED | https://bkleather.uk/ | 17528 | The candidate is not high confidence and has no independent first-party ownership evidence sufficient to upgrade it. |

### unresolved_due_to_missing_data

| Source ref | Field | Organisation | URL | Target | Reason |
|---|---|---|---|---:|---|
| non-healthcare-company-websites-all-sectors.csv:38:website | website | BLUE ORCHID ASPLEY GUISE LTD T/A BLUE ORCHID | https://blueorchidrestaurant.co.uk/ | 18137 | The candidate does not match a valid reviewed development value. |
| non-healthcare-company-websites-all-sectors.csv:42:website | website | BLUEBIRD CARE STEVENAGE & NORTH HERTS | https://www.bluebirdcare.co.uk/ | 18243 | The verification pilot upgrade is not recorded in the development source data. |
| non-healthcare-company-websites-all-sectors.csv:6396:website | website | BLACKROCK INVESTMENT MANAGEMENT (UK) LIMITED | https://www.blackrock.com/ | 17711 | The candidate does not match a valid reviewed development value. |
