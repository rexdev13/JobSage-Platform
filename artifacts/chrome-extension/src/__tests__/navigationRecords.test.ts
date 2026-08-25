import { describe, expect, it } from "vitest";
import { takeMatchingRecord } from "../lib/navigationRecords";

describe("trusted navigation record collections", () => {
  it("keeps the second new-tab target after matching the first registration", () => {
    const createdTargets = [
      { tabId: 51, url: "https://ats.example/apply/a?ref=jobsage" },
      { tabId: 52, url: "https://ats.example/apply/b?ref=jobsage" },
    ];

    const first = takeMatchingRecord(createdTargets, (target) => target.url.includes("/a?"));
    expect(first?.tabId).toBe(51);
    expect(createdTargets).toEqual([{ tabId: 52, url: "https://ats.example/apply/b?ref=jobsage" }]);

    const second = takeMatchingRecord(createdTargets, (target) => target.url.includes("/b?"));
    expect(second?.tabId).toBe(52);
    expect(createdTargets).toEqual([]);
  });

  it("keeps another verified registration pending until its own target appears", () => {
    const pending = [
      { applicationUrl: "https://ats.example/apply/a?ref=jobsage" },
      { applicationUrl: "https://ats.example/apply/b?ref=jobsage" },
    ];

    const first = takeMatchingRecord(pending, (entry) => entry.applicationUrl.includes("/a?"));
    expect(first?.applicationUrl).toContain("/a?");
    expect(pending).toEqual([{ applicationUrl: "https://ats.example/apply/b?ref=jobsage" }]);

    const second = takeMatchingRecord(pending, (entry) => entry.applicationUrl.includes("/b?"));
    expect(second?.applicationUrl).toContain("/b?");
    expect(pending).toEqual([]);
  });
});