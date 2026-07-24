---
name: drizzle-kit push interactive prompts
description: How to sync dev DB schema when drizzle-kit push blocks on interactive prompts
---

`pnpm --filter @workspace/db run push` (drizzle-kit push) blocks on raw-mode interactive prompts (e.g. "add unique constraint or truncate?") that cannot be answered by piping stdin.

**Why:** drizzle-kit uses a raw-TTY select prompt; non-interactive shells hang or exit at the prompt.

**How to apply:** When push stalls on a prompt, apply the equivalent DDL manually via executeSql (check for duplicates before unique constraints; use `USING` casts for type changes like text → text[]), then re-run push until it reports "Changes applied" as verification of zero drift. The api-server also runs a startup schema drift check (`schemaDriftCheck.ts`) that logs drifted tables loudly.
