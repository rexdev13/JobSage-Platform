/**
 * Inbound email webhook for JOBSAGE aliases (@mail.jobsage.co.uk).
 *
 * Resend delivers inbound emails to this endpoint when an employer replies
 * to a candidate's JOBSAGE alias. The handler:
 *   1. Verifies the Svix webhook signature (using INBOUND_EMAIL_WEBHOOK_SECRET).
 *   2. Resolves the recipient alias to a candidate user.
 *   3. Deduplicates repeated deliveries via Resend's message ID.
 *   4. Inserts the reply as a candidateMessages inbox entry.
 *   5. Matches the reply to any open speculative application from the sender's domain.
 *   6. Classifies the reply (interview / rejection / offer / acknowledged) and
 *      advances the application status.
 *   7. Notifies the candidate via email.
 *
 * Required setup: see docs/inbound-email-setup.md
 */

import { Router, type Request, type Response } from "express";
import { Webhook } from "svix";
import { db } from "@workspace/db";
import {
  candidateMessagesTable,
  speculativeApplicationsTable,
  usersTable,
  profilesTable,
} from "@workspace/db";
import { eq, and, or } from "drizzle-orm";
import { sendEmployerReplyNotification } from "../lib/email";

const router = Router();

// ---------------------------------------------------------------------------
// Signature verification
// ---------------------------------------------------------------------------

/**
 * Verify an inbound Resend webhook using Svix-signed headers.
 * Returns the parsed payload on success, throws on failure.
 *
 * In development (NODE_ENV !== 'production') the secret may be omitted —
 * the request is logged as unauthenticated and processing continues.
 * In production the secret is REQUIRED; missing it causes a hard 401.
 */
function verifySvixSignature(
  rawBody: Buffer,
  headers: Record<string, string | string[] | undefined>,
  secret: string | undefined,
): unknown {
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("INBOUND_EMAIL_WEBHOOK_SECRET is required in production");
    }
    console.warn(
      "[inbound-email] INBOUND_EMAIL_WEBHOOK_SECRET is not set — skipping signature verification (dev/test only)",
    );
    // Return undefined to signal "not verified" — caller must JSON.parse body itself
    return undefined;
  }

  const wh = new Webhook(secret);
  // Svix requires string headers
  const svixHeaders: Record<string, string> = {};
  for (const key of ["svix-id", "svix-timestamp", "svix-signature"]) {
    const val = headers[key];
    if (val) svixHeaders[key] = Array.isArray(val) ? val[0]! : val;
  }

  // wh.verify() returns the parsed payload or throws on bad signature
  return wh.verify(rawBody.toString("utf8"), svixHeaders);
}

// ---------------------------------------------------------------------------
// Rate limiting — simple in-memory store per sender email (max 20/min)
// ---------------------------------------------------------------------------
const senderHits = new Map<string, { count: number; windowStart: number }>();

