const OUTREACH_SECTIONS = [
  { questionId: "motivation" },
  { questionId: "clinical_experience" },
  { questionId: "uk_registration" },
  { questionId: "right_to_work" },
  { questionId: "strengths" },
  { questionId: "availability" },
] as const;

export const SEND_CV_QUESTION_IDS = OUTREACH_SECTIONS.map((section) => section.questionId);

export function compileSmartApplyOutreach({
  answers,
}: {
  answers: Record<string, string>;
  employerName: string;
  jobTitle: string;
  candidateName: string;
}): string {
  // The employer email supplies the single greeting, application opening,
  // attachment reference, and sign-off. Keep this payload to clean body
  // paragraphs so it can be composed into that message without repetition.
  return OUTREACH_SECTIONS
    .map(({ questionId }) => answers[questionId]?.trim() ?? "")
    .filter(Boolean)
    .join("\n\n");
}