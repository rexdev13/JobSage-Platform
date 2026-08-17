/**
 * One-off script: run a full liveness scan against all stored apply links.
 * Usage: npx tsx src/scripts/runLivenessScanOnce.ts
 *
 * This is equivalent to POST /admin/link-scan but runs directly in-process,
 * skipping the HTTP auth layer — safe to run from the shell in dev/staging.
 */
import { runFullLivenessScan } from "../lib/vacancyLivenessSweep";

console.log("[run-liveness-scan] Starting full liveness scan…");
const t0 = Date.now();

runFullLivenessScan()
  .then((counters) => {
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`[run-liveness-scan] Done in ${elapsed}s`);
    console.log(`  checked:      ${counters.checked}`);
    console.log(`  live:         ${counters.live}`);
    console.log(`  dead:         ${counters.dead}`);
    console.log(`  inconclusive: ${counters.inconclusive}`);
    process.exit(0);
  })
  .catch((err) => {
    console.error("[run-liveness-scan] Fatal error:", err);
    process.exit(1);
  });
