---
name: OpenAPI generated-client drift
description: Checked-in generated api-client files can contain hand-added members missing from openapi.yaml; regen clobbers them.
---

The checked-in `lib/api-client-react/src/generated/*` files have historically contained hand-added members (fields, interfaces, enum values) that were never added to `lib/api-spec/openapi.yaml`. Running codegen removes them and breaks unrelated frontend pages.

**Why:** Discovered when a routine `pnpm run codegen` dropped several fields/interfaces the web app relied on, producing dozens of TS errors in pages untouched by the current task.

**How to apply:** After any codegen run, `git diff lib/api-client-react/src/generated/api.schemas.ts` and inspect removed lines. If members the app uses disappear, restore them by adding them to `openapi.yaml` (spec is the source of truth) and regenerate — never hand-edit generated files.
