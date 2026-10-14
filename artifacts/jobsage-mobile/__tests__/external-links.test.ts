import { describe, expect, it, jest } from "@jest/globals";
import * as WebBrowser from "expo-web-browser";

jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn() }));
jest.mock("expo-web-browser", () => ({
  openBrowserAsync: jest.fn(),
  WebBrowserPresentationStyle: { PAGE_SHEET: "pageSheet" },
}));
jest.mock("@/lib/workspace-config", () => ({
  isFirstPartyUrl: () => false,
}));

import {
  classifyEmployerWindowTarget,
  classifyUrl,
  openExternal,
  parseInAppContactLink,
  safeLinkLogContext,
} from "@/lib/external-links";

describe("employer browser pop-up links", () => {
  it("keeps safe HTTPS destinations inside the controlled browser", () => {
    expect(classifyEmployerWindowTarget("https://apply.example.org/jobs/42?source=nhs")).toEqual({
      kind: "in-app",
      url: "https://apply.example.org/jobs/42?source=nhs",
    });
  });

  it("upgrades public HTTP employer destinations to HTTPS inside the controlled browser", () => {
    expect(classifyUrl("http://ats.example.org/apply")).toBe("http");
    expect(classifyEmployerWindowTarget("http://ats.example.org/apply")).toEqual({
      kind: "in-app",
      url: "https://ats.example.org/apply",
    });
  });

  it("opens a public HTTP workspace link through the in-app browser at its HTTPS URL", async () => {
    await expect(openExternal("http://ats.example.org/apply")).resolves.toBe(true);
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith("https://ats.example.org/apply", {
      presentationStyle: "pageSheet",
    });
  });

  it("keeps employer email and phone links in-app as copyable contact details", () => {
    expect(classifyEmployerWindowTarget("mailto:recruitment@example.org")).toEqual({ kind: "contact" });
    expect(classifyEmployerWindowTarget("tel:+442079460000")).toEqual({ kind: "contact" });
    expect(parseInAppContactLink("mailto:recruitment@example.org?subject=Application")).toEqual({
      kind: "email",
      displayValue: "recruitment@example.org",
      copyValue: "recruitment@example.org",
    });
    expect(parseInAppContactLink("tel:+44 (20) 7946-0000")).toEqual({
      kind: "phone",
      displayValue: "+44 (20) 7946-0000",
      copyValue: "+442079460000",
    });
    expect(parseInAppContactLink("webcal://calendar.example.org/feed")).toBeNull();
    expect(classifyUrl("webcal://calendar.example.org/feed")).toBe("blocked");
  });

  it("does not send contact links to another app", async () => {
    jest.clearAllMocks();
    await expect(openExternal("mailto:recruitment@example.org")).resolves.toBe(false);
    expect(WebBrowser.openBrowserAsync).not.toHaveBeenCalled();
  });

  it("blocks local or unsupported destinations", () => {
    expect(classifyEmployerWindowTarget("http://localhost/jobs/42")).toEqual({ kind: "blocked" });
    expect(classifyEmployerWindowTarget("https://localhost/apply")).toEqual({ kind: "blocked" });
    expect(classifyEmployerWindowTarget("javascript:alert(1)")).toEqual({ kind: "blocked" });
  });

  it("exposes only scheme and host in navigation logs", () => {
    expect(safeLinkLogContext("https://apply.example.org/apply?email=private@example.org#step-2")).toEqual({
      scheme: "https",
      host: "apply.example.org",
    });
  });
});
