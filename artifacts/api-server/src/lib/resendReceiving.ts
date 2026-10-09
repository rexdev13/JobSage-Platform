import { Resend, type GetReceivingEmailResponseSuccess } from "resend";
import { getEmailConfigurationStatus } from "./email";

const DEFAULT_FROM = "noreply@jobsage.co.uk";
const MAX_FORWARD_ATTACHMENT_BYTES = 18 * 1024 * 1024;
const RESEND_ATTACHMENT_HOST = "inbound-cdn.resend.com";

export type ReceivedEmail = GetReceivingEmailResponseSuccess;

export class ResendReceivingError extends Error {
  constructor(
    readonly stage:
      | "configuration"
      | "retrieve"
      | "attachment-list"
      | "attachment-download"
      | "attachment-size"
      | "forward",
    readonly statusCode?: number,
  ) {
    super(stage);
    this.name = "ResendReceivingError";
  }
}

function createResendClient(): Resend {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) throw new ResendReceivingError("configuration");
  return new Resend(apiKey);
}

export async function getReceivedEmail(emailId: string): Promise<ReceivedEmail> {
  const client = createResendClient();
  const result = await client.emails.receiving.get(emailId);
  if (result.error) {
    throw new ResendReceivingError("retrieve", result.error.statusCode ?? undefined);
  }
  return result.data;
}

function safeFilename(filename: string | null | undefined): string {
  const name = (filename || "attachment")
    .replace(/[\\/]/g, "_")
    .replace(/[\u0000-\u001f\u007f]/g, "_")
    .trim()
    .slice(0, 180);
  return name || "attachment";
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function htmlToText(html: string): string {
  return html
    .replace(/<\s*(br|\/p|\/div|\/li|\/tr|\/h[1-6])\b[^>]*>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function originalSenderAddress(value: string): string | null {
  const address = value.match(/<([^<>]+)>/)?.[1]?.trim() ?? value.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) ? address : null;
}

async function downloadAttachment(
  downloadUrl: string,
  expectedSize: number | null,
  remainingBytes: number,
): Promise<Buffer> {
  let url: URL;
  try {
    url = new URL(downloadUrl);
  } catch {
    throw new ResendReceivingError("attachment-download");
  }
  if (url.protocol !== "https:" || url.hostname !== RESEND_ATTACHMENT_HOST) {
    throw new ResendReceivingError("attachment-download");
  }
  if (expectedSize !== null && expectedSize > remainingBytes) {
    throw new ResendReceivingError("attachment-size");
  }

  let response: Response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(30_000),
      redirect: "error",
    });
  } catch {
    throw new ResendReceivingError("attachment-download");
  }
  if (!response.ok) {
    throw new ResendReceivingError("attachment-download", response.status);
  }

  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > remainingBytes) {
    throw new ResendReceivingError("attachment-size");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new ResendReceivingError("attachment-download");

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > remainingBytes) {
        await reader.cancel().catch(() => {});
        throw new ResendReceivingError("attachment-size");
      }
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    if (error instanceof ResendReceivingError) throw error;
    throw new ResendReceivingError("attachment-download");
  }
  return Buffer.concat(chunks, totalBytes);
}

