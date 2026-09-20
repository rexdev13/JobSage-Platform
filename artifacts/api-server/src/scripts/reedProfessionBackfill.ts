import { runReedProfessionBackfill } from "../lib/reedProfessionBackfill";

if (process.env.NODE_ENV !== "development") {
  throw new Error(
    "The Reed profession backfill is development-only. Run it with NODE_ENV=development.",
  );
}

const result = await runReedProfessionBackfill();
console.log(JSON.stringify(result, null, 2));
if (result.failed) process.exitCode = 1;