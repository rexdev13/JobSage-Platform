import { runSponsorVacancyCleanup } from "../lib/sponsorVacancyCleanup";

// The rollout sweep already confirmed the current dead backlog. Remove it
// immediately once; future scheduled runs use the protective 24h grace period.
runSponsorVacancyCleanup({ graceHours: 0 })
  .then((summary) => {
    console.log(JSON.stringify(summary, null, 2));
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });