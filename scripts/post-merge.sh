#!/bin/bash
set -e
pnpm install --frozen-lockfile

# Safety pre-flight: capture what drizzle-kit push WOULD run before applying it.
# --strict --verbose prints planned SQL, then blocks on a confirmation prompt.
# timeout(124) kills the blocking prompt after the SQL has already been printed.
# Any other non-zero exit from drizzle-kit is treated as an unknown failure and
# the script aborts (fail-closed) rather than proceeding with --force blindly.
echo "[post-merge] Pre-flight: scanning for destructive schema operations..."
PROBE_TMP=$(mktemp)
set +e
timeout 30 pnpm --filter db push --strict --verbose > "$PROBE_TMP" 2>&1
PROBE_EXIT=$?
set -e

PROBE_CLEAN=$(sed 's/\x1b\[[0-9;]*[mGKHF]//g' "$PROBE_TMP")
rm -f "$PROBE_TMP"

if [ "$PROBE_EXIT" -eq 0 ]; then
  # drizzle-kit exited cleanly — no pending changes, or changes already applied.
  echo "[post-merge] Preflight: no pending schema changes."
elif [ "$PROBE_EXIT" -eq 124 ]; then
  # timeout killed the confirmation prompt — expected when schema drift exists.
  # The planned SQL was printed before the prompt; check for destructive ops.
  if echo "$PROBE_CLEAN" | grep -qiE "TRUNCATE|DROP TABLE"; then
    echo "[post-merge] BLOCKED: drizzle-kit push would run destructive operations."
    echo "[post-merge] Resolve the schema drift manually before re-running post-merge."
    echo "--- Detected ---"
    echo "$PROBE_CLEAN" | grep -iE "TRUNCATE|DROP TABLE"
    exit 1
  fi
  echo "[post-merge] Preflight: pending ALTER TABLE changes detected (no TRUNCATE/DROP TABLE)."
else
  # Unexpected drizzle-kit failure — fail closed rather than guessing it is safe.
  echo "[post-merge] BLOCKED: drizzle-kit preflight probe failed (exit $PROBE_EXIT)."
  echo "[post-merge] Manual review required before applying schema changes."
  echo "--- Probe output ---"
  echo "$PROBE_CLEAN"
  exit 1
fi

echo "[post-merge] Applying schema changes."
# drizzle-kit may ask "truncate table?" for unique constraint additions —
# that prompt defaults to "No, add without truncating", so piping a newline
# selects the safe default. --force bypasses the top-level "are you sure?" gate.
echo "" | pnpm --filter db push --force