function safeHeaderValue(value: string | null | undefined, maxLength = 2_000): string {
  return (value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function makeForwardText(email: ReceivedEmail, plainBody: string): string {
  const originalDate = safeHeaderValue(email.headers?.date || email.created_at);
  return [
    "---------- Forwarded message ----------",
    `From: ${safeHeaderValue(email.from)}`,
    `To: ${safeHeaderValue(email.to.join(", ")) || "(not available)"}`,
    ...(email.cc?.length ? [`Cc: ${safeHeaderValue(email.cc.join(", "))}`] : []),
    `Date: ${originalDate}`,
    `Subject: ${safeHeaderValue(email.subject) || "(no subject)"}`,
    ...(email.message_id ? [`Message-ID: ${safeHeaderValue(email.message_id)}`] : []),
    "",
    plainBody,
  ].join("\n");
}

function makeForwardHtml(email: ReceivedEmail, originalHtml: string | null, plainBody: string): string {
  const originalDate = safeHeaderValue(email.headers?.date || email.created_at);
  const details = [
    ["From", safeHeaderValue(email.from)],
    ["To", safeHeaderValue(email.to.join(", ")) || "(not available)"],
    ...(email.cc?.length ? [["Cc", safeHeaderValue(email.cc.join(", "))] as [string, string]] : []),
    ["Date", originalDate],
    ["Subject", safeHeaderValue(email.subject) || "(no subject)"],
    ...(email.message_id ? [["Message-ID", safeHeaderValue(email.message_id)] as [string, string]] : []),
  ];
  const header = details
    .map(([label, value]) => `<div><strong>${label}:</strong> ${escapeHtml(value)}</div>`)
    .join("");
  const body = originalHtml ?? `<pre style="white-space:pre-wrap">${escapeHtml(plainBody)}</pre>`;

  return `<div style="font-family:Arial,sans-serif"><p>---------- Forwarded message ----------</p><div>${header}</div><hr>${body}</div>`;
}

/**
 * Forwards one received message to the configured destination. Original sender
 * details and body are included in the forwarded message, and original files
 * are attached individually (including inline content IDs).
 *
 * The Resend send API idempotency key is derived from the immutable inbound
 * email ID so webhook retries do not create duplicate forwarded messages.
 */
export async function forwardReceivedEmail(emailId: string, destination: string): Promise<string> {
  const client = createResendClient();
  const receivedResult = await client.emails.receiving.get(emailId);
  if (receivedResult.error) {
    throw new ResendReceivingError("retrieve", receivedResult.error.statusCode ?? undefined);
  }
  const email = receivedResult.data;

  const attachmentListResult = await client.emails.receiving.attachments.list({ emailId });
  if (attachmentListResult.error) {
    throw new ResendReceivingError(
      "attachment-list",
      attachmentListResult.error.statusCode ?? undefined,
    );
  }

  const attachments: Array<{
    filename: string;
    content: Buffer;
    contentType?: string;
    contentId?: string;
  }> = [];
  let totalAttachmentBytes = 0;
  for (const attachment of attachmentListResult.data.data) {
    const content = await downloadAttachment(
      attachment.download_url,
      attachment.size ?? null,
      MAX_FORWARD_ATTACHMENT_BYTES - totalAttachmentBytes,
    );
    totalAttachmentBytes += content.length;
    attachments.push({
      filename: safeFilename(attachment.filename),
      content,
      contentType: attachment.content_type || undefined,
      contentId: attachment.content_id?.replace(/^<|>$/g, "") || undefined,
    });
  }

  const plainBody = email.text?.trim() ? email.text : email.html ? htmlToText(email.html) : "";
  const originalHtml = email.html?.trim() ? email.html : null;
  const configuredSender = getEmailConfigurationStatus().senderAddress ?? DEFAULT_FROM;
  const subject = safeHeaderValue(email.subject) || "(no subject)";
  const from = `JOBSAGE <${configuredSender}>`;
  const replyTo = (email.reply_to ?? [])
    .map(originalSenderAddress)
    .filter((address): address is string => address !== null);
  if (replyTo.length === 0) {
    const originalSender = originalSenderAddress(email.from);
    if (originalSender) replyTo.push(originalSender);
  }

  const sendResult = await client.emails.send(
    {
      from,
      to: destination,
      subject: /^(fwd|fw):/i.test(subject) ? subject : `Fwd: ${subject}`,
      text: makeForwardText(email, plainBody),
      html: makeForwardHtml(email, originalHtml, plainBody),
      replyTo: replyTo.length ? replyTo : undefined,
      attachments: attachments.length ? attachments : undefined,
    },
    { idempotencyKey: `jobsage-developer-forward-${emailId}` },
  );
  if (sendResult.error) {
    throw new ResendReceivingError("forward", sendResult.error.statusCode ?? undefined);
  }
  return sendResult.data.id;
}
