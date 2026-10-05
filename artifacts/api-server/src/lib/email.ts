import { Resend } from "resend";

const DEFAULT_FROM = "noreply@jobsage.co.uk";
const EMAIL_ADDRESS_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function extractEmailAddress(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const address = trimmed.match(/<([^<>]+)>$/)?.[1]?.trim() ?? trimmed;
  return EMAIL_ADDRESS_PATTERN.test(address) ? address : null;
}

export interface EmailConfigurationStatus {
  resendApiKeyPresent: boolean;
  senderAddress: string | null;
  senderSource: "EMAIL_FROM" | "default";
  senderUsable: boolean;
  ready: boolean;
  diagnostics: string[];
}

/** Safe startup diagnostics: reports configuration state, never credential values. */
export function getEmailConfigurationStatus(
  env: NodeJS.ProcessEnv = process.env,
): EmailConfigurationStatus {
  const configuredFrom = env.EMAIL_FROM?.trim();
  const senderSource = configuredFrom ? "EMAIL_FROM" : "default";
  const senderAddress = extractEmailAddress(configuredFrom || DEFAULT_FROM);
  const resendApiKeyPresent = Boolean(env.RESEND_API_KEY?.trim());
  const diagnostics: string[] = [];
  if (!resendApiKeyPresent) diagnostics.push("RESEND_API_KEY is missing");
  if (!senderAddress) diagnostics.push("EMAIL_FROM is missing or not a usable email address");
  return {
    resendApiKeyPresent,
    senderAddress,
    senderSource,
    senderUsable: senderAddress !== null,
    ready: resendApiKeyPresent && senderAddress !== null,
    diagnostics,
  };
}

export function logEmailConfiguration(): void {
  const status = getEmailConfigurationStatus();
  if (!status.ready) {
    console.error(`[email] CRITICAL: outbound email is not ready — ${status.diagnostics.join("; ")}`);
    return;
  }
  console.log(
    `[email] Resend outbound email configured; approved sender ${status.senderAddress} (${status.senderSource})`,
  );
}

const resend = new Resend(process.env.RESEND_API_KEY);
const initialEmailConfig = getEmailConfigurationStatus();
// Keep a safe syntactic fallback for non-Send-CV templates. The Send CV path
// calls assertEmailConfiguration before reaching Resend and will fail clearly
// when this fallback represents invalid configuration.
const FROM = initialEmailConfig.senderAddress ?? DEFAULT_FROM;
const APP_URL = process.env.APP_URL ?? "https://jobsage.co.uk";

function assertEmailConfiguration(context: string): void {
  const status = getEmailConfigurationStatus();
  // Local tests and development can use a mocked/provider-local Resend client,
  // but a production request must never be reported as sent with missing
  // credentials or an unusable configured sender.
  if (process.env.NODE_ENV === "production" && !status.ready) {
    throw new Error(`${context} is unavailable: ${status.diagnostics.join("; ")}.`);
  }
}

export async function sendSupportTicketNotification(opts: {
  ticketId: string;
  name: string;
  email: string;
  category: string;
  subject: string;
  message: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    assertEmailConfiguration("Support ticket notifications");
    const recipient = process.env.SUPPORT_EMAIL?.trim() || "support@jobsage.uk";
    const safeMessage = escapeEmailHtml(opts.message).replace(/\r?\n/g, "<br />");
    const result = await resend.emails.send({
      from: `JOBSAGE <${FROM}>`,
      to: recipient,
      replyTo: opts.email,
      subject: `[Support ${opts.ticketId}] ${opts.subject}`,
      text: [
        `Ticket: ${opts.ticketId}`,
        `Name: ${opts.name}`,
        `Email: ${opts.email}`,
        `Category: ${opts.category}`,
        `Subject: ${opts.subject}`,
        "",
        opts.message,
      ].join("\n"),
      html: `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#162436;line-height:1.6">
        <h1 style="font-size:20px">New JOBSAGE support request</h1>
        <p><strong>Ticket:</strong> ${escapeEmailHtml(opts.ticketId)}</p>
        <p><strong>Name:</strong> ${escapeEmailHtml(opts.name)}</p>
        <p><strong>Email:</strong> ${escapeEmailHtml(opts.email)}</p>
        <p><strong>Category:</strong> ${escapeEmailHtml(opts.category)}</p>
        <p><strong>Subject:</strong> ${escapeEmailHtml(opts.subject)}</p>
        <hr /><p>${safeMessage}</p>
      </body></html>`,
    });
    if (result.error) {
      return { success: false, error: result.error.message || "Email provider rejected the support ticket." };
    }
    return { success: true };
  } catch (error: unknown) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to send the support ticket.",
    };
  }
}

