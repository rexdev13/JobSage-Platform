export type AssistantErrorKind = "auth" | "server" | "network";

export interface AssistantErrorEvent {
  kind: AssistantErrorKind;
  status?: number;
  message?: string;
}

export const SENSITIVE_QUESTION_BLOCK_MESSAGE =
  "JOBSAGE can't generate an answer because this question asks you to confirm sensitive or personal information. Please review it and answer it yourself.";

export function assistantErrorMessageFor(event: AssistantErrorEvent): string {
  if (event.kind === "auth") {
    return "Please sign in to JOBSAGE (jobsage.co.uk) in another tab, then try again.";
  }
  if (event.kind === "server") {
    if (event.status === 422) {
      return event.message?.trim() || SENSITIVE_QUESTION_BLOCK_MESSAGE;
    }
    return "JOBSAGE couldn't generate an answer right now. Please try again in a moment.";
  }
  return "Could not reach the JOBSAGE API. Check your internet connection and try again.";
}