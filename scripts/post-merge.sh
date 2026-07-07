#!/bin/bash
set -e
pnpm install --frozen-lockfile

# Safety pre-flight: capture the SQL drizzle-kit would run without applying it.
# --strict --verbose prints planned statements before the confirmation prompt.
# timeout kills the hanging prompt; the SQL output is already captured by then.
# Strip ANSI escape codes so the grep is reliable.
echo "[post-merge] Pre-flight: scanning for destructive schema operations..."
PLANNED=$(timeout 30 pnpm --filter db push --strict --verbose 2>&1 || true)
PLANNED_CLEAN=$(echo "$PLANNED" | sed 's/\x1b\[[0-9;]*[mGKHF]//g')

if echo "$PLANNED_CLEAN" | grep -qi "TRUNCATE"; then
  echo "[post-merge] BLOCKED: drizzle-kit push would run a TRUNCATE statement."
  echo "[post-merge] This indicates schema drift that requires table recreation."
  echo "[post-merge] Resolve the drift manually before re-running post-merge."
  echo "--- Planned SQL containing TRUNCATE ---"
  echo "$PLANNED_CLEAN" | grep -i "TRUNCATE"
  exit 1
fi

echo "[post-merge] No destructive table operations detected — applying schema."
pnpm --filter db push --force
