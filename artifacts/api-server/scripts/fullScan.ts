import { runFullLivenessScan } from "../src/lib/vacancyLivenessSweep";
runFullLivenessScan()
  .then((t) => { console.log("FULL SCAN DONE", JSON.stringify(t)); process.exit(0); })
  .catch((e) => { console.error("FULL SCAN FAILED", e); process.exit(1); });
