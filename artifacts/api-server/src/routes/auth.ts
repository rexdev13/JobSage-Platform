import bcrypt from "bcryptjs";
import { Router, type IRouter, type Request, type Response } from "express";
import { GetCurrentAuthUserResponse } from "@workspace/api-zod";
import { writeAuditEvent } from "../lib/audit";
import { db, usersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import {
  clearSession,
  createSession,
  deleteSession,
  getSessionId,
  generateToken,
  tokenExpiresAt,
  SESSION_COOKIE,
  SESSION_TTL,
  type SessionData,
} from "../lib/auth";
import { sendVerificationEmail, sendPasswordResetEmail } from "../lib/email";
import { generateJobsageEmail } from "../lib/jobsageEmailGen";

/**
 * Fire-and-forget: backfill JOBSAGE alias on users table for existing accounts that
 * registered before the alias feature was introduced.
 */
async function backfillJobsageAliasOnLogin(userId: string, firstName: string | null, lastName: string | null): Promise<void> {
  try {
    const [user] = await db
      .select({ jobsageEmail: usersTable.jobsageEmail })
      .from(usersTable)
      .where(eq(usersTable.id, userId));
    if (user && !user.jobsageEmail) {
      const alias = generateJobsageEmail(firstName, lastName);
      await db
        .update(usersTable)
        .set({ jobsageEmail: sql`COALESCE(${usersTable.jobsageEmail}, ${alias})` })
        .where(eq(usersTable.id, userId));
    }
  } catch {
    // Non-critical — backfill will retry on next login
  }
}

const BCRYPT_ROUNDS = 12;

const RESEND_COOLDOWN_MS = 60_000;
const resendLastSentAt = new Map<string, number>();

setInterval(() => {
  const cutoff = Date.now() - RESEND_COOLDOWN_MS;
  for (const [email, ts] of resendLastSentAt) {
    if (ts < cutoff) resendLastSentAt.delete(email);
  }
}, RESEND_COOLDOWN_MS).unref();

function emailErrDetail(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as Record<string, unknown>;
    const parts: string[] = [];
    if (e["message"]) parts.push(String(e["message"]));
    if (e["statusCode"]) parts.push(`status=${e["statusCode"]}`);
    if (e["name"]) parts.push(`name=${e["name"]}`);
    if (parts.length) return parts.join(", ");
  }
  return String(err);
}

const router: IRouter = Router();

function setSessionCookie(res: Response, sid: string) {
  res.cookie(SESSION_COOKIE, sid, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL,
  });
}

function getOrigin(req: Request): string {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host =
    req.headers["x-forwarded-host"] || req.headers["host"] || "localhost";
  return `${proto}://${host}`;
}

router.get("/auth/user", (req: Request, res: Response) => {
  res.json({
    ...GetCurrentAuthUserResponse.parse({ user: req.isAuthenticated() ? req.user : null }),
    isImpersonating: req.isImpersonating === true,
  });
});

