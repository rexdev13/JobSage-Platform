import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:18286";
const EMAIL_CAPTURE_PATH =
  process.env.JOBSAGE_DEV_EMAIL_CAPTURE_PATH ?? "/tmp/jobsage-dev-email-capture.jsonl";
const OUTPUT_PATH = process.env.CV_QUALITY_OUTPUT_PATH ?? "/tmp/jobsage-cv-quality-output.json";
const PDF_PATH = process.env.CV_QUALITY_PDF_PATH ?? "/tmp/jobsage-cv-quality-output.pdf";
const SCREENSHOT_PATH = process.env.CV_QUALITY_SCREENSHOT_PATH ?? "/tmp/jobsage-cv-quality-review.png";
const TEST_EMAIL = "validation.candidate@jobsage.test";

type CapturedMessage = { id?: string; to?: string | string[]; html?: string; text?: string };

async function captureMessages(): Promise<CapturedMessage[]> {
  try {
    return (await readFile(EMAIL_CAPTURE_PATH, "utf8")).split("\n").flatMap((line) => {
      if (!line.trim()) return [];
      try {
        return [JSON.parse(line) as CapturedMessage];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

async function signInSyntheticAccount(page: Page): Promise<void> {
  const previousIds = new Set((await captureMessages()).flatMap((message) => message.id ? [message.id] : []));
  await page.goto(`${BASE_URL}/forgot-password`);
  await page.locator('input[type="email"]').fill(TEST_EMAIL);
  const forgotResponse = page.waitForResponse((response) =>
    response.request().method() === "POST"
    && new URL(response.url()).pathname.endsWith("/api/auth/forgot-password"),
  );
  await page.locator('form button[type="submit"]').click();
  expect((await forgotResponse).status()).toBe(200);

  let resetMessage: CapturedMessage | undefined;
  for (let attempt = 0; attempt < 50 && !resetMessage; attempt += 1) {
    resetMessage = (await captureMessages()).find((message) => {
      const recipients = Array.isArray(message.to) ? message.to : [message.to ?? ""];
      return recipients.some((recipient) => recipient.toLowerCase().includes(TEST_EMAIL))
        && Boolean(message.id)
        && !previousIds.has(message.id!)
        && (message.html ?? "").includes("/reset-password?token=");
    });
    if (!resetMessage) await page.waitForTimeout(100);
  }
  if (!resetMessage) throw new Error("No synthetic reset message was captured.");

  const body = `${resetMessage.html ?? ""}\n${resetMessage.text ?? ""}`.replace(/&amp;/g, "&");
  const link = (body.match(/https?:\/\/[^\s"'<>]+/g) ?? []).find((candidate) => {
    try {
      return new URL(candidate).pathname.endsWith("/reset-password");
    } catch {
      return false;
    }
  });
  if (!link) throw new Error("The synthetic reset message had no usable link.");
  const token = new URL(link).searchParams.get("token") ?? "";
  const password = `Dev!${randomBytes(20).toString("base64url")}qZ4`;
  await page.goto(`${BASE_URL}/reset-password?token=${encodeURIComponent(token)}`);
  const fields = page.locator('input[type="password"]');
  await fields.nth(0).fill(password);
  await fields.nth(1).fill(password);
  const resetResponse = page.waitForResponse((response) =>
    response.request().method() === "POST"
    && new URL(response.url()).pathname.endsWith("/api/auth/reset-password"),
  );
  await page.getByRole("button", { name: "Update password" }).click();
  expect((await resetResponse).status()).toBe(200);

  await page.goto(`${BASE_URL}/login`);
  await page.locator('input[type="email"]').fill(TEST_EMAIL);
  await page.locator('input[type="password"]').fill(password);
  const loginResponse = page.waitForResponse((response) =>
    response.request().method() === "POST"
    && new URL(response.url()).pathname.endsWith("/api/auth/login"),
  );
  await page.locator('form button[type="submit"]').click();
  expect((await loginResponse).status()).toBe(200);
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 15000 }).not.toBe("/login");
}

const SYNTHETIC_CV = `Mira Adebayo
Manchester, Greater Manchester
mira.adebayo@example.invalid | 01632 960 123

PROFESSIONAL SUMMARY
Project coordinator with experience supporting service improvement, operational change and cross-functional delivery. Known for clear status reporting, practical risk tracking and dependable follow-through. Seeking UK project coordination and project support roles.

WORK EXPERIENCE
Project Coordinator | Northstar Community Services | April 2022–December 2025
- Coordinated 4 workstreams across a 9-person delivery group and maintained a shared milestone plan for 18 project milestones.
- Increased on-time milestone completion from 72% to 89% by introducing a weekly dependency review and named action owners.
- Reduced average case handover time from 18 days to 12 days by mapping the existing process and agreeing a revised checklist with 6 service leads.
- Tracked an £85,000 project budget; monthly forecasts stayed within £2,400 of the final spend.
- Prepared fortnightly decision papers and RAID reports for a steering group of 7 stakeholders.

Project Support Officer | Alder & Finch Housing Partnership | January 2020–March 2022
- Maintained schedules and records for 3 housing-service improvement projects covering 5 neighbourhood teams.
- Reconciled 240 service records and resolved 31 duplicate entries before a quarterly performance review.
- Organised 11 staff workshops, recorded actions and followed up with owners within 3 working days.
- Built a spreadsheet tracker that reduced overdue actions from 26 to 9 in one quarter.

Retail Assistant | Northgate Market | June 2018–December 2019
- Served customers at the checkout and restocked a rotating range of household goods.
- Balanced the till at close and escalated stock discrepancies to the duty supervisor.

EDUCATION AND QUALIFICATIONS
BA Business and Management | Northbridge Institute | 2018
PRINCE2 Foundation | 2021
Excel for Project Tracking short course | 2023

CORE SKILLS
Project coordination; schedule maintenance; RAID logs; budget tracking; meeting facilitation; action tracking; stakeholder updates; process mapping; spreadsheet reporting; document control.

VOLUNTEERING
Volunteer Coordinator | Greenway Community Pantry | 2021–2023
- Scheduled 8 volunteers across weekly sessions and maintained a simple stock and attendance log.

INTERESTS
Weekend cycling and independent films.`;

test("evaluate CV rewrite quality and final PDF using only a fictional CV", async ({ browser }) => {
  test.setTimeout(420_000);
  const context = await browser.newContext({ baseURL: BASE_URL });
  const page = await context.newPage();
  let originalDocumentIds = new Set<number>();
  let documentSnapshotCaptured = false;
  const output: Record<string, unknown> = {
    source: SYNTHETIC_CV,
    outputs: {},
  };

  try {
    await signInSyntheticAccount(page);
    const initial = await context.request.get("/api/documents");
    expect(initial.status()).toBe(200);
    const initialPayload = await initial.json() as { documents: Array<{ id: number; filename: string }> };
    for (const doc of initialPayload.documents) {
      if (doc.filename === "synthetic-cv-quality-eval.pdf") {
        await context.request.delete(`/api/documents/${doc.id}`);
      }
    }
    const refreshed = await context.request.get("/api/documents");
    const refreshedPayload = await refreshed.json() as { documents: Array<{ id: number }> };
    originalDocumentIds = new Set(refreshedPayload.documents.map((doc) => doc.id));
    documentSnapshotCaptured = true;

    const pdfPage = await context.newPage();
    await pdfPage.setContent(`<html><body style="font:12px Arial;line-height:1.45"><pre style="white-space:pre-wrap">${SYNTHETIC_CV.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</pre></body></html>`);
    const sourcePdf = await pdfPage.pdf({ format: "A4", printBackground: false });
    await pdfPage.close();

    const uploadUrlResponse = await context.request.post("/api/storage/uploads/request-url", {
      data: { name: "synthetic-cv-quality-eval.pdf", size: sourcePdf.length, contentType: "application/pdf" },
    });
    expect(uploadUrlResponse.status()).toBe(200);
    const uploadInfo = await uploadUrlResponse.json() as { uploadURL: string; storageKey: string };
    const uploaded = await context.request.put(uploadInfo.uploadURL, {
      data: sourcePdf,
      headers: { "Content-Type": "application/pdf" },
    });
    expect(uploaded.ok()).toBeTruthy();
    const registration = await context.request.post("/api/documents", {
      data: {
        filename: "synthetic-cv-quality-eval.pdf",
        mimeType: "application/pdf",
        storageKey: uploadInfo.storageKey,
        fileSize: sourcePdf.length,
      },
    });
    expect(registration.status()).toBe(201);
    const cv = await registration.json() as { id: number };
    const typeResponse = await context.request.patch(`/api/documents/${cv.id}/type`, {
      data: { documentType: "cv" },
    });
    expect(typeResponse.ok()).toBeTruthy();

    await page.goto(`${BASE_URL}/documents`);
    const openEnhancement = page.getByRole("button", { name: "Enhance CV", exact: true });
    await openEnhancement.click();
    const cvRadio = page.locator(`input[name="cv-select"][value="${cv.id}"]`);
    await expect(cvRadio).toBeVisible();
    await cvRadio.check();

    const modes: Array<{ mode: "general" | "focused" | "focus_only"; focus?: string }> = [
      { mode: "general" },
      { mode: "focused", focus: "UK Project Coordinator roles" },
      { mode: "focus_only", focus: "Project coordination" },
    ];

    for (const { mode, focus } of modes) {
      if (mode !== "general") {
        await page.getByTestId("button-try-again").click();
        await page.locator(`input[name="enh-mode"][value="${mode}"]`).check();
        await page.locator("#cv-focus").fill(focus!);
      }

      const responsePromise = page.waitForResponse((response) =>
        response.request().method() === "POST"
        && new URL(response.url()).pathname.endsWith("/api/profiles/cv-enhancement"),
        { timeout: 120000 },
      );
      await page.getByRole("button", { name: "Create my CV draft" }).click();
      const response = await responsePromise;
      expect(response.status(), `${mode} rewrite`).toBe(200);
      const result = await response.json() as {
        mode: string;
        enhancedContent: string;
        originalText: string;
        preservationWarnings?: string[];
      };
      expect(result.mode).toBe(mode);
      expect(result.enhancedContent.length).toBeGreaterThan(300);
      await expect(page.getByTestId("textarea-enhanced-cv")).toBeVisible();
      const visibleContent = await page.getByTestId("textarea-enhanced-cv").inputValue();
      expect(visibleContent).toBe(result.enhancedContent);
      (output.outputs as Record<string, unknown>)[mode] = {
        content: result.enhancedContent,
        warnings: result.preservationWarnings ?? [],
      };
      await writeFile(OUTPUT_PATH, JSON.stringify(output, null, 2));
      console.log(`Completed ${mode}: ${result.enhancedContent.length} characters; warnings=${(result.preservationWarnings ?? []).length}`);
    }

    await page.screenshot({ path: SCREENSHOT_PATH, fullPage: false });
    await page.getByTestId("tab-cv-original").click();
    await page.getByTestId("checkbox-confirm-cv-review").check();
    await page.getByTestId("checkbox-set-primary-cv").uncheck();
    const finalizePromise = page.waitForResponse((response) =>
      response.request().method() === "POST"
      && new URL(response.url()).pathname.endsWith("/api/profiles/cv-enhancement/finalize"),
      { timeout: 60000 },
    );
    await page.getByTestId("button-save-enhanced-cv").click();
    expect((await finalizePromise).status()).toBe(200);
    await expect(page.getByText("A fresh CV, ready to use")).toBeVisible();
    const downloadHref = await page.getByTestId("link-download-enhanced-cv").getAttribute("href");
    expect(downloadHref).toBeTruthy();
    const downloaded = await context.request.get(new URL(downloadHref!, BASE_URL).toString());
    expect(downloaded.status()).toBe(200);
    const downloadedPdf = Buffer.from(await downloaded.body());
    expect(downloadedPdf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    await writeFile(PDF_PATH, downloadedPdf);
  } finally {
    if (documentSnapshotCaptured) {
      const current = await context.request.get("/api/documents").catch(() => null);
      if (current?.ok()) {
        const payload = await current.json() as { documents?: Array<{ id: number }> };
        for (const doc of payload.documents ?? []) {
          if (!originalDocumentIds.has(doc.id)) {
            await context.request.delete(`/api/documents/${doc.id}`).catch(() => null);
          }
        }
      }
    }
    await context.close();
  }
});
