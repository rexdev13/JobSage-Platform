import { expect, test } from "@playwright/test";

const BASE = "";
const APPLICATION_DETAILS = {
  applicationMotivation: "I want to support safe, compassionate care.",
  applicationStrengths: "Clear communication and calm decision-making.",
  noticePeriod: "Four weeks",
  startAvailability: "Available from 1 September",
} as const;

test("application details autosave, reload, and clear independently", async ({ page }) => {
  let profile: Record<string, unknown> = {
    profession: "nurse",
    specialty: "ICU",
    qualificationCountry: "Nigeria",
    qualificationType: "bachelor",
    qualificationYear: 2015,
    experienceYears: 5,
    registrationStatus: "registered",
    licenceReady: true,
    dbsClearanceLevel: "enhanced",
    safeguardingTrainingLevel: "level_2",
    residencyStatus: "visa_required",
    requiresSponsorship: true,
    preferredRegion: ["London"],
    alertFrequency: "weekly",
    preferredStartDate: null,
    profilePhotoKey: null,
    languages: ["English"],
    additionalNotes: null,
    phone: "07123456789",
    streetAddress: "10 High Street",
    city: "London",
    postcode: "SW1A 1AA",
    country: "United Kingdom",
    ...Object.fromEntries(
      Object.keys(APPLICATION_DETAILS).map((field) => [field, null]),
    ),
  };

  await page.route("**/api/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    const method = route.request().method();

    if (pathname.endsWith("/api/auth/user")) {
      await route.fulfill({
        json: {
          user: {
            id: "candidate-1",
            email: "candidate@example.com",
            role: "candidate",
            firstName: "Jane",
            lastName: "Doe",
          },
        },
      });
    } else if (pathname.endsWith("/api/consent")) {
      await route.fulfill({ json: { hasConsented: true } });
    } else if (pathname.endsWith("/api/profiles/me") && method === "GET") {
      await route.fulfill({ json: profile });
    } else if (pathname.endsWith("/api/profiles/me") && method === "PUT") {
      profile = { ...profile, ...route.request().postDataJSON() };
      await route.fulfill({ json: profile });
    } else if (pathname.endsWith("/api/professions")) {
      await route.fulfill({ json: { professions: [] } });
    } else if (pathname.endsWith("/api/journey/status")) {
      await route.fulfill({ json: { badges: [] } });
    } else if (pathname.endsWith("/api/career-profiles")) {
      await route.fulfill({ json: { profiles: [] } });
    } else if (pathname.endsWith("/api/documents")) {
      await route.fulfill({ json: { documents: [] } });
    } else {
      await route.fulfill({ json: {} });
    }
  });

  await page.goto(`${BASE}/profile`);
  await expect(page.getByRole("heading", { name: "Application Details" })).toBeVisible();

  for (const [field, value] of Object.entries(APPLICATION_DETAILS)) {
    const input = page.locator(`[name="${field}"]`);
    const saveResponse = page.waitForResponse((response) =>
      response.request().method() === "PUT" &&
      new URL(response.url()).pathname.endsWith("/api/profiles/me"),
    );

    await input.fill(value);
    await input.press("Tab");

    const response = await saveResponse;
    expect(response.ok()).toBeTruthy();
    expect(response.request().postDataJSON()).toMatchObject({ [field]: value });
  }

  await page.reload();
  for (const [field, value] of Object.entries(APPLICATION_DETAILS)) {
    await expect(page.locator(`[name="${field}"]`)).toHaveValue(value);
  }

  const motivation = page.locator('[name="applicationMotivation"]');
  const clearResponse = page.waitForResponse((response) =>
    response.request().method() === "PUT" &&
    new URL(response.url()).pathname.endsWith("/api/profiles/me"),
  );
  await motivation.fill("");
  await motivation.press("Tab");

  const response = await clearResponse;
  expect(response.ok()).toBeTruthy();
  expect(response.request().postDataJSON()).toMatchObject({
    applicationMotivation: null,
    applicationStrengths: APPLICATION_DETAILS.applicationStrengths,
    noticePeriod: APPLICATION_DETAILS.noticePeriod,
    startAvailability: APPLICATION_DETAILS.startAvailability,
  });

  await page.reload();
  await expect(page.locator('[name="applicationMotivation"]')).toHaveValue("");
  await expect(page.locator('[name="applicationStrengths"]')).toHaveValue(
    APPLICATION_DETAILS.applicationStrengths,
  );
  await expect(page.locator('[name="noticePeriod"]')).toHaveValue(
    APPLICATION_DETAILS.noticePeriod,
  );
  await expect(page.locator('[name="startAvailability"]')).toHaveValue(
    APPLICATION_DETAILS.startAvailability,
  );
});

