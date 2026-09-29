---
name: Production sponsor import identity
description: Development sponsor IDs are not portable to the production sponsor dataset.
---

Do not apply development sponsor website CSVs to production by `sponsor_licences.id`. Production has a materially different sponsor dataset. Production SQL access is read-only, but the supported super-admin website/careers importer is a guarded production write path: it previews a plan and only fills blank values.

**Why:** Development and production sponsor IDs are not portable, but treating all production writes as unavailable obscures the supported import route. Reusing development IDs could attach URLs to the wrong employers; bypassing the production preview or updating existing values could overwrite valid data.

**How to apply:** Obtain a fresh production-side identity export and reviewed mapping. Reconcile employer name and supplied location/detail fields, then use the super-admin importer’s read-only preview and guarded apply only when its plan matches the reviewed rows. Preserve conflicts and never write through production SQL or assume development IDs are portable.