import { describe, expect, it, jest } from "@jest/globals";

jest.mock("expo-linking", () => ({ openURL: jest.fn() }));
jest.mock("expo-web-browser", () => ({
  openBrowserAsync: jest.fn(),
  WebBrowserPresentationStyle: { PAGE_SHEET: "pageSheet" },
}));
jest.mock("@/lib/workspace-config", () => ({
  isFirstPartyUrl: () => false,
}));

import { classifyEmployerWindowTarget } from "@/lib/external-links";

describe("employer browser pop-up links", () => {
  it("keeps safe HTTPS destinations inside the controlled browser", () => {
    expect(classifyEmployerWindowTarget("https://apply.example.org/jobs/42?source=nhs")).toEqual({
      kind: "in-app",
      url: "https://apply.example.org/jobs/42?source=nhs",
    });
  });

  it("routes mail and telephone links to the system handler", () => {
    expect(classifyEmployerWindowTarget("mailto:recruitment@example.org")).toEqual({ kind: "system" });
    expect(classifyEmployerWindowTarget("tel:+442079460000")).toEqual({ kind: "system" });
  });

  it("blocks insecure or non-public destinations", () => {
    expect(classifyEmployerWindowTarget("http://apply.example.org/jobs/42")).toEqual({ kind: "blocked" });
    expect(classifyEmployerWindowTarget("https://localhost/apply")).toEqual({ kind: "blocked" });
    expect(classifyEmployerWindowTarget("javascript:alert(1)")).toEqual({ kind: "blocked" });
  });
});
