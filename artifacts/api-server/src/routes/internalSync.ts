import { Router, type Request, type Response } from "express";

const router = Router();

router.post("/internal/sync/register", async (req: Request, res: Response): Promise<void> => {
  const key = process.env["INTERNAL_SYNC_KEY"];
  if (!key || req.headers["x-internal-key"] !== key) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const { runSponsorLicenceSync } = await import("../lib/sponsorLicenceSync");
    await runSponsorLicenceSync("manual");
    res.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: msg });
  }
});

export default router;
