import { requireAuthenticated } from "../middlewares/requireRole";
import { Router, type IRouter } from "express";
import {
  db,
  profilesTable,
  documentsTable,
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
async function checkAndIncrementLimit(
  userId: string,
): Promise<{ allowed: boolean; remaining: number }> {
  const today = new Date().toISOString().slice(0, 10);

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

  await db.execute(
    sql`INSERT INTO cv_enhancement_usage (user_id, usage_date, count)
        VALUES (${userId}, ${today}, 1)
        ON CONFLICT (user_id, usage_date) DO UPDATE
          SET count = cv_enhancement_usage.count + 1`,
  );

  return { allowed: true, remaining: DAILY_LIMIT - (currentCount + 1) };
}

// ── Download and parse a CV PDF from storage ───────────────────────────────────
async function extractCvText(storageKey: string): Promise<string> {
  const objectFile = await objectStorageSvc.getObjectEntityFile(storageKey);
  const response   = await objectStorageSvc.downloadObject(objectFile);
  const buf        = Buffer.from(await response.arrayBuffer());
  // pdf-parse v2.x exports PDFParse as a named class (no .default in any runtime)
  const { PDFParse } = (await import("pdf-parse")) as unknown as {
    PDFParse: new (opts: { data: Buffer | Uint8Array }) => {
      getText(): Promise<{ text: string }>;
    };
  };
  const parsed = await new PDFParse({ data: buf }).getText();
  return parsed.text.trim();
}

// ── PDF renderer for a fully-rewritten CV ─────────────────────────────────────
// Renders the AI-returned text into a clean A4 PDF.
// Lines that are ALL CAPS (and short) are treated as section headers.
export function buildRewrittenCvPdf(params: {
  name: string;
  content: string;
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const { name, content } = params;

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

    // ── Name header ───────────────────────────────────────────────────────
    doc.font("Helvetica-Bold").fontSize(22).fillColor(DARK).text(name, MARGIN, MARGIN, { width: CONTENT });
    doc.moveTo(MARGIN, doc.y + 8).lineTo(PAGE_W - MARGIN, doc.y + 8)
      .strokeColor(BRAND).lineWidth(1.5).stroke();
    doc.moveDown(1.2);

    // ── Parse and render the AI content ──────────────────────────────────
    // Split into lines; detect section headers (ALL CAPS, ≤ 60 chars, non-empty)
    const isSectionHeader = (line: string): boolean => {
      const t = line.trim();
      if (!t || t.length > 70) return false;
      // Must be mostly uppercase letters (allow spaces, punctuation, digits)
      const letters = t.replace(/[^A-Za-z]/g, "");
      if (!letters.length) return false;
      const upperRatio = (t.replace(/[^A-Z]/g, "").length) / letters.length;
      return upperRatio >= 0.85;
    };

    const lines = content.split("\n");
    let i = 0;
    while (i < lines.length) {
      const raw = lines[i];
      const line = raw.trim();
      i++;

      if (!line) {
        doc.moveDown(0.4);
        continue;
      }

      if (isSectionHeader(line)) {
        doc.moveDown(0.6);
        doc.font("Helvetica-Bold").fontSize(9).fillColor(BRAND).text(line);
        doc.moveTo(MARGIN, doc.y + 2).lineTo(PAGE_W - MARGIN, doc.y + 2)
          .strokeColor(LIGHT).lineWidth(0.8).stroke();
        doc.moveDown(0.5);
        continue;
      }

      // Bullet point
      if (line.startsWith("- ") || line.startsWith("• ") || line.startsWith("* ")) {
        const text = line.slice(2).trim();
        const y = doc.y;
        doc.font("Helvetica").fontSize(10).fillColor(DARK).text("•", MARGIN, y, { width: 12 });
        doc.text(text, MARGIN + 14, y, { width: CONTENT - 14, lineGap: 2 });
        continue;
      }

      // Bold inline (lines that end with a colon, e.g. "Job Title, Company — 2020-2023:")
      doc.font("Helvetica").fontSize(10).fillColor(DARK)
        .text(line, { width: CONTENT, lineGap: 2 });
    }

    // ── Footer ────────────────────────────────────────────────────────────
    const footerY = doc.page.height - MARGIN + 10;
    doc.font("Helvetica").fontSize(7.5).fillColor(MUTED).text(
      `Enhanced by JOBSAGE AI CV Enhancement  ·  ${new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })}`,
      MARGIN, footerY, { width: CONTENT, align: "center" },
    );

    doc.end();
  });
}

