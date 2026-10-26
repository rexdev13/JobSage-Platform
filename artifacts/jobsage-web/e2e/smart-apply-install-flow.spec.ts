import { expect, test } from "@playwright/test";

const BASE_PATH = process.env.JOBSAGE_WEB_BASE_PATH ?? "";
const STORE_URL = "https://chromewebstore.google.com/detail/jobsage-smart-apply/dnafhjmagedfebkfdackdbgkpgklpokb";

test.describe("Smart Apply install flow", () => {
  test("desktop user opens a page-sized Store popup and can return to JOBSAGE", async ({ page, context }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await context.route("https://chromewebstore.google.com/**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<!doctype html><html><body><h1>JOBSAGE Smart Apply Chrome Web Store listing</h1></body></html>",
      });
    });

    await page.goto(`${BASE_PATH}/e2e/fixtures/smart-apply-install-harness.html`);
    await page.getByRole("button", { name: /get the extension/i }).click();
    const installLink = page.getByRole("link", { name: /add to chrome/i });
    await expect(installLink).toHaveAttribute("href", STORE_URL);
    await expect(page.getByText(/opens in a separate window.*close it to return to jobsage/i)).toBeVisible();

    const popupPromise = page.waitForEvent("popup");
    await installLink.click();
    const popup = await popupPromise;
    await expect(popup).toHaveURL(STORE_URL);
    await expect(popup.getByRole("heading", { name: /chrome web store listing/i })).toBeVisible();

    const pageSize = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
    const popupSize = await popup.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
    expect(popupSize.width).toBeGreaterThanOrEqual(pageSize.width);
    expect(popupSize.height).toBeGreaterThanOrEqual(pageSize.height);
    await expect(page.getByRole("button", { name: /no thanks/i })).toBeVisible();

    await popup.close();
    await expect(page.getByRole("button", { name: /no thanks/i })).toBeVisible();
  });

  test("mobile user sees desktop-only guidance without install controls", async ({ browser }) => {
    const context = await browser.newContext({
      userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
      viewport: { width: 402, height: 874 },
      isMobile: true,
      hasTouch: true,
    });
    try {
      const page = await context.newPage();
      await page.goto(`${BASE_PATH}/e2e/fixtures/smart-apply-install-harness.html`);

      await expect(page.getByText("Smart Apply is available on desktop Chrome")).toBeVisible();
      await expect(page.getByText(/open jobsage on a desktop or laptop/i)).toBeVisible();
      await expect(page.getByRole("button", { name: /get the extension/i })).toHaveCount(0);
      await expect(page.getByRole("link", { name: /add to chrome/i })).toHaveCount(0);
      await expect(page.getByRole("link", { name: /download the extension/i })).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});
