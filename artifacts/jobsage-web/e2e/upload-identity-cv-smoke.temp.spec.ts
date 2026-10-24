import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:18286";
const EMAIL_CAPTURE_PATH =
  process.env.JOBSAGE_DEV_EMAIL_CAPTURE_PATH ?? "/tmp/jobsage-dev-email-capture.jsonl";
const TEST_EMAIL = "validation.candidate@jobsage.test";

type CapturedMessage = {
  id?: string;
  to?: string | string[];
  html?: string;
  text?: string;
};

function readMessages(source: string): CapturedMessage[] {
  return source.split("\n").flatMap((line) => {
    if (!line.trim()) return [];
    try {
      return [JSON.parse(line) as CapturedMessage];
    } catch {
      return [];
    }
  });
}

async function readCapture(): Promise<CapturedMessage[]> {
  try {
    return readMessages(await readFile(EMAIL_CAPTURE_PATH, "utf8"));
  } catch {
    return [];
  }
}

function isForEmail(message: CapturedMessage, email: string): boolean {
  const recipients = Array.isArray(message.to) ? message.to : [message.to ?? ""];
  return recipients.some((recipient) => recipient.toLowerCase().includes(email.toLowerCase()));
}

async function resetSyntheticPassword(page: Page): Promise<string> {
  const previousIds = new Set((await readCapture()).flatMap((message) => message.id ? [message.id] : []));
  await page.goto(`${BASE_URL}/forgot-password`);
  await page.locator('input[type="email"]').fill(TEST_EMAIL);
  const forgotResponsePromise = page.waitForResponse((response) =>
    new URL(response.url()).pathname.endsWith("/api/auth/forgot-password")
    && response.request().method() === "POST",
  );
  await page.locator('form button[type="submit"]').click();
  expect((await forgotResponsePromise).status()).toBe(200);

  let captured: CapturedMessage | undefined;
  for (let attempt = 0; attempt < 50 && !captured; attempt += 1) {
    captured = (await readCapture()).find((message) =>
      isForEmail(message, TEST_EMAIL)
      && Boolean(message.id)
      && !previousIds.has(message.id!)
      && (message.html ?? "").includes("/reset-password?token="),
    );
    if (!captured) await page.waitForTimeout(100);
  }
  if (!captured) throw new Error("No new synthetic password-reset email was captured.");

  const body = `${captured.html ?? ""}\n${captured.text ?? ""}`.replace(/&amp;/g, "&");
  const resetLink = (body.match(/https?:\/\/[^\s"'<>]+/g) ?? []).find((candidate) => {
    try {
      return new URL(candidate).pathname.endsWith("/reset-password");
    } catch {
      return false;
    }
  });
  if (!resetLink) throw new Error("The synthetic reset email had no usable reset link.");
  const resetUrl = new URL(resetLink);
  const password = `Dev!${randomBytes(20).toString("base64url")}aA7`;
  await page.goto(`${BASE_URL}/reset-password?token=${encodeURIComponent(resetUrl.searchParams.get("token") ?? "")}`);
  await expect(page.getByRole("heading", { name: "Set new password" })).toBeVisible();
  const passwordFields = page.locator('input[type="password"]');
  await passwordFields.nth(0).fill(password);
  await passwordFields.nth(1).fill(password);
  const resetResponsePromise = page.waitForResponse((response) =>
    new URL(response.url()).pathname.endsWith("/api/auth/reset-password")
    && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Update password" }).click();
  expect((await resetResponsePromise).status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Password updated" })).toBeVisible();
  return password;
}

async function signInSyntheticAccount(page: Page, password: string): Promise<void> {
  await page.goto(`${BASE_URL}/login`);
  await page.locator('input[type="email"]').fill(TEST_EMAIL);
  await page.locator('input[type="password"]').fill(password);
  const loginResponsePromise = page.waitForResponse((response) =>
    new URL(response.url()).pathname.endsWith("/api/auth/login")
    && response.request().method() === "POST",
  );
  await page.locator('form button[type="submit"]').click();
  expect((await loginResponsePromise).status()).toBe(200);
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 15000 }).not.toBe("/login");
}

async function visitRoute(page: Page, path: string): Promise<void> {
  await page.goto(`${BASE_URL}${path}`);
  await expect.poll(() => new URL(page.url()).pathname).toBe(path);
  await expect(page.locator("body")).not.toContainText(/500|internal server error/i);
}

async function getJson<T>(page: Page, path: string): Promise<T> {
  const response = await page.context().request.get(path);
  expect(response.ok(), `${path} returned ${response.status()}`).toBeTruthy();
  return response.json() as Promise<T>;
}

test("synthetic upload, identity review, and all CV enhancement modes work end to end", async ({ browser }) => {
  test.setTimeout(420_000);
  const context = await browser.newContext({ baseURL: BASE_URL });
  const page = await context.newPage();
  let initialProfile: Record<string, unknown> | null = null;
  let uploadedPhotoKey: string | null = null;
  let originalDocumentIds = new Set<number>();
  let initialDocumentsCaptured = false;

  try {
    const password = await resetSyntheticPassword(page);
    await signInSyntheticAccount(page, password);

    const profileResponse = await context.request.get("/api/profiles/me");
    expect(profileResponse.status()).toBe(200);
    initialProfile = await profileResponse.json() as Record<string, unknown>;
    const previousPhotoKey = initialProfile.profilePhotoKey ?? null;

    const initialDocuments = await getJson<{ documents: Array<{ id: number }> }>(page, "/api/documents");
    originalDocumentIds = new Set(initialDocuments.documents.map((document) => document.id));
    initialDocumentsCaptured = true;

    const imagePage = await context.newPage();
    await imagePage.setViewportSize({ width: 160, height: 160 });
    await imagePage.setContent(
      '<body style="margin:0;background:#dbeafe;display:grid;place-items:center;font:700 24px sans-serif;color:#1e3a8a"><div style="width:112px;height:112px;border:8px solid #3b82f6;border-radius:20px;display:grid;place-items:center">TEST</div></body>',
    );
    const syntheticPng = await imagePage.screenshot({ type: "png" });
    const pdfPage = await context.newPage();
    await pdfPage.setContent(
      `<html><body style="font:14px Arial"><h1>Synthetic CV Test</h1><p>All content below is fictional test data.</p><h2>Summary</h2><p>Project coordinator with experience organising delivery teams and documenting project outcomes.</p><h2>Experience</h2><p>Example Works Group — Project Coordinator — 2022–2025</p><ul><li>Coordinated 4 workstreams and maintained weekly delivery records.</li><li>Reduced document-processing time by 20% through a revised checklist.</li></ul><p>Unique synthetic CV source fact: 4 workstreams, 20% improvement.</p><h2>Education</h2><p>Example Institute — Project Management Certificate — 2021</p></body></html>`,
    );
    const cvPdf = await pdfPage.pdf({ format: "A4", printBackground: false });
    await imagePage.close();
    await pdfPage.close();

    await visitRoute(page, "/profile");
    const photoSavePromise = page.waitForResponse((response) => {
      if (
        response.request().method() !== "PUT"
        || !new URL(response.url()).pathname.endsWith("/api/profiles/me")
      ) return false;
      const body = response.request().postDataJSON() as { profilePhotoKey?: string | null } | null;
      return Boolean(body?.profilePhotoKey && body.profilePhotoKey !== previousPhotoKey);
    }, { timeout: 30000 });
    await page.locator('input[type="file"]').first().setInputFiles({
      name: "synthetic-profile.png",
      mimeType: "image/png",
      buffer: syntheticPng,
    });
    const photoSaveResponse = await photoSavePromise;
    expect(photoSaveResponse.ok()).toBeTruthy();
    const updatedProfile = await getJson<{ profilePhotoKey: string | null }>(page, "/api/profiles/me");
    expect(updatedProfile.profilePhotoKey).toBeTruthy();
    expect(updatedProfile.profilePhotoKey).not.toBe(previousPhotoKey);
    uploadedPhotoKey = updatedProfile.profilePhotoKey;
    const photoObjectPath = `/api/storage/objects${uploadedPhotoKey!.replace(/^\/objects/, "")}`;
    const storedPhoto = await context.request.get(photoObjectPath);
    expect(storedPhoto.status()).toBe(200);
    expect(storedPhoto.headers()["content-type"]).toContain("image/png");

    await visitRoute(page, "/documents");
    const textDocumentResponsePromise = page.waitForResponse((response) =>
      response.request().method() === "POST"
      && new URL(response.url()).pathname.endsWith("/api/documents"),
    );
    await page.locator('input[type="file"]').first().setInputFiles({
      name: "synthetic-upload-check.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Synthetic document-upload test. No real candidate data."),
    });
    const textDocumentResponse = await textDocumentResponsePromise;
    expect(textDocumentResponse.status()).toBe(201);
    const textDocument = await textDocumentResponse.json() as { id: number; mimeType: string };
    expect(textDocument.mimeType).toBe("text/plain");
    await expect(page.getByTestId(`document-card-${textDocument.id}`)).toBeVisible();

    await visitRoute(page, "/identity-verification");
    await expect(page.getByRole("button", { name: /Submit for verification/i })).toBeDisabled();
    const identityInputs = page.locator('input[type="file"]');
    expect(await identityInputs.count()).toBe(2);
    await identityInputs.nth(0).setInputFiles({
      name: "synthetic-id.png",
      mimeType: "image/png",
      buffer: syntheticPng,
    });
    await identityInputs.nth(1).setInputFiles({
      name: "synthetic-selfie.png",
      mimeType: "image/png",
      buffer: syntheticPng,
    });
    const identitySubmitPromise = page.waitForResponse((response) =>
      response.request().method() === "POST"
      && new URL(response.url()).pathname.endsWith("/api/identity/submit"),
    );
    await page.getByRole("button", { name: /Submit for verification/i }).click();
    const identitySubmitResponse = await identitySubmitPromise;
    expect(identitySubmitResponse.status()).toBe(200);
    const identitySubmission = await identitySubmitResponse.json() as { status: string };
    expect(identitySubmission.status).toBe("pending");

    let identity: { status: string; aiConfidence: string | null; aiNotes: string | null } | null = null;
    await expect.poll(async () => {
      const result = await getJson<{ verification: typeof identity }>(page, "/api/identity/status");
      identity = result.verification;
      return result.verification?.aiConfidence ?? null;
    }, { timeout: 60000, intervals: [1000, 2000, 3000] }).not.toBeNull();
    expect(identity?.status).toBe("pending");
    expect(identity?.aiNotes ?? "").not.toMatch(/AI check failed|could not read/i);

    const uploadUrlResponse = await context.request.post("/api/storage/uploads/request-url", {
      data: { name: "synthetic-cv.pdf", size: cvPdf.length, contentType: "application/pdf" },
    });
    expect(uploadUrlResponse.status()).toBe(200);
    const uploadInfo = await uploadUrlResponse.json() as { uploadURL: string; storageKey: string };
    const storedCvResponse = await context.request.put(uploadInfo.uploadURL, {
      data: cvPdf,
      headers: { "Content-Type": "application/pdf" },
    });
    expect(storedCvResponse.ok()).toBeTruthy();
    const cvRegistrationResponse = await context.request.post("/api/documents", {
      data: {
        filename: "synthetic-cv.pdf",
        mimeType: "application/pdf",
        storageKey: uploadInfo.storageKey,
        fileSize: cvPdf.length,
      },
    });
    expect(cvRegistrationResponse.status()).toBe(201);
    const cvDocument = await cvRegistrationResponse.json() as { id: number };
    const cvTypeResponse = await context.request.patch(`/api/documents/${cvDocument.id}/type`, {
      data: { documentType: "cv" },
    });
    expect(cvTypeResponse.ok()).toBeTruthy();

    await visitRoute(page, "/documents");
    const cvCard = page.getByTestId(`document-card-${cvDocument.id}`);
    await expect(cvCard).toBeVisible();
    await cvCard.getByRole("button", { name: "Enhance CV" }).click();
    await expect(page.locator('input[name="enh-mode"][value="general"]')).toBeVisible();
    const cvChoice = page.locator(`input[name="cv-select"][value="${cvDocument.id}"]`);
    if (await cvChoice.count()) await cvChoice.check();

    async function generateMode(mode: "general" | "focused" | "focus_only", focus?: string) {
      await page.locator(`input[name="enh-mode"][value="${mode}"]`).check();
      if (focus) await page.locator("#cv-focus").fill(focus);
      const enhancementResponsePromise = page.waitForResponse((response) =>
        response.request().method() === "POST"
        && new URL(response.url()).pathname.endsWith("/api/profiles/cv-enhancement"),
        { timeout: 120000 },
      );
      await page.getByRole("button", { name: "Enhance CV" }).last().click();
      const enhancementResponse = await enhancementResponsePromise;
      expect(enhancementResponse.status(), `${mode} enhancement response`).toBe(200);
      const result = await enhancementResponse.json() as {
        mode: string;
        enhancedContent: string;
        originalText: string;
      };
      expect(result.mode).toBe(mode);
      expect(result.enhancedContent.trim().length).toBeGreaterThan(40);
      expect(result.originalText).toContain("Unique synthetic CV source fact");
      await expect(page.locator('textarea[aria-label="Edit enhanced CV content"]')).toBeVisible();
      await expect(page.getByTestId("uk-cv-conventions-note")).toBeVisible();
      await page.getByRole("button", { name: "Original", exact: true }).click();
      await expect(page.getByText("Unique synthetic CV source fact")).toBeVisible();
      return result;
    }

    await generateMode("general");
    await page.getByRole("button", { name: "Try again" }).click();
    await generateMode("focused", "UK project coordinator roles");
    await page.getByRole("button", { name: "Try again" }).click();
    await generateMode("focus_only", "project coordination");

    await page.getByRole("checkbox", { name: /I compared the draft with the original/ }).check();
    await page.getByRole("checkbox", { name: /Set as primary CV/ }).uncheck();
    const finalizeResponsePromise = page.waitForResponse((response) =>
      response.request().method() === "POST"
      && new URL(response.url()).pathname.endsWith("/api/profiles/cv-enhancement/finalize"),
      { timeout: 60000 },
    );
    await page.getByRole("button", { name: "Accept & Save" }).click();
    const finalizeResponse = await finalizeResponsePromise;
    expect(finalizeResponse.ok()).toBeTruthy();
    await expect(page.getByText("CV Enhanced & Saved")).toBeVisible();
    const downloadLink = page.getByRole("link", { name: /Download Enhanced CV/ });
    const downloadHref = await downloadLink.getAttribute("href");
    expect(downloadHref).toBeTruthy();
    const downloadedCv = await context.request.get(new URL(downloadHref!, BASE_URL).toString());
    expect(downloadedCv.status()).toBe(200);
    expect(Buffer.from(await downloadedCv.body()).subarray(0, 4).toString()).toBe("%PDF");
  } finally {
    if (initialProfile) {
      const restoreResponse = await context.request.put("/api/profiles/me", {
        data: initialProfile,
      }).catch(() => null);
      if (restoreResponse && !restoreResponse.ok()) {
        console.error(`Synthetic profile restore returned ${restoreResponse.status()}`);
      }
    }

    if (initialDocumentsCaptured) {
      const current = await context.request.get("/api/documents").catch(() => null);
      if (current?.ok()) {
        const payload = await current.json() as { documents?: Array<{ id: number }> };
        for (const document of payload.documents ?? []) {
          if (!originalDocumentIds.has(document.id)) {
            await context.request.delete(`/api/documents/${document.id}`).catch(() => null);
          }
        }
      }
    }

    if (uploadedPhotoKey) {
      console.log("Synthetic profile photo upload completed; profile key restored.");
    }
    await context.close();
  }
});
