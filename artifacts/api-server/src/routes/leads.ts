import crypto from "crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { db, socialLeadsTable, sponsorLicencesTable } from "@workspace/db";
import { openai } from "@workspace/integrations-openai-ai-server";
import { sql, ilike, or, desc, count, eq, and } from "drizzle-orm";
import { requireRole } from "../middlewares/requireRole";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Validation schema
// ---------------------------------------------------------------------------

const SubmitLeadSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  email: z.string().email("A valid email address is required"),
  phone: z.string().min(1, "Phone number is required"),

  // Qualifying questions (generic — all sectors)
  industrySector: z.string().optional(),
  desiredRole: z.string().optional(),
  additionalMessage: z.string().optional(),

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
// GET /api/leads — paginated list of waitlist submissions (admin only)
// ---------------------------------------------------------------------------

router.get(
  "/leads",
  requireRole("admin", "super_admin"),
  async (req: Request, res: Response): Promise<void> => {
    const page  = Math.max(1, parseInt(String(req.query.page  ?? "1"),  10));
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? "25"), 10)));
    const search = String(req.query.search ?? "").trim();
    const offset = (page - 1) * limit;

    const where = search
      ? or(
          ilike(socialLeadsTable.email,     `%${search}%`),
          ilike(socialLeadsTable.firstName, `%${search}%`),
          ilike(socialLeadsTable.lastName,  `%${search}%`),
        )
      : undefined;

    const [[{ total }], leads] = await Promise.all([
      db.select({ total: count() }).from(socialLeadsTable).where(where),
      db
        .select()
        .from(socialLeadsTable)
        .where(where)
        .orderBy(desc(socialLeadsTable.createdAt))
        .limit(limit)
        .offset(offset),
    ]);

    res.json({ leads, total, page, limit });
  },
);

// ---------------------------------------------------------------------------
// GET /api/leads/sectors — distinct sponsor-licence industries for the dropdown
// Public, no auth required. Results are stable enough to cache for 1 hour.
// ---------------------------------------------------------------------------

router.get(
  "/leads/sectors",
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const rows = await db
        .selectDistinct({ industry: sponsorLicencesTable.industry })
        .from(sponsorLicencesTable)
        .where(sql`${sponsorLicencesTable.industry} IS NOT NULL AND ${sponsorLicencesTable.industry} != 'Other'`)
        .orderBy(sponsorLicencesTable.industry);

      const sectors = rows
        .map((r) => r.industry)
        .filter((v): v is string => typeof v === "string" && v.trim() !== "");

      // Always append "Other" as the last option
      sectors.push("Other");

      res.setHeader("Cache-Control", "public, max-age=3600");
      res.json({ sectors });
    } catch (err) {
      console.error("[leads] GET /leads/sectors error:", err);
      res.status(500).json({ error: "Could not load sector list." });
    }
  },
);

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

      // If a partial chat lead already exists for this email, upgrade it to a
      // full form submission rather than creating a duplicate record.
      const [existingChatLead] = await db
        .select({ id: socialLeadsTable.id })
        .from(socialLeadsTable)
        .where(
          and(
            eq(socialLeadsTable.email, d.email.toLowerCase()),
            eq(socialLeadsTable.source, "chat"),
          ),
        )
        .limit(1);

      if (existingChatLead) {
        await db
          .update(socialLeadsTable)
          .set({
            firstName: d.firstName,
            lastName: d.lastName,
            phone: d.phone,
            industrySector: d.industrySector ?? null,
            desiredRole: d.desiredRole ?? null,
            additionalMessage: d.additionalMessage ?? null,
            utmSource: d.utmSource ?? null,
            utmMedium: d.utmMedium ?? null,
            utmCampaign: d.utmCampaign ?? null,
            utmContent: d.utmContent ?? null,
            landingPath: d.landingPath ?? null,
            referrerUrl: d.referrerUrl ?? null,
            ipHash,
            gdprConsent: d.gdprConsent,
            gdprConsentedAt: now,
            source: "form",
            status: "new",
          })
          .where(eq(socialLeadsTable.id, existingChatLead.id));
      } else {
        await db.insert(socialLeadsTable).values({
          firstName: d.firstName,
          lastName: d.lastName,
          email: d.email.toLowerCase(),
          phone: d.phone,

          industrySector: d.industrySector ?? null,
          desiredRole: d.desiredRole ?? null,
          additionalMessage: d.additionalMessage ?? null,

          utmSource: d.utmSource ?? null,
          utmMedium: d.utmMedium ?? null,
          utmCampaign: d.utmCampaign ?? null,
          utmContent: d.utmContent ?? null,
          landingPath: d.landingPath ?? null,
          referrerUrl: d.referrerUrl ?? null,

          ipHash,
          gdprConsent: d.gdprConsent,
          gdprConsentedAt: now,

          source: "form",
          status: "new",
        });
      }

      res.status(201).json({ success: true });
    } catch (err) {
      console.error("[leads] POST /leads/submit error:", err);
      res.status(500).json({ error: "Failed to submit your details. Please try again." });
    }
  },
);

// ---------------------------------------------------------------------------
// POST /api/leads/chat — public SSE streaming chat for /get-started
// Uses gpt-4o-mini. No auth required (pre-registration lead capture).
// ---------------------------------------------------------------------------

