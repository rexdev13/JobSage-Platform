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

  it("correlates a placeholder new-tab target when the exact URL arrives later", () => {
    const registered = "https://ats.example/apply/role-1?ref=jobsage";
    const createdTargets = [{ tabId: 91, url: "about:blank", createdAt: 1 }];
    const pending = [{ applicationUrl: registered, createdAt: 2 }];

    // Mirrors the background worker's event order: onCreated first, then the
    // target tab's exact tagged onBeforeNavigate, then registration matching.
    const target = createdTargets.find((entry) => entry.tabId === 91)!;
    target.url = registered;
    const match = takeMatchingRecord(pending, (entry) => entry.applicationUrl === target.url);

    expect(match?.applicationUrl).toBe(registered);
    expect(createdTargets).toEqual([{ tabId: 91, url: registered, createdAt: 1 }]);
    expect(pending).toEqual([]);
  });

  it("matches registration that arrives before a placeholder target navigation", () => {
    const registered = "https://ats.example/apply/role-2?ref=jobsage";
    const pending = [{ applicationUrl: registered, createdAt: 1 }];
    const target = { tabId: 92, url: "about:blank", createdAt: 2 };

    target.url = registered;
    const match = takeMatchingRecord(pending, (entry) => entry.applicationUrl === target.url);

    expect(match?.applicationUrl).toBe(registered);
    expect(pending).toEqual([]);
  });

  it("keeps exact rapid new-tab URLs independent across destination tabs", () => {
    const targets = [
      { tabId: 101, url: "https://ats.example/apply/a?ref=jobsage" },
      { tabId: 102, url: "https://ats.example/apply/b?ref=jobsage" },
    ];
    const match = takeMatchingRecord(
      targets,
      (entry) => entry.url === "https://ats.example/apply/b?ref=jobsage",
    );

    expect(match?.tabId).toBe(102);
    expect(targets).toEqual([{ tabId: 101, url: "https://ats.example/apply/a?ref=jobsage" }]);
  });

  it("does not treat an unregistered ref-only destination as trusted", () => {
    const pending: Array<{ applicationUrl: string }> = [];
    const refOnly = "https://ats.example/apply/unregistered?ref=jobsage";
    const match = takeMatchingRecord(pending, (entry) => entry.applicationUrl === refOnly);

    expect(match).toBeNull();
    expect(pending).toEqual([]);
  });
});