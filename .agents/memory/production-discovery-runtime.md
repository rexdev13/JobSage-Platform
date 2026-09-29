---
name: Production discovery runtime
description: Keep production read-only SQL access separate from workspace scripts that use the app database connection.
---

Replit's production `executeSql` interface queries a read-only replica; it does not provide a production database connection to a workspace TypeScript script. A local CLI's `--environment=production` label does not switch its `@workspace/db` connection.

**Why:** Running a production-labeled discovery CLI from the development workspace can read the wrong database and misreport which production employers were checked.

**How to apply:** Use bounded production `executeSql` reads for evidence only. Run outbound production discovery only in an explicitly provisioned, production-safe execution environment with verified source rows and a read-only database role, or use a sanitized snapshot.

The managed production SQL replica and a separately provisioned production-proof connection can expose different fingerprints and slightly different vacancy counts. The fingerprint includes endpoint identity, so a mismatch alone does not prove the target is wrong.

**Why:** A recent healthcare proof found matching sponsor, selector, and mapping counts but a small job-board vacancy delta between the two production read paths.

**How to apply:** Before outbound proof work, verify the proof connection is transaction-read-only, compare stable sponsor/selector/mapping counts with managed production, and pin the actual run to that connection's independently checked fingerprint. Use counts from the same proof target for the run report.

Read-only transaction settings do not mean the database role is least-privileged; a proof connection can still report DML, ownership, or administrative privileges.

**Why:** The production proof connection used for discovery had both read-only settings enabled while its role retained broad privileges.

**How to apply:** Keep proof runs on code paths that set the transaction read-only before querying and block every persistence path. Never reuse a proof credential in an importer or other write-enabled task; evaluate a separate approved credential and safeguards for authorized writes.