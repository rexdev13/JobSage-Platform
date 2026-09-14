import { runDiscovery, writeDiscoveryOutput } from "./discovery";

function optionsFrom(args: string[]): Record<string, string | boolean> {
  const options: Record<string, string | boolean> = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (!argument.startsWith("--")) continue;
    const [key, inlineValue] = argument.slice(2).split("=", 2);
    if (inlineValue !== undefined) options[key!] = inlineValue;
    else if (args[index + 1] && !args[index + 1]!.startsWith("--")) options[key!] = args[++index]!;
    else options[key!] = true;
  }
  return options;
}

function stringOption(options: Record<string, string | boolean>, key: string, fallback = ""): string {
  const value = options[key];
  return typeof value === "string" ? value : fallback;
}

function numberOption(options: Record<string, string | boolean>, key: string, fallback: number): number {
  const value = Number.parseInt(stringOption(options, key), 10);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function help(): void {
  console.log(`
Sponsor contact discovery

Pilot/full discovery:
  pnpm --filter @workspace/scripts sponsor-contacts pilot --limit 200 --output data/sponsor_contacts_pilot.csv
  pnpm --filter @workspace/scripts sponsor-contacts full --output data/sponsor_contacts_full.csv

Optional inputs:
  --input FILE       Existing sponsor CSV; otherwise download the latest Home Office register
  --cqc FILE         CQC CSV with organisation and website columns
  --gias FILE        GIAS CSV with establishment name, SchoolWebsite, and MainEmail
  --charity FILE     Charity Commission export with name, website, and email
  --delay-ms N       Minimum delay per employer host (default 1500)

Review/import:
  pnpm --filter @workspace/scripts sponsor-contacts import --input data/sponsor_contacts_pilot.csv
  pnpm --filter @workspace/scripts sponsor-contacts import --input data/sponsor_contacts_pilot.csv --apply --require-review

Import is dry-run by default. Add review_status=approved in the reviewed CSV when using --require-review.
Only verified_email rows are imported by default, and existing JOBSAGE website/contact values are never overwritten.
`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv[0] === "--") argv.shift();
  const [command = "help", ...args] = argv;
  const options = optionsFrom(args);
  if (command === "help" || options.help) {
    help();
    return;
  }
  if (command === "pilot" || command === "full") {
    const limit = command === "full" ? Number.MAX_SAFE_INTEGER : numberOption(options, "limit", 200);
    const rows = await runDiscovery({
      inputPath: stringOption(options, "input") || undefined,
      cqcPath: stringOption(options, "cqc") || undefined,
      giasPath: stringOption(options, "gias") || undefined,
      charityPath: stringOption(options, "charity") || undefined,
      homeOfficeUrl: stringOption(options, "home-office-url") || undefined,
      limit,
      delayMs: numberOption(options, "delay-ms", 1_500),
    });
    const output = stringOption(options, "output", command === "pilot"
      ? "data/sponsor_contacts_pilot.csv"
      : "data/sponsor_contacts_full.csv");
    await writeDiscoveryOutput(output, rows);
    const counts = rows.reduce<Record<string, number>>((result, row) => {
      result[row.status] = (result[row.status] ?? 0) + 1;
      return result;
    }, {});
    console.log(`Wrote ${rows.length} rows to ${output}`);
    console.log(counts);
    return;
  }
  if (command === "import") {
    const { importReviewCsv } = await import("./importer");
    const input = stringOption(options, "input");
    if (!input) throw new Error("import requires --input FILE");
    const summary = await importReviewCsv(input, {
      apply: options.apply === true,
      requireReview: options["require-review"] === true,
    });
    console.log(summary);
    if (!options.apply) console.log("No database changes made. Add --apply after reviewing the CSV.");
    return;
  }
  help();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});