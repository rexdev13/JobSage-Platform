import { describe, expect, it } from "vitest";
import { isConfiguredFirstPartyOrigin } from "../lib/trustedOrigin";

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