import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { attachUnexpectedPoolErrorHandler, pool } from "@workspace/db";

describe("database pool error containment", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("handles an unexpected idle-client error without throwing", () => {
    const target = new EventEmitter();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    attachUnexpectedPoolErrorHandler(target as never);

    expect(target.listenerCount("error")).toBe(1);
    expect(() => {
      target.emit("error", new Error("Connection terminated unexpectedly"));
    }).not.toThrow();
    expect(log).toHaveBeenCalledWith(
      "[database-pool] Idle client error:",
      "Connection terminated unexpectedly",
    );
  });

  it("installs the handler on the exported shared pool", () => {
    expect(pool.listenerCount("error")).toBeGreaterThanOrEqual(1);
  });
});