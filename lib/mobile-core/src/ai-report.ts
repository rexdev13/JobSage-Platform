export const AI_REPORT_REASONS = {
  inaccurate: "Incorrect or misleading",
  unsafe: "Unsafe or harmful",
  privacy: "Privacy concern",
  other: "Other concern",
} as const;
export type AIReportReason = keyof typeof AI_REPORT_REASONS;

/** Reporter-supplied evidence, not an authoritative attribution or moderation verdict. */
export function buildAIReportMessage(options: {
  reason: AIReportReason;
  detail: string;
  context: string;
  includeContent: boolean;
  content: string;
  kind?: "ai" | "message";
}) {
  const detail = options.detail.trim();
  if (!Object.prototype.hasOwnProperty.call(AI_REPORT_REASONS, options.reason)) throw new Error("Choose a report reason.");
  if (detail.length < 10 || detail.length > 1000) throw new Error("Describe the issue in 10–1,000 characters.");
  const base = `${options.kind === "message" ? "Message" : "AI"} content report\nReason: ${AI_REPORT_REASONS[options.reason]}\nContext supplied by reporter: ${options.context.slice(0, 160)}\n\n${detail}`;
  return options.includeContent
    ? `${base}\n\n${options.kind === "message" ? "Message" : "Answer"} excerpt supplied by reporter (up to 2,000 characters):\n${options.content.slice(0, 2000)}`
    : `${base}\n\nThe reporter did not include the ${options.kind === "message" ? "message" : "answer"} text.`;
}