export async function sendSupportTicketReply(opts: {
  to: string;
  ticketId: string;
  subject: string;
  replyText: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    assertEmailConfiguration("Support ticket replies");
    const safeReply = escapeEmailHtml(opts.replyText).replace(/\r?\n/g, "<br />");
    const result = await resend.emails.send({
      from: `JOBSAGE <${FROM}>`,
      to: opts.to,
      subject: `Re: [Support ${opts.ticketId}] ${normalizeEmailSubject(opts.subject)}`,
      text: [
        `Reply to your JOBSAGE support request (${opts.ticketId})`,
        "",
        opts.replyText,
        "",
        "The JOBSAGE Support team",
      ].join("\n"),
      html: `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#162436;line-height:1.6">
        <h1 style="font-size:20px">JOBSAGE Support has replied</h1>
        <p>Reply to your support request <strong>${escapeEmailHtml(opts.ticketId)}</strong> about <strong>${escapeEmailHtml(opts.subject)}</strong>:</p>
        <div style="white-space:normal">${safeReply}</div>
        <p>The JOBSAGE Support team</p>
      </body></html>`,
    });
    if (result.error) {
      return { success: false, error: result.error.message || "Email provider rejected the support reply." };
    }
    return { success: true };
  } catch (error: unknown) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to send the support reply.",
    };
  }
}

export async function sendProductFeedbackReply(opts: {
  to: string;
  feedbackId: number;
  replyText: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    assertEmailConfiguration("Product feedback replies");
    const safeReply = escapeEmailHtml(opts.replyText).replace(/\r?\n/g, "<br />");
    const result = await resend.emails.send({
      from: `JOBSAGE <${FROM}>`,
      to: opts.to,
      subject: "JOBSAGE has replied to your feedback",
      text: [
        "JOBSAGE has replied to the feedback you shared with us.",
        "",
        opts.replyText,
        "",
        "The JOBSAGE Support team",
      ].join("\n"),
      html: `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#162436;line-height:1.6">
        <h1 style="font-size:20px">JOBSAGE has replied to your feedback</h1>
        <p>Our team has responded to the feedback you shared with JOBSAGE.</p>
        <div style="white-space:normal">${safeReply}</div>
        <p>The JOBSAGE Support team</p>
      </body></html>`,
    });
    if (result.error) {
      return { success: false, error: result.error.message || "Email provider rejected the feedback reply." };
    }
    return { success: true };
  } catch (error: unknown) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to send the feedback reply.",
    };
  }
}

export async function sendWaitlistWelcomeEmail(opts: {
  to: string;
  firstName: string;
  industrySector?: string | null;
  desiredRole?: string | null;
}): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const safeFirstName = escapeEmailHtml(opts.firstName);

  try {
    const result = await resend.emails.send({
      from: `JOBSAGE <${FROM}>`,
      to: opts.to,
      subject: "We've received your information — JOBSAGE",
      html: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Welcome to JOBSAGE</title>
</head>
<body style="margin:0;padding:0;background:#f4f7fb;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#f4f7fb;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
          <tr>
            <td style="background:#0f172a;padding:28px 40px;text-align:center;">
              <span style="color:#ffffff;font-size:22px;font-weight:800;letter-spacing:-0.5px;">JOBSAGE</span>
            </td>
          </tr>
          <tr>
            <td style="padding:40px 40px 28px;">
              <h1 style="color:#0f172a;font-size:22px;font-weight:700;margin:0 0 18px;">Hi ${safeFirstName},</h1>
              <p style="color:#475569;font-size:15px;line-height:1.7;margin:0 0 18px;">
                 Thank you for taking the time to share your information with JOBSAGE. We're writing to confirm that we've received your details successfully.
              </p>
              <p style="color:#475569;font-size:15px;line-height:1.7;margin:0 0 18px;">
                 The information you provided will now be kept on record for follow-up. You'll hear from JOBSAGE regarding the next steps and any further information that may be relevant to your enquiry.
              </p>
              <p style="color:#475569;font-size:15px;line-height:1.7;margin:0 0 26px;">
                 We appreciate your interest in JOBSAGE and thank you for choosing to share your details with us. We look forward to staying in touch.
               </p>
               <p style="color:#475569;font-size:15px;line-height:1.7;margin:0;">
                Best regards,<br />The JOBSAGE Team
              </p>
            </td>
          </tr>
          <tr>
            <td style="background:#f8fafc;padding:20px 40px;border-top:1px solid #e2e8f0;text-align:center;">
              <p style="color:#64748b;font-size:12px;margin:0 0 10px;">
                Stay connected with JOBSAGE
              </p>
              <a href="https://www.instagram.com/jobsageltd?stkn=MXJrMmZpODFjbzBkZw==" target="_blank" rel="noopener noreferrer" aria-label="Follow JOBSAGE on Instagram" style="color:#e1306c;font-size:13px;font-weight:600;text-decoration:none;">
                <span style="display:inline-block;width:18px;height:18px;border:2px solid #e1306c;border-radius:5px;vertical-align:-5px;margin-right:6px;position:relative;">
                  <span style="display:block;width:6px;height:6px;border:2px solid #e1306c;border-radius:50%;position:absolute;left:4px;top:4px;"></span>
                  <span style="display:block;width:3px;height:3px;background:#e1306c;border-radius:50%;position:absolute;right:2px;top:2px;"></span>
                </span>
                Follow us on Instagram
              </a>
              <p style="color:#94a3b8;font-size:12px;margin:0;">
                &copy; ${new Date().getFullYear()} JOBSAGE. Decision intelligence for regulated professionals.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
    });

    if (result.error) {
      return {
        success: false,
        error: result.error.message || "Email provider rejected the waitlist confirmation.",
      };
    }

    return {
      success: true,
      ...(result.data?.id ? { messageId: result.data.id } : {}),
    };
  } catch (error: unknown) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to send waitlist confirmation.",
    };
  }
}

