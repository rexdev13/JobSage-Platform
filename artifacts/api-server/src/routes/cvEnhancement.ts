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
    // 2-page overflow guard: track pages via the 'pageAdded' event and stop
    // rendering the moment content would spill onto a third page.
    const PAGE_H   = 841.89; // A4 height in points
    const SAFE_END = PAGE_H - MARGIN - 20; // stop 20 pt before the page bottom

    let pageCount = 1;
    let contentTruncated = false;
    doc.on("pageAdded", () => { pageCount++; });

    // True once we are past the safe zone on page 2 or have gone beyond page 2.
    const overLimit = (): boolean =>
      pageCount > 2 || (pageCount === 2 && doc.y > SAFE_END);

    // Detect section headers: ALL CAPS, ≤ 70 chars, ≥ 85 % uppercase letters.
    const isSectionHeader = (line: string): boolean => {
      const t = line.trim();
      if (!t || t.length > 70) return false;
      const letters = t.replace(/[^A-Za-z]/g, "");
      if (!letters.length) return false;
      const upperRatio = (t.replace(/[^A-Z]/g, "").length) / letters.length;
      return upperRatio >= 0.85;
    };

    const lines = content.split("\n");
    let i = 0;
    while (i < lines.length) {
      if (overLimit()) { contentTruncated = true; break; }

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

      // Body text
      doc.font("Helvetica").fontSize(10).fillColor(DARK)
        .text(line, { width: CONTENT, lineGap: 2 });
    }

    if (contentTruncated) {
      console.log("[cv-pdf] Content exceeded 2 pages and was truncated to comply with UK CV standards.");
    }

    // ── No footer — removed to meet UK professional CV presentation standards ──

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
      "You are a senior professional CV writer specialising in UK healthcare and skilled-worker immigration.\n" +
      "Rewrite the candidate's CV to be significantly more impactful using strong UK-standard professional language — " +
      "while keeping every factual detail exactly as-is: employer names, job titles, dates, qualifications, " +
      "certifications, and any numbers or statistics. Write in UK English. Do not invent anything.\n\n" +
      "MANDATORY SECTION ORDER — use these exact ALL-CAPS headings, in this order:\n" +
      "1. PERSONAL STATEMENT  — 3–4 sentences: current level + specialism + key strengths + career direction. " +
      "No first-person 'I'. Do NOT use the heading 'Professional Summary', 'Objective', or any variant.\n" +
      "2. WORK EXPERIENCE     — reverse chronological. Format each role exactly as:\n" +
      "   Job Title | Organisation | City/Region | Mon YYYY – Mon YYYY\n" +
      "   Each role: 2–3 bullet points. Bullets MUST be achievement-led and quantified wherever possible " +
      "(e.g. 'Reduced waiting times by 30%', 'Managed a caseload of 40+ patients'). " +
      "Start every bullet with a strong action verb (e.g. Led, Delivered, Implemented, Achieved).\n" +
      "3. EDUCATION & QUALIFICATIONS — reverse chronological. Degree/Diploma | Institution | Country | Year\n" +
      "4. PROFESSIONAL REGISTRATIONS — e.g. NMC, GMC, HCPC, SRA. Include registration number and current status, " +
      "or state 'In process' / 'Not yet registered' as appropriate.\n" +
      "5. KEY SKILLS          — concise bullet list of 6–10 relevant skills.\n\n" +
      "STRICT RULES:\n" +
      "- Do NOT include: date of birth, age, photograph, nationality, marital status, religion, National Insurance number, " +
      "or full home address. Use city and region only (e.g. 'Manchester, Greater Manchester').\n" +
      "- All dates MUST follow the format Mon YYYY – Mon YYYY (e.g. 'Jan 2021 – Mar 2024'). No year-only ranges.\n" +
      "- End the CV with the heading REFERENCES on its own line, followed by exactly: " +
      "'References: Available upon request.' — never list actual referee names or contact details.\n" +
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
