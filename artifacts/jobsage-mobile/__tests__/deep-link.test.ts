import { describe, expect, it } from "@jest/globals";
import { resolveJobsageDeepLink } from "../lib/deep-link";

describe("resolveJobsageDeepLink", () => {
  it("accepts a custom-scheme route with a host-form path", () => {
    expect(resolveJobsageDeepLink("jobsage-mobile://applications/42", { id: "u1", role: "candidate" }))
      .toEqual({ kind: "open", path: "/applications/42" });
  });

  it("routes logged-out private destinations through sign-in", () => {
    expect(resolveJobsageDeepLink("jobsage-mobile:///inbox", null))
      .toEqual({ kind: "login", path: "/inbox" });
  });

  it("allows only explicit public destinations while logged out", () => {
    expect(resolveJobsageDeepLink("jobsage-mobile://privacy", null))
      .toEqual({ kind: "open", path: "/privacy" });
    expect(resolveJobsageDeepLink("jobsage-mobile://privacy-settings", null))
      .toEqual({ kind: "login", path: "/privacy-settings" });
  });

  it("rejects external schemes and unsafe paths", () => {
    expect(resolveJobsageDeepLink("https://jobsage.co.uk/inbox", null)).toEqual({ kind: "invalid" });
    expect(resolveJobsageDeepLink("jobsage-mobile://inbox/%2f%2fevil.example", null)).toEqual({ kind: "invalid" });
  });

  it("rejects links scoped to another account", () => {
    expect(resolveJobsageDeepLink("jobsage-mobile://applications/42?accountId=other", { id: "u1", role: "candidate" }))
      .toEqual({ kind: "forbidden" });
  });

  it("restricts the native candidate companion to candidates", () => {
    expect(resolveJobsageDeepLink("jobsage-mobile://companion", { id: "u1", role: "employer" }))
      .toEqual({ kind: "forbidden" });
  });
});
