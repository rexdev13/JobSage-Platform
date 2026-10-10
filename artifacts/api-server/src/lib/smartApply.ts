import { openai } from "@workspace/integrations-openai-ai-server";

export interface ApplicationQuestion {
  id: string;
  question: string;
  hint: string;
  required: boolean;
}

export interface PrefillResult {
  questionId: string;
  aiAnswer: string;
  evidence: Array<{ source: "profile" | "cv"; phrase: string }>;
  confidence: "high" | "medium" | "low" | "none";
  needsReview: boolean;
}

interface CandidateEvidence {
  source: "profile" | "cv";
  phrase: string;
}

const NON_CLAIM_WORDS = new Set(
  "a an and are as at be been but by can could did do does for from had has have he her hers him his i if in into is it its me might my of on or our ours she should that the their theirs them they this those to was we were what when where which who will with would you your".split(" "),
);
const CONTRADICTION_MARKERS = new Set([
  "not",
  "no",
  "never",
  "without",
  "neither",
  "nor",
  "denies",
  "denied",
  "unregistered",
  "nonregistered",
  "former",
  "previously",
  "expired",
  "lapsed",
  "suspended",
  "revoked",
]);

const NUMBER_WORDS: Record<string, string> = {
  zero: "0",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
  ten: "10",
  eleven: "11",
  twelve: "12",
  thirteen: "13",
  fourteen: "14",
  fifteen: "15",
  sixteen: "16",
  seventeen: "17",
  eighteen: "18",
  nineteen: "19",
  twenty: "20",
};

const PROFESSION_TERMS: Array<[RegExp, string]> = [
  [/\b(?:nurse|nursing)\b/i, "nursing"],
  [/\b(?:doctor|physician|medical doctor)\b/i, "medicine"],
  [/\bmidwi(?:fe|fery)\b/i, "midwifery"],
  [/\bpharmac(?:ist|y)\b/i, "pharmacy"],
  [/\bdentist(?:ry)?\b/i, "dentistry"],
  [/\bphysiotherap(?:ist|y)\b/i, "physiotherapy"],
  [/\boccupational therapist\b/i, "occupational therapy"],
  [/\bradiograph(?:er|y)\b/i, "radiography"],
  [/\bparamedic(?:s)?\b/i, "paramedicine"],
  [/\bsocial worker\b/i, "social work"],
];

const QUALIFICATION_TERMS: Array<[RegExp, string]> = [
  [/\b(?:mbbs|mbchb|bachelor of medicine|medical degree)\b/i, "medicine"],
  [/\b(?:bsc nursing|b\.?\s?nurs(?:ing)?|bachelor of (?:science in )?nursing|nursing degree)\b/i, "nursing"],
  [/\b(?:bpharm|pharmd|bachelor of pharmacy|pharmacy degree)\b/i, "pharmacy"],
  [/\b(?:bds|dental degree|bachelor of dental surgery)\b/i, "dentistry"],
  [/\b(?:bpt|physiotherapy degree)\b/i, "physiotherapy"],
];

