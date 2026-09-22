import { requireAuthenticated } from "../middlewares/requireRole";
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import { db, documentsTable, careerProfilesTable, DOCUMENT_DISCLAIMER, DOCUMENT_TYPES } from "@workspace/db";
import type { DocumentType } from "@workspace/db";
import { eq, and, isNotNull } from "drizzle-orm";
import {
  ListMyDocumentsResponse,
  RegisterDocumentBody,
  DeleteDocumentParams,
} from "@workspace/api-zod";
import { ObjectStorageService } from "../lib/objectStorage";
import { extractCvFields } from "../lib/cvParser";

const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("File type not allowed. Accepted: PDF, JPEG, PNG, DOC, DOCX, TXT."));
    }
  },
});

router.get("/documents", requireAuthenticated, async (req: Request, res: Response): Promise<void> => {
  const docs = await db
    .select()
    .from(documentsTable)
    .where(eq(documentsTable.userId, req.user!.id));

  res.json(ListMyDocumentsResponse.parse({ documents: docs }));
});

router.post(
  "/documents/upload",
  requireAuthenticated,
  (req: Request, res: Response, next: NextFunction): void => {
    upload.single("file")(req, res, (err) => {
      if (err) {
        if (err.code === "LIMIT_FILE_SIZE") {
          res.status(400).json({ error: "File exceeds maximum size of 5 MB." });
          return;
        }
        res.status(400).json({ error: err.message ?? "File upload error" });
        return;
      }
      next();
    });
  },
  async (req: Request, res: Response): Promise<void> => {
    if (!req.file) {
      res.status(400).json({ error: "No file provided" });
      return;
    }

    try {
      const storageKey = await objectStorageService.saveFileBuffer({
        buffer: req.file.buffer,
        contentType: req.file.mimetype,
      });

      // Write ACL so the owner can download their file via GET /storage/objects/*
      try {
        await objectStorageService.trySetObjectEntityAclPolicy(storageKey, {
          owner: req.user!.id,
          visibility: "private",
        });
      } catch (aclErr) {
        console.error("Document ACL write failed (multipart upload):", aclErr);
      }

      const [doc] = await db
        .insert(documentsTable)
        .values({
          userId: req.user!.id,
          filename: req.file.originalname,
          mimeType: req.file.mimetype,
          storageKey,
          fileSize: req.file.size,
          disclaimerText: DOCUMENT_DISCLAIMER,
        })
        .returning();

      res.status(201).json(doc);
    } catch (err) {
      console.error("Document upload error:", err);
      res.status(500).json({ error: "Failed to upload document" });
    }
  },
);

router.post("/documents", requireAuthenticated, async (req: Request, res: Response): Promise<void> => {
  const parsed = RegisterDocumentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { filename, mimeType, storageKey, fileSize } = parsed.data;

  if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
    res.status(400).json({ error: "File type not allowed. Accepted: PDF, JPEG, PNG." });
    return;
  }

  if (fileSize && fileSize > MAX_FILE_SIZE) {
    res.status(400).json({ error: "File exceeds maximum size of 5 MB." });
    return;
  }

  // Validate that the storageKey belongs to the expected private uploads namespace
  if (!storageKey.startsWith("/objects/uploads/")) {
    res.status(400).json({ error: "Invalid storage key. Must be obtained from the presigned upload URL endpoint." });
    return;
  }

  // Write ACL so the owner can download their file via GET /storage/objects/*
  try {
    await objectStorageService.trySetObjectEntityAclPolicy(storageKey, {
      owner: req.user!.id,
      visibility: "private",
    });
  } catch (aclErr) {
    console.error("Document ACL write failed (presigned upload):", aclErr);
  }

  const [doc] = await db
    .insert(documentsTable)
    .values({
      userId: req.user!.id,
      filename,
      mimeType,
      storageKey,
      fileSize: fileSize ?? null,
      disclaimerText: DOCUMENT_DISCLAIMER,
    })
    .returning();

  res.status(201).json(doc);
});

