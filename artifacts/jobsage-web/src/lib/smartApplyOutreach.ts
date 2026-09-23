const OUTREACH_SECTIONS = [
  { questionId: "motivation" },
  { questionId: "clinical_experience" },
  { questionId: "uk_registration" },
  { questionId: "right_to_work" },
  { questionId: "strengths" },
  { questionId: "availability" },
] as const;

export const SEND_CV_QUESTION_IDS = OUTREACH_SECTIONS.map((section) => section.questionId);

function cleanAnswer(value: string | undefined): string {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

export function compileSmartApplyOutreach({
  answers,
  employerName,
  jobTitle,
}: {
  answers: Record<string, string>;
  employerName: string;
  jobTitle: string;
  candidateName: string;
}): string {
  // The employer email supplies the single greeting, application opening,
  // attachment reference, and sign-off. Compose the answers into a concise,
  // role-aware application narrative so the email does not read like a
  // questionnaire export.
  const motivation = cleanAnswer(answers.motivation);
  const clinicalExperience = cleanAnswer(answers.clinical_experience);
  const ukRegistration = cleanAnswer(answers.uk_registration);
  const rightToWork = cleanAnswer(answers.right_to_work);
  const strengths = cleanAnswer(answers.strengths);
  const availability = cleanAnswer(answers.availability);
  const roleLabel = jobTitle.trim() ? `the ${jobTitle.trim()} opportunity` : "this opportunity";
  const employerSuffix = employerName.trim() ? ` at ${employerName.trim()}` : "";
  const paragraphs: string[] = [];

  if (motivation) {
    paragraphs.push(`I am particularly interested in ${roleLabel}${employerSuffix}. ${motivation}`);
  }
  if (clinicalExperience || ukRegistration) {
    const experienceParagraph = [
      clinicalExperience
        ? `My relevant clinical experience has prepared me to contribute effectively in this role. ${clinicalExperience}`
        : "",
      ukRegistration
        ? `My current UK regulatory position is as follows: ${ukRegistration}`
        : "",
    ].filter(Boolean).join(" ");
    paragraphs.push(experienceParagraph);
  }
  if (rightToWork || strengths) {
    const suitabilityParagraph = [
      rightToWork
        ? `Regarding my right to work in the UK and any sponsorship requirements: ${rightToWork}`
        : "",
      strengths
        ? `I would also bring these professional strengths to the role: ${strengths}`
        : "",
    ].filter(Boolean).join(" ");
    paragraphs.push(suitabilityParagraph);
  }
  if (availability) {
    paragraphs.push(`Finally, in terms of availability: ${availability}`);
  }

  return paragraphs.join("\n\n");
}