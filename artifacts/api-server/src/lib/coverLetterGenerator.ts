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
  cvText: string | null;
  jobTitle: string;
  employer: string;
  jobDescription: string | null;
  location: string | null;
  regulator: string | null;
}

export interface CoverLetterResult {
  coverLetter: string;
  disclaimer: string;
}

export async function generateCoverLetter(input: CoverLetterInput): Promise<CoverLetterResult> {
  const systemPrompt = `You are an expert UK healthcare career consultant helping international professionals write compelling cover letters for NHS and private healthcare positions.

Write formal, concise, and professional UK-style cover letters (350–500 words). Structure:
1. Opening — name the role and employer; express genuine motivation
2. Relevant experience — highlight specialty, years of experience, and key achievements relevant to the role
3. UK regulatory awareness — mention relevant regulator (${input.regulator ?? "GMC/NMC/HCPC"}) and registration status or pathway
4. Fit for the organisation — show knowledge of UK healthcare context
5. Closing — express enthusiasm, request for interview, note availability

Return ONLY the cover letter text (no JSON, no markdown fences). Begin with "Dear Hiring Manager," and end with "Yours sincerely,\n[Candidate Name]".`;

  const cvSection = input.cvText
    ? `\n\nCandidate CV extract:\n${input.cvText.slice(0, 3000)}`
    : "";

  const jobSection = input.jobDescription
    ? `\n\nJob description:\n${input.jobDescription.slice(0, 1500)}`
    : "";

  const userPrompt = `Write a cover letter for the following:

Candidate: ${input.candidateName}
Profession: ${input.profession.replace(/_/g, " ")}
Specialty: ${input.specialty ?? "General"}
Experience: ${input.experienceYears} years
Trained in: ${input.qualificationCountry ?? "International"}
Registration: ${input.registrationStatus ?? "In process"}
${cvSection}

Target role: ${input.jobTitle}
Employer: ${input.employer}
Location: ${input.location ?? "UK"}
Regulator: ${input.regulator ?? "GMC/NMC/HCPC"}
${jobSection}`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    max_completion_tokens: 1000,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });

  const text = response.choices[0]?.message?.content ?? "";
  return { coverLetter: text.trim(), disclaimer: DISCLAIMER };
}
