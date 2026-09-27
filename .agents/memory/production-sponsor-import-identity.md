---
name: Production sponsor import identity
description: Development sponsor IDs are not portable to the production sponsor dataset.
---

Do not apply development sponsor website CSVs to production by `sponsor_licences.id`. Production has a materially different sponsor dataset, and the existing website promotion/import scripts are development-only. Production SQL access is read-only.

**Why:** A development scan joined correctly against its source IDs, but a read-only production snapshot showed a substantially different sponsor set. Reusing those numeric IDs could attach websites to the wrong employers, and no supported bulk production import route was found.

**How to apply:** Before any production sponsor import, obtain a fresh production-side identity export or an explicitly reviewed ID mapping. Reconcile employer name, town, and industry, preserve conflicting existing websites, and use only an authorized production write path. Never bypass read-only access or assume development IDs are portable.