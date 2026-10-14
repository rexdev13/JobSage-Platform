import { expect, test } from "@playwright/test";

const BASE_PATH = process.env.JOBSAGE_WEB_BASE_PATH ?? "";

test.describe("authentication accessibility", () => {
  test("sign-in has a page heading, named fields, and a keyboard-operable password toggle", async ({ page }) => {
    await page.goto(`${BASE_PATH}/login`);

    await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
    await expect(page.getByLabel("Email address")).toBeVisible();
    await expect(page.getByLabel("Password", { exact: true })).toBeVisible();

    const showPassword = page.getByRole("button", { name: "Show password" });
    await expect(showPassword).toHaveAttribute("aria-pressed", "false");
    await showPassword.focus();
    await expect(showPassword).toBeFocused();
    await page.keyboard.press("Enter");

    const hidePassword = page.getByRole("button", { name: "Hide password" });
    await expect(hidePassword).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("type", "text");
  });

  test("registration fields and both password toggles have accessible names", async ({ page }) => {
    await page.goto(`${BASE_PATH}/register`);

    await expect(page.getByRole("heading", { level: 1, name: "Create account" })).toBeVisible();
    for (const label of ["First name", "Last name", "Email address", "Password", "Confirm password"]) {
      await expect(page.getByLabel(label, { exact: true })).toBeVisible();
    }

    const showPassword = page.getByRole("button", { name: "Show password" });
    const showConfirmation = page.getByRole("button", { name: "Show confirmation password" });
    await expect(showPassword).toHaveJSProperty("tabIndex", 0);
    await expect(showConfirmation).toHaveJSProperty("tabIndex", 0);

    await showPassword.focus();
    await page.keyboard.press("Space");
    await expect(page.getByRole("button", { name: "Hide password" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("type", "text");

    await showConfirmation.focus();
    await page.keyboard.press("Space");
    await expect(page.getByRole("button", { name: "Hide confirmation password" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByLabel("Confirm password", { exact: true })).toHaveAttribute("type", "text");
  });

  test("password recovery pages use level-one headings and associated field labels", async ({ page }) => {
    await page.goto(`${BASE_PATH}/forgot-password`);
    await expect(page.getByRole("heading", { level: 1, name: "Forgot password?" })).toBeVisible();
    await expect(page.getByLabel("Email address", { exact: true })).toBeVisible();

    await page.goto(`${BASE_PATH}/reset-password?token=accessibility-test-token`);
    await expect(page.getByRole("heading", { level: 1, name: "Set new password" })).toBeVisible();
    await expect(page.getByLabel("New password", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Confirm new password", { exact: true })).toBeVisible();

    const showPasswords = page.getByRole("button", { name: "Show passwords" });
    await showPasswords.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Hide passwords" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByLabel("New password", { exact: true })).toHaveAttribute("type", "text");
    await expect(page.getByLabel("Confirm new password", { exact: true })).toHaveAttribute("type", "text");
  });
});
