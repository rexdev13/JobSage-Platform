---
name: Secret scope verification
description: Distinguish project editor secrets from published app production secrets.
---

A secret reported as present by environment queries does not by itself prove it was added to a published app's Production secrets. Replit separates project-level editor secrets from the secrets configured for a published app; confirm the destination rather than infer scope from a presence flag.

**Why:** During a one-off production database proof, the secret presence check returned true for both environment views, while Replit documentation clarified that published-app secrets are configured separately.

**How to apply:** Before using a credential in a development process, confirm from current Replit documentation which secret store the UI or secure form writes to. Never print the value or infer production exposure from a presence flag alone.