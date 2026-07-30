#!/bin/bash
# Fails when the compiled jobsage-web bundle (dist/public) is older than any
# frontend source input, so merged frontend fixes cannot silently stay
# unpublished behind a stale bundle.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB="$ROOT/artifacts/jobsage-web"
MARKER="$WEB/dist/public/index.html"

if [ ! -f "$MARKER" ]; then
  echo "[web-bundle-freshness] FAIL: no built bundle at $MARKER."
  echo "Run: PORT=3000 BASE_PATH=/ pnpm --filter @workspace/jobsage-web run build"
  exit 1
fi

# Source inputs that shape the compiled bundle.
STALE=$(find \
  "$WEB/src" "$WEB/index.html" "$WEB/public" "$WEB/vite.config.ts" \
  "$ROOT/lib/api-client-react/src" \
  "$ROOT/lib/auth-web/src" \
  -type f -newer "$MARKER" 2>/dev/null | head -20 || true)

if [ -n "$STALE" ]; then
  echo "[web-bundle-freshness] FAIL: dist/public is older than these source files:"
  echo "$STALE"
  echo "Rebuild with: PORT=3000 BASE_PATH=/ pnpm --filter @workspace/jobsage-web run build"
  exit 1
fi

echo "[web-bundle-freshness] OK: web bundle is up to date with source."
