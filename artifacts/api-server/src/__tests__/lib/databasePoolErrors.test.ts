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

  it("handles an unexpected checked-out client error without throwing", () => {
    const target = new EventEmitter();
    const client = new EventEmitter();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    attachUnexpectedPoolErrorHandler(target as never);
    target.emit("connect", client);

    expect(() => {
      client.emit("error", new Error("Connection terminated by administrator"));
    }).not.toThrow();
    expect(log).toHaveBeenCalledWith(
      "[database-pool] Checked-out client error:",
      "Connection terminated by administrator",
    );
  });

  it("installs the handler on the exported shared pool", () => {
    expect(pool.listenerCount("error")).toBeGreaterThanOrEqual(1);
    expect(pool.listenerCount("connect")).toBeGreaterThanOrEqual(1);
  });
});