router.post("/auth/register", async (req: Request, res: Response) => {
  const { email, password, firstName, lastName } = req.body as {
    email?: string;
    password?: string;
    firstName?: string;
    lastName?: string;
  };

  if (!email || typeof email !== "string" || !email.includes("@")) {
    res.status(400).json({ error: "Valid email is required" });
    return;
  }
  if (!password || typeof password !== "string" || password.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters" });
    return;
  }

  const normalised = email.trim().toLowerCase();

  const [existing] = await db
    .select({ id: usersTable.id, emailVerified: usersTable.emailVerified })
    .from(usersTable)
    .where(eq(usersTable.email, normalised));

  if (existing) {
    res.status(409).json({ error: "An account with this email already exists" });
    return;
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const token = generateToken();
  const tokenExpires = tokenExpiresAt(24);
  const jobsageAlias = generateJobsageEmail(firstName?.trim() || null, lastName?.trim() || null);

  const [user] = await db
    .insert(usersTable)
    .values({
      email: normalised,
      passwordHash,
      emailVerified: false,
      emailVerifyToken: token,
      emailVerifyTokenExpires: tokenExpires,
      firstName: firstName?.trim() || null,
      lastName: lastName?.trim() || null,
      jobsageEmail: jobsageAlias,
    })
    .returning();

  try {
    await sendVerificationEmail(normalised, token, getOrigin(req));
  } catch (err: unknown) {
    console.error(`[email] Failed to send verification email to ${normalised}: ${emailErrDetail(err)}`, err);
    // Roll back the user record so the registration can be retried
    await db.delete(usersTable).where(eq(usersTable.id, user.id));
    res.status(503).json({
      error: "We were unable to send your verification email. Please try again shortly.",
    });
    return;
  }

  res.status(201).json({
    message: "Account created. Please check your email to verify your account before signing in.",
    userId: user.id,
  });
});

router.post("/auth/employer-register", async (req: Request, res: Response) => {
  const { email, password, firstName, lastName } = req.body as {
    email?: string;
    password?: string;
    firstName?: string;
    lastName?: string;
  };

  if (!email || typeof email !== "string" || !email.includes("@")) {
    res.status(400).json({ error: "Valid email is required" });
    return;
  }
  if (!password || typeof password !== "string" || password.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters" });
    return;
  }

  const normalised = email.trim().toLowerCase();

  const [existing] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, normalised));

  if (existing) {
    res.status(409).json({ error: "An account with this email already exists" });
    return;
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  const [user] = await db
    .insert(usersTable)
    .values({
      email: normalised,
      passwordHash,
      emailVerified: true,
      role: "employer",
      firstName: firstName?.trim() || null,
      lastName: lastName?.trim() || null,
    })
    .returning();

  const sessionData: SessionData = {
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      profileImageUrl: user.profileImageUrl,
      role: user.role,
    },
  };

  const sid = await createSession(sessionData);
  setSessionCookie(res, sid);

  res.status(201).json(
    GetCurrentAuthUserResponse.parse({ user: sessionData.user }),
  );
});

router.get("/auth/verify-email", async (req: Request, res: Response) => {
  const token = req.query.token as string | undefined;
  const origin = getOrigin(req);

  if (!token) {
    res.redirect(`${origin}/login?error=invalid_token`);
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.emailVerifyToken, token));

  if (
    !user ||
    !user.emailVerifyTokenExpires ||
    user.emailVerifyTokenExpires < new Date()
  ) {
    res.redirect(`${origin}/login?error=token_expired`);
    return;
  }

  await db
    .update(usersTable)
    .set({
      emailVerified: true,
      emailVerifyToken: null,
      emailVerifyTokenExpires: null,
    })
    .where(eq(usersTable.id, user.id));

  const sessionData: SessionData = {
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      profileImageUrl: user.profileImageUrl,
      role: user.role,
    },
  };

  const sid = await createSession(sessionData);
  setSessionCookie(res, sid);
  res.redirect(origin + "/");
});

router.post("/auth/login", async (req: Request, res: Response) => {
  const { email, password } = req.body as {
    email?: string;
    password?: string;
  };

  if (!email || !password) {
    res.status(400).json({ error: "Email and password are required" });
    return;
  }

  const normalised = email.trim().toLowerCase();

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, normalised));

  if (!user || !user.passwordHash) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const passwordMatch = await bcrypt.compare(password, user.passwordHash);
  if (!passwordMatch) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  if (!user.emailVerified) {
    res.status(403).json({
      error: "Please verify your email address before signing in. Check your inbox for a verification link.",
      code: "email_not_verified",
    });
    return;
  }

  if (user.suspendedAt) {
    res.status(403).json({
      error: "Your account has been suspended. Please contact support@jobsage.co.uk if you believe this is an error.",
      code: "account_suspended",
    });
    return;
  }

  const sessionData: SessionData = {
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      profileImageUrl: user.profileImageUrl,
      role: user.role,
    },
  };

  const sid = await createSession(sessionData);
  setSessionCookie(res, sid);

  writeAuditEvent(user.id, "user_login").catch(() => {});

  // Retroactive backfill: ensure candidate gets a JOBSAGE alias on every login
  if (user.role === "candidate" || user.role == null) {
    backfillJobsageAliasOnLogin(user.id, user.firstName, user.lastName).catch(() => {});
  }

  res.json({
    ...GetCurrentAuthUserResponse.parse({
      user: sessionData.user,
    }),
    token: sid,
  });
});

