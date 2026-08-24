import { describe, expect, it } from "vitest";
import {
  TRACKING_CONTEXT_TTL_MS,
  nextTrackingContext,
  type TabTrackingContext,
} from "../lib/trackingContext";

const startedAt = 1_700_000_000_000;
const click: TabTrackingContext = {
  etld1: "example.nhs.uk",
  activatedAt: startedAt,
  applicationUrl: "https://jobs.example.nhs.uk/role/42?ref=jobsage",
};

describe("nextTrackingContext", () => {
  it("retains the original click through an ATS redirect to a confirmation domain", () => {
    const next = nextTrackingContext(
      click,
      "apply.example.org",
      { transitionType: "link", transitionQualifiers: ["server_redirect"] },
      startedAt + 60_000,
    );

    expect(next).toEqual({ ...click, etld1: "apply.example.org" });
  });

  it("retains the original click after a cross-domain form submission", () => {
    const next = nextTrackingContext(
      click,
      "confirmation.example.org",
      { transitionType: "form_submit" },
      startedAt + 10 * 60_000,
    );

    expect(next?.applicationUrl).toBe(click.applicationUrl);
  });

  it("clears the click context when the candidate later follows an unrelated cross-site link", () => {
    const next = nextTrackingContext(
      click,
      "unrelated.example.com",
      { transitionType: "link" },
      startedAt + 60_000,
    );

    expect(next).toBeNull();
  });

  it("expires stale click context before a later confirmation page can use it", () => {
    const next = nextTrackingContext(
      click,
      "apply.example.org",
      { transitionType: "form_submit" },
      startedAt + TRACKING_CONTEXT_TTL_MS + 1,
    );

    expect(next).toBeNull();
  });
});