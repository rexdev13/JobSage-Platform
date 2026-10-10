import { createHash } from "node:crypto";
import { parse as parseCsv } from "csv-parse/sync";
import { checkDestinationDead } from "./linkHealth";
import {
  PUBLIC_BOARD_REVALIDATION_FIELDS,
  publicBoardSourceRowHash,
  signPublicBoardRevalidation,
  type PublicBoardRevalidationRecord,
} from "./publicBoardRevalidationProof";

export const REVIEWED_PUBLIC_BOARD_REVALIDATION_MAX_BYTES = 3_000_000;
export const REVIEWED_PUBLIC_BOARD_REVALIDATION_MAX_ROWS = 4_000;
export const REVIEWED_PUBLIC_BOARD_REVALIDATION_HOST_DELAY_MS = 750;
export const REVIEWED_PUBLIC_BOARD_REVALIDATION_MAX_CONCURRENT_HOSTS = 8;

const URL_COLUMN = "apply_url";

export class ReviewedPublicBoardRevalidationInputError extends Error {}

export type ReviewedPublicBoardRevalidationResult = {
  inputSha256: string;
  outputSha256: string;
  csv: string;
  rows: number;
  hostCount: number;
  counts: Record<string, number>;
  completedAt: string;
};

export type RevalidationProgress = {
  completed: number;
  total: number;
  currentHost: string;
};

type CsvRecord = Record<string, string>;
type RevalidationOutcome = {
  status: "live" | "confirmed_dead" | "inconclusive";
  checkedAt: string;
  finalUrl: string;
  reason: string;
};

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function parseInput(buffer: Buffer): {
  inputSha256: string;
  headers: string[];
  records: CsvRecord[];
} {
  if (buffer.length === 0 || buffer.length > REVIEWED_PUBLIC_BOARD_REVALIDATION_MAX_BYTES) {
    throw new ReviewedPublicBoardRevalidationInputError(
      `CSV must be non-empty and no larger than ${REVIEWED_PUBLIC_BOARD_REVALIDATION_MAX_BYTES} bytes.`,
    );
  }
  if (!process.env.VACANCY_JOB_SECRET) {
    throw new Error("VACANCY_JOB_SECRET is not configured.");
  }

  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new ReviewedPublicBoardRevalidationInputError("CSV must be valid UTF-8.");
  }

  let headers: string[] = [];
  let records: CsvRecord[];
  try {
    records = parseCsv(source, {
      bom: true,
      columns: (rawHeaders: string[]) => {
        headers = rawHeaders.map((header) => header.trim());
        if (new Set(headers).size !== headers.length) {
          throw new Error("CSV has duplicate column names.");
        }
        if (PUBLIC_BOARD_REVALIDATION_FIELDS.some((field) => headers.includes(field))) {
          throw new Error("CSV already contains revalidation proof fields.");
        }
        return headers;
      },
      skip_empty_lines: true,
      trim: true,
      max_record_size: 64_000,
    }) as CsvRecord[];
  } catch (error) {
    if (error instanceof Error && (
      error.message.includes("duplicate column") ||
      error.message.includes("revalidation proof fields")
    )) {
      throw new ReviewedPublicBoardRevalidationInputError(error.message);
    }
    throw new ReviewedPublicBoardRevalidationInputError("CSV could not be parsed.");
  }

  if (!headers.includes(URL_COLUMN)) {
    throw new ReviewedPublicBoardRevalidationInputError(`CSV must include a "${URL_COLUMN}" column.`);
  }
  if (records.length === 0 || records.length > REVIEWED_PUBLIC_BOARD_REVALIDATION_MAX_ROWS) {
    throw new ReviewedPublicBoardRevalidationInputError(
      `CSV must contain 1 to ${REVIEWED_PUBLIC_BOARD_REVALIDATION_MAX_ROWS} data rows.`,
    );
  }
  return { inputSha256: sha256(buffer), headers, records };
}

export function inspectReviewedPublicBoardRevalidationInput(buffer: Buffer): { rows: number } {
  return { rows: parseInput(buffer).records.length };
}

