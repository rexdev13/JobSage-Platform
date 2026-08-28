import { repairStoredJobBoardVacancies } from "../lib/boardVacancyMaintenance";

repairStoredJobBoardVacancies()
  .then((summary) => {
    console.log(JSON.stringify(summary, null, 2));
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });