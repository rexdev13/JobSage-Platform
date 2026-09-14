import { describe, expect, it } from "vitest";
import {
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