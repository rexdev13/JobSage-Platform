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

export async function sendWaitlistWelcomeEmail(opts: {
  to: string;
  firstName: string;
  industrySector?: string | null;
  desiredRole?: string | null;
}): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const safeFirstName = escapeEmailHtml(opts.firstName);
  const safeIndustrySector = opts.industrySector
    ? escapeEmailHtml(opts.industrySector)
    : null;
  const registerUrl = escapeHtmlAttribute(
    `${APP_URL}/register?email=${encodeURIComponent(opts.to)}`,
  );

  try {
    const result = await resend.emails.send({
      from: `JOBSAGE <${FROM}>`,
      to: opts.to,
      subject: "Welcome to JOBSAGE — We've received your details!",
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
                Thank you for joining the JOBSAGE waitlist! We have received your details${safeIndustrySector ? ` and interest in ${safeIndustrySector} opportunities` : ""}.
              </p>
              <p style="color:#475569;font-size:15px;line-height:1.7;margin:0 0 18px;">
                Our advisory team reviews each profile to identify suitable UK sponsorship pathways and relevant vacancies. A dedicated team member will reach out to you shortly to guide you on next steps.
              </p>
              <p style="color:#475569;font-size:15px;line-height:1.7;margin:0 0 26px;">
                In the meantime, you can create your free account to track your progress and browse licensed sponsor employers.
              </p>
              <table cellpadding="0" cellspacing="0" role="presentation" style="margin:0 auto 28px;">
                <tr>
                  <td style="background:#0f172a;border-radius:8px;padding:14px 30px;text-align:center;">
                    <a href="${registerUrl}" style="color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;display:inline-block;">Create Free Account</a>
                  </td>
                </tr>
              </table>
              <p style="color:#475569;font-size:15px;line-height:1.7;margin:0;">
                Best regards,<br />The JOBSAGE Team
              </p>
            </td>
          </tr>
          <tr>
            <td style="background:#f8fafc;padding:20px 40px;border-top:1px solid #e2e8f0;text-align:center;">
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
  eligibleRoles: AlertRole[],
  workTowardsRoles: AlertRole[],
  alertFrequency: "daily" | "weekly" = "daily",
): string {
  const frequencyLabel = alertFrequency === "weekly" ? "weekly" : "daily";
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

  const eligibleSection =
    eligibleRoles.length > 0
      ? `<h3 style="color:#059669;font-size:16px;margin:24px 0 8px;">✅ Roles You Can Apply to Now (${eligibleRoles.length})</h3>
         <table width="100%" cellpadding="0" cellspacing="0">${eligibleRoles.map(roleRow).join("")}</table>`
      : "";

  const workTowardsSection =
    workTowardsRoles.length > 0
      ? `<h3 style="color:#d97706;font-size:16px;margin:24px 0 8px;">🎯 Roles Worth Working Towards (${workTowardsRoles.length})</h3>
         <table width="100%" cellpadding="0" cellspacing="0">${workTowardsRoles.map(roleRow).join("")}</table>`
      : "";

  const noRolesMsg =
    eligibleRoles.length === 0 && workTowardsRoles.length === 0
      ? `<p style="color:#64748b;font-size:15px;margin:16px 0;">No new matching roles were added since your last alert. We'll keep checking for you.</p>`
      : "";

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
              Here's your personalised job alert based on your professional profile and eligibility status.
            </p>
            ${noRolesMsg}
            ${eligibleSection}
            ${workTowardsSection}
            <table cellpadding="0" cellspacing="0" style="margin:28px auto 0;">
              <tr>
                <td style="background:#0f172a;border-radius:8px;padding:14px 32px;text-align:center;">
                  <a href="${APP_URL}/opportunities" style="color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;">View All Opportunities</a>
                </td>
              </tr>
            </table>
            <p style="color:#94a3b8;font-size:12px;margin:24px 0 0;text-align:center;">
              You're receiving this because your alert preference is set to ${frequencyLabel}.<br/>
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
  eligibleRoles: AlertRole[],
  workTowardsRoles: AlertRole[],
  alertFrequency: "daily" | "weekly" = "daily",
): Promise<void> {
  const frequencyLabel = alertFrequency === "weekly" ? "weekly" : "daily";
  const totalRoles = eligibleRoles.length + workTowardsRoles.length;
  const subject =
    totalRoles > 0
      ? `JOBSAGE: ${totalRoles} new role${totalRoles !== 1 ? "s" : ""} matching your profile`
      : `JOBSAGE: Your ${frequencyLabel} job alert`;

  const result = await resend.emails.send({
    from: `JOBSAGE <${FROM}>`,
    to,
    subject,
    html: jobAlertEmailHtml(firstName, eligibleRoles, workTowardsRoles, alertFrequency),
  });
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

function renderCandidateNotes(notes: string | null | undefined): string | null {
  const normalizedNotes = notes?.replace(/\r\n?/g, "\n").trim();
  if (!normalizedNotes) return null;

  const renderedParts: string[] = [];
  let paragraphLines: string[] = [];
  let bulletItems: string[] = [];

  const flushParagraph = () => {
    if (paragraphLines.length === 0) return;
    renderedParts.push(
      `<p style="margin:0 0 12px;color:#334155;font-size:14px;line-height:1.7;">${paragraphLines
        .map((line) => escapeEmailHtml(line))
        .join("<br />")}</p>`,
    );
    paragraphLines = [];
  };

  const flushBullets = () => {
    if (bulletItems.length === 0) return;
    renderedParts.push(
      `<ul style="margin:0 0 12px;padding-left:20px;color:#334155;font-size:14px;line-height:1.7;">${bulletItems
        .map((item) => `<li style="padding-left:4px;">${escapeEmailHtml(item)}</li>`)
        .join("")}</ul>`,
    );
    bulletItems = [];
  };

  for (const line of normalizedNotes.split("\n")) {
    const trimmedLine = line.trim();
    if (!trimmedLine) {
      flushParagraph();
      flushBullets();
      continue;
    }

    const bulletMatch = trimmedLine.match(/^(?:[-*•]|\d+[.)])\s+(.+)$/);
    if (bulletMatch) {
      flushParagraph();
      bulletItems.push(bulletMatch[1]);
    } else {
      flushBullets();
      paragraphLines.push(trimmedLine);
    }
  }

  flushParagraph();
  flushBullets();
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
  const renderedNotes = renderCandidateNotes(opts.notes);
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
  <style>
    @media only screen and (max-width: 620px) {
      .email-shell { width:100% !important; }
      .email-padding { padding-left:20px !important; padding-right:20px !important; }
      .snapshot-cell { display:block !important; width:100% !important; padding-right:0 !important; }
      .snapshot-cell + .snapshot-cell { padding-top:12px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:'Segoe UI',Arial,sans-serif;color:#0f172a;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#f8fafc;padding:32px 12px;">
    <tr>
      <td align="center">
        <table class="email-shell" width="600" cellpadding="0" cellspacing="0" role="presentation" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
          <tr>
            <td class="email-padding" style="background:#0f172a;padding:28px 36px;">
              <div style="color:#ffffff;font-size:24px;font-weight:800;letter-spacing:-0.6px;">JOBSAGE</div>
              <div style="color:#cbd5e1;font-size:13px;line-height:1.5;margin-top:6px;">Candidate Introduction &amp; Speculative Application</div>
            </td>
          </tr>
          <tr>
            <td class="email-padding" style="padding:32px 36px 12px;">
              <h1 style="color:#0f172a;font-size:22px;line-height:1.3;font-weight:700;margin:0 0 6px;">Candidate Application</h1>
              <p style="color:#64748b;font-size:14px;line-height:1.6;margin:0;">A candidate has shared their profile for your consideration.</p>
            </td>
          </tr>
          <tr>
            <td class="email-padding" style="padding:12px 36px 28px;">
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="border:1px solid #e2e8f0;border-radius:12px;background:#ffffff;">
                <tr>
                  <td style="padding:20px 20px 8px;">
                    <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                      <tr>
                        <td class="snapshot-cell" width="50%" valign="top" style="width:50%;padding:0 16px 12px 0;">
                          <div style="color:#64748b;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;">Candidate</div>
                          <div style="color:#0f172a;font-size:15px;font-weight:600;line-height:1.5;margin-top:4px;">${safeCandidateName}</div>
                        </td>
                        <td class="snapshot-cell" width="50%" valign="top" style="width:50%;padding:0 0 12px 0;">
                          <div style="color:#64748b;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;">Target Role / Dept</div>
                          <div style="color:#0f172a;font-size:15px;font-weight:600;line-height:1.5;margin-top:4px;">${candidateRole}</div>
                        </td>
                      </tr>
                      <tr>
                        <td class="snapshot-cell" width="50%" valign="top" style="width:50%;padding:4px 16px 12px 0;">
                          <div style="color:#64748b;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;">Target Organisation</div>
                          <div style="color:#0f172a;font-size:15px;font-weight:600;line-height:1.5;margin-top:4px;">${safeCompanyName}</div>
                        </td>
                        <td class="snapshot-cell" width="50%" valign="top" style="width:50%;padding:4px 0 12px 0;">
                          <div style="color:#64748b;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;">Attached Documents</div>
                          <div style="color:#334155;font-size:14px;line-height:1.6;margin-top:4px;">${documentsMarkup}</div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          ${safeVacancyUrl ? `
          <tr>
            <td class="email-padding" style="padding:0 36px 28px;">
              <p style="color:#64748b;font-size:13px;line-height:1.6;margin:0;">Related vacancy: <a href="${safeVacancyUrl}" style="color:#2563eb;text-decoration:underline;">View role details</a></p>
            </td>
          </tr>` : ""}
          ${renderedNotes ? `
          <tr>
            <td class="email-padding" style="padding:0 36px 28px;">
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#f8fafc;border:1px solid #e2e8f0;border-left:4px solid #3b82f6;border-radius:0 10px 10px 0;">
                <tr>
                  <td style="padding:20px;">
                    <h2 style="color:#0f172a;font-size:16px;line-height:1.4;margin:0 0 12px;">Message &amp; Qualifications from Candidate</h2>
                    ${renderedNotes}
                  </td>
                </tr>
              </table>
            </td>
          </tr>` : ""}
          <tr>
            <td class="email-padding" style="padding:0 36px 32px;">
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;">
                <tr>
                  <td style="padding:20px;text-align:center;">
                    <div style="color:#1e3a8a;font-size:16px;font-weight:700;line-height:1.4;">Reply to this email to contact ${safeCandidateName}</div>
                    <div style="color:#475569;font-size:13px;line-height:1.6;margin-top:8px;">Hit &ldquo;Reply&rdquo; to send a message directly to ${safeCandidateName}. Your response will be securely routed to their JOBSAGE candidate portal.</div>
                    <div style="color:#64748b;font-size:12px;line-height:1.5;margin-top:12px;">Candidate reply address: <strong style="color:#334155;">${safeJobsageEmail}</strong></div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td class="email-padding" style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:20px 36px;text-align:center;">
              <p style="color:#64748b;font-size:12px;line-height:1.6;margin:0;">Please handle candidate information in accordance with applicable privacy requirements.</p>
              <p style="color:#94a3b8;font-size:11px;line-height:1.6;margin:8px 0 0;">Ref: JS-${opts.applicationId} &nbsp;|&nbsp; JOBSAGE UK</p>
              <p style="color:#94a3b8;font-size:11px;line-height:1.6;margin:4px 0 0;">&copy; ${new Date().getFullYear()} JOBSAGE</p>
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
