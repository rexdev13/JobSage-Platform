import { Router, type IRouter, type Request, type Response } from "express";
import { db, documentsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import {
  ListMyDocumentsResponse,
  RegisterDocumentBody,
  DeleteDocumentParams,
} from "@workspace/api-zod";

const ALLOWED_MIME_TYPES = ["application/pdf", "image/jpeg", "image/png"];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

const router: IRouter = Router();

router.get("/documents", async (req: Request, res: Response): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const docs = await db
    .select()
    .from(documentsTable)
    .where(eq(documentsTable.userId, req.user.id));

  res.json(ListMyDocumentsResponse.parse({ documents: docs }));
});

router.post("/documents", async (req: Request, res: Response): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parsed = RegisterDocumentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { filename, mimeType, objectPath, fileSize } = parsed.data;

  if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
    res.status(400).json({ error: "File type not allowed. Accepted: PDF, JPEG, PNG." });
    return;
  }

  if (fileSize && fileSize > MAX_FILE_SIZE) {
    res.status(400).json({ error: "File exceeds maximum size of 5 MB." });
    return;
  }

  const [doc] = await db
    .insert(documentsTable)
    .values({
      userId: req.user.id,
      filename,
      mimeType,
      objectPath,
      fileSize: fileSize ?? null,
    })
    .returning();

  res.status(201).json(doc);
});

router.delete("/documents/:id", async (req: Request, res: Response): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const params = DeleteDocumentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid document ID" });
    return;
  }

  const [deleted] = await db
    .delete(documentsTable)
    .where(and(eq(documentsTable.id, params.data.id), eq(documentsTable.userId, req.user.id)))
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;
