import { requireAuthenticated } from "../middlewares/requireRole";
import { Router, type IRouter } from "express";
import {
  db,
  profilesTable,
  documentsTable,
  careerProfilesTable,
  cvEnhancementUsageTable,
  DOCUMENT_DISCLAIMER,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { openai } from "@workspace/integrations-openai-ai-server";
import { ObjectStorageService } from "../lib/objectStorage";
import PDFDocument from "pdfkit";

const router: IRouter = Router();
const objectStorageSvc = new ObjectStorageService();

const DAILY_LIMIT = 5;

// ── DB-backed daily rate limit ─────────────────────────────────────────────────
// Persisted to cv_enhancement_usage so restarts/redeploys never reset counters.
async function checkAndIncrementLimit(
  userId: string,
): Promise<{ allowed: boolean; remaining: number }> {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC

  // Read current count first (avoids over-counting on concurrent requests)
  const [row] = await db
    .select({ count: cvEnhancementUsageTable.count })
    .from(cvEnhancementUsageTable)
    .where(
      and(
        eq(cvEnhancementUsageTable.userId, userId),
        eq(cvEnhancementUsageTable.usageDate, today),
      ),
    );

  const currentCount = row?.count ?? 0;
  if (currentCount >= DAILY_LIMIT) {
    return { allowed: false, remaining: 0 };
  }

  // Atomic upsert-increment
  await db.execute(
    sql`INSERT INTO cv_enhancement_usage (user_id, usage_date, count)
        VALUES (${userId}, ${today}, 1)
        ON CONFLICT (user_id, usage_date) DO UPDATE
          SET count = cv_enhancement_usage.count + 1`,
  );

  return { allowed: true, remaining: DAILY_LIMIT - (currentCount + 1) };
}

// ── PDF generation ─────────────────────────────────────────────────────────────
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

export function buildCvPdf(params: PdfParams): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const { firstName, lastName, profile, aiContent } = params;

    const BRAND  = "#8B1A1A";
    const DARK   = "#1A1A1A";
    const MUTED  = "#6B7280";
    const LIGHT  = "#E5E7EB";
    const MARGIN = 55;
    const PAGE_W = 595.28;
    const CONTENT = PAGE_W - MARGIN * 2;

    const doc = new PDFDocument({ size: "A4", margin: MARGIN, autoFirstPage: true });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const candidateName =
      [firstName, lastName].filter(Boolean).join(" ").trim() || "Candidate";

    // ── Header ────────────────────────────────────────────────────────────
    doc.font("Helvetica-Bold").fontSize(24).fillColor(DARK).text(candidateName, MARGIN, MARGIN, { width: CONTENT });
    const titleParts = [profile.profession, profile.specialty].filter(Boolean);
    doc.font("Helvetica").fontSize(12).fillColor(MUTED).text(titleParts.join("  ·  "), { width: CONTENT });

    doc.moveTo(MARGIN, doc.y + 10).lineTo(PAGE_W - MARGIN, doc.y + 10)
      .strokeColor(BRAND).lineWidth(1.5).stroke();
    doc.moveDown(1.4);

    // ── Section helpers ───────────────────────────────────────────────────
    function sectionHeader(title: string) {
      doc.moveDown(0.7);
      doc.font("Helvetica-Bold").fontSize(9).fillColor(BRAND).text(title.toUpperCase(), { characterSpacing: 1.2 });
      doc.moveTo(MARGIN, doc.y + 2).lineTo(PAGE_W - MARGIN, doc.y + 2)
        .strokeColor(LIGHT).lineWidth(0.8).stroke();
      doc.moveDown(0.6);
    }

    function bullet(text: string) {
      const y = doc.y;
      doc.font("Helvetica").fontSize(10).fillColor(DARK).text("•", MARGIN, y, { width: 12 });
      doc.text(text, MARGIN + 14, y, { width: CONTENT - 14 });
    }

    // ── Personal Statement ────────────────────────────────────────────────
    sectionHeader("Personal Statement");
    doc.font("Helvetica").fontSize(10).fillColor(DARK).text(aiContent, { width: CONTENT, lineGap: 3 });

    // ── Professional Details ──────────────────────────────────────────────
    sectionHeader("Professional Details");
    if (profile.experienceYears) {
      bullet(`${profile.experienceYears} year${profile.experienceYears !== 1 ? "s" : ""} of professional experience`);
    }
    const regLabel: Record<string, string> = {
      registered:     "Fully registered with UK regulatory body",
      not_registered: "Not yet registered in the UK",
      in_process:     "UK registration currently in progress",
    };
    if (profile.registrationStatus) bullet(regLabel[profile.registrationStatus] ?? profile.registrationStatus);
    if (profile.residencyStatus)    bullet(`Residency / visa status: ${profile.residencyStatus}`);
    bullet(profile.requiresSponsorship ? "Requires UK Skilled Worker sponsorship" : "Does not require UK sponsorship");
    if (profile.preferredRegion?.length) {
      bullet(`Preferred UK region${profile.preferredRegion.length > 1 ? "s" : ""}: ${profile.preferredRegion.join(", ")}`);
    }

    // ── Qualifications ────────────────────────────────────────────────────
    sectionHeader("Qualifications & Education");
    const qualParts = [
      profile.qualificationType,
      profile.qualificationCountry ? `(${profile.qualificationCountry}` : null,
      profile.qualificationYear
        ? `${profile.qualificationCountry ? ", " : "("}${profile.qualificationYear})`
        : profile.qualificationCountry ? ")" : null,
    ].filter(Boolean);
    bullet(qualParts.join(" "));

    // ── Languages ─────────────────────────────────────────────────────────
    if (profile.languages?.length) {
      sectionHeader("Languages");
      bullet(profile.languages.join(", "));
    }

    // ── Additional Notes ──────────────────────────────────────────────────
    if (profile.additionalNotes?.trim()) {
      sectionHeader("Additional Notes");
      doc.font("Helvetica").fontSize(10).fillColor(DARK).text(profile.additionalNotes.trim(), { width: CONTENT, lineGap: 3 });
    }

    // ── Footer ────────────────────────────────────────────────────────────
    const footerY = doc.page.height - MARGIN + 10;
    doc.font("Helvetica").fontSize(7.5).fillColor(MUTED).text(
      `Generated by JOBSAGE AI CV Enhancement  ·  ${new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })}`,
      MARGIN, footerY, { width: CONTENT, align: "center" },
    );

    doc.end();
  });
}

