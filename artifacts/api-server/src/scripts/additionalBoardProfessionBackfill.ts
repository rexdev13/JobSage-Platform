import { runAdditionalBoardProfessionBackfill } from "../lib/additionalBoardProfessionBackfill";

if (process.env.NODE_ENV !== "development") {
  throw new Error(
    "The additional-board profession backfill is development-only. Run it with NODE_ENV=development.",
  );
}

const result = await runAdditionalBoardProfessionBackfill();
console.log(JSON.stringify(result, null, 2));
if (result.failed) process.exitCode = 1;