import { db, sponsorLicenceVacanciesTable } from "@workspace/db";
import { eq, isNotNull } from "drizzle-orm";
import { verifyStoredLink } from "./linkVerification";
import { classifyVacancySource } from "./vacancySource";

export type BoardRepairSummary = {
  before: number;
  reclassified: number;
  swept: number;
  live: number;
  dead: number;
  inconclusive: number;
  after: number;
};

const RECLASSIFY_BOARD_NAMES = new Set(["NHS Jobs", "Trac", "HealthJobsUK", "Reed"]);

export async function repairStoredJobBoardVacancies(): Promise<BoardRepairSummary> {
  const rows = await db
    .select()
    .from(sponsorLicenceVacanciesTable)
    .where(isNotNull(sponsorLicenceVacanciesTable.url));
  const before = rows.filter((row) => row.sourceType === "job_board").length;
  let reclassified = 0;

  for (const row of rows) {
    const source = classifyVacancySource(row.url);
    if (
      source.sourceType !== "job_board" ||
      !source.boardName ||
      !RECLASSIFY_BOARD_NAMES.has(source.boardName)
    ) continue;
    if (
      row.sourceType === "job_board" &&
      row.boardName === source.boardName &&
      row.externalListingId === source.externalListingId
    ) continue;
    await db
      .update(sponsorLicenceVacanciesTable)
      .set({
        sourceType: "job_board",
        boardName: source.boardName,
        externalListingId: source.externalListingId,
      })
      .where(eq(sponsorLicenceVacanciesTable.id, row.id));
    row.sourceType = "job_board";
    row.boardName = source.boardName;
    row.externalListingId = source.externalListingId;
    reclassified += 1;
  }

  const boardRows = rows.filter((row) => row.sourceType === "job_board" && row.url);
  const outcomes = { live: 0, dead: 0, inconclusive: 0 };
  const concurrency = 8;
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, boardRows.length) }, async () => {
      while (cursor < boardRows.length) {
        const row = boardRows[cursor++]!;
        const outcome = await verifyStoredLink("sponsor_vacancy", row.id, row.url);
        if (outcome === "live") outcomes.live += 1;
        else if (outcome === "dead") outcomes.dead += 1;
        else outcomes.inconclusive += 1;
      }
    }),
  );

  const after = boardRows.length;
  return {
    before,
    reclassified,
    swept: boardRows.length,
    live: outcomes.live,
    dead: outcomes.dead,
    inconclusive: outcomes.inconclusive,
    after,
  };
}