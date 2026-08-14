import { requireAuthenticated } from "../middlewares/requireRole";
import { Router, type IRouter } from "express";
import {
  db,
  profilesTable,
  documentsTable,
  careerProfilesTable,
  DOCUMENT_DISCLAIMER,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { openai } from "@workspace/integrations-openai-ai-server";
import { ObjectStorageService } from "../lib/objectStorage";
import PDFDocument from "pdfkit";

const router: IRouter = Router();
const objectStorageSvc = new ObjectStorageService();

// ── Daily rate limit ───────────────────────────────────────────────────────────
// 5 generations per user per UTC calendar day.
const DAILY_LIMIT = 5;
const dailyUsage = new Map<string, { date: string; count: number }>();

function checkAndIncrementLimit(userId: string): { allowed: boolean; remaining: number } {
  const today = new Date().toISOString().slice(0, 10);
  const entry = dailyUsage.get(userId);
  if (!entry || entry.date !== today) {
    dailyUsage.set(userId, { date: today, count: 1 });
    return { allowed: true, remaining: DAILY_LIMIT - 1 };
  }
  if (entry.count >= DAILY_LIMIT) return { allowed: false, remaining: 0 };
  entry.count += 1;
  return { allowed: true, remaining: DAILY_LIMIT - entry.count };
}

// ── PDF generation helper ──────────────────────────────────────────────────────
interface PdfParams {
  firstName: string | null | undefined;
  lastName: string | null | undefined;
  profile: {
    profession: string;
    specialty: string;
    qualificationType: string;
    qualificationCountry: string;
    qualificationYear: number;
    experienceYears: number;
    registrationStatus: string;
    residencyStatus: string;
    requiresSponsorship: boolean;
    languages: string[] | null;
    additionalNotes: string | null;
    preferredRegion: string[] | null;
  };
  aiContent: string;
}

function buildCvPdf(params: PdfParams): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const { firstName, lastName, profile, aiContent } = params;

    const BRAND   = "#8B1A1A";
    const DARK    = "#1A1A1A";
    const MUTED   = "#6B7280";
    const LIGHT   = "#F3F4F6";
    const PAGE_W  = 595.28;
    const MARGIN  = 55;
    const CONTENT = PAGE_W - MARGIN * 2;

    const doc = new PDFDocument({ size: "A4", margin: MARGIN, autoFirstPage: true });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const candidateName =
      [firstName, lastName].filter(Boolean).join(" ").trim() || "Candidate";

    // ── Header ─────────────────────────────────────────────────────────────
    // Name
    doc
      .font("Helvetica-Bold")
      .fontSize(24)
      .fillColor(DARK)
      .text(candidateName, MARGIN, MARGIN, { width: CONTENT });

    const titleParts = [profile.profession, profile.specialty].filter(Boolean);
    doc
      .font("Helvetica")
      .fontSize(12)
      .fillColor(MUTED)
      .text(titleParts.join("  ·  "), { width: CONTENT });

    // Divider
    const divY = doc.y + 10;
    doc
      .moveTo(MARGIN, divY)
      .lineTo(PAGE_W - MARGIN, divY)
      .strokeColor(BRAND)
      .lineWidth(1.5)
      .stroke();
    doc.moveDown(1.2);

    // ── Section helper ──────────────────────────────────────────────────────
    function sectionHeader(title: string) {
      doc.moveDown(0.6);
      doc
        .font("Helvetica-Bold")
        .fontSize(9)
        .fillColor(BRAND)
        .text(title.toUpperCase(), { characterSpacing: 1.2 });
      doc
        .moveTo(MARGIN, doc.y + 2)
        .lineTo(PAGE_W - MARGIN, doc.y + 2)
        .strokeColor(LIGHT)
        .lineWidth(0.8)
        .stroke();
      doc.moveDown(0.5);
    }

    function bullet(text: string) {
      const bX = MARGIN + 10;
      const tX = MARGIN + 20;
      const tW = CONTENT - 20;
      const y  = doc.y;
      doc.font("Helvetica").fontSize(10).fillColor(DARK).text("•", MARGIN, y, { width: 10 });
      doc.text(text, tX, y, { width: tW });
    }

    // ── Personal Statement ──────────────────────────────────────────────────
    sectionHeader("Personal Statement");
    doc
      .font("Helvetica")
      .fontSize(10)
      .fillColor(DARK)
      .text(aiContent, { width: CONTENT, lineGap: 3 });

    // ── Professional Details ────────────────────────────────────────────────
    sectionHeader("Professional Details");

    if (profile.experienceYears) {
      bullet(`${profile.experienceYears} year${profile.experienceYears !== 1 ? "s" : ""} of professional experience`);
    }

    const regLabel: Record<string, string> = {
      registered:     "Fully registered with UK regulatory body",
      not_registered: "Not yet registered in the UK",
      in_process:     "UK registration currently in progress",
    };
    if (profile.registrationStatus) {
      bullet(regLabel[profile.registrationStatus] ?? profile.registrationStatus);
    }

    if (profile.residencyStatus) {
      bullet(`Residency / visa status: ${profile.residencyStatus}`);
    }

    bullet(profile.requiresSponsorship
      ? "Requires UK Skilled Worker sponsorship"
      : "Does not require UK sponsorship");

    if (profile.preferredRegion?.length) {
      bullet(`Preferred UK region${profile.preferredRegion.length > 1 ? "s" : ""}: ${profile.preferredRegion.join(", ")}`);
    }

    // ── Qualifications ──────────────────────────────────────────────────────
    sectionHeader("Qualifications & Education");
    const qualParts = [
      profile.qualificationType,
      profile.qualificationCountry ? `(${profile.qualificationCountry}` : null,
      profile.qualificationYear    ? `${profile.qualificationCountry ? ", " : "("}${profile.qualificationYear})` : (profile.qualificationCountry ? ")" : null),
    ].filter(Boolean);
    bullet(qualParts.join(" "));

    // ── Languages ───────────────────────────────────────────────────────────
    if (profile.languages?.length) {
      sectionHeader("Languages");
      bullet(profile.languages.join(", "));
    }

    // ── Additional Notes ────────────────────────────────────────────────────
    if (profile.additionalNotes?.trim()) {
      sectionHeader("Additional Notes");
      doc
        .font("Helvetica")
        .fontSize(10)
        .fillColor(DARK)
        .text(profile.additionalNotes.trim(), { width: CONTENT, lineGap: 3 });
    }

    // ── Footer ──────────────────────────────────────────────────────────────
    const footerY = doc.page.height - MARGIN + 10;
    doc
      .font("Helvetica")
      .fontSize(7.5)
      .fillColor(MUTED)
      .text(
        `Generated by JOBSAGE AI CV Enhancement  ·  ${new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })}`,
        MARGIN,
        footerY,
        { width: CONTENT, align: "center" },
      );

    doc.end();
  });
}

