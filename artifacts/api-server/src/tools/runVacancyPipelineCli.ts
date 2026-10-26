import { pool } from "@workspace/db";
import { runSponsorLicenceSync } from "../lib/sponsorLicenceSync";
import { runFreeBoardVacancyCollector } from "../lib/freeBoardVacancyCollector";
import { runVacancyJob, type VacancyJobKind } from "../lib/vacancyJobRunner";

/**
 * Local ops runner for the external vacancy pipeline.
 *
 * Usage:
 *   tsx src/tools/runVacancyPipelineCli.ts sponsor-sync
 *   tsx src/tools/runVacancyPipelineCli.ts free-boards [--source=<id>] [--pages=<n>]
 *   tsx src/tools/runVacancyPipelineCli.ts job <kind> [--limit=<n>]
 */
async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const arg = (name: string) => {
    const prefix = `--${name}=`;
    const hit = rest.find((v) => v.startsWith(prefix));
    return hit ? hit.slice(prefix.length) : undefined;
  };

  switch (command) {
    case "sponsor-sync": {
      await runSponsorLicenceSync("manual");
      break;
    }
    case "free-boards": {
      const pages = Number(arg("pages") ?? "100000");
      const sourceId = arg("source");
      let passes = 0;
      // Keep sweeping until every selected source completes a full sweep.
      for (;;) {
        passes += 1;
        const summary = await runFreeBoardVacancyCollector({
          pagesPerSource: pages,
          ...(sourceId ? { sourceId } : {}),
        });
        console.log(
          `[free-boards] pass=${passes} selected=${summary.selected} upserted=${summary.upserted} ` +
            `matched=${summary.sponsorMatched} unmatched=${summary.unmatchedSponsorIdentity} ` +
            `done=${summary.done} remaining=${summary.remaining}`,
        );
        for (const source of summary.metrics.sources) {
          console.log(
            `  ${source.sourceId.padEnd(22)} ${source.outcome.padEnd(18)} ` +
              `fetched=${source.recordsFetched} saved=${source.saved} ` +
              `unmatched=${source.unmatchedSponsorIdentity} ${source.error ?? ""}`,
          );
        }
        if (summary.done || summary.remaining === 0) break;
        if (passes >= 40) {
          console.log("[free-boards] pass cap reached; sources still pending");
          break;
        }
      }
      break;
    }
    case "job": {
      const kind = rest[0] as VacancyJobKind | undefined;
      if (!kind) throw new Error("job requires a VacancyJobKind argument");
      const limit = Number(arg("limit") ?? "0") || undefined;
      const summary = await runVacancyJob(kind, limit ?? 5);
      console.log(`[job] ${kind}`, JSON.stringify(summary, null, 2).slice(0, 4000));
      break;
    }
    default:
      throw new Error(`Unknown command: ${command ?? "(none)"}`);
  }
}

main()
  .catch((error) => {
    console.error("[pipeline-cli] Failed:", error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
