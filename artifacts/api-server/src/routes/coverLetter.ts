import { Router, type IRouter } from "express";
import { requireAuthenticated } from "../middlewares/requireRole";
import { db, profilesTable, documentsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { generateCoverLetter } from "../lib/coverLetterGenerator";
import { ObjectStorageService } from "../lib/objectStorage";
import { openai } from "@workspace/integrations-openai-ai-server";
import { maskPersonalContactInfo } from "../lib/jobsageEmailGen";

const router: IRouter = Router();
const objectStorage = new ObjectStorageService();

const COVER_LETTER_DISCLAIMER =
  "This cover letter is AI-generated for guidance only. Review and personalise before sending to any employer.";

router.post("/cover-letter/generate", requireAuthenticated, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const { jobTitle, employer, jobDescription, location, regulator, roleId } = req.body as {
    jobTitle?: string;
    employer?: string;
    jobDescription?: string | null;
    location?: string | null;
    regulator?: string | null;
    roleId?: number;
  };

  if (!jobTitle || !employer) {
    res.status(400).json({ error: "jobTitle and employer are required." });
    return;
  }

  const [profile] = await db
    .select()
    .from(profilesTable)
    .where(eq(profilesTable.userId, userId));

  if (!profile) {
    res.status(400).json({ error: "Profile not found. Please complete your profile first." });
    return;
  }

  // Try to get CV text from the most recent PDF document
  let cvText: string | null = null;
  try {
    const docs = await db
      .select()
      .from(documentsTable)
      .where(and(eq(documentsTable.userId, userId), eq(documentsTable.mimeType, "application/pdf")))
      .orderBy(documentsTable.createdAt);

    if (docs.length > 0) {
      const latestDoc = docs[docs.length - 1]!;
      const objectFile = await objectStorage.getObjectEntityFile(latestDoc.storageKey);
      const response = await objectStorage.downloadObject(objectFile);
      const arrayBuf = await response.arrayBuffer();
      const buf = Buffer.from(arrayBuf);
      const pdfParse = (await import("pdf-parse")).default;
      const parsed = await pdfParse(buf);
      cvText = parsed.text.slice(0, 4000);
    }
  } catch {
    // CV parsing is best-effort — proceed without it
  }

  const user = req.user!;
  const candidateName =
    [(user as { firstName?: string }).firstName, (user as { lastName?: string }).lastName]
      .filter(Boolean)
      .join(" ") || user.email || "Candidate";

  // Mask personal contact info in the parsed CV text before it reaches the AI prompt
  const jobsageEmail = profile.jobsageEmail ?? null;
  const maskedCvText = cvText && jobsageEmail ? maskPersonalContactInfo(cvText, jobsageEmail) : cvText;

  try {
    const result = await generateCoverLetter({
      candidateName,
      profession: profile.profession,
      specialty: profile.specialty,
      experienceYears: profile.experienceYears,
      qualificationCountry: profile.qualificationCountry,
      registrationStatus: profile.registrationStatus,
      cvText: maskedCvText,
      jobTitle,
      employer,
      jobDescription: jobDescription ?? null,
      location: location ?? null,
      regulator: regulator ?? null,
      jobsageEmail,
    });

    res.json(result);
  } catch (err) {
    console.error("[cover-letter] generation error:", err);
    res.status(500).json({ error: "Failed to generate cover letter. Please try again." });
  }
});