router.post("/documents/:id/parse-cv", requireAuthenticated, async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid document ID" });
    return;
  }

  const [doc] = await db
    .select()
    .from(documentsTable)
    .where(and(eq(documentsTable.id, id), eq(documentsTable.userId, req.user!.id)));

  if (!doc) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  const allowedMimes = ["application/pdf", "image/jpeg", "image/png"];
  if (!allowedMimes.includes(doc.mimeType)) {
    res.status(400).json({ error: "Only PDF and image files can be parsed." });
    return;
  }

  try {
    const objectFile = await objectStorageService.getObjectEntityFile(doc.storageKey);
    const [buffer] = await objectFile.download();
    const extracted = await extractCvFields(buffer as Buffer, doc.mimeType);
    res.json({ extracted });
  } catch (err) {
    console.error("CV parse error:", err);
    const message =
      err instanceof Error
        ? err.message
        : "Failed to parse CV. Please try again.";
    res.status(422).json({ error: message });
  }
});

router.patch("/documents/:id/label", requireAuthenticated, async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid document ID" });
    return;
  }

  const { label, isPrimary } = req.body as { label?: string | null; isPrimary?: boolean };
  const userId = req.user!.id;

  const [existing] = await db
    .select()
    .from(documentsTable)
    .where(and(eq(documentsTable.id, id), eq(documentsTable.userId, userId)));

  if (!existing) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  // isPrimary can only be set on CV documents
  if (isPrimary === true && existing.documentType !== "cv") {
    res.status(400).json({ error: "Only CV documents can be marked as primary." });
    return;
  }

  const updates: { label?: string | null; isPrimary?: boolean } = {};
  if (label !== undefined) updates.label = label ?? null;
  if (isPrimary !== undefined) updates.isPrimary = isPrimary;

  // When marking as primary, wrap both updates in a transaction so we can
  // never end up with zero or two simultaneous primary CVs for a user.
  if (isPrimary === true) {
    const [updated] = await db.transaction(async (tx) => {
      await tx
        .update(documentsTable)
        .set({ isPrimary: false })
        .where(and(eq(documentsTable.userId, userId), eq(documentsTable.documentType, "cv")));

      return tx
        .update(documentsTable)
        .set(updates)
        .where(and(eq(documentsTable.id, id), eq(documentsTable.userId, userId)))
        .returning();
    });

    res.json(updated);
    return;
  }

  const [updated] = await db
    .update(documentsTable)
    .set(updates)
    .where(and(eq(documentsTable.id, id), eq(documentsTable.userId, userId)))
    .returning();

  res.json(updated);
});

router.patch("/documents/:id/type", requireAuthenticated, async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid document ID" });
    return;
  }

  const { documentType } = req.body as { documentType: string | null };

  if (documentType !== null && !DOCUMENT_TYPES.includes(documentType as DocumentType)) {
    res.status(400).json({ error: `Invalid document type. Allowed: ${DOCUMENT_TYPES.join(", ")}` });
    return;
  }

  const [updated] = await db
    .update(documentsTable)
    .set({ documentType: documentType ?? null })
    .where(and(eq(documentsTable.id, id), eq(documentsTable.userId, req.user!.id)))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  res.json(updated);
});

router.patch("/documents/:id/save-parsed", requireAuthenticated, async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid document ID" });
    return;
  }

  const userId = req.user!.id;
  const { parsedData } = req.body as { parsedData?: Record<string, unknown> | null };

  if (parsedData === undefined) {
    res.status(400).json({ error: "parsedData is required" });
    return;
  }

  const [existing] = await db
    .select({ id: documentsTable.id, parsedData: documentsTable.parsedData })
    .from(documentsTable)
    .where(and(eq(documentsTable.id, id), eq(documentsTable.userId, userId)));

  if (!existing) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  const [updated] = await db
    .update(documentsTable)
    .set({ parsedData } as any)
    .where(and(eq(documentsTable.id, id), eq(documentsTable.userId, userId)))
    .returning();

  // A source-CV confirmation can change Maker evidence even when the merged
  // profile values remain the same. Invalidate only drafts that used this CV,
  // preserving their text for candidate review or regeneration.
  if (JSON.stringify(existing.parsedData ?? null) !== JSON.stringify(parsedData ?? null)) {
    await db
      .update(careerProfilesTable)
      .set({ aiCvReviewedAt: null })
      .where(
        and(
          eq(careerProfilesTable.userId, userId),
          eq(careerProfilesTable.aiCvSourceDocumentId, id),
          isNotNull(careerProfilesTable.aiCvContent),
        ),
      );
  }

  res.json(updated);
});

router.delete("/documents/:id", requireAuthenticated, async (req: Request, res: Response): Promise<void> => {
  const params = DeleteDocumentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid document ID" });
    return;
  }

  const [deleted] = await db
    .delete(documentsTable)
    .where(and(eq(documentsTable.id, params.data.id), eq(documentsTable.userId, req.user!.id)))
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;
