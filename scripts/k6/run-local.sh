#!/usr/bin/env bash
set -euo pipefail

PROFILE="${K6_PROFILE:-smoke}"
BASE_URL="${K6_BASE_URL:-http://127.0.0.1:8080/api}"
SUMMARY_PATH="${K6_SUMMARY_PATH:-artifacts/k6/${PROFILE}-summary.json}"

case "${BASE_URL}" in
  *jobsage.co.uk*|*replit.app*|*replit.dev*)
    echo "Refusing a production or hosted target. Use a local URL or an explicitly provisioned non-production staging URL." >&2
    exit 2
    ;;
esac

if [[ -n "${STAGING_BASE_URL:-}" ]]; then
  BASE_URL="${STAGING_BASE_URL%/}"
  case "${BASE_URL}" in
    *jobsage.co.uk*)
      echo "Refusing the JOBSAGE production custom domain as a staging target." >&2
      exit 2
      ;;
  esac
fi

if ! command -v k6 >/dev/null 2>&1; then
  echo "k6 is not installed. Install the system package, then rerun this script." >&2
  exit 127
fi

mkdir -p "$(dirname "${SUMMARY_PATH}")"
echo "Running k6 profile=${PROFILE} against ${BASE_URL}"
K6_BASE_URL="${BASE_URL}" \
  k6 run \
  --summary-export="${SUMMARY_PATH}" \
  scripts/k6/jobsage-smoke.js