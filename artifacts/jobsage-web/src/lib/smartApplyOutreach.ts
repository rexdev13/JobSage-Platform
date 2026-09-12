const OUTREACH_SECTIONS = [
  { questionId: "motivation", label: "Motivation" },
  { questionId: "clinical_experience", label: "Relevant Clinical Experience" },
  { questionId: "uk_registration", label: "UK Regulatory Registration Status" },
  { questionId: "right_to_work", label: "Right to Work & Sponsorship Status" },
  { questionId: "strengths", label: "Key Professional Strengths" },
  { questionId: "availability", label: "Availability & Notice Period" },
] as const;

export const SEND_CV_QUESTION_IDS = OUTREACH_SECTIONS.map((section) => section.questionId);

export function compileSmartApplyOutreach({
  answers,
  employerName,
  jobTitle,
  candidateName,
}: {
  answers: Record<string, string>;
  employerName: string;
  jobTitle: string;
  candidateName: string;
}): string {
  const sections = OUTREACH_SECTIONS.map(
    ({ questionId, label }) => `• ${label}:\n${answers[questionId]?.trim() ?? ""}`,
  ).join("\n\n");

  return `Dear Hiring Team at ${employerName.trim()},

I am writing to express my sincere interest in the ${jobTitle.trim()} position. Please find my screening details and qualifications below:

${sections}

Please find my CV attached. I look forward to hearing from you.

Kind regards,
${candidateName.trim() || "JOBSAGE Candidate"}`;
}