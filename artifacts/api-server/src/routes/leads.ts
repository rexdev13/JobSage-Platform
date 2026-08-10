import crypto from "crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { db, socialLeadsTable } from "@workspace/db";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Validation schema
// ---------------------------------------------------------------------------

const SubmitLeadSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().optional(),
  email: z.string().email("A valid email address is required"),
  phone: z.string().optional(),

  // Qualifying questions
  profession: z.string().optional(),
  qualificationCountry: z.string().optional(),
  registrationStatus: z.string().optional(),
  requiresSponsorship: z.string().optional(),
  specialty: z.string().optional(),
  timeline: z.string().optional(),
  biggestChallenge: z.array(z.string()).optional(),

  // UTM / attribution — client sends these from its own URL bar
  utmSource: z.string().optional(),
  utmMedium: z.string().optional(),
  utmCampaign: z.string().optional(),
  utmContent: z.string().optional(),
  landingPath: z.string().optional(),
  referrerUrl: z.string().optional(),

  // Consent — must be true; literal(true) rejects false/missing
  gdprConsent: z.literal(true, {
    errorMap: () => ({ message: "GDPR consent is required to submit this form" }),
  }),
});

// ---------------------------------------------------------------------------
// POST /api/leads/submit — public, no auth required
// ---------------------------------------------------------------------------

router.post(
  "/leads/submit",
  async (req: Request, res: Response): Promise<void> => {
    const parsed = SubmitLeadSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: parsed.error.issues[0]?.message ?? "Invalid submission",
      });
      return;
    }

    try {
      const d = parsed.data;

      // Hash the client IP for dedup/geo without storing PII.
      // Same approach as consent_logs.ip_hash.
      const rawIp =
        (req.headers["x-forwarded-for"] as string | undefined)
          ?.split(",")[0]
          ?.trim() ??
        req.socket.remoteAddress ??
        "";
      const ipHash = crypto.createHash("sha256").update(rawIp).digest("hex");

      const now = new Date();

      await db.insert(socialLeadsTable).values({
        firstName: d.firstName,
        lastName: d.lastName ?? null,
        email: d.email,
        phone: d.phone ?? null,

        profession: d.profession ?? null,
        qualificationCountry: d.qualificationCountry ?? null,
        registrationStatus: d.registrationStatus ?? null,
        requiresSponsorship: d.requiresSponsorship ?? null,
        specialty: d.specialty ?? null,
        timeline: d.timeline ?? null,
        // text[].array() columns require `as any` — see Drizzle array column note
        biggestChallenge: (d.biggestChallenge ?? []) as any,

        utmSource: d.utmSource ?? null,
        utmMedium: d.utmMedium ?? null,
        utmCampaign: d.utmCampaign ?? null,
        utmContent: d.utmContent ?? null,
        landingPath: d.landingPath ?? null,
        referrerUrl: d.referrerUrl ?? null,

        ipHash,
        gdprConsent: d.gdprConsent,
        gdprConsentedAt: now,

        status: "new",
      });

      res.status(201).json({ success: true });
    } catch (err) {
      console.error("[leads] POST /leads/submit error:", err);
      res.status(500).json({ error: "Failed to submit your details. Please try again." });
    }
  },
);

export default router;
