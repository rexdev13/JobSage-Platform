---
name: Secret scope verification
description: Distinguish project editor secrets from published app production secrets.
---

A secret reported as present by environment queries does not by itself prove it was added to a published app's Production secrets. Replit separates project-level editor secrets from the secrets configured for a published app; confirm the destination rather than infer scope from a presence flag. Production environment-variable changes also do not affect the running published version until a new version is published.

**Why:** Replit documentation clarifies that published-app secrets are configured separately and production variable changes take effect only after republishing.

**How to apply:** Before using a credential in a development process, confirm from current Replit documentation which secret store the UI or secure form writes to. Never print the value or infer production exposure from a presence flag alone. After production environment changes, do not report them as active until the new app version is published.