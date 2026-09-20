const RETRYABLE_DATABASE_CODES = new Set([
  "08000", // connection exception
  "08001", // client unable to establish connection
  "08003", // connection does not exist
  "08004", // server rejected connection
  "08006", // connection failure
  "57P01", // admin shutdown
  "57P02", // crash shutdown
  "57P03", // cannot connect now
]);

type ErrorDetails = {
  code?: string;
  message: string;
};

function errorChain(error: unknown): unknown[] {
  const chain: unknown[] = [];
  const seen = new Set<unknown>();
  let current = error;
  while (current && !seen.has(current) && chain.length < 8) {
    chain.push(current);
    seen.add(current);
    current =
      typeof current === "object" && current !== null && "cause" in current
        ? (current as { cause?: unknown }).cause
        : undefined;
  }
  return chain;
}

export function companySiteDatabaseErrorDetails(error: unknown): ErrorDetails {
  const chain = errorChain(error);
  const coded = chain.find(
    (item): item is { code: string; message?: string } =>
      typeof item === "object" &&
      item !== null &&
      "code" in item &&
      typeof (item as { code?: unknown }).code === "string",
  );
  const deepest = chain.at(-1);
  return {
    ...(coded ? { code: coded.code } : {}),
    message:
      deepest instanceof Error
        ? deepest.message
        : error instanceof Error
          ? error.message
          : String(error),
  };
}

export function isRetryableCompanySiteDatabaseError(error: unknown): boolean {
  return errorChain(error).some((item) => {
    if (typeof item !== "object" || item === null) return false;
    const code = "code" in item ? String((item as { code?: unknown }).code ?? "") : "";
    const message =
      "message" in item ? String((item as { message?: unknown }).message ?? "") : "";
    return (
      RETRYABLE_DATABASE_CODES.has(code) ||
      /terminating connection|connection (?:terminated|reset|closed)|server closed the connection unexpectedly|client has already been released|connection is not queryable/i.test(
        message,
      )
    );
  });
}

export async function withCompanySiteDatabaseRetry<T>(
  label: string,
  operation: () => Promise<T>,
  options: {
    maxAttempts?: number;
    retryDelayMs?: number;
  } = {},
): Promise<T> {
  const maxAttempts = Math.max(1, Math.min(options.maxAttempts ?? 2, 3));
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? 50);
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const details = companySiteDatabaseErrorDetails(error);
      const retryable = isRetryableCompanySiteDatabaseError(error);
      console.error(
        `[company-site-db] ${label} attempt=${attempt}/${maxAttempts} retryable=${retryable} code=${details.code ?? "unknown"} error=${details.message}`,
      );
      if (!retryable || attempt === maxAttempts) throw error;
      if (retryDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs * attempt));
      }
    }
  }
  throw new Error(`Unreachable company-site database retry state: ${label}`);
}