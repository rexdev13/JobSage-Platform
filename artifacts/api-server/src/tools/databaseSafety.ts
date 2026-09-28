import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const DATABASE_FINGERPRINT_PATTERN = /^[0-9a-f]{32}$/i;

export async function assertDatabaseFingerprint(expectedFingerprint: string): Promise<void> {
  if (!DATABASE_FINGERPRINT_PATTERN.test(expectedFingerprint)) {
    throw new Error("Expected database fingerprint must be a 32-character hexadecimal value.");
  }
  const result = await db.execute<{ fingerprint: string }>(sql`
    SELECT md5(
      current_database() || ':' ||
      coalesce(inet_server_addr()::text, '') || ':' ||
      pg_postmaster_start_time()::text
    ) AS fingerprint
  `);
  if (
    result.rows.length !== 1 ||
    result.rows[0]?.fingerprint.toLowerCase() !== expectedFingerprint.toLowerCase()
  ) {
    throw new Error("Connected database does not match the independently confirmed database.");
  }
}

export function safeToolErrorSummary(value: unknown): string {
  const outer = value instanceof Error ? value as Error & { cause?: unknown; code?: unknown } : null;
  const cause = outer?.cause;
  const root = cause && typeof cause === "object"
    ? cause as { message?: unknown; code?: unknown }
    : null;
  const codeValue = root?.code ?? outer?.code;
  const safeCode = typeof codeValue === "string" && /^[A-Z0-9_-]{1,32}$/i.test(codeValue)
    ? ` (${codeValue})`
    : "";
  const rawMessage = typeof root?.message === "string"
    ? root.message
    : value instanceof Error
      ? value.message
      : String(value ?? "unknown error");
  const message = rawMessage
    .replace(/\b(?:postgres(?:ql)?|https?):\/\/[^\s"'`<>]+/gi, "[redacted-url]")
    .replace(/\b(password|token|secret|authorization)\s*[=:]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, 180);
  return `${message}${safeCode}`;
}