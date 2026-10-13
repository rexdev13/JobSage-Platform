import { validateWorkspaceMessage } from "@workspace/mobile-core";
import { describe, expect, it } from "@jest/globals";

const origin = "https://jobsage.example";
const channel = "a".repeat(32);
const options = { origin, navigationUrl: `${origin}/workspace`, channel, now: 1_000 };

function validatePrivacyExport(auth: { password?: string; emailCodeProof?: string }) {
  return validateWorkspaceMessage(JSON.stringify({
    version: 1,
    channel,
    url: `${origin}/workspace`,
    timestamp: 1_000,
    type: "privacy-export",
    expectedAccountId: "fixture-account",
    confirmed: true,
    ...auth,
  }), options);
}

describe("native privacy export bridge verification", () => {
  it("accepts either password verification or a one-use email-code proof", () => {
    expect(validatePrivacyExport({ password: "fixture-password" })?.type).toBe("privacy-export");
    expect(validatePrivacyExport({ emailCodeProof: "privacy-proof-fixture-token-value-1234567890abcdef" })?.type)
      .toBe("privacy-export");
  });

  it("rejects missing, conflicting, or malformed reauthentication material", () => {
    expect(validatePrivacyExport({})).toBeNull();
    expect(validatePrivacyExport({ password: "fixture-password", emailCodeProof: "privacy-proof-fixture-token-value-1234567890abcdef" })).toBeNull();
    expect(validatePrivacyExport({ emailCodeProof: "short" })).toBeNull();
  });
});
