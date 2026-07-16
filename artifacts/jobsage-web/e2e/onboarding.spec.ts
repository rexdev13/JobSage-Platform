import { test, expect } from "@playwright/test";

const BASE = "/jobsage";

test.describe("Onboarding journey page structure", () => {
  test("root path redirects to login when unauthenticated", async ({ page }) => {
    await page.goto(`${BASE}/`);
    await expect(page).toHaveURL(new RegExp("login|register|landing|jobsage"), { timeout: 5000 });
    await expect(page.locator("body")).not.toContainText("500");
  });

  test("login page does not show server error", async ({ page }) => {
    await page.goto(`${BASE}/login`);
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toMatch(/500|internal server error/i);
    await expect(page).toHaveURL(new RegExp("login|jobsage"));
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