function checkSenderRateLimit(senderEmail: string): boolean {
  const now = Date.now();
  const windowMs = 60_000;
  const maxPerWindow = 20;

  const entry = senderHits.get(senderEmail);
  if (!entry || now - entry.windowStart > windowMs) {
    senderHits.set(senderEmail, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= maxPerWindow) return false;
  entry.count++;
  return true;
}

// ---------------------------------------------------------------------------
// Email classification — lightweight keyword matching
// ---------------------------------------------------------------------------
const INTERVIEW_KEYWORDS = [
  "interview",
  "meeting",
  "schedule",
  "invite",
  "invited",
  "appointment",
  "speak with you",
  "discuss",
  "call with",
  "video call",
  "teams meeting",
  "zoom",
  "microsoft teams",
  "google meet",
];

const REJECTION_KEYWORDS = [
  "unfortunately",
  "not successful",
  "not taken forward",
  "unable to offer",
  "other candidates",
  "position has been filled",
  "not progressing",
  "regret to inform",
  "no longer proceeding",
  "unsuccessful",
  "won't be moving forward",
  "will not be moving forward",
];

const OFFER_KEYWORDS = [
  "pleased to offer",
  "job offer",
  "offer of employment",
  "formal offer",
  "we would like to offer you",
];

// Headers that indicate auto-replies — skip keyword classification for these
const AUTO_REPLY_HEADERS = ["auto-submitted", "x-autoreply", "x-auto-response-suppress", "x-autoresponder"];

type ReplyCategory = "interview_invited" | "rejected" | "offer" | "acknowledged";

function classifyReply(subject: string, body: string, rawHeaders?: Array<{ name: string; value: string }> | Record<string, string>): ReplyCategory {
  // Detect OOO / auto-reply headers → always acknowledged (never reject on keyword)
  if (rawHeaders) {
    if (Array.isArray(rawHeaders)) {
      if (rawHeaders.some((h) => AUTO_REPLY_HEADERS.includes(h.name.toLowerCase()))) {
        return "acknowledged";
      }
    } else {
      if (Object.keys(rawHeaders).some((k) => AUTO_REPLY_HEADERS.includes(k.toLowerCase()))) {
        return "acknowledged";
      }
    }
  }

  // Detect OOO subject lines (common pattern)
  const subjectLower = subject.toLowerCase();
  if (/\b(out of office|out of the office|automatic reply|auto.?reply)\b/i.test(subjectLower)) {
    return "acknowledged";
  }

  const text = `${subject} ${body}`.toLowerCase();

  // Offer takes precedence (very specific phrasing)
  if (OFFER_KEYWORDS.some((k) => text.includes(k))) return "offer";
  // Rejection next
  if (REJECTION_KEYWORDS.some((k) => text.includes(k))) return "rejected";
  // Interview
  if (INTERVIEW_KEYWORDS.some((k) => text.includes(k))) return "interview_invited";
  return "acknowledged";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract the plain email address from a "Name <email>" string */
function parseEmailAddress(raw: string): { name: string; email: string } {
  const match = raw.match(/^(.*?)\s*<([^>]+)>$/);
  if (match) {
    return { name: match[1]!.trim().replace(/^"|"$/g, ""), email: match[2]!.trim().toLowerCase() };
  }
  return { name: "", email: raw.trim().toLowerCase() };
}

/** Extract the domain from an email address */
function emailDomain(email: string): string {
  return email.split("@")[1]?.toLowerCase() ?? "";
}

/** Strip common email threading prefixes from subject */
function cleanSubject(subject: string): string {
  return subject.replace(/^(re|fw|fwd):\s*/i, "").trim();
}

/** Truncate body to a reasonable inbox display length, stripping quoted text */
function truncateBody(text: string, maxLen = 4000): string {
  if (!text) return "";
  const stripped = text
    .split("\n")
    .filter((line) => !line.trimStart().startsWith(">"))
    .join("\n")
    .trim();
  return stripped.length <= maxLen ? stripped : stripped.slice(0, maxLen) + "\n\n[Message truncated]";
}

// ---------------------------------------------------------------------------
// Resend inbound email payload types
// ---------------------------------------------------------------------------
interface ResendInboundPayload {
  type?: string;
  created_at?: string;
  data?: {
    from?: string;
    to?: string | string[];
    subject?: string;
    text?: string;
    html?: string;
    headers?: Array<{ name: string; value: string }> | Record<string, string>;
    messageId?: string;
    message_id?: string;
    attachments?: unknown[];
  };
  // Resend may also send the fields at the top level for some webhook versions
  from?: string;
  to?: string | string[];
  subject?: string;
  text?: string;
  headers?: Array<{ name: string; value: string }> | Record<string, string>;
  messageId?: string;
  message_id?: string;
}

function extractField<T>(
  payload: ResendInboundPayload,
  field: keyof ResendInboundPayload & keyof NonNullable<ResendInboundPayload["data"]>,
): T {
  const nested = payload.data?.[field as keyof typeof payload.data];
  const topLevel = payload[field as keyof typeof payload];
  return (nested ?? topLevel) as T;
}

function extractMessageId(payload: ResendInboundPayload): string | null {
  const fromData = payload.data?.messageId ?? payload.data?.message_id;
  const fromTop = payload.messageId ?? payload.message_id;
  const id = fromData ?? fromTop;
  if (id) return String(id);

  const headers = payload.data?.headers ?? payload.headers;
  if (Array.isArray(headers)) {
    const h = headers.find((h) => h.name.toLowerCase() === "message-id");
    if (h?.value) return h.value;
  } else if (headers && typeof headers === "object") {
    const h = (headers as Record<string, string>)["message-id"] ?? (headers as Record<string, string>)["Message-ID"];
    if (h) return h;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Webhook handler
// ---------------------------------------------------------------------------
router.post("/webhooks/inbound-email", async (req: Request & { rawBody?: Buffer }, res: Response): Promise<void> => {
  const webhookSecret = process.env.INBOUND_EMAIL_WEBHOOK_SECRET;

  // --- 1. Verify Svix signature ------------------------------------------
  let payload: ResendInboundPayload;
  try {
    const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(req.body));
    const verified = verifySvixSignature(rawBody, req.headers as Record<string, string | undefined>, webhookSecret);
    // If dev-mode bypass (verified === undefined), parse body from already-parsed req.body
    payload = (verified ?? req.body) as ResendInboundPayload;
  } catch (err) {
    console.warn("[inbound-email] Signature verification failed:", (err as Error).message);
    res.status(401).json({ error: "Invalid webhook signature" });
    return;
  }

  // --- 2. Extract email fields ------------------------------------------
  const rawFrom = (extractField(payload, "from") as string) ?? "";
  const rawToField = extractField(payload, "to") as string | string[] | undefined;
  const toAddresses: string[] = Array.isArray(rawToField)
    ? rawToField
    : typeof rawToField === "string"
    ? [rawToField]
    : [];
  const subject = (extractField(payload, "subject") as string) ?? "(no subject)";
  const bodyText = (extractField(payload, "text") as string) ?? "";
  const rawHeaders = (extractField(payload, "headers") as Array<{ name: string; value: string }> | Record<string, string> | undefined);
  const externalMessageId = extractMessageId(payload);

  if (!rawFrom) {
    res.status(400).json({ error: "Missing from address" });
    return;
  }

  const sender = parseEmailAddress(rawFrom);
  const senderDomain = emailDomain(sender.email);

  // Guard: ignore no-reply/automated senders to avoid feedback loops
  if (
    sender.email.startsWith("noreply") ||
    sender.email.startsWith("no-reply") ||
    sender.email.startsWith("donotreply") ||
    sender.email.includes("mailer-daemon") ||
    sender.email.includes("postmaster@")
  ) {
    console.log(`[inbound-email] Ignoring automated sender: ${sender.email}`);
    res.status(200).json({ ok: true, skipped: "automated sender" });
    return;
  }

  // --- 3. Rate limit by sender ------------------------------------------
  if (!checkSenderRateLimit(sender.email)) {
    console.warn(`[inbound-email] Rate limit hit for sender: ${sender.email}`);
    res.status(429).json({ error: "Too many requests from this sender" });
    return;
  }

  // --- 4. Find the JOBSAGE alias among the recipients ------------------
  const MAIL_DOMAIN = process.env.JOBSAGE_MAIL_DOMAIN ?? "mail.jobsage.co.uk";
  const aliasRecipient = toAddresses
    .map((a) => parseEmailAddress(a).email)
    .find((e) => e.endsWith(`@${MAIL_DOMAIN}`));

  if (!aliasRecipient) {
    console.log(`[inbound-email] No @${MAIL_DOMAIN} recipient found in: ${toAddresses.join(", ")}`);
    res.status(200).json({ ok: true, skipped: "no jobsage alias in recipients" });
    return;
  }

  // --- 5. Resolve alias to candidate ------------------------------------
  let candidateUserId: string | null = null;

  const [userRow] = await db
    .select({ id: usersTable.id, email: usersTable.email, firstName: usersTable.firstName })
    .from(usersTable)
    .where(eq(usersTable.jobsageEmail, aliasRecipient))
    .limit(1);

  if (userRow) {
    candidateUserId = userRow.id;
  } else {
    const [profileRow] = await db
      .select({ userId: profilesTable.userId })
      .from(profilesTable)
      .where(eq(profilesTable.jobsageEmail, aliasRecipient))
      .limit(1);
    candidateUserId = profileRow?.userId ?? null;
  }

  if (!candidateUserId) {
    console.log(`[inbound-email] No candidate found for alias: ${aliasRecipient}`);
    // Return 200 so Resend doesn't retry — alias has no matching candidate
    res.status(200).json({ ok: true, skipped: "alias not matched to any candidate" });
    return;
  }

  // Fetch candidate info if resolved via profile (not userRow)
  let candidateEmail: string;
  let candidateFirstName: string;
  if (userRow) {
    candidateEmail = userRow.email ?? "";
    candidateFirstName = userRow.firstName ?? "there";
  } else {
    const [u] = await db
      .select({ email: usersTable.email, firstName: usersTable.firstName })
      .from(usersTable)
      .where(eq(usersTable.id, candidateUserId))
      .limit(1);
    candidateEmail = u?.email ?? "";
    candidateFirstName = u?.firstName ?? "there";
  }

  // --- 6. Deduplicate --------------------------------------------------
  if (externalMessageId) {
    const [existing] = await db
      .select({ id: candidateMessagesTable.id })
      .from(candidateMessagesTable)
      .where(eq(candidateMessagesTable.externalMessageId, externalMessageId))
      .limit(1);
    if (existing) {
      console.log(`[inbound-email] Duplicate delivery, message already stored: ${externalMessageId}`);
      res.status(200).json({ ok: true, skipped: "duplicate" });
      return;
    }
  }

  // --- 7. Classify the reply -------------------------------------------
  const cleanBody = truncateBody(bodyText);
  const category = classifyReply(subject, cleanBody, rawHeaders);
  const displaySubject = `Employer reply: ${cleanSubject(subject) || subject}`;

  // --- 8. Match speculative application --------------------------------
  let matchedApplicationId: number | null = null;
  let matchedCompanyName: string | null = null;

  try {
    const openStatuses = ["cv_sent", "sent", "acknowledged", "under_review"];
    const openApps = await db
      .select()
      .from(speculativeApplicationsTable)
      .where(
        and(
          eq(speculativeApplicationsTable.userId, candidateUserId),
          or(
            ...openStatuses.map((s) =>
              eq(speculativeApplicationsTable.status, s as "cv_sent" | "sent" | "acknowledged" | "under_review"),
            ),
          ),
        ),
      );

    // Priority 1: match by emailRecipient domain
    const domainMatch = openApps.find((app) => {
      const recipientDomain = emailDomain(app.emailRecipient ?? "");
      return recipientDomain && recipientDomain === senderDomain;
    });

    if (domainMatch) {
      matchedApplicationId = domainMatch.id;
      matchedCompanyName = domainMatch.companyName;
    } else {
      // Priority 2: sender name/company contains the stored company name (fuzzy)
      const senderContext = `${sender.name} ${sender.email}`.toLowerCase();
      const nameMatch = openApps.find((app) => {
        const company = app.companyName.toLowerCase();
        return (
          senderContext.includes(company) ||
          company.split(" ").some((w) => w.length > 3 && senderContext.includes(w))
        );
      });
      if (nameMatch) {
        matchedApplicationId = nameMatch.id;
        matchedCompanyName = nameMatch.companyName;
      }
    }
  } catch (err) {
    console.error("[inbound-email] Error matching application:", err);
  }

  // --- 9. Insert inbox message ------------------------------------------
  let insertedMessageId: number | null = null;
  try {
    const [inserted] = await db
      .insert(candidateMessagesTable)
      .values({
        recipientUserId: candidateUserId,
        messageType: "employer_reply",
        subject: displaySubject,
        messageText: cleanBody || "(No message body)",
        companyName: sender.name || senderDomain || "Employer",
        senderEmail: sender.email,
        externalMessageId: externalMessageId ?? null,
        applicationId: matchedApplicationId ?? null,
      } as Parameters<typeof db.insert>[0] extends infer T ? T extends { values: (v: infer V) => any } ? V : never : never)
      .returning({ id: candidateMessagesTable.id });
    insertedMessageId = inserted?.id ?? null;
  } catch (err) {
    console.error("[inbound-email] Failed to insert inbox message:", err);
    res.status(500).json({ error: "Failed to store message" });
    return;
  }

  // --- 10. Advance application status -----------------------------------
  if (matchedApplicationId) {
    const statusOrder: Record<string, number> = {
      cv_sent: 0,
      sent: 0,
      no_account: 0,
      acknowledged: 1,
      under_review: 2,
      interview_invited: 3,
      offer: 4,
      rejected: 5,
    };

    try {
      const [currentApp] = await db
        .select({ status: speculativeApplicationsTable.status })
        .from(speculativeApplicationsTable)
        .where(eq(speculativeApplicationsTable.id, matchedApplicationId));

      const currentOrder = statusOrder[currentApp?.status ?? "cv_sent"] ?? 0;
      const newOrder = statusOrder[category] ?? 1;

      if (newOrder > currentOrder || category === "rejected") {
        await db
          .update(speculativeApplicationsTable)
          .set({ status: category })
          .where(eq(speculativeApplicationsTable.id, matchedApplicationId));
        console.log(
          `[inbound-email] Updated application #${matchedApplicationId} status: ${currentApp?.status} → ${category}`,
        );
      }
    } catch (err) {
      console.error("[inbound-email] Failed to update application status:", err);
    }
  }

  // --- 11. Notify candidate --------------------------------------------
  try {
    if (candidateEmail) {
      await sendEmployerReplyNotification({
        to: candidateEmail,
        candidateFirstName,
        companyName: matchedCompanyName ?? sender.name ?? senderDomain ?? "An employer",
        subject: displaySubject,
        messageText: cleanBody,
        category,
      });
    }
  } catch (err) {
    console.error("[inbound-email] Failed to send notification email:", err);
  }

  console.log(
    `[inbound-email] Processed reply from ${sender.email} → alias ${aliasRecipient}, candidate ${candidateUserId}, category=${category}, appId=${matchedApplicationId ?? "none"}`,
  );

  res.status(200).json({
    ok: true,
    candidateUserId,
    messageId: insertedMessageId,
    category,
    matchedApplicationId,
  });
});

export default router;
