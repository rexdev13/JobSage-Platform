# Onboarding vacancy coverage verification

## Production snapshot: 23 September 2026

This snapshot was generated with a read-only production query. “Visible” means
the stored vacancy is live, has a URL, was verified within 48 hours, is not
marked missing/closed/expired, and satisfies the company-site evidence rule.
The classification is the same category family used by the opportunity feed.

All 21 onboarding professions currently have at least one fresh,
candidate-visible vacancy. There are **no Red professions** in this snapshot.
Shared categories intentionally show the same count for each mapped
profession.

| Onboarding profession | Category | Visible | Board | Company site | Status |
|---|---:|---:|---:|---:|---|
| Accountant | ACCOUNTING | 28 | 18 | 10 | GREEN |
| Allied Health Professional | HCPC | 87 | 84 | 3 | GREEN |
| Architect | ARCHITECTURE | 14 | 1 | 13 | GREEN |
| Business Development Manager | BUSINESS_DEVELOPMENT | 21 | 0 | 21 | GREEN |
| Clinical Academic | GMC | 38 | 37 | 1 | GREEN |
| Dentist | DENTAL | 10 | 7 | 3 | GREEN |
| Doctor | GMC | 38 | 37 | 1 | GREEN |
| Engineer | ENGINEERING | 144 | 19 | 125 | GREEN |
| IT Professional | IT | 76 | 12 | 64 | GREEN |
| Lawyer / Solicitor | LEGAL | 19 | 19 | 0 | GREEN |
| Midwife | NMC | 301 | 286 | 15 | GREEN |
| Nurse | NMC | 301 | 286 | 15 | GREEN |
| Occupational Therapist | HCPC | 87 | 84 | 3 | GREEN |
| Optometrist | HCPC | 87 | 84 | 3 | GREEN |
| Paramedic | HCPC | 87 | 84 | 3 | GREEN |
| Pharmacist | PHARMACY | 74 | 67 | 7 | GREEN |
| Physiotherapist | HCPC | 87 | 84 | 3 | GREEN |
| Radiographer | HCPC | 87 | 84 | 3 | GREEN |
| Social Worker | SOCIAL_WORK | 20 | 17 | 3 | GREEN |
| Software Engineering | IT | 76 | 12 | 64 | GREEN |
| Teacher / Lecturer | EDUCATION | 26 | 23 | 3 | GREEN |

The Business Development Manager row is intentionally not forced into a
healthcare, legal, accounting, or IT category. It uses the new
`BUSINESS_DEVELOPMENT` category and currently has fresh company-site coverage;
the Reed and jobs.ac.uk paths are enabled for subsequent backfills.

## Re-run procedure

Run the read-only query below against the production replica after each
backfill cycle. Replace the `classified` CTE with the current shared
classifier output if the vacancy taxonomy changes. Do not use this report to
mutate production rows.