export async function revalidateReviewedPublicBoardCsv(
  buffer: Buffer,
  onProgress?: (progress: RevalidationProgress) => void,
): Promise<ReviewedPublicBoardRevalidationResult> {
  const parsed = parseInput(buffer);
  const environment = process.env.NODE_ENV || "unknown";
  const records = parsed.records;
  const outcomes = new Array<RevalidationOutcome>(records.length);
  const byHost = new Map<string, number[]>();

  records.forEach((record, index) => {
    try {
      const parsedUrl = new URL(record[URL_COLUMN] ?? "");
      const indices = byHost.get(parsedUrl.hostname) ?? [];
      indices.push(index);
      byHost.set(parsedUrl.hostname, indices);
    } catch {
      outcomes[index] = {
        status: "inconclusive",
        checkedAt: new Date().toISOString(),
        finalUrl: "",
        reason: "invalid_url",
      };
    }
  });

  let completed = 0;
  const hostEntries = [...byHost.entries()];
  let nextHostIndex = 0;
  const runHost = async (host: string, indices: number[]) => {
    let nextRequestAt = 0;
    for (const index of indices) {
      const delayMs = Math.max(0, nextRequestAt - Date.now());
      if (delayMs > 0) {
        await new Promise((resolve) =>
          setTimeout(resolve, delayMs),
        );
      }
      const checkedAt = new Date().toISOString();
      nextRequestAt = Date.now() + REVIEWED_PUBLIC_BOARD_REVALIDATION_HOST_DELAY_MS;
      try {
        const result = await checkDestinationDead(records[index]![URL_COLUMN]!, { timeoutMs: 2_500 });
        outcomes[index] = {
          status: result.verdict === "alive"
            ? "live"
            : result.verdict === "dead"
              ? "confirmed_dead"
              : "inconclusive",
          checkedAt,
          finalUrl: result.verdict === "alive"
            ? result.finalUrl ?? records[index]![URL_COLUMN]!
            : "",
          reason: result.reason.slice(0, 400),
        };
      } catch (error) {
        outcomes[index] = {
          status: "inconclusive",
          checkedAt,
          finalUrl: "",
          reason: error instanceof Error ? error.message.slice(0, 400) : "network_or_timeout_error",
        };
      }
      completed += 1;
      onProgress?.({ completed, total: records.length, currentHost: host });
    }
  };
  const workerCount = Math.min(
    REVIEWED_PUBLIC_BOARD_REVALIDATION_MAX_CONCURRENT_HOSTS,
    hostEntries.length,
  );
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextHostIndex < hostEntries.length) {
      const [host, indices] = hostEntries[nextHostIndex++]!;
      await runHost(host, indices);
    }
  }));

  for (let index = 0; index < records.length; index += 1) {
    if (!outcomes[index]) {
      completed += 1;
      outcomes[index] = {
        status: "inconclusive",
        checkedAt: new Date().toISOString(),
        finalUrl: "",
        reason: "invalid_url",
      };
      onProgress?.({ completed, total: records.length, currentHost: "" });
    }
  }

  const outputHeaders = [...parsed.headers, ...PUBLIC_BOARD_REVALIDATION_FIELDS];
  const totalRows = records.length;
  const outputRows = records.map((record, index): CsvRecord => {
    const outcome = outcomes[index]!;
    const sourceRow = String(index + 2);
    const rowHash = publicBoardSourceRowHash(record);
    const base: CsvRecord = {
      ...record,
      revalidation_status: outcome.status,
      revalidated_at: outcome.checkedAt,
      revalidated_final_url: outcome.finalUrl,
      revalidation_reason: outcome.reason,
      revalidation_input_sha256: parsed.inputSha256,
      revalidation_source_row: sourceRow,
      revalidation_total_rows: String(totalRows),
      revalidation_row_hash: rowHash,
    };
    const secret = process.env.VACANCY_JOB_SECRET;
    if (!secret) throw new Error("VACANCY_JOB_SECRET is not configured.");
    const proof = signPublicBoardRevalidation({
      environment,
      inputSha256: parsed.inputSha256,
      sourceRow,
      totalRows,
      url: record[URL_COLUMN] ?? "",
      status: outcome.status,
      checkedAt: outcome.checkedAt,
      finalUrl: outcome.finalUrl,
      reason: outcome.reason,
      rowHash,
    }, secret);
    return { ...base, revalidation_proof: proof };
  });

  const csv = [
    outputHeaders.map(csvCell).join(","),
    ...outputRows.map((row) => outputHeaders.map((header) => csvCell(row[header] ?? "")).join(",")),
  ].join("\n") + "\n";
  const counts = outputRows.reduce<Record<string, number>>((acc, row) => {
    acc[row.revalidation_status] = (acc[row.revalidation_status] ?? 0) + 1;
    return acc;
  }, {});
  return {
    inputSha256: parsed.inputSha256,
    outputSha256: sha256(csv),
    csv,
    rows: records.length,
    hostCount: byHost.size,
    counts,
    completedAt: new Date().toISOString(),
  };
}