router.post("/auth/logout", async (req: Request, res: Response) => {
  const sid = getSessionId(req);
  await clearSession(res, sid);
  res.json({ success: true });
});

router.post("/auth/forgot-password", async (req: Request, res: Response) => {
  const { email } = req.body as { email?: string };

  if (!email || typeof email !== "string") {
    res.status(400).json({ error: "Email is required" });
    return;
  }

  const normalised = email.trim().toLowerCase();
  const [user] = await db
    .select({ id: usersTable.id, emailVerified: usersTable.emailVerified })
    .from(usersTable)
    .where(eq(usersTable.email, normalised));

  const SAFE_RESPONSE = {
    message: "If an account with that email exists, a password reset link has been sent.",
  };

  if (!user) {
    res.json(SAFE_RESPONSE);
    return;
  }

  const token = generateToken();
  const tokenExpires = tokenExpiresAt(24);

  await db
    .update(usersTable)
    .set({
      passwordResetToken: token,
      passwordResetTokenExpires: tokenExpires,
    })
    .where(eq(usersTable.id, user.id));

  try {
    await sendPasswordResetEmail(normalised, token, getOrigin(req));
  } catch (err: unknown) {
    console.error(`[email] Failed to send password reset email to ${normalised}: ${emailErrDetail(err)}`, err);
  }

  res.json(SAFE_RESPONSE);
});

router.post("/auth/reset-password", async (req: Request, res: Response) => {
  const { token, password } = req.body as {
    token?: string;
    password?: string;
  };

  if (!token || !password) {
    res.status(400).json({ error: "Token and new password are required" });
    return;
  }
  if (password.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters" });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.passwordResetToken, token));

  if (
    !user ||
    !user.passwordResetTokenExpires ||
    user.passwordResetTokenExpires < new Date()
  ) {
    res.status(400).json({ error: "Reset link is invalid or has expired. Please request a new one." });
    return;
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  await db
    .update(usersTable)
    .set({
      passwordHash,
      emailVerified: true,
      emailVerifyToken: null,
      emailVerifyTokenExpires: null,
      passwordResetToken: null,
      passwordResetTokenExpires: null,
    })
    .where(eq(usersTable.id, user.id));

  res.json({ message: "Password updated successfully. You can now sign in." });
});

router.post("/auth/resend-verification", async (req: Request, res: Response) => {
  const { email } = req.body as { email?: string };

  if (!email || typeof email !== "string") {
    res.status(400).json({ error: "Email is required" });
    return;
  }

  const normalised = email.trim().toLowerCase();

  const lastSent = resendLastSentAt.get(normalised);
  if (lastSent !== undefined) {
    const elapsed = Date.now() - lastSent;
    if (elapsed < RESEND_COOLDOWN_MS) {
      const retryAfter = Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000);
      res.status(429).set("Retry-After", String(retryAfter)).json({
        error: `Please wait before requesting another email.`,
        retryAfter,
      });
      return;
    }
  }

  resendLastSentAt.set(normalised, Date.now());

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, normalised));

  const SAFE_RESPONSE = {
    message: "If an unverified account with that email exists, a new verification link has been sent.",
  };

  if (!user || user.emailVerified) {
    res.json(SAFE_RESPONSE);
    return;
  }

  const token = generateToken();
  const tokenExpires = tokenExpiresAt(24);

  await db
    .update(usersTable)
    .set({
      emailVerifyToken: token,
      emailVerifyTokenExpires: tokenExpires,
    })
    .where(eq(usersTable.id, user.id));

  try {
    await sendVerificationEmail(normalised, token, getOrigin(req));
  } catch (err: unknown) {
    console.error(`[email] Failed to resend verification email to ${normalised}: ${emailErrDetail(err)}`, err);
  }

  res.json(SAFE_RESPONSE);
});

export default router;
