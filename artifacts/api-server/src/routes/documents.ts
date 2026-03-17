import { requireAuthenticated } from "../middlewares/requireRole";
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import { db, documentsTable, DOCUMENT_DISCLAIMER } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import {
  ListMyDocumentsResponse,
  RegisterDocumentBody,
  DeleteDocumentParams,
} from "@workspace/api-zod";
import { ObjectStorageService } from "../lib/objectStorage";

const ALLOWED_MIME_TYPES = ["application/pdf", "image/jpeg", "image/png"];
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
      cb(new Error("File type not allowed. Accepted: PDF, JPEG, PNG."));
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
