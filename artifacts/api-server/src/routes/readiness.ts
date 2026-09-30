import { Router, type IRouter } from "express";
import { GetReadinessQuotaResponse } from "@workspace/api-zod";
import { getReadinessQuota } from "../lib/readinessQuota";
import { requireAuthenticated } from "../middlewares/requireRole";

const router: IRouter = Router();

router.get("/readiness/quota", requireAuthenticated, async (req, res): Promise<void> => {
  try {
    const snapshot = await getReadinessQuota(req.user!.id);
    res.json(GetReadinessQuotaResponse.parse({
      ...snapshot,
      resetsAt: new Date(snapshot.resetsAt),
    }));
  } catch (err) {
    req.log.error({ err }, "Could not load readiness quota");
    res.status(500).json({ error: "Failed to fetch readiness quota." });
  }
});

export default router;