// ── POST /profiles/cv-enhancement ─────────────────────────────────────────────
// Body: { documentId: number, mode?: "general"|"focused", focus?: string }
// Downloads the selected CV PDF, parses it, and rewrites with AI.
router.post("/profiles/cv-enhancement", requireAuthenticated, async (req, res): Promise<void> => {
  const userId = req.user!.id;
  const { documentId, mode, focus } = req.body as {
    documentId?: unknown;
    mode?:       unknown;
    focus?:      unknown;
  };

  if (!documentId || typeof documentId !== "number") {
    res.status(400).json({ error: "documentId (number) is required." });
    return;
  }

  const enhMode  = mode === "focused" ? "focused" : "general";
  const focusStr = typeof focus === "string" ? focus.trim() : "";

  if (enhMode === "focused" && !focusStr) {
    res.status(400).json({ error: "A focus prompt is required for focused enhancement." });
    return;
  }

  // Check rate limit
  const { allowed, remaining } = await checkAndIncrementLimit(userId);
  if (!allowed) {
    res.status(429).json({
      error: `Daily limit reached. You can enhance up to ${DAILY_LIMIT} CVs per day. Try again tomorrow.`,
      limitReached: true,
    });
    return;
  }

  try {
    // Fetch the document — must belong to this user and be a CV
    const [doc] = await db
      .select()
      .from(documentsTable)
      .where(
        and(
          eq(documentsTable.id, documentId),
          eq(documentsTable.userId, userId),
          eq(documentsTable.documentType, "cv"),
        ),
      )
      .limit(1);

    if (!doc) {
      res.status(404).json({ error: "CV not found." });
      return;
    }

    if (!doc.storageKey) {
      res.status(400).json({ error: "This CV has no file attached." });
      return;
    }

    // Extract text from the PDF
    const originalText = await extractCvText(doc.storageKey);
    if (!originalText) {
      res.status(400).json({
        error: "Could not extract text from this CV. Make sure it is a searchable (not scanned) PDF.",
      });
      return;
    }

    // Build AI prompt
    const systemPrompt =
      "You are a professional CV writer specialising in UK healthcare and skilled-worker immigration. " +
      "Your job is to rewrite a candidate's CV to make it significantly more impactful and professional — " +
      "while keeping every factual detail exactly as-is: employer names, job titles, dates, qualifications, " +
      "certifications, contact details, and any numbers or statistics. " +
      "Write in UK English. Use strong, active language. Do not invent anything. " +
      "Format the output with clear ALL-CAPS section headers (e.g. PROFESSIONAL SUMMARY, WORK EXPERIENCE, " +
      "EDUCATION, KEY SKILLS, CERTIFICATIONS, LANGUAGES, REFERENCES). " +
      "Return the complete rewritten CV — nothing else, no preamble, no explanations.";

    const userPrompt =
      enhMode === "focused"
        ? `Here is the candidate's current CV. Rewrite it to be significantly better, ` +
          `specifically tailored toward: "${focusStr}". ` +
          `Emphasise the skills and experience most relevant to this focus. ` +
          `Keep all factual details exactly as-is.\n\nCV:\n\n${originalText}`
        : `Here is the candidate's current CV. Rewrite it to be significantly better — ` +
          `stronger language, clearer structure, more professional tone. ` +
          `Keep all factual details exactly as-is.\n\nCV:\n\n${originalText}`;

    const completion = await openai.chat.completions.create({
      model:       "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user",   content: userPrompt },
      ],
      max_tokens:  2000,
      temperature: 0.4,
    });

    const enhancedContent = completion.choices[0]?.message?.content?.trim() ?? "";
    if (!enhancedContent) {
      res.status(500).json({ error: "AI returned an empty response. Please try again." });
      return;
    }

    res.json({
      enhancedContent,
      originalText,
      documentId,
      mode: enhMode,
      focus: focusStr || null,
      remaining,
    });
  } catch (err) {
    console.error("[cv-enhancement] Error:", err);
    res.status(500).json({ error: "Failed to enhance CV." });
  }
});

// ── POST /profiles/cv-enhancement/finalize ────────────────────────────────────
// Body: { editedContent, documentId, setAsPrimary? }
// Generates a PDF from the rewritten content and saves it as a new CV document.
router.post(
  "/profiles/cv-enhancement/finalize",
  requireAuthenticated,
  async (req, res): Promise<void> => {
    const userId    = req.user!.id;
    const firstName = req.user!.firstName;
    const lastName  = req.user!.lastName;

    const { editedContent, documentId, setAsPrimary } = req.body as {
      editedContent?: unknown;
      documentId?:   unknown;
      setAsPrimary?: unknown;
    };

    if (!editedContent || typeof editedContent !== "string" || !editedContent.trim()) {
      res.status(400).json({ error: "editedContent is required." });
      return;
    }

    const docId =
      typeof documentId === "number"
        ? documentId
        : typeof documentId === "string"
        ? parseInt(documentId, 10)
        : null;

    if (!docId || isNaN(docId)) {
      res.status(400).json({ error: "documentId is required." });
      return;
    }

    const makePrimary = setAsPrimary !== false; // default true
    const content     = editedContent.trim();

    try {
      // Fetch the source document to inherit its parsedData
      const [sourceDoc] = await db
        .select()
        .from(documentsTable)
        .where(
          and(
            eq(documentsTable.id, docId),
            eq(documentsTable.userId, userId),
            eq(documentsTable.documentType, "cv"),
          ),
        )
        .limit(1);

      if (!sourceDoc) {
        res.status(404).json({ error: "Source CV not found." });
        return;
      }

      const candidateName =
        [firstName, lastName].filter(Boolean).join(" ").trim() || "Candidate";

      // Generate improved PDF
      const pdfBuffer = await buildRewrittenCvPdf({ name: candidateName, content });

      // Upload to object storage
      const storageKey = await objectStorageSvc.saveFileBuffer({
        buffer:      pdfBuffer,
        contentType: "application/pdf",
      });

      await objectStorageSvc.trySetObjectEntityAclPolicy(storageKey, {
        owner:      userId,
        visibility: "private",
      });

      const dateStr  = new Date().toISOString().slice(0, 10);
      const filename = `Enhanced_CV_${dateStr}.pdf`;

      // Inherit parsedData from the source document, plus update rawNotes with the new content
      const inheritedParsedData = {
        ...((sourceDoc.parsedData as Record<string, unknown> | null) ?? {}),
        rawNotes: content,
      };

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
            parsedData:     inheritedParsedData as any, // eslint-disable-line @typescript-eslint/no-explicit-any
            disclaimerText: DOCUMENT_DISCLAIMER,
          })
          .returning();

        if (!inserted) throw new Error("Document insert returned nothing.");

        if (makePrimary) {
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
