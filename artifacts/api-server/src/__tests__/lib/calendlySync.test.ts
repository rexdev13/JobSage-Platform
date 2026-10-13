import { describe, expect, it } from "vitest";
import {
  classifyCalendlyConnectionFailure,
  getCalendlyConnectionIssue,
  resolveCalendlyLeadId,
  resolveCalendlySyncStatus,
} from "../../lib/calendlySync";

describe("Calendly synchronization merge rules", () => {
  it("preserves locally recorded completed and no-show outcomes", () => {
    expect(resolveCalendlySyncStatus("completed", "cancelled")).toBe("completed");
    expect(resolveCalendlySyncStatus("no_show", "rescheduled")).toBe("no_show");
  });

  it("uses Calendly lifecycle state before a local outcome is recorded", () => {
    expect(resolveCalendlySyncStatus("scheduled", "cancelled")).toBe("cancelled");
    expect(resolveCalendlySyncStatus("rescheduled", "scheduled")).toBe("scheduled");
  });

  it("fills a missing lead link without replacing an existing one", () => {
    expect(resolveCalendlyLeadId(42, 84)).toBe(42);
    expect(resolveCalendlyLeadId(null, 84)).toBe(84);
    expect(resolveCalendlyLeadId(null, null)).toBeNull();
  });
});

describe("Calendly connection failure classification", () => {
  it("treats the connector's missing-connection 404 as disconnected", () => {
    const issue = classifyCalendlyConnectionFailure(404, "No calendly connection found");
    expect(issue?.connectionStatus).toBe("disconnected");
    expect(getCalendlyConnectionIssue(issue)?.connectionStatus).toBe("disconnected");
  });

  it("distinguishes revoked authorization from a missing connection", () => {
    expect(classifyCalendlyConnectionFailure(401, "")?.connectionStatus).toBe("reauthorization_required");
    expect(classifyCalendlyConnectionFailure(403, "")?.connectionStatus).toBe("reauthorization_required");
    expect(classifyCalendlyConnectionFailure(502, "upstream error")).toBeNull();
    expect(classifyCalendlyConnectionFailure(404, "event not found")).toBeNull();
  });
});