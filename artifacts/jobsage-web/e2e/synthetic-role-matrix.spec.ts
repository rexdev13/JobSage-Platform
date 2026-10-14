import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:18286";
const BASE_PATH = (process.env.JOBSAGE_WEB_BASE_PATH ?? "").replace(/\/$/, "");
const EMAIL_CAPTURE_PATH =
  process.env.JOBSAGE_DEV_EMAIL_CAPTURE_PATH ?? "/tmp/jobsage-dev-email-capture.jsonl";

test.use({ trace: "off", screenshot: "off", video: "off" });

type CapturedMessage = {
  id?: string;
  to?: string | string[];
  subject?: string;
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

function messageIsFor(message: CapturedMessage, email: string): boolean {
  const recipients = Array.isArray(message.to) ? message.to : [message.to ?? ""];
  return recipients.some((recipient) => recipient.toLowerCase().includes(email.toLowerCase()));
}

async function waitForNewResetEmail(
  email: string,
  previousIds: Set<string>,
): Promise<CapturedMessage> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const message = (await readCapture()).find((candidate) =>
      messageIsFor(candidate, email)
      && Boolean(candidate.id)
      && !previousIds.has(candidate.id!)
      && (candidate.html ?? "").includes("/reset-password?token="),
    );
    if (message) return message;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("No new local password-reset email was captured for the synthetic account.");
}

