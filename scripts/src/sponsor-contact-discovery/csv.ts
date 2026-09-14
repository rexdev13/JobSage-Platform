import { readFile, writeFile } from "node:fs/promises";

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
      continue;
    }
    if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows.filter((candidate) => candidate.some((value) => value.trim() !== ""));
}

export function parseCsvObjects(text: string): Array<Record<string, string>> {
  const [rawHeaders, ...rawRows] = parseCsv(text);
  if (!rawHeaders) return [];
  const headers = rawHeaders.map((header, index) =>
    (index === 0 ? header.replace(/^\uFEFF/, "") : header).trim(),
  );
  return rawRows.map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index]?.trim() ?? ""])),
  );
}

function escapeCsv(value: unknown): string {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function stringifyCsv(rows: readonly Record<string, unknown>[], columns: readonly string[]): string {
  return [
    columns.map(escapeCsv).join(","),
    ...rows.map((row) => columns.map((column) => escapeCsv(row[column])).join(",")),
  ].join("\n") + "\n";
}

export async function readCsvFile(path: string): Promise<Array<Record<string, string>>> {
  return parseCsvObjects(await readFile(path, "utf8"));
}

export async function writeCsvFile(
  path: string,
  rows: readonly Record<string, unknown>[],
  columns: readonly string[],
): Promise<void> {
  await writeFile(path, stringifyCsv(rows, columns), "utf8");
}