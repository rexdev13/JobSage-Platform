/**
 * Usage: tsx src/tools/enrichNhsSponsorshipEvidence.ts [--limit=300] [--minutes=10]
 * See lib/nhsSponsorshipEvidence.
 */
import { pool } from "@workspace/db";
import { runNhsSponsorshipEvidenceBatch } from "../lib/nhsSponsorshipEvidence";

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
runNhsSponsorshipEvidenceBatch({
  limit: Number(arg("limit") ?? 300),
  deadlineMs: Date.now() + Number(arg("minutes") ?? 10) * 60_000,
})
  .then((summary) => console.log("[nhs-sponsorship]", JSON.stringify(summary)))
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => pool.end());
