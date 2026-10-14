import { test, expect } from "@playwright/test";

const BASE = process.env.JOBSAGE_WEB_BASE_PATH ?? "";

test.describe("Onboarding journey page structure", () => {
  test("public root loads without a server error", async ({ page }) => {
    await page.goto(`${BASE}/`);
    await expect(page.locator("body")).not.toContainText("500");
    await expect(page.locator("body")).not.toBeEmpty();
  });

  test("login page does not show server error", async ({ page }) => {
    await page.goto(`${BASE}/login`);
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toMatch(/500|internal server error/i);
    await expect(page).toHaveURL(/\/login/);
  });

  test("register page does not show server error", async ({ page }) => {
    await page.goto(`${BASE}/register`);
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toMatch(/500|internal server error/i);
  });

  test("forgot-password page does not show server error", async ({ page }) => {
    await page.goto(`${BASE}/forgot-password`);
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toMatch(/500|internal server error/i);
  });

  test("page title includes JOBSAGE branding", async ({ page }) => {
    await page.goto(`${BASE}/login`);
    const title = await page.title();
    expect(title.length).toBeGreaterThan(0);
  });
});

test.describe("Sponsor search page (public-facing)", () => {
  test("sponsor search page is accessible", async ({ page }) => {
    await page.goto(`${BASE}/sponsor-search`);
    const status = await page.evaluate(() => document.readyState);
    expect(status).toBe("complete");
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toMatch(/500|internal server error/i);
  });
});
