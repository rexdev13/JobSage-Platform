/**
 * Usage: tsx src/tools/enrichNhsSponsorshipEvidence.ts [--limit=300] [--minutes=10]
 *        tsx src/tools/enrichNhsSponsorshipEvidence.ts --reclassify
 * See lib/nhsSponsorshipEvidence.
 */
import { pool } from "@workspace/db";
import {
  reclassifyStoredSponsorshipEvidence,
  runNhsSponsorshipEvidenceBatch,
} from "../lib/nhsSponsorshipEvidence";

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const run = process.argv.includes("--reclassify")
  ? reclassifyStoredSponsorshipEvidence()
  : runNhsSponsorshipEvidenceBatch({
      limit: Number(arg("limit") ?? 300),
      deadlineMs: Date.now() + Number(arg("minutes") ?? 10) * 60_000,
    });

run
  .then((summary) => console.log("[nhs-sponsorship]", JSON.stringify(summary)))
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => pool.end());
