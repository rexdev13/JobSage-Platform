import { Router, type IRouter, type Request, type Response } from "express";
import { db, identityVerificationsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuthenticated, requireRole } from "../middlewares/requireRole";
import { ObjectStorageService } from "../lib/objectStorage";
import { openai } from "@workspace/integrations-openai-ai-server";

const router: IRouter = Router();
const storage = new ObjectStorageService();

router.get("/identity/status", requireAuthenticated, async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.id;
  const [record] = await db
    .select()
    .from(identityVerificationsTable)
    .where(eq(identityVerificationsTable.userId, userId));
  res.json({ verification: record ?? null });
});

router.post("/identity/submit", requireAuthenticated, async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.id;
  const { passportKey, selfieKey } = req.body as { passportKey?: string; selfieKey?: string };

  if (!passportKey || !selfieKey) {
    res.status(400).json({ error: "passportKey and selfieKey are required" });
    return;
  }

  const [existing] = await db
    .select()
    .from(identityVerificationsTable)
    .where(eq(identityVerificationsTable.userId, userId));

  if (existing?.status === "verified") {
    res.status(400).json({ error: "Identity already verified" });
    return;
  }

  const [record] = await db
    .insert(identityVerificationsTable)
    .values({ userId, passportKey, selfieKey, status: "pending" })
    .onConflictDoUpdate({
      target: identityVerificationsTable.userId,
      set: { passportKey, selfieKey, status: "pending", aiConfidence: null, aiNotes: null, verifiedAt: null },
    })
    .returning();

  res.json(record);

  setImmediate(() => {
    void runAiVerification(record.id, passportKey, selfieKey);
  });
});

async function runAiVerification(recordId: number, passportKey: string, selfieKey: string) {
  try {
    const passportGcsFile = await storage.getObjectEntityFile(passportKey);
    const selfieGcsFile = await storage.getObjectEntityFile(selfieKey);

    const passportResponse = await storage.downloadObject(passportGcsFile);
    const selfieResponse = await storage.downloadObject(selfieGcsFile);

    const passportBuf = Buffer.from(await passportResponse.arrayBuffer());
    const selfieBuf = Buffer.from(await selfieResponse.arrayBuffer());

    const passportB64 = passportBuf.toString("base64");
    const selfieB64 = selfieBuf.toString("base64");

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `You are an identity verification assistant. Compare the face in a passport/ID document photo with a selfie photo.
Return ONLY a JSON object: { "faceMatch": true/false, "confidence": "high"|"medium"|"low"|"none", "notes": "brief explanation max 100 chars", "documentType": "passport"|"id_card"|"other"|"unclear" }`,
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Compare these two images. Image 1 is an identity document, Image 2 is a selfie. Do the faces match?" },
            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${passportB64}`, detail: "high" } },
            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${selfieB64}`, detail: "high" } },
          ],
        },
      ],
      max_tokens: 200,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const parsed = jsonMatch ? (JSON.parse(jsonMatch[0]) as { faceMatch?: boolean; confidence?: string; notes?: string }) : {};

    const confidence = (parsed.confidence ?? "none") as "high" | "medium" | "low" | "none";
    const autoVerify = parsed.faceMatch === true && confidence === "high";

    await db
      .update(identityVerificationsTable)
      .set({
        status: autoVerify ? "verified" : "pending",
        aiConfidence: confidence,
        aiNotes: parsed.notes ?? null,
        verifiedAt: autoVerify ? new Date() : null,
      })
      .where(eq(identityVerificationsTable.id, recordId));
  } catch (err) {
    console.error("[identity] AI verification failed:", err);
    await db
      .update(identityVerificationsTable)
      .set({ aiNotes: "AI check failed — pending manual review", aiConfidence: "none" })
      .where(eq(identityVerificationsTable.id, recordId));
  }
}

router.patch("/admin/identity/:id", requireRole("admin", "super_admin"), async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const { status, adminNotes } = req.body as { status?: string; adminNotes?: string };
  if (!status || !["verified", "rejected", "pending"].includes(status)) {
    res.status(400).json({ error: "status must be verified, rejected, or pending" }); return;
  }

  const [updated] = await db
    .update(identityVerificationsTable)
    .set({
      status: status as "verified" | "rejected" | "pending",
      adminNotes: adminNotes ?? null,
      verifiedAt: status === "verified" ? new Date() : null,
    })
    .where(eq(identityVerificationsTable.id, id))
    .returning();

  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json(updated);
});

router.get("/admin/identity", requireRole("admin", "super_admin"), async (req: Request, res: Response): Promise<void> => {
  const records = await db
    .select()
    .from(identityVerificationsTable)
    .orderBy(identityVerificationsTable.createdAt);
  res.json({ verifications: records });
});

export default router;
