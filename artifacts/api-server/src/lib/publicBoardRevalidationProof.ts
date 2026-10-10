import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const PUBLIC_BOARD_REVALIDATION_FIELDS = [
  "revalidation_status",
  "revalidated_at",
  "revalidated_final_url",
  "revalidation_reason",
  "revalidation_input_sha256",
  "revalidation_source_row",
  "revalidation_total_rows",
  "revalidation_row_hash",
  "revalidation_proof",
] as const;

export type PublicBoardRevalidationRecord = Record<string, string>;

export type PublicBoardRevalidationFacts = {
  environment: string;
  inputSha256: string;
  sourceRow: string;
  totalRows: number;
  url: string;
  status: string;
  checkedAt: string;
  finalUrl: string;
  reason: string;
  rowHash: string;
};

const REVALIDATION_FIELD_SET = new Set<string>(PUBLIC_BOARD_REVALIDATION_FIELDS);

export function publicBoardSourceRowHash(row: PublicBoardRevalidationRecord): string {
  const sourceValues = Object.fromEntries(
    Object.keys(row)
      .filter((key) => !REVALIDATION_FIELD_SET.has(key))
      .sort()
      .map((key) => [key, row[key] ?? ""]),
  );
  return createHash("sha256").update(JSON.stringify(sourceValues)).digest("hex");
}

function proofPayload(facts: PublicBoardRevalidationFacts): string {
  return JSON.stringify({
    version: 1,
    environment: facts.environment,
    inputSha256: facts.inputSha256,
    sourceRow: facts.sourceRow,
    totalRows: facts.totalRows,
    url: facts.url,
    status: facts.status,
    checkedAt: facts.checkedAt,
    finalUrl: facts.finalUrl,
    reason: facts.reason,
    rowHash: facts.rowHash,
  });
}

export function signPublicBoardRevalidation(
  facts: PublicBoardRevalidationFacts,
  secret: string,
): string {
  return createHmac("sha256", secret).update(proofPayload(facts)).digest("base64url");
}

export function verifyPublicBoardRevalidation(
  row: PublicBoardRevalidationRecord,
  expected: { environment: string; sourceRow: string; totalRows: number },
): boolean {
  const secret = process.env.VACANCY_JOB_SECRET;
  if (!secret) return false;
  const proof = row.revalidation_proof;
  const sourceRow = row.revalidation_source_row;
  const totalRows = Number(row.revalidation_total_rows);
  const rowHash = publicBoardSourceRowHash(row);
  if (
    !proof ||
    sourceRow !== expected.sourceRow ||
    totalRows !== expected.totalRows ||
    row.revalidation_row_hash !== rowHash
  ) return false;

  const facts: PublicBoardRevalidationFacts = {
    environment: expected.environment,
    inputSha256: row.revalidation_input_sha256 ?? "",
    sourceRow,
    totalRows,
    url: row.apply_url ?? "",
    status: row.revalidation_status ?? "",
    checkedAt: row.revalidated_at ?? "",
    finalUrl: row.revalidated_final_url ?? "",
    reason: row.revalidation_reason ?? "",
    rowHash,
  };
  const expectedSignature = createHmac("sha256", secret).update(proofPayload(facts)).digest();
  let providedSignature: Buffer;
  try {
    providedSignature = Buffer.from(proof, "base64url");
  } catch {
    return false;
  }
  return providedSignature.length === expectedSignature.length
    && timingSafeEqual(providedSignature, expectedSignature);
}
