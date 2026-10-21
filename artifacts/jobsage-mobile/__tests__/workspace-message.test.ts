import { validateWorkspaceMessage } from "@workspace/mobile-core";
import { describe, expect, it } from "@jest/globals";

const origin = "https://jobsage.example";
const channel = "a".repeat(32);
const options = { origin, navigationUrl: `${origin}/workspace`, channel, now: 1_000 };

describe("Android first-party SPA message navigation", () => {
  const message = {
    version: 1, channel, timestamp: 1_000, type: "application",
    applicationId: 73, url: `${origin}/opportunities?view=boards#roles`,
  };
  const androidOptions = { ...options, allowSameOriginNavigation: true };

  it("accepts a channel-bound same-origin Apply despite a stale Android document URL", () => {
    expect(validateWorkspaceMessage(JSON.stringify(message), androidOptions)?.type).toBe("application");
    // iOS and callers that do not explicitly opt in retain exact-URL matching.
    expect(validateWorkspaceMessage(JSON.stringify(message), options)).toBeNull();
  });

  it.each([
    ["foreign claimed origin", { ...message, url: "https://employer.example/apply" }, androidOptions],
    ["foreign native origin", message, { ...androidOptions, navigationUrl: "https://employer.example/apply" }],
    ["insecure claimed origin", { ...message, url: "http://jobsage.example/opportunities" }, androidOptions],
    ["wrong channel", { ...message, channel: "b".repeat(32) }, androidOptions],
    ["stale message", { ...message, timestamp: -61_000 }, androidOptions],
    ["future message", { ...message, timestamp: 62_000 }, androidOptions],
    ["invalid application reference", { ...message, applicationId: "73" }, androidOptions],
    ["unexpected field", { ...message, unexpected: true }, androidOptions],
    ["invalid native URL", message, { ...androidOptions, navigationUrl: "not-a-url" }],
  ])("still rejects %s", (_label, value, policy) => {
    expect(validateWorkspaceMessage(JSON.stringify(value), policy)).toBeNull();
  });

  it("does not relax reauthentication requirements for a private export", () => {
    expect(validateWorkspaceMessage(JSON.stringify({
      version: 1, channel, timestamp: 1_000, url: message.url, type: "privacy-export",
      expectedAccountId: "fixture-account", confirmed: true,
      password: "fixture-password", emailCodeProof: "a".repeat(64),
    }), androidOptions)).toBeNull();
  });
});

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
