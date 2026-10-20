import { describe, expect, it } from "@jest/globals";
import {
  INITIAL_WORKSPACE_LOAD_STATE,
  isWorkspaceLoadBlocking,
  transitionWorkspaceLoadState,
} from "../lib/workspace-load-policy";

describe("workspace load policy", () => {
  it("blocks the initial document until it becomes usable", () => {
    const started = transitionWorkspaceLoadState(INITIAL_WORKSPACE_LOAD_STATE, "source-ready");
    expect(started).toBe("blocking");
    expect(transitionWorkspaceLoadState(INITIAL_WORKSPACE_LOAD_STATE, "navigation-start")).toBe("blocking");
    expect(transitionWorkspaceLoadState(started, "content-visible")).toBe("ready");

    const completed = transitionWorkspaceLoadState("blocking", "complete");
    expect(completed).toBe("ready");
  });

  it("does not block again when a ready workspace starts another navigation", () => {
    expect(transitionWorkspaceLoadState("ready", "navigation-start")).toBe("ready");
  });

  it("restores the blocking loader only after an explicit retry", () => {
    expect(transitionWorkspaceLoadState("ready", "retry")).toBe("blocking");
  });

  it("records a load failure as a persistent failed state", () => {
    expect(transitionWorkspaceLoadState("blocking", "failure")).toBe("failed");
  });

  it.each(["complete", "content-visible"] as const)(
    "keeps a failed workspace failed after a late %s callback",
    (event) => {
      expect(transitionWorkspaceLoadState("failed", event)).toBe("failed");
    },
  );

  it("reports only waiting and blocking as loader phases", () => {
    expect(isWorkspaceLoadBlocking("waiting")).toBe(true);
    expect(isWorkspaceLoadBlocking("blocking")).toBe(true);
    expect(isWorkspaceLoadBlocking("ready")).toBe(false);
    expect(isWorkspaceLoadBlocking("failed")).toBe(false);
  });
});