```sql
WITH onboarding(profession, category) AS (
  VALUES
    ('Doctor', 'GMC'), ('Nurse', 'NMC'), ('Midwife', 'NMC'),
    ('Allied Health Professional', 'HCPC'), ('Clinical Academic', 'GMC'),
    ('Dentist', 'DENTAL'), ('Pharmacist', 'PHARMACY'), ('Optometrist', 'HCPC'),
    ('Physiotherapist', 'HCPC'), ('Radiographer', 'HCPC'), ('Paramedic', 'HCPC'),
    ('Occupational Therapist', 'HCPC'), ('Social Worker', 'SOCIAL_WORK'),
    ('Teacher / Lecturer', 'EDUCATION'), ('Engineer', 'ENGINEERING'),
    ('Accountant', 'ACCOUNTING'), ('IT Professional', 'IT'),
    ('Lawyer / Solicitor', 'LEGAL'), ('Architect', 'ARCHITECTURE'),
    ('Software Engineering', 'IT'), ('Business Development Manager', 'BUSINESS_DEVELOPMENT')
),
classified AS (
  SELECT CASE
    WHEN (title || ' ' || coalesce(description, '')) ~* '\y(doctor|physician|clinical fellow|medical consultant)\y' THEN 'GMC'
    WHEN (title || ' ' || coalesce(description, '')) ~* '\y(nurse|nursing|midwife|midwifery)\y' THEN 'NMC'
    WHEN (title || ' ' || coalesce(description, '')) ~* '\y(dentist|dental)\y' THEN 'DENTAL'
    WHEN (title || ' ' || coalesce(description, '')) ~* '\y(pharmacist|pharmacy)\y' THEN 'PHARMACY'
    WHEN (title || ' ' || coalesce(description, '')) ~* '\y(physiotherapist|occupational therapist|radiographer|paramedic|optometrist)\y' THEN 'HCPC'
    WHEN (title || ' ' || coalesce(description, '')) ~* '\y(social worker|social care)\y' THEN 'SOCIAL_WORK'
    WHEN (title || ' ' || coalesce(description, '')) ~* '\y(teacher|lecturer|professor|education)\y' THEN 'EDUCATION'
    WHEN (title || ' ' || coalesce(description, '')) ~* 'business[ -]+development' THEN 'BUSINESS_DEVELOPMENT'
    WHEN (title || ' ' || coalesce(description, '')) ~* '\y(software|developer|programmer|information technology|IT)\y' THEN 'IT'
    WHEN (title || ' ' || coalesce(description, '')) ~* '\y(engineer|engineering)\y' THEN 'ENGINEERING'
    WHEN (title || ' ' || coalesce(description, '')) ~* '\y(accountant|accounting|finance manager)\y' THEN 'ACCOUNTING'
    WHEN (title || ' ' || coalesce(description, '')) ~* '\y(lawyer|solicitor|barrister|paralegal|legal counsel)\y' THEN 'LEGAL'
    WHEN (title || ' ' || coalesce(description, '')) ~* '\y(architect|architectural|architecture)\y' THEN 'ARCHITECTURE'
  END AS category,
  source_type, url, liveness, last_verified_at, source_missing_since,
  source_missing_observations, closes_at, expires_at, closed_reason,
  company_vacancy_evidence, company_evidence_legacy_until
  FROM sponsor_licence_vacancies
),
visible AS (
  SELECT category, source_type
  FROM classified
  WHERE category IS NOT NULL
    AND liveness = 'live'
    AND url IS NOT NULL AND btrim(url) <> ''
    AND last_verified_at >= now() - interval '48 hours'
    AND source_missing_since IS NULL
    AND coalesce(source_missing_observations, 0) = 0
    AND coalesce(closed_reason, '') !~* '(closed|filled|no longer accepting|closing date has passed)'
    AND (closes_at IS NULL OR closes_at > now())
    AND (expires_at IS NULL OR expires_at > now())
    AND (
      source_type <> 'company_site'
      OR company_vacancy_evidence IS NOT NULL
      OR (company_evidence_legacy_until IS NOT NULL AND company_evidence_legacy_until >= now())
    )
),
counts AS (
  SELECT category, count(*)::int AS visible_count,
    count(*) FILTER (WHERE source_type = 'job_board')::int AS board_visible_count,
    count(*) FILTER (WHERE source_type = 'company_site')::int AS company_visible_count
  FROM visible
  GROUP BY category
)
SELECT o.profession, o.category,
  coalesce(c.visible_count, 0)::int AS visible_count,
  coalesce(c.board_visible_count, 0)::int AS board_visible_count,
  coalesce(c.company_visible_count, 0)::int AS company_visible_count,
  CASE WHEN coalesce(c.visible_count, 0) > 0 THEN 'GREEN' ELSE 'RED' END AS status
FROM onboarding o
LEFT JOIN counts c ON c.category = o.category
ORDER BY o.profession;
```

## Backfill acceptance rules

- A profession is **Green** only when `visible_count > 0`; raw discoveries and
  unverified rows do not count.
- A successful query with zero classified sponsor rows is recorded with
  `emptySuccess: true` in the profession backfill metrics and must be
  investigated rather than reported as healthy coverage.
- A source failure is distinct from an empty success. Check `failed`, request
  status, and the stored `vacancy_sync_log.metrics` object.
- A new profession or category is incomplete until it is added to the
  onboarding list, the category map, title classifier, Reed target list,
  additional-board plan, and this verification query.