const LEAD_CHAT_SYSTEM_PROMPT = `You are SAGE, a friendly advisor on the JOBSAGE platform. JOBSAGE helps professionals from around the world find jobs and UK relocation pathways across all industries.

Your primary goal is to collect the user's first name, last name, email address, and phone number. You can also ask what sector they work in. That is it.

STRICT FORMATTING RULES — follow these without exception:
No markdown of any kind. No bullet points, no bold text, no asterisks, no numbered lists, no headers. Plain sentences only.
UNDER NO CIRCUMSTANCES are you allowed to use dashes (-) or em-dashes (—) in your responses. Use commas for pauses. Write in a continuous, flowing conversational text.
Write exactly like a real person texting on WhatsApp. Short sentences. Casual and warm. Natural transitions between topics.
Never ask for all information at once. Gather it one or two pieces at a time through natural conversation.
Never use a list to present options or steps. Just talk.

How to run the conversation:
Start by asking for their first name. Once you have it use it naturally.
After their name, ask for their last name.
Then get their email. Then their phone number.
You can weave in a casual question about their sector somewhere along the way if it feels natural.
Keep each message to one or two short sentences max.
Be warm and encouraging. Sound human not robotic.

If the user asks about UK jobs, sponsorship, or visas give a brief honest answer in plain conversational language then gently steer back to collecting their details.
Never give legal or immigration advice. If they need specifics suggest they speak to an immigration advisor.`;


router.post(
  "/leads/chat",
  async (req: Request, res: Response): Promise<void> => {
    const { message, history } = req.body as {
      message?: string;
      history?: Array<{ role: "user" | "assistant"; content: string }>;
    };

    if (!message?.trim()) {
      res.status(400).json({ error: "message is required." });
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    try {
      const chatHistory = (history ?? []).slice(-12); // keep last 12 turns for context

      const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
        { role: "system", content: LEAD_CHAT_SYSTEM_PROMPT },
        ...chatHistory.map((m) => ({ role: m.role, content: m.content })),
        { role: "user", content: message.trim() },
      ];

      // Stream the conversational response
      const stream = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        max_completion_tokens: 300,
        stream: true,
        messages,
      });

      let fullContent = "";
      for await (const chunk of stream) {
        const text = chunk.choices[0]?.delta?.content ?? "";
        if (text) {
          fullContent += text;
          res.write(`data: ${JSON.stringify({ text })}\n\n`);
        }
      }

      // After streaming, extract structured qualifying data from the full conversation.
      // Only run the extraction once we have at least 2 user turns (enough signal).
      const userTurns = chatHistory.filter((m) => m.role === "user").length + 1;
      let extracted: Record<string, string | null> = {};

      if (userTurns >= 2) {
        try {
          const fullConversation = [
            ...chatHistory,
            { role: "user", content: message.trim() },
            { role: "assistant", content: fullContent },
          ]
            .map((m) => `${m.role === "user" ? "User" : "AI"}: ${m.content}`)
            .join("\n");

          const extractResp = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            max_completion_tokens: 150,
            messages: [
              {
                role: "system",
                content: `Extract contact and qualifying data from this conversation. Return ONLY valid JSON. Only include fields the user has clearly stated — omit fields that are uncertain or not mentioned. Use null for omitted fields.

{
  "name": "<user's full name or null>",
  "email": "<user's email address or null>",
  "phone": "<user's phone number or null>",
  "industrySector": "<sector or industry they work in or are interested in, or null>",
  "desiredRole": "<specific role or job title they are targeting or null>"
}`,
              },
              { role: "user", content: fullConversation },
            ],
            response_format: { type: "json_object" },
          });

          const raw = extractResp.choices[0]?.message?.content ?? "{}";
          const parsed = JSON.parse(raw) as Record<string, string | null>;
          // Only keep fields with non-null values
          extracted = Object.fromEntries(
            Object.entries(parsed).filter(([, v]) => v !== null && v !== ""),
          );
        } catch {
          // extraction failure is non-critical — continue without it
        }
      }

      // Persist a partial chat lead when we have at least a name + email.
      // This ensures candidates who chat but never submit the form are still captured.
      // If they later submit the full form, /leads/submit will upgrade this record.
      if (extracted.name && extracted.email) {
        try {
          const nameParts = String(extracted.name).trim().split(/\s+/);
          const firstName = nameParts[0] ?? "";
          const lastName = nameParts.slice(1).join(" ") || "";
          const email = String(extracted.email).toLowerCase();

          // Only create a chat lead if no record already exists for this email
          const [existing] = await db
            .select({ id: socialLeadsTable.id })
            .from(socialLeadsTable)
            .where(eq(socialLeadsTable.email, email))
            .limit(1);

          if (!existing) {
            await db.insert(socialLeadsTable).values({
              firstName,
              lastName,
              email,
              phone: extracted.phone ? String(extracted.phone) : "",
              industrySector: extracted.industrySector ? String(extracted.industrySector) : null,
              desiredRole: extracted.desiredRole ? String(extracted.desiredRole) : null,
              gdprConsent: false,
              gdprConsentedAt: new Date(),
              source: "chat",
              status: "new",
            });
          }
        } catch (saveErr) {
          // Non-critical — don't let a DB error break the chat stream
          console.error("[leads/chat] partial lead save error:", saveErr);
        }
      }

      res.write(`data: ${JSON.stringify({ done: true, extracted })}\n\n`);
      res.end();
    } catch (err) {
      console.error("[leads/chat] SSE error:", err);
      res.write(`data: ${JSON.stringify({ error: "AI service unavailable. Please try again." })}\n\n`);
      res.end();
    }
  },
);

export default router;
