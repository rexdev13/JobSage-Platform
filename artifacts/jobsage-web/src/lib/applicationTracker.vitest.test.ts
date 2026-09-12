import { describe, expect, it } from "vitest";
import {
  excludeClosedApplications,
  filterApplicationsByTimeframe,
  getApplicationProcessStage,
  isRejectedApplicationStatus,
} from "./applicationTracker";

const NOW = Date.parse("2026-09-12T12:00:00.000Z");

describe("application tracker helpers", () => {
  it("filters by applied date and keeps the boundary inclusive", () => {
    const applications = [
      { id: "seven", appliedAt: "2026-09-05T12:00:00.000Z" },
      { id: "older", appliedAt: "2026-09-04T11:59:59.000Z" },
      { id: "created", appliedAt: null, createdAt: "2026-09-01T12:00:00.000Z" },
    ];

    expect(filterApplicationsByTimeframe(applications, "7d", NOW).map((a) => a.id)).toEqual(["seven"]);
    expect(filterApplicationsByTimeframe(applications, "30d", NOW).map((a) => a.id)).toEqual(["seven", "older", "created"]);
  });

  it("returns all applications for full history", () => {
    const applications = [{ appliedAt: "invalid" }, { appliedAt: null }];
    expect(filterApplicationsByTimeframe(applications, "all", NOW)).toBe(applications);
  });

  it("removes closed vacancies from the tracker entirely", () => {
    const applications = [
      { id: "active", isClosed: false },
      { id: "unknown" },
      { id: "closed", isClosed: true },
    ];

    expect(excludeClosedApplications(applications).map((a) => a.id)).toEqual(["active", "unknown"]);
  });

  it("maps application statuses to the four process stages", () => {
    expect(getApplicationProcessStage("link_clicked")).toBe(0);
    expect(getApplicationProcessStage("cv_sent")).toBe(1);
    expect(getApplicationProcessStage("interview_invited")).toBe(2);
    expect(getApplicationProcessStage("offer")).toBe(3);
    expect(getApplicationProcessStage("rejected")).toBe(1);
    expect(isRejectedApplicationStatus("rejected")).toBe(true);
    expect(isRejectedApplicationStatus("offer")).toBe(false);
  });
});