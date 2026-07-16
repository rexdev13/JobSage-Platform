import { test, expect } from "@playwright/test";

const BASE = "/jobsage";

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
    await emailField.fill(`e2e_${Date.now()}@qatest.dev`);
    await passwordField.fill("abc");
    await page.getByRole("button", { name: /register|create|sign up/i }).click();
    const errorVisible = await page.locator("body").evaluate(
      (el) => el.innerText.match(/password|8 char|too short|minimum|required/i) !== null
        || el.querySelector(":invalid") !== null
    );
    expect(errorVisible).toBeTruthy();
  });

  test("successful registration shows email verification message", async ({ page }) => {
    const uniqueEmail = `e2e_${Date.now()}@qatest.dev`;
    await page.goto(`${BASE}/register`);
    const emailField = page.locator("input[type='email'], input[name='email'], input[placeholder*='email' i]").first();
    await emailField.fill(uniqueEmail);
    const passwordFields = page.locator("input[type='password']");
    await passwordFields.first().fill("TestPass99!");
    const count = await passwordFields.count();
    if (count > 1) {
      await passwordFields.nth(1).fill("TestPass99!");
    }
    await page.getByRole("button", { name: /register|create|sign up/i }).click();
    await expect(page.locator("body")).toContainText(/email|verify|check|sent/i, { timeout: 10000 });
  });

  test("forgot password page renders and accepts email submission", async ({ page }) => {
    await page.goto(`${BASE}/forgot-password`);
    await expect(page.locator("input[type='email'], input[name='email'], input[placeholder*='email' i]").first()).toBeVisible();
    const sendButton = page.getByRole("button", { name: /send|reset|submit/i });
    await expect(sendButton).toBeVisible();
    await page.locator("input[type='email'], input[name='email'], input[placeholder*='email' i]").first().fill("test@example.com");
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
