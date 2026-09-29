---
name: Git authentication and merge-safe pushes
description: Diagnose GitHub push authentication and preserve intentional merge history during Git-pane sync.
---

Do not assume an Agent GitHub API connector can authenticate Git CLI pushes. Replit's Git pane may also run `git pull --rebase origin <branch>` before pushing; on an intentional merge commit this can replay source commits and create conflicts even though the committed merge remains intact.

**Why:** A clean large merge remained reachable from the branch, but the pane-driven rebase replayed source commits and created transient conflicts. Aborting that rebase restored the committed merge. Separately, Git CLI authentication remained unavailable despite an added GitHub connector.

**How to apply:** Check remote access separately with a bounded read-only `git ls-remote` and prompts disabled. On a Git-pane conflict, inspect branch refs, reflog, and the index before editing. If the intended merge is still reachable from the saved branch, abort only the failed rebase and use an authenticated push path that preserves merge history. Never print credentials, flatten the intentional merge, or assume cached remote-tracking refs reflect live GitHub state.