// SSE streaming endpoint for real-time cover letter generation
router.post("/cover-letter/generate-stream", requireAuthenticated, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const { jobTitle, employer, jobDescription, location, regulator, roleId } = req.body as {
    jobTitle?: string;
    employer?: string;
    jobDescription?: string | null;
    location?: string | null;
    regulator?: string | null;
    roleId?: number;
  };

  if (!jobTitle || !employer) {
    res.status(400).json({ error: "jobTitle and employer are required." });
    return;
  }

  const [profile] = await db.select().from(profilesTable).where(eq(profilesTable.userId, userId));
  if (!profile) {
    res.status(400).json({ error: "Profile not found. Please complete your profile first." });
    return;
  }

  let cvText: string | null = null;
  try {
    const docs = await db
      .select()
      .from(documentsTable)
      .where(and(eq(documentsTable.userId, userId), eq(documentsTable.mimeType, "application/pdf")))
      .orderBy(documentsTable.createdAt);
    if (docs.length > 0) {
      const latestDoc = docs[docs.length - 1]!;
      const objectFile = await objectStorage.getObjectEntityFile(latestDoc.storageKey);
      const response = await objectStorage.downloadObject(objectFile);
      const arrayBuf = await response.arrayBuffer();
      const buf = Buffer.from(arrayBuf);
      const pdfParse = (await import("pdf-parse")).default;
      const parsed = await pdfParse(buf);
      cvText = parsed.text.slice(0, 4000);
    }
  } catch {
    // best-effort
  }

  const user = req.user!;
  const candidateName =
    [(user as { firstName?: string }).firstName, (user as { lastName?: string }).lastName]
      .filter(Boolean)
      .join(" ") || user.email || "Candidate";

  // Mask personal contact info in the parsed CV text before it reaches the AI prompt
  const jobsageEmailStream = profile.jobsageEmail ?? null;
  const maskedCvTextStream = cvText && jobsageEmailStream ? maskPersonalContactInfo(cvText, jobsageEmailStream) : cvText;

  const contactLine = jobsageEmailStream ? `Contact email: ${jobsageEmailStream}` : "";

  const systemPrompt = `You are an expert UK healthcare career consultant helping international professionals write compelling cover letters for NHS and private healthcare positions.

Write formal, concise, and professional UK-style cover letters (350–500 words). Structure:
1. Opening — name the role and employer; express genuine motivation
2. Relevant experience — highlight specialty, years of experience, and key achievements relevant to the role
3. UK regulatory awareness — mention relevant regulator (${regulator ?? "GMC/NMC/HCPC"}) and registration status or pathway
4. Fit for the organisation — show knowledge of UK healthcare context
5. Closing — express enthusiasm, request for interview, note availability

Return ONLY the cover letter text (no JSON, no markdown fences). Begin with "Dear Hiring Manager," and end with "Yours sincerely,\n[Candidate Name]".`;

  const cvSection = maskedCvTextStream ? `\n\nCandidate CV extract:\n${maskedCvTextStream.slice(0, 3000)}` : "";
  const jobSection = jobDescription ? `\n\nJob description:\n${jobDescription.slice(0, 1500)}` : "";

  const userPrompt = `Write a cover letter for the following:

Candidate: ${candidateName}
${contactLine}
Profession: ${profile.profession.replace(/_/g, " ")}
Specialty: ${profile.specialty ?? "General"}
Experience: ${profile.experienceYears} years
Trained in: ${profile.qualificationCountry ?? "International"}
Registration: ${profile.registrationStatus ?? "In process"}
${cvSection}

Target role: ${jobTitle}
Employer: ${employer}
Location: ${location ?? "UK"}
Regulator: ${regulator ?? "GMC/NMC/HCPC"}
${jobSection}`;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  try {
    const stream = await openai.chat.completions.create({
      model: "gpt-4o",
      max_completion_tokens: 1000,
      stream: true,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content ?? "";
      if (text) {
        res.write(`data: ${JSON.stringify({ text })}\n\n`);
      }
    }

    res.write(`data: ${JSON.stringify({ done: true, disclaimer: COVER_LETTER_DISCLAIMER })}\n\n`);
    res.end();
  } catch (err) {
    console.error("[cover-letter-stream] error:", err);
    res.write(`data: ${JSON.stringify({ error: "Failed to generate cover letter." })}\n\n`);
    res.end();
  }
});

export default router;
