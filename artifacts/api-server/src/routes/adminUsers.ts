import { Router, type IRouter, type Request, type Response } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireRole } from "../middlewares/requireRole";
import { sendVerificationEmail, sendPasswordResetEmail } from "../lib/email";
import { generateToken, tokenExpiresAt } from "../lib/auth";

const router: IRouter = Router();

function extractParamId(req: Request): string | null {
  const raw = req.params["id"];
  if (typeof raw === "string" && raw.length > 0) return raw;
  if (Array.isArray(raw) && typeof raw[0] === "string" && raw[0].length > 0) return raw[0];
  return null;
}

router.get(
  "/admin/users/search",
  requireRole("admin"),
  async (req: Request, res: Response): Promise<void> => {
    const { email } = req.query as { email?: string };

    if (!email || typeof email !== "string" || !email.includes("@")) {
      res.status(400).json({ error: "A valid email is required." });
      return;
    }

    const normalised = email.trim().toLowerCase();

    const [user] = await db
      .select({
        id: usersTable.id,
        email: usersTable.email,
        firstName: usersTable.firstName,
        lastName: usersTable.lastName,
        role: usersTable.role,
        emailVerified: usersTable.emailVerified,
        hasPassword: usersTable.passwordHash,
        emailVerifyTokenExpires: usersTable.emailVerifyTokenExpires,
        passwordResetTokenExpires: usersTable.passwordResetTokenExpires,
        createdAt: usersTable.createdAt,
        updatedAt: usersTable.updatedAt,
      })
      .from(usersTable)
      .where(eq(usersTable.email, normalised));

    if (!user) {
      res.status(404).json({ error: "No account found with that email address." });
      return;
    }

    res.json({
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      emailVerified: user.emailVerified,
      hasPassword: Boolean(user.hasPassword),
      emailVerifyTokenExpires: user.emailVerifyTokenExpires,
      passwordResetTokenExpires: user.passwordResetTokenExpires,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    });
  }
);

router.post(
  "/admin/users/:id/resend-verification",
  requireRole("admin"),
  async (req: Request, res: Response): Promise<void> => {
    const id = extractParamId(req);
    if (!id) {
      res.status(400).json({ error: "User ID is required." });
      return;
    }

    const [user] = await db
      .select({
        id: usersTable.id,
        email: usersTable.email,
        emailVerified: usersTable.emailVerified,
      })
      .from(usersTable)
      .where(eq(usersTable.id, id));

    if (!user) {
      res.status(404).json({ error: "User not found." });
      return;
    }

    if (!user.email) {
      res.status(422).json({ error: "This account has no email address on file." });
      return;
    }

    if (user.emailVerified) {
      res.status(409).json({ error: "This account is already verified." });
      return;
    }

    const token = generateToken();
    const tokenExpires = tokenExpiresAt(24);

    await db
      .update(usersTable)
      .set({ emailVerifyToken: token, emailVerifyTokenExpires: tokenExpires })
      .where(eq(usersTable.id, id));

    try {
      await sendVerificationEmail(user.email, token);
    } catch (err) {
      console.error(`[admin] Failed to resend verification to ${user.email}:`, err);
      res.status(503).json({ error: "Failed to send verification email. Please try again." });
      return;
    }

    res.json({ message: `Verification email sent to ${user.email}.` });
  }
);

router.post(
  "/admin/users/:id/send-password-reset",
  requireRole("admin"),
  async (req: Request, res: Response): Promise<void> => {
    const id = extractParamId(req);
    if (!id) {
      res.status(400).json({ error: "User ID is required." });
      return;
    }

    const [user] = await db
      .select({
        id: usersTable.id,
        email: usersTable.email,
      })
      .from(usersTable)
      .where(eq(usersTable.id, id));

    if (!user) {
      res.status(404).json({ error: "User not found." });
      return;
    }

    if (!user.email) {
      res.status(422).json({ error: "This account has no email address on file." });
      return;
    }

    const token = generateToken();
    const tokenExpires = tokenExpiresAt(1);

    await db
      .update(usersTable)
      .set({ passwordResetToken: token, passwordResetTokenExpires: tokenExpires })
      .where(eq(usersTable.id, id));

    try {
      await sendPasswordResetEmail(user.email, token);
    } catch (err) {
      console.error(`[admin] Failed to send password reset to ${user.email}:`, err);
      res.status(503).json({ error: "Failed to send password reset email. Please try again." });
      return;
    }

    res.json({ message: `Password reset email sent to ${user.email}.` });
  }
);

export default router;
