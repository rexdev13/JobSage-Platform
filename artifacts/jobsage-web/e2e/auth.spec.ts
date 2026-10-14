import { readFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";

const BASE = process.env.JOBSAGE_WEB_BASE_PATH ?? "";

async function capturedVerificationToken(email: string): Promise<string> {
  const capturePath = process.env.JOBSAGE_DEV_EMAIL_CAPTURE_PATH;
  if (!capturePath) {
    throw new Error("JOBSAGE_DEV_EMAIL_CAPTURE_PATH is required for the registration verification E2E.");
  }

  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const contents = await readFile(capturePath, "utf8").catch(() => "");
    for (const line of contents.split(/\r?\n/).filter(Boolean).reverse()) {
      let message: { to?: unknown; subject?: unknown; html?: unknown };
      try {
        message = JSON.parse(line) as typeof message;
      } catch {
        continue;
      }

      const recipients = Array.isArray(message.to) ? message.to : [message.to];
      if (
        message.subject !== "JOBSAGE: Verify your email address" ||
        !recipients.some((recipient) => typeof recipient === "string" && recipient.toLowerCase() === email.toLowerCase()) ||
        typeof message.html !== "string"
      ) {
        continue;
      }

      const href = message.html.match(/href=["']([^"']*\/api\/auth\/verify-email\?[^"']+)["']/i)?.[1];
      if (!href) continue;
      const link = new URL(href);
      if (link.pathname !== "/api/auth/verify-email") continue;
      const token = link.searchParams.get("token");
      if (token) return token;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error("Development email capture did not contain the synthetic account's verification link.");
}

test.describe("Authentication pages", () => {
  test("login page renders with all required elements", async ({ page }) => {
    await page.goto(`${BASE}/login`);
    await expect(page.locator("input[type='email'], input[name='email'], input[placeholder*='email' i]").first()).toBeVisible();
    await expect(page.locator("input[type='password']").first()).toBeVisible();
    await expect(page.getByRole("button", { name: /sign in|log in/i })).toBeVisible();
  });

  test("login with invalid credentials shows error message", async ({ page }) => {
    await page.goto(`${BASE}/login`);
    await page.locator("input[type='email'], input[name='email'], input[placeholder*='email' i]").first().fill("nobody@noexist.invalid");
    await page.locator("input[type='password']").first().fill("wrongpassword");
    await page.getByRole("button", { name: /sign in|log in/i }).click();
    await expect(page.locator("body")).toContainText(/invalid|incorrect|wrong|not found|error/i, { timeout: 8000 });
    await expect(page).toHaveURL(new RegExp("login"));
  });

  test("login page has a link to the registration page", async ({ page }) => {
    await page.goto(`${BASE}/login`);
    const registerLink = page.getByRole("link", { name: /register|create account|sign up/i });
    await expect(registerLink).toBeVisible();
    await registerLink.click();
    await expect(page).toHaveURL(new RegExp("register"), { timeout: 5000 });
  });

  test("login page has a forgot password link", async ({ page }) => {
    await page.goto(`${BASE}/login`);
    const forgotLink = page.getByRole("link", { name: /forgot/i });
    await expect(forgotLink).toBeVisible();
  });

  test("register page renders with email and password inputs", async ({ page }) => {
    await page.goto(`${BASE}/register`);
    await expect(page.locator("input[type='email'], input[name='email'], input[placeholder*='email' i]").first()).toBeVisible();
    await expect(page.locator("input[type='password']").first()).toBeVisible();
    await expect(page.getByRole("button", { name: /register|create|sign up/i })).toBeVisible();
  });

  test("register with too-short password shows validation error", async ({ page }) => {
    await page.goto(`${BASE}/register`);
    const emailField = page.locator("input[type='email'], input[name='email'], input[placeholder*='email' i]").first();
    const passwordField = page.locator("input[type='password']").first();
    await emailField.fill(`e2e_${Date.now()}@jobsage.test`);
    await passwordField.fill("abc");
    await page.getByRole("button", { name: /register|create|sign up/i }).click();
    const errorVisible = await page.locator("body").evaluate(
      (el) => el.innerText.match(/password|8 char|too short|minimum|required/i) !== null
        || el.querySelector(":invalid") !== null
    );
    expect(errorVisible).toBeTruthy();
  });

  test("successful registration shows email verification message", async ({ page }) => {
    const uniqueEmail = `e2e_${Date.now()}@jobsage.test`;
    await page.goto(`${BASE}/register`);
    const emailField = page.locator("input[type='email'], input[name='email'], input[placeholder*='email' i]").first();
    await emailField.fill(uniqueEmail);
    const passwordFields = page.locator("input[type='password']");
    await passwordFields.first().fill("TestPass99!");
    const count = await passwordFields.count();
    if (count > 1) {
      await passwordFields.nth(1).fill("TestPass99!");
    }
    await page.getByRole("checkbox", { name: /I am 18 or older/i }).check();
    await page.getByRole("button", { name: /register|create|sign up/i }).click();
    await expect(page.locator("body")).toContainText(/email|verify|check|sent/i, { timeout: 10000 });

    const token = await capturedVerificationToken(uniqueEmail);
    const baseUrl = process.env.BASE_URL;
    if (!baseUrl) throw new Error("BASE_URL must point to the development preview for this E2E.");
    const verifyUrl = new URL("/api/auth/verify-email", baseUrl);
    verifyUrl.searchParams.set("token", token);
    await page.goto(verifyUrl.toString());

    const authUser = await page.evaluate(async () => {
      const response = await fetch("/api/auth/user", { credentials: "include" });
      return await response.json() as { user?: { email?: string } };
    });
    expect(authUser.user?.email).toBe(uniqueEmail);
  });

  test("forgot password page renders and accepts email submission", async ({ page }) => {
    await page.goto(`${BASE}/forgot-password`);
    await expect(page.locator("input[type='email'], input[name='email'], input[placeholder*='email' i]").first()).toBeVisible();
    const sendButton = page.getByRole("button", { name: /send|reset|submit/i });
    await expect(sendButton).toBeVisible();
    await page.locator("input[type='email'], input[name='email'], input[placeholder*='email' i]").first().fill(`e2e_forgot_${Date.now()}@jobsage.test`);
    await sendButton.click();
    await expect(page.locator("body")).toContainText(/sent|check|email|reset|success/i, { timeout: 8000 });
  });
});

test.describe("Auth guard", () => {
  test("unauthenticated access to dashboard redirects to login", async ({ page }) => {
    await page.goto(`${BASE}/dashboard`);
    await expect(page).toHaveURL(new RegExp("login"), { timeout: 5000 });
  });

  test("unauthenticated access to profile redirects to login", async ({ page }) => {
    await page.goto(`${BASE}/profile`);
    await expect(page).toHaveURL(new RegExp("login"), { timeout: 5000 });
  });
});