function splitEvidencePhrases(text: string | null | undefined): string[] {
  if (!text?.trim()) return [];
  return text
    .split(/(?<=[.!?;\n])\s+|[\r\n]+/)
    .map((phrase) => phrase.trim().replace(/^[\s"'“”‘’]+|[\s"'“”‘’]+$/g, ""))
    .filter((phrase) => phrase.length > 0 && phrase.length <= 500);
}

function normalizeClaimToken(token: string): string {
  const lower = token.toLowerCase();
  if (NUMBER_WORDS[lower]) return NUMBER_WORDS[lower];
  if (lower === "progress" || lower === "process") return "process";
  if (lower.endsWith("ies") && lower.length > 4) return `${lower.slice(0, -3)}y`;
  if (lower.endsWith("s") && lower.length > 4) return lower.slice(0, -1);
  return lower;
}

function claimTokens(text: string): string[] {
  return (text.match(/[a-z]+|\d+/gi) ?? [])
    .map(normalizeClaimToken)
    .filter((token) => !NON_CLAIM_WORDS.has(token));
}

function findMatchingEvidence(sentence: string, sources: CandidateEvidence[]): CandidateEvidence[] {
  const answerTokens = [...new Set(claimTokens(sentence))];
  if (!answerTokens.length) return [];

  const matches = sources
    .map(({ source, phrase }) => {
      const sourceTokens = new Set(claimTokens(phrase));
      const matchedTokens = answerTokens.filter((token) => sourceTokens.has(token));
      const coverage = matchedTokens.length / answerTokens.length;
      const answerMarkers = answerTokens.filter((token) => CONTRADICTION_MARKERS.has(token)).sort();
      const sourceMarkers = [...sourceTokens].filter((token) => CONTRADICTION_MARKERS.has(token)).sort();
      const samePolarity = answerMarkers.join("|") === sourceMarkers.join("|");
      const onlyTokenIsSpecific = answerTokens.length === 1 && answerTokens[0].length >= 5;
      return {
        source,
        phrase,
        coverage,
        sufficient:
          samePolarity &&
          (coverage === 1 || (onlyTokenIsSpecific && matchedTokens.length === 1)),
      };
    })
    .filter((match) => match.sufficient)
    .sort((a, b) => b.coverage - a.coverage || a.phrase.length - b.phrase.length);

  return matches.length ? [{ source: matches[0].source, phrase: matches[0].phrase }] : [];
}

function supportedAnswer(
  answer: string,
  sources: CandidateEvidence[],
): { answer: string; evidence: CandidateEvidence[] } {
  const retained: string[] = [];
  const evidence: CandidateEvidence[] = [];
  const sentences = answer.match(/[^.!?]+[.!?]?/g) ?? [];

  for (const rawSentence of sentences) {
    const sentence = rawSentence.trim();
    if (!sentence) continue;
    const matchedSources = findMatchingEvidence(sentence, sources);
    if (!matchedSources.length) continue;
    retained.push(sentence);
    evidence.push(...matchedSources);
  }

  return {
    answer: retained.join(" "),
    evidence: evidence.filter(
      (item, index) =>
        evidence.findIndex((other) => other.source === item.source && other.phrase === item.phrase) === index,
    ),
  };
}

function detectedCategories(text: string, patterns: Array<[RegExp, string]>): Set<string> {
  return new Set(patterns.filter(([pattern]) => pattern.test(text)).map(([, category]) => category));
}

function hasConflictingProfessionOrQualification(profile: {
  profession: string;
  qualificationType: string;
  cvText?: string | null;
}): boolean {
  const cvText = profile.cvText ?? "";
  if (!cvText.trim()) return false;

  const profileProfession = detectedCategories(profile.profession, PROFESSION_TERMS);
  const cvProfessions = detectedCategories(cvText, PROFESSION_TERMS);
  const profileQualifications = detectedCategories(profile.qualificationType, QUALIFICATION_TERMS);
  const cvQualifications = detectedCategories(cvText, QUALIFICATION_TERMS);

  const professionConflict =
    profileProfession.size > 0 &&
    [...cvProfessions].some((profession) => !profileProfession.has(profession));
  const qualificationConflict =
    profileQualifications.size > 0 &&
    [...cvQualifications].some((qualification) => !profileQualifications.has(qualification));
  return professionConflict || qualificationConflict;
}

function candidateEvidenceSources(
  profile: {
    profession: string;
    specialty: string;
    qualificationCountry: string;
    qualificationType: string;
    qualificationYear: number;
    experienceYears: number;
    registrationStatus: string;
    requiresSponsorship: boolean;
    additionalNotes?: string | null;
    applicationMotivation?: string | null;
    applicationStrengths?: string | null;
    noticePeriod?: string | null;
    startAvailability?: string | null;
    cvText?: string | null;
  },
): Record<string, CandidateEvidence[]> {
  const cvSources = splitEvidencePhrases(profile.cvText).map((phrase) => ({ source: "cv" as const, phrase }));
  const noteSources = splitEvidencePhrases(profile.additionalNotes).map((phrase) => ({ source: "profile" as const, phrase }));
  const clinicalProfileSources = [
    `Profession: ${profile.profession}`,
    `Specialty: ${profile.specialty}`,
    `Qualification: ${profile.qualificationType} (${profile.qualificationYear}), ${profile.qualificationCountry}`,
    `Years of experience: ${profile.experienceYears}`,
  ].map((phrase) => ({ source: "profile" as const, phrase }));
  const registrationStatus = profile.registrationStatus.replace(/_/g, " ");

  return {
    motivation: profile.applicationMotivation?.trim()
      ? [{ source: "profile" as const, phrase: profile.applicationMotivation.trim() }]
      : [],
    clinical_experience: [...clinicalProfileSources, ...cvSources, ...noteSources],
    uk_registration: [
      { source: "profile", phrase: `UK registration status: ${registrationStatus}` },
      ...cvSources,
      ...noteSources,
    ],
    right_to_work: [
      { source: "profile", phrase: `Requires sponsorship: ${profile.requiresSponsorship ? "Yes" : "No"}` },
      ...cvSources,
      ...noteSources,
    ],
    strengths: profile.applicationStrengths?.trim()
      ? [{ source: "profile" as const, phrase: profile.applicationStrengths.trim() }]
      : [],
    availability: [
      ...(profile.startAvailability?.trim()
        ? [{ source: "profile" as const, phrase: `Start availability: ${profile.startAvailability.trim()}` }]
        : []),
      ...(profile.noticePeriod?.trim()
        ? [{ source: "profile" as const, phrase: `Notice period: ${profile.noticePeriod.trim()}` }]
        : []),
    ],
  };
}

const STANDARD_QUESTIONS: ApplicationQuestion[] = [
  {
    id: "motivation",
    question: "Why are you applying for this role and what motivates you?",
    hint: "Describe your professional motivation and why this specific role appeals to you.",
    required: true,
  },
  {
    id: "clinical_experience",
    question: "Summarise your relevant clinical experience for this role.",
    hint: "Include key specialties, procedures, and environments you have worked in.",
    required: true,
  },
  {
    id: "uk_registration",
    question: "What is your current UK regulatory registration status?",
    hint: "e.g. GMC registered, awaiting PLAB 2, NMC application in progress, etc.",
    required: true,
  },
  {
    id: "right_to_work",
    question: "Do you currently have the right to work in the UK?",
    hint: "Include visa type if applicable. If you need sponsorship, state this clearly.",
    required: true,
  },
  {
    id: "strengths",
    question: "What are your greatest professional strengths relevant to this position?",
    hint: "Be specific — give examples from your career that demonstrate these strengths.",
    required: true,
  },
  {
    id: "availability",
    question: "When can you start and what is your current notice period?",
    hint: "Include any constraints such as examination dates or pending visa processing.",
    required: false,
  },
];

const SYSTEM_PROMPT = `You are a specialist UK healthcare career coach helping an internationally trained health professional complete a job application.

Your task is to pre-fill job application questions using the candidate profile provided.
For each question, write a concise, professional answer (2–5 sentences).
Use only facts explicitly supplied in the candidate profile, CV extract, and role context. Never invent duties, qualifications, registrations, dates, achievements, employers, or personal circumstances. If the evidence is insufficient, set confidence to "none" and return an empty answer.
Do not guess motivation, personal strengths, availability, or notice period. The server fills those matching questions only from candidate-authored profile fields.
Never answer criminal-record, conviction, disclosure, declaration, consent, agreement, or payroll questions. Those always need the candidate's own confirmation.

Return ONLY valid JSON matching exactly:
{
  "prefills": [
    {
      "questionId": "<string>",
      "aiAnswer": "<string>",
      "confidence": "<high|medium|low|none>",
      "needsReview": <boolean — true if the candidate MUST review/edit before submitting>
    }
  ]
}`;

export function getStandardQuestions(): ApplicationQuestion[] {
  return STANDARD_QUESTIONS;
}

export async function prefillApplicationAnswers(
  profile: {
    profession: string;
    specialty: string;
    qualificationCountry: string;
    qualificationType: string;
    qualificationYear: number;
    experienceYears: number;
    registrationStatus: string;
    requiresSponsorship: boolean;
    preferredRegion?: string | null;
    languages?: string[] | null;
    additionalNotes?: string | null;
    applicationMotivation?: string | null;
    applicationStrengths?: string | null;
    noticePeriod?: string | null;
    startAvailability?: string | null;
    cvText?: string | null;
  },
  roleContext: {
    title: string;
    employer?: string | null;
    description?: string | null;
    regulator: string;
    location: string;
    salary?: string | null;
    externalUrl?: string | null;
    sponsorshipOffered?: boolean;
  }
): Promise<PrefillResult[]> {
  const profileText = `
Profession: ${profile.profession}
Specialty: ${profile.specialty}
Qualification country: ${profile.qualificationCountry}
Qualification type: ${profile.qualificationType} (${profile.qualificationYear})
Years of experience: ${profile.experienceYears}
UK registration status: ${profile.registrationStatus}
Requires sponsorship: ${profile.requiresSponsorship ? "Yes" : "No"}
${profile.preferredRegion ? `Preferred UK region: ${profile.preferredRegion}` : ""}
${profile.languages?.length ? `Languages: ${profile.languages.join(", ")}` : ""}
${profile.additionalNotes ? `Candidate notes: ${profile.additionalNotes.slice(0, 1200)}` : ""}
${profile.cvText ? `CV extract (use only facts explicitly stated here): ${profile.cvText.slice(0, 5000)}` : "CV extract: unavailable"}
`.trim();

  const roleText = `
Job title: ${roleContext.title}
${roleContext.employer ? `Employer: ${roleContext.employer}` : ""}
Regulator: ${roleContext.regulator}
Location: ${roleContext.location}
${roleContext.salary ? `Salary: ${roleContext.salary}` : ""}
Sponsorship offered: ${roleContext.sponsorshipOffered ? "Yes" : "No"}
${roleContext.description ? `Description: ${roleContext.description.slice(0, 600)}` : ""}
${roleContext.externalUrl ? `Vacancy URL: ${roleContext.externalUrl}` : ""}
`.trim();

  const questionsText = STANDARD_QUESTIONS.map(
    (q, i) => `Q${i + 1} [id: ${q.id}]: ${q.question}`
  ).join("\n");

  const userMessage = `Candidate profile:\n${profileText}\n\nRole:\n${roleText}\n\nQuestions to answer:\n${questionsText}`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    max_completion_tokens: 2000,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ],
    response_format: { type: "json_object" },
  });

  const raw = response.choices[0]?.message?.content ?? "{}";

  let parsed: { prefills?: unknown[] };
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = {};
  }

  const modelPrefills = Array.isArray(parsed.prefills)
    ? parsed.prefills.filter(
        (p): p is Record<string, unknown> => typeof p === "object" && p !== null,
      )
    : [];
  const prefillsByQuestionId = new Map<string, Record<string, unknown>>();
  for (const prefill of modelPrefills) {
    if (typeof prefill.questionId === "string") {
      prefillsByQuestionId.set(prefill.questionId, prefill);
    }
  }

  // These answers are copied from explicit candidate-authored profile facts,
  // never generated or inferred by the model. Keep each answer blank when the
  // corresponding fact was not supplied.
  const candidateAnswers: Record<string, string> = {
    motivation: profile.applicationMotivation?.trim() ?? "",
    strengths: profile.applicationStrengths?.trim() ?? "",
    availability: [
      profile.startAvailability?.trim()
        ? `Start availability: ${profile.startAvailability.trim()}`
        : "",
      profile.noticePeriod?.trim()
        ? `Notice period: ${profile.noticePeriod.trim()}`
        : "",
    ].filter(Boolean).join("\n"),
  };
  const evidenceSources = candidateEvidenceSources(profile);
  const conflictingCandidateEvidence = hasConflictingProfessionOrQualification(profile);

  const prefills: PrefillResult[] = STANDARD_QUESTIONS.map((question) => {
    const modelPrefill = prefillsByQuestionId.get(question.id);
    const modelConfidence = normaliseConf(modelPrefill?.confidence);
    const modelAnswer =
      typeof modelPrefill?.aiAnswer === "string"
        ? modelPrefill.aiAnswer.trim()
        : "";
    const hasCandidateAnswer = Object.hasOwn(candidateAnswers, question.id);
    const proposedAnswer =
      hasCandidateAnswer
        ? candidateAnswers[question.id]
        : modelConfidence === "none"
          ? ""
          : modelAnswer;
    const blockedByConflict =
      conflictingCandidateEvidence &&
      (question.id === "clinical_experience" || question.id === "uk_registration");
    const supported = blockedByConflict
      ? { answer: "", evidence: [] }
      : hasCandidateAnswer
        ? {
            answer: proposedAnswer,
            evidence: proposedAnswer ? (evidenceSources[question.id] ?? []) : [],
          }
        : supportedAnswer(proposedAnswer, evidenceSources[question.id] ?? []);
    const aiAnswer = supported.answer;

    return {
      questionId: question.id,
      aiAnswer,
      evidence: supported.evidence,
      // Model-reported confidence is not a review signal. Every generated
      // answer must be checked by the candidate before it can be sent.
      confidence: aiAnswer ? "medium" : "none",
      needsReview: true,
    };
  });

  return prefills;
}

function normaliseConf(val: unknown): "high" | "medium" | "low" | "none" {
  if (val === "high") return "high";
  if (val === "medium") return "medium";
  if (val === "low") return "low";
  return "none";
}
