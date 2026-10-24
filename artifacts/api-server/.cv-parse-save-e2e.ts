import PDFDocument from "pdfkit";
import { chromium } from "../jobsage-web/node_modules/@playwright/test/index.mjs";
import {
  consentLogsTable,
  db,
  pool,
  profilesTable,
  sessionsTable,
  usersTable,
} from "@workspace/db";
import { PRIVACY_POLICY_VERSION } from "@workspace/mobile-core";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { createSession } from "./src/lib/auth";

if (process.env.NODE_ENV !== "development") {
  throw new Error("Synthetic CV parse-and-save testing is development-only.");
}

const userId = `cv-parse-test-${randomUUID()}`;
const email = `${userId}@jobsage.test`;
const baseUrl = process.env.REPLIT_DEV_DOMAIN
  ? `https://${process.env.REPLIT_DEV_DOMAIN}`
  : "http://localhost:18286";
let sid: string | undefined;
let documentId: number | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let context: Awaited<ReturnType<typeof chromium.launch>> extends never ? never : any;

const pdfBuffer = await new Promise<Buffer>((resolve, reject) => {
  const pdf = new PDFDocument({ margin: 48 });
  const chunks: Buffer[] = [];
  pdf.on("data", (chunk: Buffer) => chunks.push(chunk));
  pdf.on("end", () => resolve(Buffer.concat(chunks)));
  pdf.on("error", reject);
  pdf.fontSize(18).text("SYNTHETIC CV — NOT A REAL CANDIDATE");
  pdf.moveDown().fontSize(12);
  pdf.text("Name: Synthetic Candidate");
  pdf.text("Profession: Teacher and curriculum development professional");
  pdf.text("Qualification: Bachelor of Education in Biology, University of Lagos, Nigeria, 2016");
  pdf.text("Work Experience");
  pdf.text("Biology Teacher, Example Secondary School, Lagos, Nigeria — January 2017 to December 2020");
  pdf.text("Designed weekly lesson plans, taught biology to senior students, assessed learning, and improved examination pass rates from 62% to 81%.");
  pdf.text("Curriculum Development Officer, Example Learning Centre, Lagos, Nigeria — January 2021 to Present");
  pdf.text("Develops science curricula, coaches 12 teachers, builds accessible learning materials, and coordinates termly assessment reviews.");
  pdf.text("Professional Development");
  pdf.text("Certificate in Inclusive Education, Example Institute, 2022.");
  pdf.text("Skills: curriculum design, biology instruction, classroom assessment, teacher coaching, learning-material development.");
  pdf.text("Languages: English and Yoruba.");
  pdf.end();
});

