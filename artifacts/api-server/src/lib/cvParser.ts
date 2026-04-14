import { createRequire } from "module";
import { openai } from "@workspace/integrations-openai-ai-server";

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const pdfParse: (buf: Buffer) => Promise<{ text: string }> = require("pdf-parse");

export interface CvExtractedFields {
  profession: string | null;
  specialty: string | null;
  qualificationCountry: string | null;
  qualificationType: string | null;
  qualificationYear: number | null;
  experienceYears: number | null;
  registrationStatus: "registered" | "not_registered" | "in_process" | null;
  requiresSponsorship: boolean | null;
  preferredRegion: string | null;
  confidence: Record<string, "high" | "medium" | "low" | "none">;
  rawNotes: string;
}

const SYSTEM_PROMPT = `You are a specialist at extracting structured healthcare professional profile data from CVs/resumes.
Extract the following fields and return ONLY valid JSON.

Profession values (pick exactly one): doctor, nurse, midwife, allied_health_professional, clinical_academic
Registration status values (pick exactly one): registered, not_registered, in_process

For each field also assess your confidence: "high" (clearly stated), "medium" (inferred), "low" (guessed), "none" (not found).

Return this exact JSON structure:
{
  "profession": "<string or null>",
  "specialty": "<string or null>",
  "qualificationCountry": "<country where primary qualification obtained, or null>",
  "qualificationType": "<degree/qualification name, e.g. MBBS, BScN, or null>",
  "qualificationYear": <year as integer or null>,
  "experienceYears": <total years of clinical experience as integer or null>,
  "registrationStatus": "<registered|not_registered|in_process|null>",
  "requiresSponsorship": <true if non-UK national/no settled status/unclear, false if UK citizen/settled status, null if cannot determine>,
  "preferredRegion": "<UK region if stated, e.g. London, North West, Scotland, or null>",
  "confidence": {
    "profession": "<high|medium|low|none>",
    "specialty": "<high|medium|low|none>",
    "qualificationCountry": "<high|medium|low|none>",
    "qualificationType": "<high|medium|low|none>",
    "qualificationYear": "<high|medium|low|none>",
    "experienceYears": "<high|medium|low|none>",
    "registrationStatus": "<high|medium|low|none>",
    "requiresSponsorship": "<high|medium|low|none>",
    "preferredRegion": "<high|medium|low|none>"
  },
  "rawNotes": "<any additional relevant notes about the candidate, max 200 chars>"
}`;

export async function extractCvFields(
  buffer: Buffer,
  mimeType: string
): Promise<CvExtractedFields> {
  let textContent = "";

  if (mimeType === "application/pdf") {
    try {
      const parsed = await pdfParse(buffer);
      textContent = parsed.text?.trim() ?? "";
    } catch {
      textContent = "";
    }
  }

  if (mimeType.startsWith("image/")) {
    const base64 = buffer.toString("base64");
    const dataUrl = `data:${mimeType};base64,${base64}`;

    const visionResponse = await openai.chat.completions.create({
      model: "gpt-4o",
      max_completion_tokens: 2000,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Extract the healthcare professional profile data from this CV image:",
            },
            { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
          ],
        },
      ],
      response_format: { type: "json_object" },
    });

    return parseAiResponse(visionResponse.choices[0]?.message?.content ?? "{}");
  }

  if (!textContent) {
    throw new Error(
      "Could not extract text from this PDF. Please ensure the PDF contains selectable text (not a scanned image). " +
        "Try uploading a JPG or PNG image of your CV instead."
    );
  }

  const truncated = textContent.slice(0, 8000);

  const textResponse = await openai.chat.completions.create({
    model: "gpt-4o",
    max_completion_tokens: 1200,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Extract the healthcare professional profile data from this CV text:\n\n${truncated}`,
      },
    ],
    response_format: { type: "json_object" },
  });

  return parseAiResponse(textResponse.choices[0]?.message?.content ?? "{}");
}

function parseAiResponse(raw: string): CvExtractedFields {
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = {};
  }

  const validProfessions = [
    "doctor",
    "nurse",
    "midwife",
    "allied_health_professional",
    "clinical_academic",
  ];
  const validRegStatus = ["registered", "not_registered", "in_process"];

  const profession = validProfessions.includes(parsed.profession as string)
    ? (parsed.profession as string)
    : null;

  const registrationStatus = validRegStatus.includes(
    parsed.registrationStatus as string
  )
    ? (parsed.registrationStatus as "registered" | "not_registered" | "in_process")
    : null;

  const qualYear =
    typeof parsed.qualificationYear === "number"
      ? parsed.qualificationYear
      : null;
  const expYears =
    typeof parsed.experienceYears === "number"
      ? parsed.experienceYears
      : null;
  const requiresSponsorship =
    typeof parsed.requiresSponsorship === "boolean"
      ? parsed.requiresSponsorship
      : null;

  const confidence = (parsed.confidence as Record<string, string>) ?? {};

  return {
    profession,
    specialty: typeof parsed.specialty === "string" ? parsed.specialty : null,
    qualificationCountry:
      typeof parsed.qualificationCountry === "string"
        ? parsed.qualificationCountry
        : null,
    qualificationType:
      typeof parsed.qualificationType === "string"
        ? parsed.qualificationType
        : null,
    qualificationYear: qualYear,
    experienceYears: expYears,
    registrationStatus,
    requiresSponsorship,
    preferredRegion:
      typeof parsed.preferredRegion === "string" ? parsed.preferredRegion : null,
    confidence: {
      profession: normaliseConf(confidence.profession),
      specialty: normaliseConf(confidence.specialty),
      qualificationCountry: normaliseConf(confidence.qualificationCountry),
      qualificationType: normaliseConf(confidence.qualificationType),
      qualificationYear: normaliseConf(confidence.qualificationYear),
      experienceYears: normaliseConf(confidence.experienceYears),
      registrationStatus: normaliseConf(confidence.registrationStatus),
      requiresSponsorship: normaliseConf(confidence.requiresSponsorship),
      preferredRegion: normaliseConf(confidence.preferredRegion),
    },
    rawNotes:
      typeof parsed.rawNotes === "string"
        ? parsed.rawNotes.slice(0, 200)
        : "",
  };
}

function normaliseConf(val: unknown): "high" | "medium" | "low" | "none" {
  if (val === "high") return "high";
  if (val === "medium") return "medium";
  if (val === "low") return "low";
  return "none";
}