function extractResetToken(message: CapturedMessage): string {
  const body = `${message.html ?? ""}\n${message.text ?? ""}`.replace(/&amp;/g, "&");
  const links = body.match(/https?:\/\/[^\s"'<>]+/g) ?? [];
  for (const link of links) {
    try {
      const parsed = new URL(link);
      if (parsed.pathname.endsWith("/reset-password")) {
        const token = parsed.searchParams.get("token");
        if (token) return token;
      }
    } catch {
      // Continue searching the locally captured message without logging its contents.
    }
  }
  throw new Error("The local password-reset email did not contain a usable reset link.");
}

async function resetSyntheticPassword(page: Page, email: string): Promise<string> {
  const previousIds = new Set((await readCapture()).flatMap((message) => message.id ? [message.id] : []));

  await visitRoute(page, "/forgot-password");
  await page.locator('input[type="email"]').fill(email);
  const forgotResponsePromise = page.waitForResponse((response) =>
    new URL(response.url()).pathname.endsWith("/api/auth/forgot-password")
    && response.request().method() === "POST",
  );
  await page.locator('form button[type="submit"]').click();
  const forgotResponse = await forgotResponsePromise;
  expect(forgotResponse.status()).toBe(200);

  const message = await waitForNewResetEmail(email, previousIds);
  const token = extractResetToken(message);
  const password = `Dev!${randomBytes(20).toString("base64url")}aA7`;
  const resetUrl = new URL(`${BASE_PATH}/reset-password`, BASE_URL);
  resetUrl.searchParams.set("token", token);

  try {
    await page.goto(resetUrl.toString(), { timeout: 15000 });
  } catch {
    throw new Error("The captured synthetic password-reset page failed to load.");
  }
  await expect(page.getByRole("heading", { name: "Set new password" })).toBeVisible();
  const updatePasswordButton = page.getByRole("button", { name: "Update password" });
  if (!await updatePasswordButton.isEnabled()) {
    await page.evaluate(() => history.replaceState(null, "", location.pathname));
    throw new Error("The captured synthetic reset link was not accepted by the reset page.");
  }
  const passwordFields = page.locator('input[type="password"]');
  await passwordFields.nth(0).fill(password);
  await passwordFields.nth(1).fill(password);
  const resetResponsePromise = page.waitForResponse((response) =>
    new URL(response.url()).pathname.endsWith("/api/auth/reset-password")
    && response.request().method() === "POST",
    { timeout: 15000 },
  );
  await page.locator('form button[type="submit"]').click();
  let resetResponse;
  try {
    resetResponse = await resetResponsePromise;
  } catch {
    await page.evaluate(() => history.replaceState(null, "", location.pathname));
    throw new Error("The synthetic password-reset request did not complete.");
  }
  await page.evaluate(() => history.replaceState(null, "", location.pathname));
  expect(resetResponse.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Password updated" })).toBeVisible();
  return password;
}

async function signInSyntheticAccount(page: Page, email: string, password: string) {
  await page.goto(`${BASE_PATH}/login`);
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  const loginResponsePromise = page.waitForResponse((response) =>
    new URL(response.url()).pathname.endsWith("/api/auth/login")
    && response.request().method() === "POST",
  );
  await page.locator('form button[type="submit"]').click();
  const loginResponse = await loginResponsePromise;
  expect(loginResponse.status()).toBe(200);
  const loginPath = `${BASE_PATH}/login` || "/login";
  let previousPath = "";
  let stableSamples = 0;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const currentPath = new URL(page.url()).pathname;
    if (currentPath === loginPath) {
      stableSamples = 0;
    } else if (currentPath === previousPath) {
      stableSamples += 1;
      if (stableSamples >= 3) return;
    } else {
      previousPath = currentPath;
      stableSamples = 0;
    }
    await page.waitForTimeout(100);
  }
  throw new Error("The synthetic account did not leave the login route after successful authentication.");
}

async function currentUser(page: Page) {
  const response = await page.context().request.get("/api/auth/user");
  const payload = await response.json().catch(() => ({})) as {
    user?: { email?: string; role?: string } | null;
  };
  return { status: response.status(), user: payload.user ?? null };
}

async function visitRoute(page: Page, path: string, expectedPath = path): Promise<void> {
  try {
    await page.goto(`${BASE_PATH}${path}`, { waitUntil: "commit" });
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("interrupted by another navigation")) {
      throw error;
    }
  }
  const expected = `${BASE_PATH}${expectedPath}` || "/";
  await expect.poll(() => new URL(page.url()).pathname).toBe(expected);
  await expect(page.locator("body")).not.toContainText(/500|internal server error/i);
}

async function waitForEmployerContext(page: Page): Promise<void> {
  await expect.poll(async () => page.evaluate(async () => {
    const response = await fetch("/api/employer/organizations", { credentials: "include" });
    if (!response.ok) return 0;
    const payload = await response.json() as { activeOrganizationId?: number | null };
    return payload.activeOrganizationId ?? 0;
  }), { timeout: 15000 }).toBeGreaterThan(0);
}

const employerFixtures = [
  {
    key: "employer owner",
    email: "validation.employer@jobsage.test",
    globalRole: "employer",
    organizationRole: "employer_owner",
    canManageStaff: true,
  },
  {
    key: "employer administrator",
    email: "validation.staff.admin@jobsage.test",
    globalRole: "candidate",
    organizationRole: "employer_admin",
    canManageStaff: true,
  },
  {
    key: "recruiter",
    email: "validation.staff.recruiter@jobsage.test",
    globalRole: "candidate",
    organizationRole: "recruiter",
    canManageStaff: false,
  },
  {
    key: "hiring manager",
    email: "validation.staff.hiring-manager@jobsage.test",
    globalRole: "candidate",
    organizationRole: "hiring_manager",
    canManageStaff: false,
  },
  {
    key: "viewer",
    email: "validation.staff.viewer@jobsage.test",
    globalRole: "candidate",
    organizationRole: "employer_viewer",
    canManageStaff: false,
  },
] as const;

test.describe("synthetic authenticated role matrix", () => {
  test("candidate: session restore, real role endpoints, authorization and logout cleanup", async ({ browser }) => {
    test.setTimeout(90000);
    const context = await browser.newContext({ baseURL: BASE_URL });
    const page = await context.newPage();
    try {
      const email = "validation.candidate@jobsage.test";
      const password = await resetSyntheticPassword(page, email);
      await signInSyntheticAccount(page, email, password);

      const signedIn = await currentUser(page);
      expect(signedIn.status).toBe(200);
      expect(signedIn.user?.role).toBe("candidate");
      expect(signedIn.user?.email).toBe(email);

      await page.reload();
      const restored = await currentUser(page);
      expect(restored.status).toBe(200);
      expect(restored.user?.role).toBe("candidate");

      const roleEndpoints = await page.evaluate(async () => {
        const paths = ["/api/roles", "/api/roles/my-matches"];
        return Promise.all(paths.map(async (path) => {
          const startedAt = performance.now();
          const response = await fetch(path, { credentials: "include" });
          return { path, status: response.status, durationMs: performance.now() - startedAt };
        }));
      });
      expect(roleEndpoints.map((entry) => entry.status)).toEqual([200, 200]);
      for (const entry of roleEndpoints) {
        expect(
          entry.durationMs,
          `${entry.path} took ${Math.round(entry.durationMs)} ms`,
        ).toBeLessThan(5000);
      }

      await visitRoute(page, "/profile");
      await expect(page.getByRole("heading", { name: "Application Details" })).toBeVisible();
      const unlabeledProfileControls = await page.locator(
        'input:not([type="hidden"]), textarea, select',
      ).evaluateAll((controls) => controls
        .filter((control) => {
          const style = getComputedStyle(control);
          return style.display !== "none"
            && style.visibility !== "hidden"
            && control.getClientRects().length > 0;
        })
        .filter((control) => {
          const field = control as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
          return !field.labels?.length
            && !control.getAttribute("aria-label")
            && !control.getAttribute("aria-labelledby");
        })
        .map((control) => ({
          tag: control.tagName.toLowerCase(),
          type: control.getAttribute("type"),
          name: control.getAttribute("name"),
          placeholder: control.getAttribute("placeholder"),
        })));
      expect(unlabeledProfileControls, "Visible profile controls need an accessible label").toEqual([]);
      const initialProfile = await page.evaluate(async () => {
        const response = await fetch("/api/profiles/me", { credentials: "include" });
        return {
          status: response.status,
          profile: await response.json() as { applicationStrengths?: string | null },
        };
      });
      expect(initialProfile.status).toBe(200);

      const strengthsField = page.locator('[name="applicationStrengths"]');
      const originalStrengths = initialProfile.profile.applicationStrengths ?? "";
      const savedStrengths = `Synthetic candidate profile save ${Date.now()}`;
      const waitForStrengthsSave = (expected: string) => page.waitForResponse((response) => {
        if (
          response.request().method() !== "PUT"
          || !new URL(response.url()).pathname.endsWith("/api/profiles/me")
        ) return false;
        return response.request().postDataJSON()?.applicationStrengths === (expected || null);
      });

      let profileSaveSucceeded = false;
      try {
        const saveResponsePromise = waitForStrengthsSave(savedStrengths);
        await strengthsField.fill(savedStrengths);
        await strengthsField.press("Tab");
        const saveResponse = await saveResponsePromise;
        expect(saveResponse.ok()).toBeTruthy();
        const savedProfile = await saveResponse.json() as { applicationStrengths?: string | null };
        expect(savedProfile.applicationStrengths).toBe(savedStrengths);
        profileSaveSucceeded = true;

        await page.reload();
        await expect(strengthsField).toHaveValue(savedStrengths);
        const persistedProfile = await page.evaluate(async () => {
          const response = await fetch("/api/profiles/me", { credentials: "include" });
          return { status: response.status, profile: await response.json() as { applicationStrengths?: string | null } };
        });
        expect(persistedProfile.status).toBe(200);
        expect(persistedProfile.profile.applicationStrengths).toBe(savedStrengths);
      } finally {
        if (profileSaveSucceeded) {
          const restoreResponsePromise = waitForStrengthsSave(originalStrengths);
          await strengthsField.fill(originalStrengths);
          await strengthsField.press("Tab");
          const restoreResponse = await restoreResponsePromise;
          expect(restoreResponse.ok()).toBeTruthy();
          await page.reload();
          await expect(strengthsField).toHaveValue(originalStrengths);
        }
      }

      const adminApiStatus = await page.evaluate(async () =>
        (await fetch("/api/admin/roles", { credentials: "include" })).status,
      );
      expect(adminApiStatus).toBe(403);

      await page.getByTestId("button-logout").click();
      await expect.poll(async () => (await currentUser(page)).user).toBeNull();
      await visitRoute(page, "/profile", "/login");
    } finally {
      await context.close();
    }
  });

  test("account switching: a new synthetic role replaces the prior session", async ({ browser }) => {
    test.setTimeout(90000);
    const context = await browser.newContext({ baseURL: BASE_URL });
    const page = await context.newPage();
    try {
      const candidateEmail = "validation.candidate@jobsage.test";
      const candidatePassword = await resetSyntheticPassword(page, candidateEmail);
      await signInSyntheticAccount(page, candidateEmail, candidatePassword);
      expect((await currentUser(page)).user?.email).toBe(candidateEmail);

      await page.getByTestId("button-logout").click();
      await expect.poll(async () => (await currentUser(page)).user).toBeNull();

      const adminEmail = "validation.admin@jobsage.test";
      const adminPassword = await resetSyntheticPassword(page, adminEmail);
      await signInSyntheticAccount(page, adminEmail, adminPassword);
      const switched = await currentUser(page);
      expect(switched.user?.email).toBe(adminEmail);
      expect(switched.user?.role).toBe("admin");
      await visitRoute(page, "/admin/users");

      await page.getByTestId("button-logout").click();
      await expect.poll(async () => (await currentUser(page)).user).toBeNull();
    } finally {
      await context.close();
    }
  });

  for (const fixture of employerFixtures) {
    test(`${fixture.key}: organization route and API permission checks`, async ({ browser }) => {
      test.setTimeout(90000);
      const context = await browser.newContext({ baseURL: BASE_URL });
      const page = await context.newPage();
      try {
        const password = await resetSyntheticPassword(page, fixture.email);
        await signInSyntheticAccount(page, fixture.email, password);
        const signedIn = await currentUser(page);
        expect(signedIn.status).toBe(200);
        expect(signedIn.user?.role).toBe(fixture.globalRole);

        const organizationsResponse = await page.context().request.get("/api/employer/organizations");
        expect(organizationsResponse.status()).toBe(200);
        const organizationsPayload = await organizationsResponse.json() as {
          organizations?: Array<{ role?: string }>;
        };
        expect(organizationsPayload.organizations?.map((organization) => organization.role) ?? [])
          .toContain(fixture.organizationRole);

        await visitRoute(page, "/employer/dashboard");
        await waitForEmployerContext(page);

        const staffReadStatus = await page.evaluate(async () =>
          (await fetch("/api/employer/staff", { credentials: "include" })).status,
        );
        expect(staffReadStatus).toBe(fixture.canManageStaff ? 200 : 403);

        const inviteValidationStatus = await page.evaluate(async () =>
          (await fetch("/api/employer/staff/invitations", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: "{}",
          })).status,
        );
        expect(inviteValidationStatus).toBe(fixture.canManageStaff ? 400 : 403);

        await visitRoute(
          page,
          "/employer/staff",
          fixture.canManageStaff ? "/employer/staff" : "/employer/dashboard",
        );
      } finally {
        await context.close();
      }
    });
  }

  test("moderator: moderation queue is available and reviewer/admin routes are denied", async ({ browser }) => {
    test.setTimeout(90000);
    const context = await browser.newContext({ baseURL: BASE_URL });
    const page = await context.newPage();
    try {
      const email = "validation.moderator@jobsage.test";
      const password = await resetSyntheticPassword(page, email);
      await signInSyntheticAccount(page, email, password);
      const signedIn = await currentUser(page);
      expect(signedIn.user?.role).toBe("moderator");

      await visitRoute(page, "/moderation/reports");
      const moderationStatus = await page.evaluate(async () =>
        (await fetch("/api/moderation/reports", { credentials: "include" })).status,
      );
      expect(moderationStatus).toBe(200);
      await visitRoute(page, "/review-queue", "/");
      const adminStatus = await page.evaluate(async () =>
        (await fetch("/api/admin/roles", { credentials: "include" })).status,
      );
      expect(adminStatus).toBe(403);
    } finally {
      await context.close();
    }
  });

  test("administrator: reviewer queue is allowed while moderation remains restricted", async ({ browser }) => {
    test.setTimeout(90000);
    const context = await browser.newContext({ baseURL: BASE_URL });
    const page = await context.newPage();
    try {
      const email = "validation.admin@jobsage.test";
      const password = await resetSyntheticPassword(page, email);
      await signInSyntheticAccount(page, email, password);
      const signedIn = await currentUser(page);
      expect(signedIn.user?.role).toBe("admin");

      await visitRoute(page, "/review-queue");
      await visitRoute(page, "/admin/users");
      const moderationStatus = await page.evaluate(async () =>
        (await fetch("/api/moderation/reports", { credentials: "include" })).status,
      );
      expect(moderationStatus).toBe(403);
    } finally {
      await context.close();
    }
  });

  test("super-admin: super-admin and lead routes are available", async ({ browser }) => {
    test.setTimeout(90000);
    const context = await browser.newContext({ baseURL: BASE_URL });
    const page = await context.newPage();
    const reactKeyWarnings: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "warning" && /unique.*key/i.test(message.text())) {
        reactKeyWarnings.push(message.text());
      }
    });
    try {
      const email = "validation.super-admin@jobsage.test";
      const password = await resetSyntheticPassword(page, email);
      await signInSyntheticAccount(page, email, password);
      const signedIn = await currentUser(page);
      expect(signedIn.user?.role).toBe("super_admin");

      await visitRoute(page, "/admin/super");
      await page.getByTestId("button-super-admin-tab-employers").click();
      const employerCount = async () => {
        const text = await page.getByText(/^\d+ employers total$/).textContent();
        return Number(text?.match(/\d+/)?.[0] ?? 0);
      };
      await expect.poll(employerCount).toBeGreaterThan(0);
      await expect.poll(async () => page.locator("tbody tr").count()).toBeGreaterThan(0);
      expect(reactKeyWarnings).toEqual([]);
      await visitRoute(page, "/admin/leads");
    } finally {
      await context.close();
    }
  });
});
