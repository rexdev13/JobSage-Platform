import { describe, expect, it } from "@jest/globals";
import { authorizeDeepLinkAfterLogin, resolveJobsageDeepLink, resolvePushDestination } from "../lib/deep-link";

describe("resolveJobsageDeepLink", () => {
  it("accepts a custom-scheme route with a host-form path", () => {
    expect(resolveJobsageDeepLink("jobsage-mobile://applications/42", { id: "u1", role: "candidate" }))
      .toEqual({ kind: "open", path: "/applications/42" });
  });

  it("routes logged-out private destinations through sign-in", () => {
    expect(resolveJobsageDeepLink("jobsage-mobile:///inbox?accountId=u1", null))
      .toEqual({ kind: "login", path: "/inbox?accountId=u1" });
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

  it("validates account ownership and route allowlisting for push destinations", () => {
    expect(resolvePushDestination("/inbox", "u1", { id: "u1", role: "candidate" }))
      .toEqual({ kind: "open", path: "/inbox" });
    expect(resolvePushDestination("/admin/users", "u1", { id: "u1", role: "admin" }))
      .toEqual({ kind: "invalid" });
    expect(resolvePushDestination("/inbox", "u2", { id: "u1", role: "candidate" }))
      .toEqual({ kind: "forbidden" });
    expect(resolvePushDestination("/inbox", "u1", null))
      .toEqual({ kind: "login", path: "/inbox?accountId=u1" });
  });

  it("requires the same account after login before opening a notification destination", () => {
    expect(authorizeDeepLinkAfterLogin("/inbox?accountId=u1", "u1")).toBe("/inbox");
    expect(authorizeDeepLinkAfterLogin("/inbox?accountId=u2", "u1")).toBeNull();
    expect(authorizeDeepLinkAfterLogin("https://attacker.invalid", "u1")).toBeNull();
  });
});
