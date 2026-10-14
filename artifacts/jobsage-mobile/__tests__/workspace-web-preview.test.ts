import { describe, expect, it } from "@jest/globals";
import { workspaceEntryPath } from "../lib/workspace-entry-path";

describe("workspace entry route", () => {
  it("opens the real sign-in page instead of the marketing home page by default", () => {
    expect(workspaceEntryPath("/")).toBe("/login");
  });

  it("preserves safe deep links", () => {
    expect(workspaceEntryPath("/applications")).toBe("/applications");
  });

  it("does not forward unsafe paths", () => {
    expect(workspaceEntryPath("//example.com")).toBe("/login");
  });
});