try {
  await db.insert(usersTable).values({
    id: userId,
    email,
    firstName: "Synthetic",
    lastName: "Candidate",
    emailVerified: true,
  });
  await db.insert(profilesTable).values({
    userId,
    profession: "Teacher / Lecturer",
    sector: "education",
    specialty: "Secondary Biology Education",
    qualificationCountry: "Nigeria",
    qualificationType: "Bachelor of Education in Biology",
    qualificationYear: 2016,
    experienceYears: 8,
    registrationStatus: "not_applicable",
    residencyStatus: "Skilled Worker Visa",
    requiresSponsorship: true,
    preferredRegion: ["London"] as any,
    alertFrequency: "off",
  });
  await db.insert(consentLogsTable).values({ userId, termsVersion: PRIVACY_POLICY_VERSION });
  sid = await createSession({
    user: {
      id: userId,
      email,
      firstName: "Synthetic",
      lastName: "Candidate",
      role: "candidate",
      profileImageUrl: null,
    },
  }, 60 * 60 * 1000);

  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  await context.addCookies([{
    name: "sid",
    value: sid,
    url: baseUrl,
    httpOnly: true,
    sameSite: "Lax",
  }]);
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (error: Error) => pageErrors.push(error.message));
  await page.goto(`${baseUrl}/documents`);
  await page.getByRole("heading", { name: "Documents" }).waitFor();

  const registrationResponse = page.waitForResponse((response: any) =>
    response.request().method() === "POST" &&
    new URL(response.url()).pathname.endsWith("/api/documents"),
  );
  await page.locator('input[type="file"]').setInputFiles({
    name: "synthetic-candidate-cv.pdf",
    mimeType: "application/pdf",
    buffer: pdfBuffer,
  });
  const registered = await registrationResponse;
  if (!registered.ok()) throw new Error(`Synthetic CV upload failed with HTTP ${registered.status()}.`);
  documentId = (await registered.json()).id;

  await page.getByRole("heading", { name: "CV Extraction Results" }).waitFor({ timeout: 120_000 });
  const modal = page.locator("div.fixed.inset-0").filter({ hasText: "CV Extraction Results" });
  const extractedValues = await modal.locator("input").evaluateAll((inputs: HTMLInputElement[]) =>
    inputs.map((input) => input.value),
  );
  const notesBeforeSave = await modal.locator("textarea").inputValue().catch(() => "");
  await modal.getByRole("checkbox").check();

  const saveResponsePromise = page.waitForResponse((response: any) =>
    response.request().method() === "PUT" &&
    new URL(response.url()).pathname.endsWith("/api/profiles/me"),
    { timeout: 30_000 },
  );
  await modal.getByRole("button", { name: "Save to Profile" }).click();
  const saveResponse = await saveResponsePromise;
  const saveBody = await saveResponse.json().catch(() => ({}));
  const requestBody = saveResponse.request().postDataJSON();
  const result: Record<string, unknown> = {
    uploadedAndParsed: true,
    extractedInputCount: extractedValues.length,
    extractedNotesLength: notesBeforeSave.length,
    profileSaveStatus: saveResponse.status(),
    profileSaveError: saveBody.error ?? null,
    submittedProfession: requestBody.profession,
    submittedPreferredRegion: requestBody.preferredRegion,
    pageErrors,
  };

  if (saveResponse.ok()) {
    const saveParsedResponse = await page.waitForResponse((response: any) =>
      response.request().method() === "PATCH" &&
      new URL(response.url()).pathname.endsWith(`/api/documents/${documentId}/save-parsed`),
      { timeout: 30_000 },
    ).catch(() => null);
    result.confirmedParsedDataStatus = saveParsedResponse?.status() ?? null;
    await page.getByText("Profile updated!", { exact: true }).waitFor({ timeout: 15_000 });
    await page.reload();
    const persistedProfile = await page.request.get(`${baseUrl}/api/profiles/me`);
    result.profileReloadStatus = persistedProfile.status();
    if (persistedProfile.ok()) {
      const profile = await persistedProfile.json();
      result.persistedProfession = profile.profession;
      result.persistedSpecialty = profile.specialty;
      result.persistedExperienceYears = profile.experienceYears;
      result.persistedAdditionalNotesLength = profile.additionalNotes?.length ?? 0;
    }
  }

  console.log(JSON.stringify(result, null, 2));
  if (!saveResponse.ok()) {
    throw new Error(`Profile save failed with HTTP ${saveResponse.status()}: ${saveBody.error ?? "unknown API error"}`);
  }
  if (pageErrors.length > 0) throw new Error("Browser reported a page error.");
} finally {
  if (context && documentId) {
    try {
      await context.request.delete(`${baseUrl}/api/documents/${documentId}`);
    } catch {
      // Database cleanup below remains the fallback for the synthetic row.
    }
  }
  await browser?.close();
  await db.transaction(async (tx) => {
    await tx.delete(consentLogsTable).where(eq(consentLogsTable.userId, userId));
    await tx.delete(profilesTable).where(eq(profilesTable.userId, userId));
    if (sid) await tx.delete(sessionsTable).where(eq(sessionsTable.sid, sid));
    await tx.delete(usersTable).where(eq(usersTable.id, userId));
  });
  await pool.end();
}
