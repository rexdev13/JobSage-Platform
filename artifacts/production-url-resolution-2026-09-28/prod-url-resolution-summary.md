# Production URL resolver dry-run

Generated: 2026-09-28T09:18:17.545Z

## Scope and safety

- The resolver only reads captured production snapshots and writes local reports; it does not write production, deploy, or call a vacancy worker. Already-running services may continue their own schedules independently.
- Production apply audit: 2026-09-27T18:52:04.939521+00:00; plan hash: `plan:f2484e940b2029c32f2aed5443e8c3a991f668c09832e463a83eca1044bdbffd`.
- Audit row count: 6,007; reconciliation rows: 6,007.
- Current snapshots: 5,774 production sponsor targets and 8,810 production careers-site rows.
- Safe rows in this resolver: 26 rows across 26 distinct blank production targets. They are prepared only, not applied.
- Already-present or duplicate no-ops: 2,620.

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
| safe_auto_resolve | 26 |
| safe_noop_already_done | 2,620 |
| needs_manual_identity_resolution | 1,581 |
| needs_manual_url_conflict_review | 251 |
| needs_manual_low_confidence_review | 1,437 |
| unresolved_due_to_missing_data | 92 |

Rows by field: careers: 362, website: 5645.

Safe auto-resolved rows by field: careers: 26.

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

Production mapping rows in the supplied snapshot:

| Reason | Rows |
|---|---:|
| exact_unique | 4,086 |

Manual-review mappings found: 0. The apply audit records 4,086 stored mappings, but the live mapping lookup showed the methods listed above.

## Row-level audit limitation

The production audit stores the plan hash and aggregate reason counts, but no `source_ref`-level outcomes. It is therefore not possible to truthfully attach an original production-audit reason to each candidate row. The row-level files below classify candidates from the reconciliation input against current production sponsor and careers-site values. Original aggregate counts above remain exact; the older preflight disposition is preserved in each row but is not treated as the applied status.

## Prepared apply path (not executed)

Use the production super-admin page **Sponsor website and careers import** and upload `safe-auto-resolved.csv`. Run the read-only preview first. Apply only if the page reports the production environment and its safe-write count equals the 26 prepared rows, with no row relying on an undisclosed identity resolution and no existing-value overwrites. The existing apply endpoint is transaction- and plan-hash-guarded and updates only blank production fields; it records an audit event.

The `safe-auto-resolved.csv` is intentionally not applied from a local CLI. This environment has read-only production SQL access and no production admin session. Manual identity and URL-conflict rows remain held until a reviewer supplies evidence. If any safe row uses `unique_ltd_limited_name_identity`, the current local matcher change must be deployed before the production preview can recognize it; do not bypass the preview.

Resolver rerun command (read-only; uses the captured snapshots):

```sh
pnpm --filter @workspace/scripts run sponsor-url-resolution -- \
  --audit artifacts/production-url-resolution-2026-09-28/production-apply-audit.json \
  --reconciliation artifacts/production-sponsor-website-careers-reconciliation-dry-run.csv \
  --production-sponsors artifacts/production-url-resolution-2026-09-28/production-sponsor-targets.csv \
  --production-careers artifacts/production-url-resolution-2026-09-28/production-careers-site-checks.csv \
  --production-mappings artifacts/production-url-resolution-2026-09-28/production-crosswalk-counts.csv \
  --out-dir artifacts/production-url-resolution-2026-09-28
```

Refresh the production snapshots and audit first if production changes before review. This script has no `--apply` option.

## Next phase

The bounded production vacancy plan is saved separately in `next-phase-vacancy-command-plan.md`. It was not executed. Production has no direct-feeds-only command; its authenticated `company_site` HTTP job uses verified direct ATS feeds where available and otherwise follows the normal company-site discovery path. Check already-running service schedules before using the plan.

## Samples by resolver classification

### safe_auto_resolve

| Source ref | Field | Organisation | URL | Target | Reason |
|---|---|---|---|---:|---|
| batch1.csv:73:careers_url | careers | Acorn House Veterinary Hospital | https://www.acornhousevets.co.uk/contact-us/practice-vacancies/ | 146764 | The blank careers field has a first-party URL on the current production sponsor website, an explicit careers-path signal, and matching reviewed development evidence. |
| batch1.csv:121:careers_url | careers | Ala-Ud-Din Mohammad Rajput ta KINGFISHER DENTAL SURGEY | https://www.kingfisherdental.co.uk/careers | 149444 | The blank careers field has a first-party URL on the current production sponsor website, an explicit careers-path signal, and matching reviewed development evidence. |
| batch1.csv:318:careers_url | careers | Avant Healthcare Services Ltd | https://avanthomecare.co.uk/work-for-us/ | 12651 | The blank careers field has a first-party URL on the current production sponsor website, an explicit careers-path signal, and matching reviewed development evidence. |

### safe_noop_already_done

| Source ref | Field | Organisation | URL | Target | Reason |
|---|---|---|---|---:|---|
| non-healthcare-company-websites-all-sectors.csv:4:website | website | BIZ CLEANERS LIMITED | https://bizcleaners.co.uk/ | 17475 | The candidate URL already matches the current production field. |
| non-healthcare-company-websites-all-sectors.csv:9:website | website | BKW Instruments Ltd | https://www.bkwinstruments.co.uk/ | 17543 | The candidate URL already matches the current production field. |
| non-healthcare-company-websites-all-sectors.csv:11:website | website | BLACK BOX MEDIA MARKETING LTD | https://blackboxmediamarketing.co.uk/ | 17574 | The candidate URL already matches the current production field. |

### needs_manual_identity_resolution

| Source ref | Field | Organisation | URL | Target | Reason |
|---|---|---|---|---:|---|
| non-healthcare-company-websites-all-sectors.csv:15:website | website | BLACKBOARD (UK) LIMITED | https://www.blackboard.com/ | — | 2 current production sponsor rows match all supplied identity fields; no single row has unique ownership evidence. |
| non-healthcare-company-websites-all-sectors.csv:16:website | website | BLACKBOARD (UK) LIMITED | https://www.blackboard.com/ | — | 2 current production sponsor rows match all supplied identity fields; no single row has unique ownership evidence. |
| non-healthcare-company-websites-all-sectors.csv:22:website | website | BLANCO UK Limited | https://www.blanco.co.uk/ | — | 2 current production sponsor rows match all supplied identity fields; no single row has unique ownership evidence. |

### needs_manual_url_conflict_review

| Source ref | Field | Organisation | URL | Target | Reason |
|---|---|---|---|---:|---|
| non-healthcare-company-websites-all-sectors.csv:3023:website | website | A Kola Construction Ltd | https://www.kolaconstruction.co.uk/ | 144835 | A different production URL is present. Existing production values are never overwritten automatically. |
| non-healthcare-company-websites-all-sectors.csv:3031:website | website | A2Z diy hardware plumbing and heating merchant ltd | https://www.a2zdiyltd.co.uk/ | 145318 | A different production URL is present. Existing production values are never overwritten automatically. |
| non-healthcare-company-websites-all-sectors.csv:3033:website | website | AA Plus Plumbing Ltd | https://aaplusplumbing.com/ | 145421 | A different production URL is present. Existing production values are never overwritten automatically. |

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
| non-healthcare-company-websites-all-sectors.csv:7404:website | website | AZEEM'S RESTAURANT LIMITED | https://www.azeems.co.uk/ | 13311 | The candidate does not match a valid reviewed development value. |
