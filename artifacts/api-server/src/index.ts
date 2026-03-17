import app from "./app";
import { seedRulesets } from "./lib/seedRulesets";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
  seedRulesets().catch((err) => {
    console.error("[seed] Failed to seed rulesets:", err);
  });
});
