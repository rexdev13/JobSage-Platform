---
name: Serialize codegen and UI agents
description: Prevent older subagent workspace snapshots from replacing changes made by concurrent implementation agents.
---

Run code-generation or backend implementation agents to completion before starting a UI implementation agent. Do not run them concurrently, even when their requested source files appear disjoint.

**Why:** In this workspace, a backend agent that regenerated shared API artifacts repeatedly restored older copies of frontend files, replacing completed UI work without reporting a conflict.

**How to apply:** Finish shared-schema, OpenAPI, and generated-client work first. Then start or resume the frontend agent, verify its saved markers in the real workspace, and avoid further codegen afterward.