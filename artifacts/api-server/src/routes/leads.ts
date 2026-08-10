import crypto from "crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { db, socialLeadsTable } from "@workspace/db";
import { openai } from "@workspace/integrations-openai-ai-server";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Validation schema
// ---------------------------------------------------------------------------

const SubmitLeadSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().optional(),
  email: z.string().email("A valid email address is required"),
  phone: z.string().optional(),

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

        status: "new",
      });

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

const LEAD_CHAT_SYSTEM_PROMPT = `You are SAGE, an AI advisor embedded on the JOBSAGE platform. JOBSAGE helps ambitious professionals from around the world find great jobs and relocation pathways in the UK — across all industries and sectors.

Your goal in this conversation is to:
1. Warmly greet the user and learn their name
2. Ask natural qualifying questions one at a time — what sector or industry they work in, what type of role they are looking for, whether they will need UK visa sponsorship, and when they are hoping to make a move
3. Give short, practical, encouraging answers about working in the UK and what the process looks like
4. After 3–5 exchanges, invite the user to leave their contact details (name, email, phone) so the JOBSAGE team can follow up with tailored opportunities

Rules:
- Ask only ONE question per message — never stack multiple questions
- Keep responses concise: 2–3 sentences maximum
- Be warm, professional, and encouraging — you are a trusted career guide, not a form
- You support ALL sectors: technology, finance, healthcare, engineering, education, hospitality, construction, law, retail, and more
- For visa and immigration: most skilled workers from overseas need a Skilled Worker visa sponsored by a UK employer who holds a sponsor licence; points-based system applies
- Never give definitive immigration or legal advice — always recommend they seek professional advice for their specific situation
- Collect the user's name and email naturally if they volunteer it — do not demand it early
- Do not ask the user to leave their details until you have asked at least 3 qualifying questions`;

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