// ── POST /profiles/cv-enhancement ─────────────────────────────────────────────
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

  const { allowed, remaining } = await checkAndIncrementLimit(userId);
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
// Generates a real PDF from the accepted narrative, stores it, and (optionally)
// marks it as the primary CV. Updates aiCvContent on the career profile.
router.post(
  "/profiles/cv-enhancement/finalize",
  requireAuthenticated,
  async (req, res): Promise<void> => {
    const userId    = req.user!.id;
    const firstName = req.user!.firstName;
    const lastName  = req.user!.lastName;

    const { editedContent, careerProfileId, setAsPrimary } = req.body as {
      editedContent?: unknown;
      careerProfileId?: unknown;
      setAsPrimary?: unknown;
    };

    if (!editedContent || typeof editedContent !== "string" || !editedContent.trim()) {
      res.status(400).json({ error: "editedContent is required." });
      return;
    }
    const content     = editedContent.trim();
    const makePrimary = setAsPrimary !== false; // default true

    const cpId =
      typeof careerProfileId === "number"
        ? careerProfileId
        : typeof careerProfileId === "string"
        ? parseInt(careerProfileId, 10)
        : null;

    try {
      const [profile] = await db
        .select()
        .from(profilesTable)
        .where(eq(profilesTable.userId, userId))
        .limit(1);

      if (!profile) {
        res.status(400).json({ error: "No profile found. Complete your profile first." });
        return;
      }

      // Generate PDF
      const pdfBuffer = await buildCvPdf({
        firstName,
        lastName,
        profile: {
          profession:           profile.profession,
          specialty:            profile.specialty,
          qualificationType:    profile.qualificationType,
          qualificationCountry: profile.qualificationCountry,
          qualificationYear:    profile.qualificationYear,
          experienceYears:      profile.experienceYears,
          registrationStatus:   profile.registrationStatus,
          residencyStatus:      profile.residencyStatus,
          requiresSponsorship:  profile.requiresSponsorship,
          languages:            profile.languages ?? null,
          additionalNotes:      profile.additionalNotes ?? null,
          preferredRegion:      profile.preferredRegion ?? null,
        },
        aiContent: content,
      });

      // Upload to object storage
      const storageKey = await objectStorageSvc.saveFileBuffer({
        buffer:      pdfBuffer,
        contentType: "application/pdf",
      });

      // ACL — private to this user
      await objectStorageSvc.trySetObjectEntityAclPolicy(storageKey, {
        owner:      userId,
        visibility: "private",
      });

      // Pre-fill parsedData so the extraction pipeline never re-runs on this doc
      const parsedData = {
        profession:                    profile.profession       || null,
        specialty:                     profile.specialty        || null,
        qualificationType:             profile.qualificationType || null,
        qualificationCountry:          profile.qualificationCountry || null,
        qualificationYear:             profile.qualificationYear  != null ? String(profile.qualificationYear) : null,
        experienceYears:               profile.experienceYears   != null ? String(profile.experienceYears) : null,
        registrationStatus:            profile.registrationStatus || null,
        requiresSponsorship:           profile.requiresSponsorship ?? null,
        preferredRegion:               profile.preferredRegion?.join(", ") ?? null,
        rawNotes:                      content,
        confidence:                    { overall: "high" },
        professionQualMismatch:        false,
        professionQualMismatchWarning: null,
        professionWarning:             null,
      };

      const dateStr  = new Date().toISOString().slice(0, 10);
      const filename = `AI_Enhanced_CV_${dateStr}.pdf`;

      // Insert document + optionally set as primary — all in one transaction
      const newDoc = await db.transaction(async (tx) => {
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
            isPrimary:      false,
            parsedData:     parsedData as any, // eslint-disable-line @typescript-eslint/no-explicit-any
            disclaimerText: DOCUMENT_DISCLAIMER,
          })
          .returning();

        if (!inserted) throw new Error("Document insert returned nothing.");

        if (makePrimary) {
          // Demote all existing primary CVs, then promote the new one
          await tx
            .update(documentsTable)
            .set({ isPrimary: false })
            .where(and(eq(documentsTable.userId, userId), eq(documentsTable.documentType, "cv")));

          const [promoted] = await tx
            .update(documentsTable)
            .set({ isPrimary: true })
            .where(eq(documentsTable.id, inserted.id))
            .returning();

          return promoted;
        }

        return inserted;
      });

      if (!newDoc) throw new Error("Transaction did not return the new document.");

      // Update career profile aiCvContent
      if (cpId && !isNaN(cpId)) {
        await db
          .update(careerProfilesTable)
          .set({ aiCvContent: content })
          .where(and(eq(careerProfilesTable.id, cpId), eq(careerProfilesTable.userId, userId)));
      }

      res.json({
        documentId: newDoc.id,
        storageKey:  newDoc.storageKey,
        filename:    newDoc.filename,
        isPrimary:   newDoc.isPrimary,
      });
    } catch (err) {
      console.error("[cv-enhancement/finalize] Error:", err);
      res.status(500).json({ error: "Failed to generate or save the enhanced CV." });
    }
  },
);

export default router;
