---
name: Production discovery runtime
description: Keep production read-only SQL access separate from workspace scripts that use the app database connection.
---

Replit's production `executeSql` interface queries a read-only replica; it does not provide a production database connection to a workspace TypeScript script. A local CLI's `--environment=production` label does not switch its `@workspace/db` connection.

**Why:** Running a production-labeled discovery CLI from the development workspace can read the wrong database and misreport which production employers were checked.

**How to apply:** Use bounded production `executeSql` reads for evidence only. Run outbound production discovery only in an explicitly provisioned, production-safe execution environment with verified source rows and a read-only database role, or use a sanitized snapshot.