---
name: Git authentication versus Agent connectors
description: Diagnose GitHub push authentication independently of the Agent GitHub connector.
---

Do not assume connecting the Agent GitHub API connector repairs Git CLI authentication. Check Git's actual remote access separately; repeated connector attachment attempts can fail without changing Git credentials.

**Why:** Disconnect/reconnect cycles did not repair pushes. GitHub itself was reachable, but disabling the interactive askpass prompt exposed missing Git HTTPS authentication immediately instead of a timeout.

**How to apply:** Confirm the current branch and remote, test network reachability, then use a bounded read-only `git ls-remote` with `GIT_TERMINAL_PROMPT=0` and `GIT_ASKPASS=/bin/false`. Consult current Replit Git-pane documentation for authentication. Never print credential values or assume cached remote-tracking refs reflect live GitHub state.