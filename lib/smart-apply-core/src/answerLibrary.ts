import type { DetectedQuestion } from "./questionDetector";

export const ANSWER_LIBRARY_STORAGE_KEY = "jobsage_answer_library_v1";
export const ANSWER_LIBRARY_ENABLED_KEY = "jobsage_answer_library_enabled_v1";
export const ANSWER_LIBRARY_VERSION = 1;
export const ANSWER_LIBRARY_MAX_ENTRIES = 120;
export const ANSWER_LIBRARY_MAX_VALUE_LENGTH = 8_000;
export const ANSWER_LIBRARY_MATCH_THRESHOLD = 0.86;
export const ANSWER_LIBRARY_COLLISION_GAP = 0.035;

export type RememberedControlType = "text" | "textarea" | "select" | "radio";
export type RememberedAnswerCategory = "safe_free_text" | "safe_structured";
export type RememberedAnswerScope = "global" | "employer" | "ats";

export interface RememberedAnswer {
  id: string;
  version: 1;
  value: string;
  normalizedQuestion: string;
  questionSignature: string;
  labelVariants: string[];
  controlType: RememberedControlType;
  category: RememberedAnswerCategory;
  source: "candidate";
  scope: RememberedAnswerScope;
  originHost?: string;
  originPath?: string;
  employerKey?: string;
  atsKey?: string;
  createdAt: number;
  updatedAt: number;
  lastUsedAt: number | null;
  useCount: number;
  expiresAt?: number;
  explicitSave: boolean;
}

export interface AnswerMatchContext {
  employerKey?: string;
  atsKey?: string;
}

export interface AnswerMatch {
  answer: RememberedAnswer;
  confidence: number;
  reason: "question" | "signature" | "similar";
}

const INTENT_PATTERNS: Array<{ intent: string; patterns: RegExp[] }> = [
  {
    intent: "motivation_for_role",
    patterns: [
      /\bwhy\b.*\b(?:role|position|job|apply|join)\b/,
      /\bmotivat[a-z]*\b.*\b(?:apply|role|position|job)\b/,
      /\binterest(?:ed)?\b.*\b(?:role|position|job)\b/,
    ],
  },
  {
    intent: "supporting_statement",
    patterns: [
      /\bsupporting (?:statement|information)\b/,
      /\bpersonal statement\b/,
      /\bstatement in support\b/,
    ],
  },
  {
    intent: "relevant_experience",
    patterns: [
      /\b(?:describe|outline|summari[sz]e)\b.*\b(?:relevant|related)\b.*\bexperience\b/,
      /\bexperience\b.*\b(?:relevant|related)\b/,
    ],
  },
  {
    intent: "strengths_for_role",
    patterns: [
      /\b(?:key |main )?strengths?\b/,
      /\bwhat (?:can|would) you bring\b/,
    ],
  },
  {
    intent: "availability",
    patterns: [
      /\bwhen can you (?:start|commence)\b/,
      /\bavailable (?:from|to start)\b/,
      /\bpreferred start date\b/,
    ],
  },
];

export function normalizeRememberedQuestion(value: string): string {
  return value
    .toLowerCase()
    .replace(/\(\d+\)\s*$/, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(?:please|kindly|required|mandatory)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function questionIntent(normalized: string): string | null {
  return INTENT_PATTERNS.find(({ patterns }) => patterns.some((pattern) => pattern.test(normalized)))?.intent ?? null;
}

function tokenSet(value: string): Set<string> {
  const stop = new Set(["a", "an", "and", "are", "for", "in", "of", "on", "the", "this", "to", "us", "you", "your"]);
  return new Set(value.split(" ").filter((token) => token.length > 1 && !stop.has(token)));
}

function diceSimilarity(a: string, b: string): number {
  const left = tokenSet(a);
  const right = tokenSet(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return (2 * shared) / (left.size + right.size);
}

function levenshteinSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = previous[j];
      previous[j] = Math.min(
        previous[j] + 1,
        previous[j - 1] + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return 1 - previous[b.length] / Math.max(a.length, b.length);
}

export function questionSimilarity(a: string, b: string): number {
  const left = normalizeRememberedQuestion(a);
  const right = normalizeRememberedQuestion(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  const leftIntent = questionIntent(left);
  const rightIntent = questionIntent(right);
  if (leftIntent && leftIntent === rightIntent) return 0.93;
  return Math.max(diceSimilarity(left, right), levenshteinSimilarity(left, right));
}

function compatibleControlTypes(a: RememberedControlType, b: RememberedControlType): boolean {
  if (a === b) return true;
  return (a === "text" && b === "textarea") || (a === "textarea" && b === "text");
}

function scopeAllows(answer: RememberedAnswer, context: AnswerMatchContext): boolean {
  if (answer.scope === "global") return true;
  if (answer.scope === "employer") {
    return !!answer.employerKey && answer.employerKey === context.employerKey;
  }
  return !!answer.atsKey && answer.atsKey === context.atsKey;
}

export function findBestRememberedAnswer(
  question: Pick<DetectedQuestion, "question" | "signature">,
  controlType: RememberedControlType,
  answers: RememberedAnswer[],
  context: AnswerMatchContext = {},
): AnswerMatch | null {
  const normalizedQuestion = normalizeRememberedQuestion(question.question);
  const matches = answers
    .filter((answer) =>
      answer.version === ANSWER_LIBRARY_VERSION &&
      answer.source === "candidate" &&
      compatibleControlTypes(answer.controlType, controlType) &&
      scopeAllows(answer, context),
    )
    .map((answer): AnswerMatch => {
      let confidence = 0;
      let reason: AnswerMatch["reason"] = "similar";
      if (answer.normalizedQuestion === normalizedQuestion) {
        confidence = 1;
        reason = "question";
      } else if (answer.questionSignature === question.signature) {
        confidence = 0.98;
        reason = "signature";
      } else {
        confidence = questionSimilarity(answer.normalizedQuestion, normalizedQuestion);
      }
      if (answer.controlType !== controlType) confidence -= 0.02;
      if (answer.employerKey && answer.employerKey === context.employerKey) confidence += 0.02;
      else if (answer.atsKey && answer.atsKey === context.atsKey) confidence += 0.01;
      return { answer, confidence: Math.min(1, Math.max(0, confidence)), reason };
    })
    .filter((match) => match.confidence >= ANSWER_LIBRARY_MATCH_THRESHOLD)
    .sort((a, b) => b.confidence - a.confidence || b.answer.updatedAt - a.answer.updatedAt);

  const best = matches[0];
  if (!best) return null;
  const second = matches[1];
  if (
    second &&
    best.answer.value !== second.answer.value &&
    best.confidence - second.confidence < ANSWER_LIBRARY_COLLISION_GAP
  ) {
    return null;
  }
  return best;
}

export function isRememberedAnswer(value: unknown): value is RememberedAnswer {
  if (!value || typeof value !== "object") return false;
  const answer = value as Partial<RememberedAnswer>;
  return (
    answer.version === ANSWER_LIBRARY_VERSION &&
    typeof answer.id === "string" &&
    typeof answer.value === "string" &&
    typeof answer.normalizedQuestion === "string" &&
    typeof answer.questionSignature === "string" &&
    Array.isArray(answer.labelVariants) &&
    answer.source === "candidate" &&
    typeof answer.updatedAt === "number" &&
    typeof answer.createdAt === "number"
  );
}