// ── POST /profiles/cv-enhancement ─────────────────────────────────────────────
// Generates an enhanced CV narrative. Does NOT save — returns text for review.
router.post("/profiles/cv-enhancement", requireAuthenticated, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const { mode, focus } = req.body as { mode?: unknown; focus?: unknown };

  if (mode !== "general" && mode !== "focused") {
    res.status(400).json({ error: 'mode must be "general" or "focused".' });
    return;
  }
  if (mode === "focused" && (!focus || typeof focus !== "string" || !focus.trim())) {
    res.status(400).json({ error: "A focus prompt is required for focused enhancement." });
    return;
  }
  const focusText = typeof focus === "string" ? focus.trim() : undefined;

  const { allowed, remaining } = checkAndIncrementLimit(userId);
  if (!allowed) {
    res.status(429).json({
      error: `Daily limit reached. You can generate up to ${DAILY_LIMIT} CV enhancements per day. Try again tomorrow.`,
      limitReached: true,
    });
    return;
  }

  try {
    const [[profile], [primaryCv]] = await Promise.all([
      db.select().from(profilesTable).where(eq(profilesTable.userId, userId)).limit(1),
      db
        .select({ parsedData: documentsTable.parsedData })
        .from(documentsTable)
        .where(
          and(
            eq(documentsTable.userId, userId),
            eq(documentsTable.documentType, "cv"),
            eq(documentsTable.isPrimary, true),
          ),
        )
        .limit(1),
    ]);

    if (!profile) {
      res.status(400).json({ error: "No profile found. Complete your profile first." });
      return;
    }

    const rawNotes =
      (primaryCv?.parsedData as Record<string, unknown> | null)?.rawNotes as string | undefined;

    const profileContext = [
      `Profession: ${profile.profession}`,
      profile.specialty ? `Specialty: ${profile.specialty}` : null,
      profile.qualificationType
        ? `Qualification: ${profile.qualificationType} (${profile.qualificationCountry ?? "unknown"}, ${profile.qualificationYear ?? "unknown"})`
        : null,
      profile.experienceYears != null ? `Years of experience: ${profile.experienceYears}` : null,
      profile.registrationStatus ? `Registration status: ${profile.registrationStatus}` : null,
      profile.residencyStatus ? `Residency / visa status: ${profile.residencyStatus}` : null,
      profile.requiresSponsorship != null
        ? `Requires UK sponsorship: ${profile.requiresSponsorship ? "Yes" : "No"}`
        : null,
      profile.languages?.length ? `Languages: ${profile.languages.join(", ")}` : null,
      profile.additionalNotes ? `Additional notes: ${profile.additionalNotes}` : null,
      rawNotes ? `CV notes (from uploaded document): ${rawNotes}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    const systemPrompt =
      "You are a professional CV writer specialising in UK healthcare and skilled-worker immigration. " +
      "Write in UK English. Use strong action verbs. Write in third-person implied (no 'I'). " +
      "Do not invent qualifications or experience not stated in the candidate profile. " +
      "Output 3–5 concise, polished paragraphs suitable for the personal statement and skills summary " +
      "section at the top of a UK CV. Do not include section headers or labels — output the prose directly.";

    const userPrompt =
      mode === "focused"
        ? `TASK: Write a polished, professional CV personal statement and skills summary for this candidate, ` +
          `specifically tailored to the following focus: "${focusText!}"\n\n` +
          `Emphasise the aspects of their profile most relevant to this focus. ` +
          `Use strong action verbs and UK-professional tone. ` +
          `Do not invent qualifications or experience not present in the profile.\n\n` +
          `CANDIDATE PROFILE:\n${profileContext}`
        : `TASK: Write a polished, professional CV personal statement and skills summary for this candidate. ` +
          `Improve grammar, replace weak language with strong action verbs, and adopt a confident, ` +
          `UK-professional tone. Do not invent qualifications or experience not present in the profile.\n\n` +
          `CANDIDATE PROFILE:\n${profileContext}`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 700,
      temperature: 0.55,
    });

    const enhancedContent = completion.choices[0]?.message?.content?.trim() ?? "";
    res.json({ enhancedContent, mode, focus: focusText ?? null, remaining });
  } catch (err) {
    console.error("[cv-enhancement] Generation error:", err);
    res.status(500).json({ error: "Failed to generate CV enhancement." });
  }
});

// ── POST /profiles/cv-enhancement/finalize ────────────────────────────────────
// Generates a real PDF from the accepted narrative, stores it as a document,
// marks it as primary CV, and updates aiCvContent on the career profile.
router.post(
  "/profiles/cv-enhancement/finalize",
  requireAuthenticated,
  async (req, res): Promise<void> => {
    const userId    = req.user!.id;
    const firstName = req.user!.firstName;
    const lastName  = req.user!.lastName;

    const { editedContent, careerProfileId } = req.body as {
      editedContent?: unknown;
      careerProfileId?: unknown;
    };

    if (!editedContent || typeof editedContent !== "string" || !editedContent.trim()) {
      res.status(400).json({ error: "editedContent is required." });
      return;
    }
    const content = editedContent.trim();

    const cpId =
      typeof careerProfileId === "number"
        ? careerProfileId
        : typeof careerProfileId === "string"
        ? parseInt(careerProfileId, 10)
        : null;

    try {
      // 1. Load profile
      const [profile] = await db
        .select()
        .from(profilesTable)
        .where(eq(profilesTable.userId, userId))
        .limit(1);

      if (!profile) {
        res.status(400).json({ error: "No profile found. Complete your profile first." });
        return;
      }

      // 2. Generate PDF
      const pdfBuffer = await buildCvPdf({
        firstName,
        lastName,
        profile: {
          profession:          profile.profession,
          specialty:           profile.specialty,
          qualificationType:   profile.qualificationType,
          qualificationCountry: profile.qualificationCountry,
          qualificationYear:   profile.qualificationYear,
          experienceYears:     profile.experienceYears,
          registrationStatus:  profile.registrationStatus,
          residencyStatus:     profile.residencyStatus,
          requiresSponsorship: profile.requiresSponsorship,
          languages:           profile.languages ?? null,
          additionalNotes:     profile.additionalNotes ?? null,
          preferredRegion:     profile.preferredRegion ?? null,
        },
        aiContent: content,
      });

      // 3. Upload to object storage
      const storageKey = await objectStorageSvc.saveFileBuffer({
        buffer:      pdfBuffer,
        contentType: "application/pdf",
      });

      // 4. ACL — private to this user
      await objectStorageSvc.trySetObjectEntityAclPolicy(storageKey, {
        owner:      userId,
        visibility: "private",
      });

      // 5. Build parsedData — pre-fills extraction result so the parse pipeline
      //    never needs to run on this document.
      const parsedData = {
        profession:           profile.profession       || null,
        specialty:            profile.specialty        || null,
        qualificationType:    profile.qualificationType || null,
        qualificationCountry: profile.qualificationCountry || null,
        qualificationYear:    profile.qualificationYear != null ? String(profile.qualificationYear) : null,
        experienceYears:      profile.experienceYears  != null ? String(profile.experienceYears) : null,
        registrationStatus:   profile.registrationStatus || null,
        requiresSponsorship:  profile.requiresSponsorship ?? null,
        preferredRegion:      profile.preferredRegion?.join(", ") ?? null,
        rawNotes:             content,
        confidence:           { overall: "high" },
        professionQualMismatch: false,
        professionQualMismatchWarning: null,
        professionWarning:    null,
      };

      const dateStr   = new Date().toISOString().slice(0, 10);
      const filename  = `AI_Enhanced_CV_${dateStr}.pdf`;

      // 6. Insert document + set as primary in one transaction
      const newDoc = await db.transaction(async (tx) => {
        // Insert the new document
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const [inserted] = await tx
          .insert(documentsTable)
          .values({
            userId,
            filename,
            mimeType:       "application/pdf",
            storageKey,
            fileSize:       pdfBuffer.length,
            documentType:   "cv",
            label:          "AI Enhanced CV",
            isPrimary:      false,           // will be flipped below
            parsedData:     parsedData as any,
            disclaimerText: DOCUMENT_DISCLAIMER,
          })
          .returning();

        if (!inserted) throw new Error("Failed to insert document row.");

        // Demote all existing primary CVs
        await tx
          .update(documentsTable)
          .set({ isPrimary: false })
          .where(
            and(
              eq(documentsTable.userId, userId),
              eq(documentsTable.documentType, "cv"),
            ),
          );

        // Promote the new document
        const [promoted] = await tx
          .update(documentsTable)
          .set({ isPrimary: true })
          .where(eq(documentsTable.id, inserted.id))
          .returning();

        return promoted;
      });

      if (!newDoc) throw new Error("Transaction did not return new document.");

      // 7. Persist aiCvContent on the career profile (if supplied)
      if (cpId && !isNaN(cpId)) {
        await db
          .update(careerProfilesTable)
          .set({ aiCvContent: content })
          .where(
            and(
              eq(careerProfilesTable.id, cpId),
              eq(careerProfilesTable.userId, userId),
            ),
          );
      }

      res.json({
        documentId: newDoc.id,
        storageKey:  newDoc.storageKey,
        filename:    newDoc.filename,
      });
    } catch (err) {
      console.error("[cv-enhancement/finalize] Error:", err);
      res.status(500).json({ error: "Failed to generate or save the enhanced CV." });
    }
  },
);

export default router;
