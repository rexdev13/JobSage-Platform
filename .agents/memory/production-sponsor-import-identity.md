---
name: Production sponsor import identity
description: Development sponsor IDs are not portable to the production sponsor dataset.
---

Do not apply development sponsor website or vacancy CSVs to production by `sponsor_licences.id`, `sponsor_ids`, or `database_match_ids`. Production has a materially different sponsor dataset. Production SQL access is read-only, but the supported super-admin website/careers importer is a guarded production write path: it previews a plan and only fills blank values. Reviewed vacancy imports must resolve employer names against the active target database and use the shared vacancy writer's exact-match locks with skip-existing behavior.

**Why:** Development and production sponsor IDs and vacancy match IDs are not portable. Reusing them can associate a vacancy with the wrong employer or treat a target-environment match incorrectly; updating an existing vacancy can overwrite current data.

**How to apply:** For website/careers mappings, obtain a fresh target-side identity export and reviewed mapping, then use the guarded blank-only importer. For reviewed vacancy CSVs, ignore source sponsor/database IDs, resolve only employer names in the target database, preview against that database, and apply through the shared locked writer with skip-existing and contact enrichment disabled. Never write through production SQL or assume development IDs are portable.