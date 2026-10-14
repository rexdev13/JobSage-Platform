---
name: drizzle-kit push prompts and partial application
description: How to handle interactive prompts and mid-run collisions without assuming a schema push rolled back
---

`pnpm --filter @workspace/db run push` (drizzle-kit push) blocks on raw-mode interactive prompts (e.g. "add unique constraint or truncate?") that cannot be answered by piping stdin.

**Why:** drizzle-kit uses a raw-TTY select prompt; non-interactive shells hang or exit at the prompt.

Schema pushes are not atomic: a later collision can fail the command after earlier tables or indexes have already been created. Treat the target schema as partially changed, not rolled back.

**Why:** a development push hit an existing index name after creating additive notification tables; retrying the broad push would have operated on a changed schema.

**How to apply:** After any mid-run collision, inspect the target schema and compare it with the intended definitions before retrying. Do not force or blindly rerun the broad push. For interactive prompts, apply equivalent DDL manually only after checking for duplicates (and use `USING` casts for type changes like text → text[]), then confirm the development schema drift check is clean. The api-server also runs a startup schema drift check (`schemaDriftCheck.ts`) that logs drifted tables loudly.

**Type changes:** push also hard-fails (no prompt) on column type changes needing a cast (e.g. text -> text[]): apply manually with `ALTER TABLE ... ALTER COLUMN ... TYPE text[] USING CASE WHEN col IS NULL OR col='' THEN NULL ELSE ARRAY[col] END`.
**Constraint naming:** drizzle matches unique constraints by name (`<table>_<col>_unique`); legacy Postgres-default `_key` constraints read as missing — RENAME them to the drizzle name instead of adding duplicates.
**Computing full drift:** no tsx at repo root; run drift scripts with `artifacts/api-server/node_modules/.bin/tsx`, comparing getTableConfig columns vs information_schema.
