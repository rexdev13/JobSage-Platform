import { describe, expect, it, vi } from "vitest";
import {
  companySiteDatabaseErrorDetails,
  isRetryableCompanySiteDatabaseError,
  withCompanySiteDatabaseRetry,
} from "../../lib/companySitePersistence";

function databaseError(code: string, message: string): Error {
  const cause = Object.assign(new Error(message), { code });
  return Object.assign(new Error("Failed query"), { cause });
}

describe("company-site database persistence retries", () => {
  it("retries an admin-terminated connection once and succeeds on a fresh pool query", async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(databaseError("57P01", "terminating connection due to administrator command"))
      .mockResolvedValueOnce("saved");
    const logSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(withCompanySiteDatabaseRetry("test state", operation, {
      retryDelayMs: 0,
    })).resolves.toBe("saved");

    expect(operation).toHaveBeenCalledTimes(2);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("code=57P01"));
    logSpy.mockRestore();
  });

  it("stops after the bounded retry and preserves the exact driver error", async () => {
    const error = databaseError("08006", "connection terminated unexpectedly");
    const operation = vi.fn().mockRejectedValue(error);
    const logSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(withCompanySiteDatabaseRetry("test state", operation, {
      retryDelayMs: 0,
    })).rejects.toBe(error);

    expect(operation).toHaveBeenCalledTimes(2);
    expect(companySiteDatabaseErrorDetails(error)).toEqual({
      code: "08006",
      message: "connection terminated unexpectedly",
    });
    logSpy.mockRestore();
  });

  it("does not retry invalid text or ordinary statement failures", async () => {
    const error = databaseError("22021", 'invalid byte sequence for encoding "UTF8": 0x00');
    const operation = vi.fn().mockRejectedValue(error);
    const logSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(withCompanySiteDatabaseRetry("test state", operation, {
      retryDelayMs: 0,
    })).rejects.toBe(error);

    expect(operation).toHaveBeenCalledOnce();
    expect(isRetryableCompanySiteDatabaseError(error)).toBe(false);
    logSpy.mockRestore();
  });
});