function verificationEmailHtml(verifyUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Verify your JOBSAGE email</title>
</head>
<body style="margin:0;padding:0;background:#f4f7fb;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7fb;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
          <tr>
            <td style="background:#0f172a;padding:28px 40px;text-align:center;">
              <span style="color:#ffffff;font-size:22px;font-weight:800;letter-spacing:-0.5px;">JOBSAGE</span>
            </td>
          </tr>
          <tr>
            <td style="padding:40px 40px 20px;">
              <h1 style="color:#0f172a;font-size:22px;font-weight:700;margin:0 0 16px;">Verify your email address</h1>
              <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 24px;">
                Welcome to JOBSAGE — the decision-intelligence platform for UK healthcare professionals.
                Please verify your email address to activate your account.
              </p>
              <table cellpadding="0" cellspacing="0" style="margin:0 auto 28px;">
                <tr>
                  <td style="background:#0f172a;border-radius:8px;padding:14px 32px;text-align:center;">
                    <a href="${verifyUrl}" style="color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;display:inline-block;">Verify Email Address</a>
                  </td>
                </tr>
              </table>
              <p style="color:#94a3b8;font-size:13px;line-height:1.5;margin:0 0 8px;">
                If the button doesn't work, copy and paste this link into your browser:
              </p>
              <p style="color:#3b82f6;font-size:13px;word-break:break-all;margin:0 0 24px;">
                <a href="${verifyUrl}" style="color:#3b82f6;">${verifyUrl}</a>
              </p>
              <p style="color:#94a3b8;font-size:13px;margin:0;">
                This link expires in 24 hours. If you did not create a JOBSAGE account, you can safely ignore this email.
              </p>
            </td>
          </tr>
          <tr>
            <td style="background:#f8fafc;padding:20px 40px;border-top:1px solid #e2e8f0;text-align:center;">
              <p style="color:#94a3b8;font-size:12px;margin:0;">
                &copy; ${new Date().getFullYear()} JOBSAGE. Decision intelligence for regulated healthcare professionals.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function resetPasswordEmailHtml(resetUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Reset your JOBSAGE password</title>
</head>
<body style="margin:0;padding:0;background:#f4f7fb;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7fb;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
          <tr>
            <td style="background:#0f172a;padding:28px 40px;text-align:center;">
              <span style="color:#ffffff;font-size:22px;font-weight:800;letter-spacing:-0.5px;">JOBSAGE</span>
            </td>
          </tr>
          <tr>
            <td style="padding:40px 40px 20px;">
              <h1 style="color:#0f172a;font-size:22px;font-weight:700;margin:0 0 16px;">Reset your password</h1>
              <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 24px;">
                We received a request to reset your JOBSAGE password. Click the button below to choose a new password.
              </p>
              <table cellpadding="0" cellspacing="0" style="margin:0 auto 28px;">
                <tr>
                  <td style="background:#0f172a;border-radius:8px;padding:14px 32px;text-align:center;">
                    <a href="${resetUrl}" style="color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;display:inline-block;">Reset Password</a>
                  </td>
                </tr>
              </table>
              <p style="color:#94a3b8;font-size:13px;line-height:1.5;margin:0 0 8px;">
                If the button doesn't work, copy and paste this link into your browser:
              </p>
              <p style="color:#3b82f6;font-size:13px;word-break:break-all;margin:0 0 24px;">
                <a href="${resetUrl}" style="color:#3b82f6;">${resetUrl}</a>
              </p>
              <p style="color:#94a3b8;font-size:13px;margin:0;">
                This link expires in 1 hour. If you did not request a password reset, you can safely ignore this email — your password will not be changed.
              </p>
            </td>
          </tr>
          <tr>
            <td style="background:#f8fafc;padding:20px 40px;border-top:1px solid #e2e8f0;text-align:center;">
              <p style="color:#94a3b8;font-size:12px;margin:0;">
                &copy; ${new Date().getFullYear()} JOBSAGE. Decision intelligence for regulated healthcare professionals.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export interface AlertRole {
  title: string;
  employer: string;
  location: string;
  sponsorshipOffered: boolean;
  isEligible: boolean;
  applyUrl?: string | null;
  aiScore?: number | null;
  matchScore?: number;
}

export interface JobAlertSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function jobAlertEmailHtml(
  firstName: string,
  roles: AlertRole[],
  alertFrequency: "weekly" = "weekly",
): string {
  const frequencyLabel = alertFrequency;
  const roleRow = (role: AlertRole) => {
    const safeApplyUrl =
      role.applyUrl && /^https?:\/\//i.test(role.applyUrl) ? escapeHtmlAttribute(role.applyUrl) : null;
    return `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #f1f5f9;">
        <p style="margin:0 0 2px;font-size:15px;font-weight:600;color:#0f172a;">${role.title}</p>
        <p style="margin:0;font-size:13px;color:#64748b;">${role.employer} · ${role.location}${role.sponsorshipOffered ? " · <span style=\"color:#059669;\">Sponsorship Available</span>" : ""}</p>
        ${safeApplyUrl ? `<p style="margin:5px 0 0;font-size:12px;"><a href="${safeApplyUrl}" style="color:#2563eb;">View vacancy</a></p>` : ""}
      </td>
    </tr>`;
  };

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Your JOBSAGE Job Alert</title></head>
<body style="margin:0;padding:0;background:#f4f7fb;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7fb;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:#0f172a;padding:28px 40px;text-align:center;">
            <span style="color:#ffffff;font-size:22px;font-weight:800;letter-spacing:-0.5px;">JOBSAGE</span>
            <p style="color:#94a3b8;font-size:13px;margin:4px 0 0;">Your ${frequencyLabel} job alert</p>
          </td>
        </tr>
        <tr>
          <td style="padding:32px 40px 20px;">
            <h1 style="color:#0f172a;font-size:20px;font-weight:700;margin:0 0 8px;">Hi ${firstName},</h1>
            <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 16px;">
              Here are your top ${roles.length} opportunities, ranked the same way as your JOBSAGE Opportunities page.
            </p>
            <table width="100%" cellpadding="0" cellspacing="0">${roles.map(roleRow).join("")}</table>
            <table cellpadding="0" cellspacing="0" style="margin:28px auto 0;">
              <tr>
                <td style="background:#0f172a;border-radius:8px;padding:14px 32px;text-align:center;">
                  <a href="${APP_URL}/opportunities" style="color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;">View All Opportunities</a>
                </td>
              </tr>
            </table>
            <p style="color:#94a3b8;font-size:12px;margin:24px 0 0;text-align:center;">
              You're receiving this because your alert preference is set to ${alertFrequency}. Up to 5 new opportunities are included per alert.<br/>
              <a href="${APP_URL}/profile" style="color:#3b82f6;">Manage alert preferences</a>
            </p>
          </td>
        </tr>
        <tr>
          <td style="background:#f8fafc;padding:20px 40px;border-top:1px solid #e2e8f0;text-align:center;">
            <p style="color:#94a3b8;font-size:12px;margin:0;">
              &copy; ${new Date().getFullYear()} JOBSAGE. Decision intelligence for regulated healthcare professionals.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export async function sendJobAlertEmail(
  to: string,
  firstName: string,
  roles: AlertRole[],
  alertFrequency: "weekly" = "weekly",
): Promise<JobAlertSendResult> {
  try {
    const result = await resend.emails.send({
      from: `JOBSAGE <${FROM}>`,
      to,
      subject: `JOBSAGE: Your top ${roles.length} opportunities this week`,
      html: jobAlertEmailHtml(firstName, roles, alertFrequency),
    });
    if (result.error) {
      return {
        success: false,
        error: result.error.message || "Email provider rejected the job alert.",
      };
    }
    return {
      success: true,
      ...(result.data?.id ? { messageId: result.data.id } : {}),
    };
  } catch (error: unknown) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to send the job alert.",
    };
  }
}

export async function sendVerificationEmail(to: string, token: string, baseUrl: string = APP_URL): Promise<void> {
  const verifyUrl = `${baseUrl}/api/auth/verify-email?token=${encodeURIComponent(token)}`;
  await resend.emails.send({
    from: `JOBSAGE <${FROM}>`,
    to,
    subject: "JOBSAGE: Verify your email address",
    html: verificationEmailHtml(verifyUrl),
  });
}

export async function sendCandidateContactEmail(opts: {
  to: string;
  candidateFirstName: string;
  companyName: string;
  subject: string;
  messageText: string;
  vacancyTitle?: string | null;
}): Promise<void> {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${opts.subject}</title>
</head>
<body style="margin:0;padding:0;background:#f4f7fb;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7fb;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
          <tr>
            <td style="background:#0f172a;padding:28px 40px;text-align:center;">
              <span style="color:#ffffff;font-size:22px;font-weight:800;letter-spacing:-0.5px;">JOBSAGE</span>
            </td>
          </tr>
          <tr>
            <td style="padding:40px 40px 20px;">
              <h1 style="color:#0f172a;font-size:20px;font-weight:700;margin:0 0 8px;">Hi ${opts.candidateFirstName},</h1>
              <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 16px;">
                You have a new message from <strong>${opts.companyName}</strong>${opts.vacancyTitle ? ` regarding the role <strong>${opts.vacancyTitle}</strong>` : ""} on JOBSAGE.
              </p>
              <div style="background:#f8fafc;border-left:4px solid #0f172a;padding:16px 20px;border-radius:0 8px 8px 0;margin:0 0 24px;">
                <p style="color:#1e293b;font-size:15px;line-height:1.7;margin:0;white-space:pre-wrap;">${opts.messageText.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>
              </div>
              <table cellpadding="0" cellspacing="0" style="margin:0 auto 24px;">
                <tr>
                  <td style="background:#0f172a;border-radius:8px;padding:14px 32px;text-align:center;">
                    <a href="${APP_URL}/inbox" style="color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;display:inline-block;">View in your inbox</a>
                  </td>
                </tr>
              </table>
              <p style="color:#94a3b8;font-size:13px;margin:0;text-align:center;">
                This message was sent to you because you are registered on JOBSAGE. To manage your profile visibility, <a href="${APP_URL}/profile" style="color:#3b82f6;">visit your profile settings</a>.
              </p>
            </td>
          </tr>
          <tr>
            <td style="background:#f8fafc;padding:20px 40px;border-top:1px solid #e2e8f0;text-align:center;">
              <p style="color:#94a3b8;font-size:12px;margin:0;">
                &copy; ${new Date().getFullYear()} JOBSAGE. Decision intelligence for regulated healthcare professionals.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  await resend.emails.send({
    from: `JOBSAGE <${FROM}>`,
    to: opts.to,
    subject: opts.subject,
    html,
  });
}

export const OPS_INBOX = process.env.EMAIL_OPS ?? "ops@jobsage.co.uk";

export function escapeEmailHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeEmailSubject(value: string): string {
  return value.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeCandidateNotes(
  notes: string | null | undefined,
  candidateName: string,
): string[] {
  const normalizedNotes = notes?.replace(/\r\n?/g, "\n").trim();
  if (!normalizedNotes) return [];

  const candidateNameKey = candidateName.trim().toLocaleLowerCase();
  const cleanedLines: string[] = [];
  let afterClosing = false;

  for (const line of normalizedNotes.split("\n")) {
    const trimmedLine = line.trim();
    if (!trimmedLine) {
      cleanedLines.push("");
      continue;
    }

    if (afterClosing) continue;
    if (/^dear hiring team(?:\s+at\b[^,]*)?,?$/i.test(trimmedLine)) continue;
    if (/^i am writing to (?:formally submit my application|express my sincere interest)\b/i.test(trimmedLine)) continue;
    if (/^please find my (?:cv|resume) attached\b/i.test(trimmedLine)) continue;
    if (/^i look forward to hearing from you\b/i.test(trimmedLine)) continue;
    if (/^(?:kind|best|warm) regards,?$/i.test(trimmedLine)) {
      afterClosing = true;
      continue;
    }

    const bulletMatch = trimmedLine.match(/^(?:[-*•]|\d+[.)])\s+(.+)$/);
    const candidateLine = bulletMatch?.[1] ?? trimmedLine;
    const headingMatch = candidateLine.match(
      /^(?:motivation|relevant clinical experience|uk regulatory registration status|right to work & sponsorship status|key professional strengths|availability & notice period)\s*:?\s*(.*)$/i,
    );
    if (headingMatch) {
      if (headingMatch[1]?.trim()) cleanedLines.push(headingMatch[1].trim());
      continue;
    }

    if (candidateNameKey && candidateLine.toLocaleLowerCase() === candidateNameKey) {
      continue;
    }
    cleanedLines.push(candidateLine);
  }

  while (cleanedLines[0] === "") cleanedLines.shift();
  while (cleanedLines.at(-1) === "") cleanedLines.pop();
  return cleanedLines;
}

function renderCandidateNotes(
  notes: string | null | undefined,
  candidateName: string,
): string | null {
  const normalizedLines = normalizeCandidateNotes(notes, candidateName);
  if (normalizedLines.length === 0) return null;

  const renderedParts: string[] = [];
  let paragraphLines: string[] = [];

  const flushParagraph = () => {
    if (paragraphLines.length === 0) return;
    renderedParts.push(
      `<p style="margin:0 0 12px;color:#334155;font-size:14px;line-height:1.7;">${paragraphLines
        .map((line) => escapeEmailHtml(line))
        .join("<br />")}</p>`,
    );
    paragraphLines = [];
  };

  for (const line of normalizedLines) {
    const trimmedLine = line.trim();
    if (!trimmedLine) {
      flushParagraph();
      continue;
    }

    paragraphLines.push(trimmedLine);
  }

  flushParagraph();
  return renderedParts.join("");
}

export async function sendSpeculativeCVToOps(opts: {
  candidateEmail: string;
  candidateName: string;
  candidateUserId: string;
  companyName: string;
  applicationId: number;
  cvFilename?: string | null;
  cvContent?: Buffer | null;
  coverLetterFilename?: string | null;
  coverLetterContent?: Buffer | null;
  vacancyTitle?: string | null;
  vacancyUrl?: string | null;
  notes?: string | null;
  /** JOBSAGE alias — required; personal email is never used as contact in employer-facing comms */
  jobsageEmail: string;
  /**
   * Resolved contact address for the target employer.
   * When the employer has a JOBSAGE account this is their registered email.
   * Defaults to OPS_INBOX so ops can manually forward if no employer account exists.
   */
  recipientEmail?: string;
}): Promise<void> {
  assertEmailConfiguration("Send CV email");
  const contactEmail = opts.jobsageEmail;
  const recipientEmail = opts.recipientEmail ?? OPS_INBOX;

  const attachments: { filename: string; content: Buffer | string }[] = [];
  if (opts.cvContent && opts.cvFilename) {
    attachments.push({ filename: opts.cvFilename, content: opts.cvContent });
  }
  if (opts.coverLetterContent && opts.coverLetterFilename) {
    attachments.push({ filename: opts.coverLetterFilename, content: opts.coverLetterContent });
  }

  const safeCandidateName = escapeEmailHtml(opts.candidateName);
  const safeCompanyName = escapeEmailHtml(opts.companyName);
  const safeJobsageEmail = escapeEmailHtml(contactEmail);
  const safeVacancyTitle = opts.vacancyTitle ? escapeEmailHtml(opts.vacancyTitle) : null;
  const safeVacancyUrl =
    opts.vacancyUrl && /^https?:\/\//i.test(opts.vacancyUrl)
      ? escapeHtmlAttribute(opts.vacancyUrl)
      : null;
  const safeCvFilename = opts.cvFilename ? escapeEmailHtml(opts.cvFilename) : null;
  const safeCoverLetterFilename = opts.coverLetterFilename
    ? escapeEmailHtml(opts.coverLetterFilename)
    : null;
  const renderedNotes = renderCandidateNotes(opts.notes, opts.candidateName);
  const safeCandidateSubject = normalizeEmailSubject(opts.candidateName);
  const safeVacancySubject = normalizeEmailSubject(opts.vacancyTitle ?? opts.companyName);
  const safeCompanySubject = normalizeEmailSubject(opts.companyName);
  const subject = `Application: ${safeCandidateSubject} — ${safeVacancySubject || safeCompanySubject}`;
  const formalPosition = safeVacancyTitle ?? "position";
  const attachmentLabel = `📎 Attached: ${safeCvFilename ?? "Curriculum Vitae (PDF)"}${
    safeCoverLetterFilename ? ` · ${safeCoverLetterFilename}` : ""
  }`;
  const safeJobsageEmailAttribute = escapeHtmlAttribute(contactEmail);

  // Always send FROM the approved/configured JOBSAGE sender. The candidate's
  // alias is a Reply-To only: alias domains may not be verified as outbound
  // Resend domains, and using one as From would make a real send fail.
  // TO the resolved employer address (or OPS_INBOX for legacy callers).
  const result = await resend.emails.send({
    from: `JOBSAGE <${FROM}>`,
    to: recipientEmail,
    replyTo: opts.jobsageEmail,
    subject,
    attachments,
    html: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeEmailHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:Arial,Helvetica,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#334155;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#f8fafc;padding:32px 12px;">
    <tr>
      <td align="center">
        <table width="620" cellpadding="0" cellspacing="0" role="presentation" style="width:100%;max-width:620px;background:#ffffff;border:1px solid #e2e8f0;">
          <tr>
            <td style="padding:48px 44px 40px;">
              <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#334155;">Dear Hiring Team at ${safeCompanyName},</p>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.8;color:#334155;">
                I am pleased to submit my application for the ${formalPosition} role at ${safeCompanyName}. My CV is attached for your consideration.
              </p>
              ${renderedNotes ? `<div style="margin:0 0 4px;">${renderedNotes}</div>` : ""}
              <p style="margin:20px 0 0;font-size:15px;line-height:1.8;color:#334155;">
                Thank you for considering my application. I would welcome the opportunity to discuss how my experience and qualifications could contribute to your team, and I look forward to hearing from you.
              </p>
              <p style="margin:24px 0 4px;font-size:15px;line-height:1.5;color:#334155;">Kind regards,</p>
              <p style="margin:0;font-weight:700;font-size:16px;line-height:1.5;color:#0f172a;">${safeCandidateName}</p>
              <p style="margin:2px 0 0;font-size:13px;line-height:1.5;color:#64748b;">
                Applicant &middot; <a href="mailto:${safeJobsageEmailAttribute}" style="color:#2563eb;text-decoration:none;">${safeJobsageEmail}</a>
              </p>
              <div style="margin-top:24px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px;font-size:13px;line-height:1.5;color:#475569;">
                ${attachmentLabel}
              </div>
              ${safeVacancyUrl ? `<p style="margin:16px 0 0;font-size:12px;line-height:1.5;color:#94a3b8;">Role details: <a href="${safeVacancyUrl}" style="color:#2563eb;text-decoration:none;">View the vacancy</a></p>` : ""}
              <hr style="border:0;border-top:1px solid #e2e8f0;margin:24px 0 16px;" />
              <div style="font-size:12px;color:#94a3b8;line-height:1.5;">
                <p style="margin:0 0 4px;">
                  📩 <strong>To reply:</strong> Simply click <strong>Reply</strong> in your email client. Your message will be securely delivered to ${safeCandidateName} via their JOBSAGE candidate messaging channel.
                </p>
                <p style="margin:0;">
                  Sent via <strong>JOBSAGE</strong> &middot; UK Healthcare &amp; Regulated Professions Talent Network
                </p>
                <p style="margin:6px 0 0;color:#cbd5e1;">Ref: JS-${opts.applicationId}</p>
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
  });
  if (result.error) {
    throw new Error(result.error.message || "Email provider rejected the CV delivery.");
  }
}

export async function sendSpeculativeCVNotification(opts: {
  candidateEmail: string;
  candidateName: string;
  companyName: string;
  /** Required: only called after confirmed delivery, so route is always known */
  deliveryRoute: "employer_contact_email" | "employer_account" | "sponsor_contact_email" | "ops_fallback";
}): Promise<void> {
  const isDirectSend = opts.deliveryRoute !== "ops_fallback";
  const deliveryLine = isDirectSend
    ? `Your CV was <strong>delivered directly to ${opts.companyName}</strong>. They can reply to your JOBSAGE alias.`
    : `Your CV has been sent to the <strong>JOBSAGE team</strong>, who will forward it to ${opts.companyName} on your behalf.`;

  await resend.emails.send({
    from: `JOBSAGE <${FROM}>`,
    to: opts.candidateEmail,
    subject: `JOBSAGE: Your speculative CV to ${opts.companyName} has been ${isDirectSend ? "delivered" : "sent"}`,
    html: `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background:#f4f7fb;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7fb;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
        <tr><td style="background:#0f172a;padding:28px 40px;text-align:center;">
          <span style="color:#ffffff;font-size:22px;font-weight:800;letter-spacing:-0.5px;">JOBSAGE</span>
        </td></tr>
        <tr><td style="padding:36px 40px 24px;">
          <h1 style="color:#0f172a;font-size:20px;font-weight:700;margin:0 0 8px;">Hi ${opts.candidateName},</h1>
          <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 16px;">
            Your speculative CV has been submitted for <strong>${opts.companyName}</strong>.
          </p>
          <div style="background:${isDirectSend ? "#f0fdf4" : "#fffbeb"};border-left:4px solid ${isDirectSend ? "#16a34a" : "#d97706"};border-radius:0 8px 8px 0;padding:14px 18px;margin:0 0 20px;">
            <p style="color:#1e293b;font-size:14px;line-height:1.6;margin:0;">${deliveryLine}</p>
          </div>
          <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 24px;">
            You can track this outreach in your <a href="${APP_URL}/applications" style="color:#3b82f6;font-weight:600;">Application Tracker</a>.
          </p>
          <p style="color:#94a3b8;font-size:12px;margin:0;">
            &copy; ${new Date().getFullYear()} JOBSAGE. Decision intelligence for regulated healthcare professionals.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
  });
}

export async function sendEmployerReplyNotification(opts: {
  to: string;
  candidateFirstName: string;
  companyName: string;
  subject: string;
  messageText: string;
  category: "interview_invited" | "rejected" | "offer" | "acknowledged";
}): Promise<void> {
  const categoryBanners: Record<string, { emoji: string; label: string; color: string }> = {
    interview_invited: { emoji: "🎉", label: "Interview Invitation", color: "#059669" },
    offer: { emoji: "🏆", label: "Job Offer", color: "#d97706" },
    rejected: { emoji: "📋", label: "Application Update", color: "#64748b" },
    acknowledged: { emoji: "📬", label: "Employer Reply", color: "#0f172a" },
  };
  const banner = categoryBanners[opts.category] ?? categoryBanners.acknowledged!;

  const escapedBody = opts.messageText.replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${banner.label} from ${opts.companyName}</title>
</head>
<body style="margin:0;padding:0;background:#f4f7fb;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7fb;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
          <tr>
            <td style="background:#0f172a;padding:28px 40px;text-align:center;">
              <span style="color:#ffffff;font-size:22px;font-weight:800;letter-spacing:-0.5px;">JOBSAGE</span>
            </td>
          </tr>
          <tr>
            <td style="background:${banner.color};padding:14px 40px;text-align:center;">
              <span style="color:#ffffff;font-size:15px;font-weight:700;">${banner.emoji} ${banner.label}</span>
            </td>
          </tr>
          <tr>
            <td style="padding:36px 40px 24px;">
              <h1 style="color:#0f172a;font-size:20px;font-weight:700;margin:0 0 8px;">Hi ${opts.candidateFirstName},</h1>
              <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 20px;">
                <strong>${opts.companyName}</strong> has replied to your speculative CV application.
                The message has been added to your JOBSAGE inbox.
              </p>
              <div style="background:#f8fafc;border-left:4px solid ${banner.color};padding:16px 20px;border-radius:0 8px 8px 0;margin:0 0 24px;">
                <p style="color:#64748b;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;margin:0 0 8px;">Message from ${opts.companyName}</p>
                <p style="color:#1e293b;font-size:14px;line-height:1.7;margin:0;">${escapedBody}</p>
              </div>
              <table cellpadding="0" cellspacing="0" style="margin:0 auto 16px;">
                <tr>
                  <td style="background:#0f172a;border-radius:8px;padding:14px 32px;text-align:center;">
                    <a href="${APP_URL}/inbox" style="color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;display:inline-block;">View in Inbox</a>
                  </td>
                </tr>
              </table>
              <table cellpadding="0" cellspacing="0" style="margin:0 auto 24px;">
                <tr>
                  <td style="border:1px solid #e2e8f0;border-radius:8px;padding:12px 28px;text-align:center;">
                    <a href="${APP_URL}/applications" style="color:#0f172a;font-size:14px;font-weight:500;text-decoration:none;display:inline-block;">View Application Tracker</a>
                  </td>
                </tr>
              </table>
              <p style="color:#94a3b8;font-size:12px;margin:0;text-align:center;">
                This notification was sent because an employer replied to your JOBSAGE alias.
              </p>
            </td>
          </tr>
          <tr>
            <td style="background:#f8fafc;padding:20px 40px;border-top:1px solid #e2e8f0;text-align:center;">
              <p style="color:#94a3b8;font-size:12px;margin:0;">
                &copy; ${new Date().getFullYear()} JOBSAGE. Decision intelligence for regulated healthcare professionals.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  await resend.emails.send({
    from: `JOBSAGE <${FROM}>`,
    to: opts.to,
    subject: `JOBSAGE: ${banner.emoji} ${banner.label} from ${opts.companyName}`,
    html,
  });
}

export async function sendPasswordResetEmail(to: string, token: string, baseUrl: string = APP_URL): Promise<void> {
  const resetUrl = `${baseUrl}/reset-password?token=${encodeURIComponent(token)}`;
  await resend.emails.send({
    from: `JOBSAGE <${FROM}>`,
    to,
    subject: "JOBSAGE: Reset your password",
    html: resetPasswordEmailHtml(resetUrl),
  });
}
