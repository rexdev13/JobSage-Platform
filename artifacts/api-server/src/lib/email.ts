import { Resend } from "resend";

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

export async function sendVerificationEmail(to: string, token: string): Promise<void> {
  const verifyUrl = `${APP_URL}/api/auth/verify-email?token=${encodeURIComponent(token)}`;
  await resend.emails.send({
    from: `JOBSAGE <${FROM}>`,
    to,
    subject: "JOBSAGE: Verify your email address",
    html: verificationEmailHtml(verifyUrl),
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
