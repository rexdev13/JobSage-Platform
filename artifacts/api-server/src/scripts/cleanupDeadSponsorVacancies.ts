import { runSponsorVacancyCleanup } from "../lib/sponsorVacancyCleanup";

const APPLY_CONFIRMATION = "--confirm-confirmed-dead-source-owned-only";
const applyRequested = process.argv.includes("--apply");

if (!applyRequested || !process.argv.includes(APPLY_CONFIRMATION)) {
  console.info(
    `[vacancy-cleanup] no changes made. To apply the 24h confirmed-dead, importer-owned cleanup, pass --apply ${APPLY_CONFIRMATION}.`,
  );
  process.exit(0);
}

runSponsorVacancyCleanup()
  .then((summary) => {
    console.log(JSON.stringify(summary, null, 2));
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });