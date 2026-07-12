import { createRequire } from "module";
import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, readFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { openai } from "@workspace/integrations-openai-ai-server";

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const pdfParse: (buf: Buffer) => Promise<{ text: string }> = require("pdf-parse");

const execFileAsync = promisify(execFile);

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
  professionQualMismatch: boolean;
  professionQualMismatchWarning: string | null;
}

const SYSTEM_PROMPT = `You are a specialist at extracting structured professional profile data from CVs/resumes.
Extract the following fields and return ONLY valid JSON.

CRITICAL DISTINCTION — Clinical profession vs Academic qualification:
- "profession" MUST be based on the candidate's WORK EXPERIENCE and JOB TITLES, NOT their degree title.
  A PhD in Education does NOT make someone a doctor. A person with an MBBS who has practised in a hospital IS a doctor.
  If the CV shows only academic/research roles with a non-clinical degree, do NOT assign a clinical profession.
- "qualificationType" = the highest ACADEMIC degree found on the CV (e.g. MBBS, BScN, PhD in Education, MBA).
  Record the actual degree name as written — do not infer profession from the degree alone.
- Set "professionQualMismatch" to true if ALL of these are met:
    1. profession is a clinical role (doctor/nurse/midwife/allied_health_professional), AND
    2. qualificationType is clearly a non-clinical academic degree (PhD in Education, MSc in Business, MBA, LLB, MA in Arts, etc.)
  This flag catches cases where an academic credential was incorrectly mapped to a clinical profession.
- Set "professionQualMismatchWarning" to a short plain-English explanation when professionQualMismatch is true, null otherwise.

Profession values (pick the closest match): doctor, nurse, midwife, allied_health_professional, clinical_academic, teacher, engineer, social_worker, or any other profession string if none of the above fit.
Registration status values (pick exactly one): registered, not_registered, in_process

For each field also assess your confidence: "high" (clearly stated), "medium" (inferred), "low" (guessed), "none" (not found).

Return this exact JSON structure:
{
  "profession": "<string or null>",
  "specialty": "<string or null>",
  "qualificationCountry": "<country where primary qualification obtained, or null>",
  "qualificationType": "<degree/qualification name, e.g. MBBS, BScN, or null>",
  "qualificationYear": <year as integer or null>,
  "experienceYears": <total years of experience as integer or null>,
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
  "rawNotes": "<any additional relevant notes about the candidate, max 200 chars>",
  "professionQualMismatch": <true|false>,
  "professionQualMismatchWarning": "<explanation string or null>"
}`;

const CLINICAL_PROFESSIONS = new Set(["doctor", "nurse", "midwife", "allied_health_professional"]);

const NON_CLINICAL_PATTERNS = [
  /\b(education|pedagogy)\b/i,
  /\b(business|management|mba|commerce)\b/i,
  /\b(law|llb|llm|jurisprudence)\b/i,
  /\b(economics|finance|accounting|banking)\b/i,
  /\b(arts|humanities|history|literature|philosophy|politics|geography|sociology|linguistics)\b/i,
];

const CLINICAL_QUAL_PATTERNS =
  /\b(mbbs|bmbs|mbchb|mb\s?bch|bscn|b\.sc\. nurs|bachelor.*nurs|bachelor.*midwif|bpharm|bds|bpt|physiother|occupational therapy|radiograph|speech)\b/i;

function detectMismatchFromRules(
  profession: string | null,
  qualificationType: string | null
): boolean {
  if (!profession || !qualificationType) return false;
  if (!CLINICAL_PROFESSIONS.has(profession)) return false;
  const qual = qualificationType.toLowerCase();
  const hasNonClinical = NON_CLINICAL_PATTERNS.some((p) => p.test(qual));
  if (hasNonClinical && !CLINICAL_QUAL_PATTERNS.test(qual)) return true;
  return false;
}

async function renderPdfFirstPageAsPng(pdfBuffer: Buffer): Promise<Buffer> {
  const id = randomUUID();
  const inputPath = join(tmpdir(), `cv-${id}.pdf`);
  const outputPrefix = join(tmpdir(), `cv-${id}-out`);

  try {
    await writeFile(inputPath, pdfBuffer);
    await execFileAsync("pdftoppm", [
      "-r", "150",
      "-png",
      "-f", "1",
      "-l", "1",
      inputPath,
      outputPrefix,
    ]);

    for (const suffix of ["-1.png", "-000001.png", "-01.png", "-001.png"]) {
      try {
        return await readFile(`${outputPrefix}${suffix}`);
      } catch {
        // try next suffix
      }
    }
    throw new Error("pdftoppm produced no output file");
  } finally {
    await unlink(inputPath).catch(() => {});
    for (const suffix of ["-1.png", "-000001.png", "-01.png", "-001.png"]) {
      await unlink(`${outputPrefix}${suffix}`).catch(() => {});
    }
  }
}

async function callVisionApi(base64: string, mimeType: string): Promise<CvExtractedFields> {
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
            text: "Extract the professional profile data from this CV:",
          },
          { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
        ],
      },
    ],
    response_format: { type: "json_object" },
  });
  return parseAiResponse(visionResponse.choices[0]?.message?.content ?? "{}");
}

async function callVisionApiWithPdf(pdfBuffer: Buffer): Promise<CvExtractedFields> {
  const base64 = pdfBuffer.toString("base64");
  const dataUrl = `data:application/pdf;base64,${base64}`;
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
            text: "Extract the professional profile data from this CV:",
          },
          { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
        ],
      },
    ],
    response_format: { type: "json_object" },
  });
  return parseAiResponse(visionResponse.choices[0]?.message?.content ?? "{}");
}

export async function extractCvFields(
  buffer: Buffer,
  mimeType: string
): Promise<CvExtractedFields> {
  if (mimeType.startsWith("image/")) {
    return callVisionApi(buffer.toString("base64"), mimeType);
  }

  if (mimeType === "application/pdf") {
    let textContent = "";
    try {
      const parsed = await pdfParse(buffer);
      textContent = parsed.text?.trim() ?? "";
    } catch {
      textContent = "";
    }

    if (textContent) {
      const truncated = textContent.slice(0, 8000);
      const textResponse = await openai.chat.completions.create({
        model: "gpt-4o",
        max_completion_tokens: 1200,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `Extract the professional profile data from this CV text:\n\n${truncated}`,
          },
        ],
        response_format: { type: "json_object" },
      });
      return parseAiResponse(textResponse.choices[0]?.message?.content ?? "{}");
    }

    // No text — scanned PDF. Try rendering via pdftoppm first (fastest, highest quality).
    try {
      const imgBuffer = await renderPdfFirstPageAsPng(buffer);
      return await callVisionApi(imgBuffer.toString("base64"), "image/png");
    } catch (renderErr) {
      console.warn("[cvParser] pdftoppm render failed, falling back to direct PDF vision:", renderErr);
    }

    // Fallback: send the raw PDF bytes directly to GPT-4o (no system binary required).
    try {
      return await callVisionApiWithPdf(buffer);
    } catch (visionErr) {
      console.error("[cvParser] direct PDF vision also failed:", visionErr);
      throw new Error(
        "We couldn't read this PDF. If it is a scanned document, try saving it as a text-based PDF " +
          "or upload your CV as a JPEG or PNG image instead."
      );
    }
  }

  throw new Error("Unsupported file type. Please upload a PDF or image file.");
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

  const rawProfession = typeof parsed.profession === "string" ? parsed.profession.trim() : null;
  const profession = rawProfession
    ? validProfessions.includes(rawProfession)
      ? rawProfession
      : rawProfession
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
  const qualificationType =
    typeof parsed.qualificationType === "string" ? parsed.qualificationType : null;

  const aiMismatch = parsed.professionQualMismatch === true;
  const ruleMismatch = detectMismatchFromRules(profession, qualificationType);
  const professionQualMismatch = aiMismatch || ruleMismatch;

  const professionQualMismatchWarning = professionQualMismatch
    ? typeof parsed.professionQualMismatchWarning === "string" && parsed.professionQualMismatchWarning.trim()
      ? parsed.professionQualMismatchWarning.trim().slice(0, 300)
      : `The detected profession "${profession ?? "unknown"}" may not match the qualification "${qualificationType ?? "unknown"}". Please verify this is correct before saving.`
    : null;

  return {
    profession,
    specialty: typeof parsed.specialty === "string" ? parsed.specialty : null,
    qualificationCountry:
      typeof parsed.qualificationCountry === "string"
        ? parsed.qualificationCountry
        : null,
    qualificationType,
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
    professionQualMismatch,
    professionQualMismatchWarning,
  };
}

function normaliseConf(val: unknown): "high" | "medium" | "low" | "none" {
  if (val === "high") return "high";
  if (val === "medium") return "medium";
  if (val === "low") return "low";
  return "none";
}
