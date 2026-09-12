---
name: Deployment pnpm CI mode
description: Replit publishing runs pnpm install without a TTY and needs project-level CI mode.
---

Publishing can fail before artifact builds when pnpm tries to remove node_modules without a TTY. Keep `ci=true` in the repository `.npmrc`; a CI setting only in the `.replit` post-build hook is too late because package installation happens first.

**Why:** The publisher's install phase runs before post-build environment variables are applied, so pnpm otherwise aborts with `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`.

**How to apply:** When a publish fails during `pnpm install` with a no-TTY removal error, verify `pnpm config get ci` returns `true`, then rerun the production builds and ask the user to publish again.