export type WorkspaceLoadState = "waiting" | "blocking" | "ready" | "failed";

export type WorkspaceLoadEvent =
  | "source-ready"
  | "navigation-start"
  | "content-visible"
  | "complete"
  | "retry"
  | "failure";

export const INITIAL_WORKSPACE_LOAD_STATE: WorkspaceLoadState = "waiting";

export function transitionWorkspaceLoadState(
  state: WorkspaceLoadState,
  event: WorkspaceLoadEvent,
): WorkspaceLoadState {
  if (event === "failure") return "failed";
  if (event === "retry") return "blocking";

  // A recorded failure remains authoritative until the user retries. In
  // particular, late WebView progress/end callbacks cannot clear the error.
  if (state === "failed") return state;

  if (state === "waiting") {
    return event === "source-ready" || event === "navigation-start" ? "blocking" : state;
  }

  if (state === "blocking") {
    return event === "content-visible" || event === "complete" ? "ready" : state;
  }

  // Once usable, client-side navigations and their callbacks never block it.
  return state;
}

export function isWorkspaceLoadBlocking(state: WorkspaceLoadState): boolean {
  return state === "waiting" || state === "blocking";
}
