import { describe, it, expect, vi, beforeEach } from "vitest";

const mockInsert = vi.fn();
const mockValues = vi.fn();

vi.mock("@workspace/db", () => {
  const valuesChain = {
    then(resolve: any) { return Promise.resolve(undefined).then(resolve); },
    catch() { return valuesChain; },
  };
  mockValues.mockReturnValue(valuesChain);

  function makeInsertChain() {
    return { values: mockValues };
  }

  return {
    db: {
      insert: (...args: any[]) => { mockInsert(...args); return makeInsertChain(); },
    },
    auditEventsTable: { name: "audit_events" },
  };
});

describe("writeAuditEvent", () => {
  beforeEach(() => {
    mockInsert.mockClear();
    mockValues.mockClear();
    vi.spyOn(console, "error").mockImplementation(() => {});

    const valuesChain = {
      then(resolve: any) { return Promise.resolve(undefined).then(resolve); },
      catch() { return valuesChain; },
    };
    mockValues.mockReturnValue(valuesChain);
  });

  it("calls db.insert on the auditEventsTable", async () => {
    const { writeAuditEvent } = await import("../lib/audit");
    await writeAuditEvent("actor-1", "admin_action", "target-1", { key: "value" });
    expect(mockInsert).toHaveBeenCalledOnce();
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({ actor: "actor-1", action: "admin_action", target: "target-1" })
    );
  });

  it("uses empty object for details when omitted", async () => {
    const { writeAuditEvent } = await import("../lib/audit");
    await writeAuditEvent("actor-2", "some_event");
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({ details: {} })
    );
  });

  it("resolves without error when target and details are omitted", async () => {
    const { writeAuditEvent } = await import("../lib/audit");
    await expect(writeAuditEvent("actor-3", "bare_event")).resolves.toBeUndefined();
  });

  it("swallows a db error and does not throw", async () => {
    mockInsert.mockImplementationOnce(() => {
      throw new Error("DB connection refused");
    });
    const { writeAuditEvent } = await import("../lib/audit");
    await expect(writeAuditEvent("actor-4", "failing_event", "target-4")).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });

  it("swallows a rejected-promise from values() and does not throw", async () => {
    const failChain = {
      then(_resolve: any, reject?: any) {
        return Promise.reject(new Error("insert failed")).catch(reject ?? (() => {}));
      },
      catch() { return failChain; },
    };
    mockValues.mockReturnValueOnce(failChain);
    const { writeAuditEvent } = await import("../lib/audit");
    await expect(writeAuditEvent("actor-5", "rejected_event")).resolves.toBeUndefined();
  });
});
