import { Router, type IRouter } from "express";
import { requireAuthenticated } from "../middlewares/requireRole";
import { db, profilesTable, documentsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { generateCoverLetter } from "../lib/coverLetterGenerator";
import { ObjectStorageService } from "../lib/objectStorage";

const router: IRouter = Router();
const objectStorage = new ObjectStorageService();

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

  try {
    const result = await generateCoverLetter({
      candidateName,
      profession: profile.profession,
      specialty: profile.specialty,
      experienceYears: profile.experienceYears,
      qualificationCountry: profile.qualificationCountry,
      registrationStatus: profile.registrationStatus,
      cvText,
      jobTitle,
      employer,
      jobDescription: jobDescription ?? null,
      location: location ?? null,
      regulator: regulator ?? null,
    });

    res.json(result);
  } catch (err) {
    console.error("[cover-letter] generation error:", err);
    res.status(500).json({ error: "Failed to generate cover letter. Please try again." });
  }
});

export default router;
