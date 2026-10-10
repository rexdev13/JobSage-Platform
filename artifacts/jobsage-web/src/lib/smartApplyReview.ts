export interface SmartApplyReviewQuestion {
  id: string;
  required?: boolean;
}

export function findFirstMissingRequiredAnswerId(
  questions: readonly SmartApplyReviewQuestion[],
  answers: Readonly<Record<string, string>>,
): string | null {
  return (
    questions.find(
      (question) => question.required && !answers[question.id]?.trim(),
    )?.id ?? null
  );
}

export function findFirstUnreviewedAnswerId(
  questions: readonly SmartApplyReviewQuestion[],
  answers: Readonly<Record<string, string>>,
  reviewRequiredIds: ReadonlySet<string>,
  reviewedIds: ReadonlySet<string>,
): string | null {
  return (
    questions.find(
      (question) =>
        reviewRequiredIds.has(question.id) &&
        Boolean(answers[question.id]?.trim()) &&
        !reviewedIds.has(question.id),
    )?.id ?? null
  );
}
