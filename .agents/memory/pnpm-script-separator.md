---
name: pnpm script argument separator
description: Why filtered pnpm package scripts should tolerate or omit a bare argument separator
---

Filtered `pnpm` script invocations of the form `pnpm --filter <package> <script> -- --flag` can pass the bare `--` through to the script's process. Do not assume it is always consumed by pnpm.

**Why:** A documented development-only batch command failed at argument parsing before its read-only dry run because its CLI rejected the forwarded separator.

**How to apply:** Test the exact documented command form for new package scripts with arguments. Either accept a standalone `--` in the parser or document an invocation without it.