test("candidates can review CV evidence, add their own text, and save the combined strengths", async ({ page }) => {
  const ownStrengths = "I provide calm, compassionate care.";
  const cvEvidence = "Led a multidisciplinary team of 12 during a service redesign.";
  let profile: Record<string, unknown> = {
    profession: "nurse",
    specialty: "ICU",
    qualificationCountry: "Nigeria",
    qualificationType: "bachelor",
    qualificationYear: 2015,
    experienceYears: 5,
    registrationStatus: "registered",
    licenceReady: true,
    dbsClearanceLevel: "enhanced",
    safeguardingTrainingLevel: "level_2",
    residencyStatus: "visa_required",
    requiresSponsorship: true,
    preferredRegion: ["London"],
    alertFrequency: "weekly",
    preferredStartDate: null,
    profilePhotoKey: null,
    languages: ["English"],
    additionalNotes: null,
    phone: "07123456789",
    streetAddress: "10 High Street",
    city: "London",
    postcode: "SW1A 1AA",
    country: "United Kingdom",
    ...Object.fromEntries(Object.keys(APPLICATION_DETAILS).map((field) => [field, null])),
  };
  const profileWrites: Array<Record<string, unknown>> = [];

  await page.route("**/api/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    const method = route.request().method();

    if (pathname.endsWith("/api/auth/user")) {
      await route.fulfill({
        json: {
          user: {
            id: "candidate-1",
            email: "candidate@example.com",
            role: "candidate",
            firstName: "Jane",
            lastName: "Doe",
          },
        },
      });
    } else if (pathname.endsWith("/api/consent")) {
      await route.fulfill({ json: { hasConsented: true } });
    } else if (pathname.endsWith("/api/profiles/me") && method === "GET") {
      await route.fulfill({ json: profile });
    } else if (pathname.endsWith("/api/profiles/me") && method === "PUT") {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      profileWrites.push(body);
      profile = { ...profile, ...body };
      await route.fulfill({ json: profile });
    } else if (pathname.endsWith("/api/profiles/application-strengths/draft")) {
      const { documentId } = route.request().postDataJSON() as { documentId: number };
      const fromScannedPdf = documentId === 41;
      await route.fulfill({
        json: {
          documentId,
          filename: fromScannedPdf ? "primary-cv.pdf" : "word-cv.docx",
          sourceFormat: fromScannedPdf ? "scanned_pdf_ocr" : "word_docx",
          notice: fromScannedPdf ? "OCR was used for this scanned PDF. Review the excerpts carefully." : null,
          remaining: 4,
          strengths: [{
            text: "I lead multidisciplinary teams through service improvement.",
            evidence: [cvEvidence],
          }],
        },
      });
    } else if (pathname.endsWith("/api/professions")) {
      await route.fulfill({ json: { professions: [] } });
    } else if (pathname.endsWith("/api/journey/status")) {
      await route.fulfill({ json: { badges: [] } });
    } else if (pathname.endsWith("/api/career-profiles")) {
      await route.fulfill({ json: { profiles: [] } });
    } else if (pathname.endsWith("/api/documents") && method === "GET") {
      await route.fulfill({
        json: {
          documents: [
            {
              id: 41,
              userId: "candidate-1",
              filename: "primary-cv.pdf",
              mimeType: "application/pdf",
              storageKey: "/objects/uploads/cv-41",
              documentType: "cv",
              label: "Primary CV",
              isPrimary: true,
              disclaimerText: "Uploaded for reference.",
              uploadedAt: "2026-01-01T00:00:00.000Z",
            },
            {
              id: 42,
              userId: "candidate-1",
              filename: "word-cv.docx",
              mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              storageKey: "/objects/uploads/cv-42",
              documentType: "cv",
              label: "Word CV",
              isPrimary: false,
              disclaimerText: "Uploaded for reference.",
              uploadedAt: "2026-02-01T00:00:00.000Z",
            },
            {
              id: 43,
              userId: "candidate-1",
              filename: "legacy-word-cv.doc",
              mimeType: "application/msword",
              storageKey: "/objects/uploads/cv-43",
              documentType: "cv",
              label: "Legacy Word CV",
              isPrimary: false,
              disclaimerText: "Uploaded for reference.",
              uploadedAt: "2026-03-01T00:00:00.000Z",
            },
          ],
        },
      });
    } else {
      await route.fulfill({ json: {} });
    }
  });

  await page.goto(`${BASE}/profile`);
  await expect(page.getByRole("heading", { name: "Application Details" })).toBeVisible();

  const field = page.locator('[name="applicationStrengths"]');
  await field.fill(ownStrengths);
  const scannedDraftRequest = page.waitForRequest((request) =>
    request.method() === "POST" &&
    new URL(request.url()).pathname.endsWith("/api/profiles/application-strengths/draft"),
  );
  await page.getByRole("button", { name: "Write professional strengths from the selected CV" }).click();
  expect((await scannedDraftRequest).postDataJSON()).toEqual({ documentId: 41 });
  await expect(page.getByText("Draft based on primary-cv.pdf · Scanned PDF (OCR)")).toBeVisible();
  await expect(page.getByText(`“${cvEvidence}”`)).toBeVisible();
  await expect(page.getByText("OCR was used for this scanned PDF. Review the excerpts carefully.")).toBeVisible();

  await page.getByLabel("CV to use for writing professional strengths").selectOption("42");
  const wordDraftRequest = page.waitForRequest((request) =>
    request.method() === "POST" &&
    new URL(request.url()).pathname.endsWith("/api/profiles/application-strengths/draft"),
  );
  await page.getByRole("button", { name: "Write professional strengths from the selected CV" }).click();
  expect((await wordDraftRequest).postDataJSON()).toEqual({ documentId: 42 });
  await expect(page.getByText("Draft based on word-cv.docx · Word DOCX")).toBeVisible();

  await page.getByRole("button", { name: "Add after my existing text" }).click();
  await expect(field).toHaveValue(`${ownStrengths}\n\nI lead multidisciplinary teams through service improvement.`);
  expect(profileWrites.some((write) => write.applicationStrengths)).toBe(false);

  const saveResponse = page.waitForResponse((response) =>
    response.request().method() === "PUT" &&
    new URL(response.url()).pathname.endsWith("/api/profiles/me"),
  );
  await page.getByRole("button", { name: "Save Changes" }).click();
  expect((await saveResponse).request().postDataJSON()).toMatchObject({
    applicationStrengths: `${ownStrengths}\n\nI lead multidisciplinary teams through service improvement.`,
  });
});
