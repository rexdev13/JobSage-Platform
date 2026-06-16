import { Resend } from "resend";

if (!process.env.RESEND_API_KEY) {
  console.error("[email] CRITICAL: RESEND_API_KEY is not set — all emails will fail");
}

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = process.env.EMAIL_FROM ?? "noreply@jobsage.co.uk";
const APP_URL = process.env.APP_URL ?? "https://jobsage.co.uk";

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
}

function jobAlertEmailHtml(
  firstName: string,
  eligibleRoles: AlertRole[],
  workTowardsRoles: AlertRole[],
  alertFrequency: "daily" | "weekly" = "daily",
): string {
  const frequencyLabel = alertFrequency === "weekly" ? "weekly" : "daily";
  const roleRow = (role: AlertRole) => `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #f1f5f9;">
        <p style="margin:0 0 2px;font-size:15px;font-weight:600;color:#0f172a;">${role.title}</p>
        <p style="margin:0;font-size:13px;color:#64748b;">${role.employer} · ${role.location}${role.sponsorshipOffered ? " · <span style=\"color:#059669;\">Sponsorship Available</span>" : ""}</p>
      </td>
    </tr>`;

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

  await resend.emails.send({
    from: `JOBSAGE <${FROM}>`,
    to,
    subject,
    html: jobAlertEmailHtml(firstName, eligibleRoles, workTowardsRoles, alertFrequency),
  });
}

export async function sendVerificationEmail(to: string, token: string): Promise<void> {
  const verifyUrl = `${APP_URL}/api/auth/verify-email?token=${encodeURIComponent(token)}`;
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

export async function sendPasswordResetEmail(to: string, token: string): Promise<void> {
  const resetUrl = `${APP_URL}/reset-password?token=${encodeURIComponent(token)}`;
  await resend.emails.send({
    from: `JOBSAGE <${FROM}>`,
    to,
    subject: "JOBSAGE: Reset your password",
    html: resetPasswordEmailHtml(resetUrl),
  });
}
