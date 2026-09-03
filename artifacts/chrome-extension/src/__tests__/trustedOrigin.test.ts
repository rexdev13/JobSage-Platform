import { describe, expect, it } from "vitest";
import { isConfiguredFirstPartyOrigin, isJobSageFirstPartyPage } from "../lib/trustedOrigin";

describe("isConfiguredFirstPartyOrigin", () => {
  it("allows only the exact configured JOBSAGE origin", () => {
    expect(isConfiguredFirstPartyOrigin("https://jobsage.co.uk/opportunities", "https://jobsage.co.uk")).toBe(true);
    expect(isConfiguredFirstPartyOrigin("https://preview.example.replit.dev/opportunities", "https://preview.example.replit.dev")).toBe(true);
  });

  it("rejects lookalike, arbitrary Replit, and localhost origins", () => {
    expect(isConfiguredFirstPartyOrigin("https://evil-jobsage.co.uk", "https://jobsage.co.uk")).toBe(false);
    expect(isConfiguredFirstPartyOrigin("https://attacker.replit.dev", "https://jobsage.co.uk")).toBe(false);
    expect(isConfiguredFirstPartyOrigin("http://localhost:3000", "https://jobsage.co.uk")).toBe(false);
  });
});

describe("isJobSageFirstPartyPage", () => {
  it("keeps the Smart Apply helper UI off JOBSAGE and Replit preview pages", () => {
    expect(isJobSageFirstPartyPage("https://jobsage.co.uk/opportunities")).toBe(true);
    expect(isJobSageFirstPartyPage("https://preview.example.replit.dev/opportunities")).toBe(true);
  });

  it("allows the helper UI on third-party application pages", () => {
    expect(isJobSageFirstPartyPage("https://careers.example.com/apply/123")).toBe(false);
    expect(isJobSageFirstPartyPage("https://evil-jobsage.co.uk/apply")).toBe(false);
  });
});