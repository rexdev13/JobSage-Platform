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
