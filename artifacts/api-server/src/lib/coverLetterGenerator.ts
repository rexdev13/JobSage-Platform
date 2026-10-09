import { openai } from "@workspace/integrations-openai-ai-server";

const DISCLAIMER =
  "This cover letter is AI-generated for guidance only. Review and personalise before sending to any employer.";

export interface CoverLetterInput {
  candidateName: string;
  profession: string;
  specialty: string | null;
  experienceYears: number;
  qualificationCountry: string | null;
  registrationStatus: string | null;
  qualificationType?: string | null;
  qualificationYear?: number | null;
  residencyStatus?: string | null;
  requiresSponsorship?: boolean | null;
  languages?: string[] | null;
  additionalNotes?: string | null;
  cvText: string | null;
  jobTitle: string;
  employer: string;
  jobDescription: string | null;
  location: string | null;
  regulator: string | null;
  /** JOBSAGE communication alias — used as the contact address in the letter instead of a personal email */
  jobsageEmail?: string | null;
}

export interface CoverLetterResult {
  coverLetter: string;
  disclaimer: string;
}

function buildSystemPrompt(regulator: string | null): string {
  return `You are an expert UK healthcare career consultant helping international professionals write compelling cover letters for NHS and private healthcare positions.

Write formal, concise, and professional UK-style cover letters (350–500 words). Structure:
1. Opening — name the role and employer; express genuine motivation
2. Relevant experience — highlight specialty, years of experience, and specific achievements drawn directly from the CV extract provided; do NOT invent or generalise — use the candidate's real background
3. UK regulatory awareness — mention relevant regulator (${regulator ?? "GMC/NMC/HCPC"}) and registration status or pathway
4. Fit for the organisation — mirror the terminology and requirements from the job description; demonstrate alignment with the employer's stated needs
5. Closing — express enthusiasm, request for interview, note availability

Grounding rules (strictly enforce):
- Every achievement or role-specific claim MUST come from the provided CV extract. If no CV extract is provided, use only the profile facts given.
- Mirror language and terminology from the job description wherever possible.
- Do NOT produce generic boilerplate. The letter must be specific to this candidate and this role.

Return ONLY the cover letter text (no JSON, no markdown fences). Begin with "Dear Hiring Manager," and end with "Yours sincerely,\\n[Candidate Name]".`;
}

function buildUserPrompt(input: CoverLetterInput): string {
  const contactLine = input.jobsageEmail ? `Contact email: ${input.jobsageEmail}` : "";

  const sponsorshipLine = input.requiresSponsorship != null
    ? `Requires sponsorship: ${input.requiresSponsorship ? "Yes" : "No"}`
    : "";

  const languagesLine = input.languages && input.languages.length > 0
    ? `Languages: ${input.languages.join(", ")}`
    : "";

  const qualLine = [
    input.qualificationType ? `Qualification type: ${input.qualificationType}` : "",
    input.qualificationYear ? `Qualified: ${input.qualificationYear}` : "",
  ].filter(Boolean).join("\n");

  const residencyLine = input.residencyStatus ? `Residency status: ${input.residencyStatus}` : "";
  const notesLine = input.additionalNotes ? `Additional context: ${input.additionalNotes}` : "";

  const cvSection = input.cvText
    ? `\n\nCandidate CV extract (use specific achievements and roles from here):\n${input.cvText.slice(0, 3000)}`
    : "";

  const jobSection = input.jobDescription
    ? `\n\nJob description (mirror terminology from here):\n${input.jobDescription.slice(0, 1500)}`
    : "";

  const profileLines = [
    `Candidate: ${input.candidateName}`,
    contactLine,
    `Profession: ${input.profession.replace(/_/g, " ")}`,
    `Specialty: ${input.specialty ?? "General"}`,
    `Experience: ${input.experienceYears} years`,
    `Trained in: ${input.qualificationCountry ?? "International"}`,
    qualLine,
    `Registration: ${input.registrationStatus ?? "In process"}`,
    residencyLine,
    sponsorshipLine,
    languagesLine,
    notesLine,
  ].filter(Boolean).join("\n");

  return `Write a cover letter for the following:

${profileLines}
${cvSection}

Target role: ${input.jobTitle}
Employer: ${input.employer}
Location: ${input.location ?? "UK"}
Regulator: ${input.regulator ?? "GMC/NMC/HCPC"}
${jobSection}`;
}

export function buildPromptMessages(input: CoverLetterInput): Array<{ role: "system" | "user"; content: string }> {
  return [
    { role: "system", content: buildSystemPrompt(input.regulator) },
    { role: "user", content: buildUserPrompt(input) },
  ];
}

export async function generateCoverLetter(input: CoverLetterInput): Promise<CoverLetterResult> {
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    max_completion_tokens: 1000,
    messages: buildPromptMessages(input),
  });

  const text = response.choices[0]?.message?.content ?? "";
  return { coverLetter: text.trim(), disclaimer: DISCLAIMER };
}
