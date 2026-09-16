/**
 * End-to-end smoke test for the Resend inbound employer-reply webhook.
 *
 * This test intentionally does not create or modify fixtures. It requires the
 * existing "john dev" candidate and one open Test JobSage Email application.
 *
 * Run from the repository root:
 *   API_BASE_URL=http://localhost:5000 \
 *   NODE_ENV=development \
 *   pnpm --filter @workspace/scripts test:inbound-reply
 *
 * DATABASE_URL is read by @workspace/db. Set INBOUND_EMAIL_WEBHOOK_SECRET
 * when the API verifies Svix signatures. If that secret is omitted, this
 * script requires NODE_ENV to be explicitly non-production and relies on the
 * API's existing development/test bypass. The fixed external message ID is
 * intentionally single-use because the webhook deduplicates it.
 */

import { createHmac, randomUUID } from "node:crypto";
import { and, eq, ilike } from "drizzle-orm";

const EXPECTED_ALIAS = "john.dev.8b8431@mail.jobsage.co.uk";
const EXPECTED_SENDER_EMAIL = "ifeo55394@gmail.com";
const EXPECTED_RECIPIENT_EMAIL = "ifeo55394@gmail.com";
const EXPECTED_COMPANY_NAME = "Test JobSage Email";
const EXPECTED_SENDER_NAME = "Test JobSage Email Recruitment";
const EXPECTED_SUBJECT = "Re: Application: john dev — Test JobSage Email";
const EXPECTED_BODY = "We would like to invite you for an interview next week.";
const FIXED_EXTERNAL_MESSAGE_ID = "<inbound-e2e-test@testhospital.nhs.uk>";
const WEBHOOK_PATH = "/api/webhooks/inbound-email";
const REQUEST_TIMEOUT_MS = 15_000;
const OPEN_STATUSES = ["cv_sent", "sent", "acknowledged", "under_review"] as const;

type OpenStatus = (typeof OPEN_STATUSES)[number];

class SmokeTestError extends Error {
  override name = "SmokeTestError";
}

type JsonObject = Record<string, unknown>;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new SmokeTestError(message);
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normaliseCompanyName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isExpectedApplication(companyName: string, emailRecipient: string | null): boolean {
  const recipient = emailRecipient?.trim().toLowerCase() ?? "";
  const normalisedCompany = normaliseCompanyName(companyName);
  return (
    recipient === EXPECTED_RECIPIENT_EMAIL ||
    normalisedCompany === normaliseCompanyName(EXPECTED_COMPANY_NAME)
  );
}

function isOpenStatus(status: string): status is OpenStatus {
  return (OPEN_STATUSES as readonly string[]).includes(status);
}

function apiUrlFromEnvironment(): string {
  const baseUrl = process.env.INBOUND_EMAIL_API_URL ?? process.env.API_BASE_URL;
  assert(
    baseUrl,
    "Set INBOUND_EMAIL_API_URL (or API_BASE_URL) to the API origin before running this smoke test.",
  );

  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new SmokeTestError("INBOUND_EMAIL_API_URL/API_BASE_URL must be an absolute http(s) URL.");
  }
  assert(
    parsed.protocol === "http:" || parsed.protocol === "https:",
    "INBOUND_EMAIL_API_URL/API_BASE_URL must use http or https.",
  );

  return `${baseUrl.replace(/\/+$/, "")}${WEBHOOK_PATH}`;
}

function displayUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "<configured API URL>";
  }
}

function signedHeaders(body: string, secret: string | undefined): Record<string, string> {
  if (!secret) {
    const nodeEnvironment = process.env.NODE_ENV;
    assert(
      nodeEnvironment && nodeEnvironment !== "production",
      "INBOUND_EMAIL_WEBHOOK_SECRET is not set; set NODE_ENV explicitly to a non-production value to use the API's unsigned development/test bypass.",
    );
    return { "Content-Type": "application/json" };
  }

  assert(
    secret.startsWith("whsec_"),
    "INBOUND_EMAIL_WEBHOOK_SECRET must use the whsec_ Svix secret format.",
  );

  const svixId = `msg_${randomUUID()}`;
  const svixTimestamp = Math.floor(Date.now() / 1000).toString();
  const signedContent = `${svixId}.${svixTimestamp}.${body}`;
  const secretBytes = Buffer.from(secret.slice("whsec_".length), "base64");
  const signature = createHmac("sha256", secretBytes)
    .update(signedContent)
    .digest("base64");

  return {
    "Content-Type": "application/json",
    "svix-id": svixId,
    "svix-timestamp": svixTimestamp,
    "svix-signature": `v1,${signature}`,
  };
}

async function withTimeout<T>(
  operation: Promise<T>,
  label: string,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new SmokeTestError(`${label} timed out after ${timeoutMs}ms.`)),
      timeoutMs,
    );
  });

  try {
    return await Promise.race([operation, timeout]);
  } catch (error) {
    if (error instanceof SmokeTestError) throw error;
    throw new SmokeTestError(`${label} failed; inspect the API/database logs for details.`);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const payload = {
  type: "email.inbound_received",
  data: {
    from: `${EXPECTED_SENDER_NAME} <${EXPECTED_SENDER_EMAIL}>`,
    to: [EXPECTED_ALIAS],
    subject: EXPECTED_SUBJECT,
    text: EXPECTED_BODY,
    messageId: FIXED_EXTERNAL_MESSAGE_ID,
  },
};

async function run(): Promise<void> {
  assert(
    process.env.DATABASE_URL,
    "DATABASE_URL is required; the smoke test verifies durable database state and will not run without it.",
  );
  const endpoint = apiUrlFromEnvironment();

  const { db, pool, candidateMessagesTable, profilesTable, speculativeApplicationsTable, usersTable } =
    await import("@workspace/db");

  try {
    const johnCandidates = await withTimeout(
      db
        .select({
          id: usersTable.id,
          firstName: usersTable.firstName,
          lastName: usersTable.lastName,
          jobsageEmail: usersTable.jobsageEmail,
        })
        .from(usersTable)
        .where(
          and(
            ilike(usersTable.firstName, "john"),
            ilike(usersTable.lastName, "dev"),
          ),
        ),
      "Candidate lookup",
    );

    assert(
      johnCandidates.length === 1,
      johnCandidates.length === 0
        ? 'Precondition failed: no candidate named "john dev" exists.'
        : 'Precondition failed: more than one candidate named "john dev" exists.',
    );
    const candidate = johnCandidates[0]!;

    let candidateAlias = candidate.jobsageEmail;
    if (!candidateAlias) {
      const [profile] = await withTimeout(
        db
          .select({ jobsageEmail: profilesTable.jobsageEmail })
          .from(profilesTable)
          .where(eq(profilesTable.userId, candidate.id))
          .limit(1),
        "Candidate alias lookup",
      );
      candidateAlias = profile?.jobsageEmail ?? null;
    }
    assert(
      candidateAlias === EXPECTED_ALIAS,
      `Precondition failed: john dev has an unexpected JOBSAGE alias; expected ${EXPECTED_ALIAS}.`,
    );

    const [existingMessage] = await withTimeout(
      db
        .select({
          id: candidateMessagesTable.id,
          recipientUserId: candidateMessagesTable.recipientUserId,
          applicationId: candidateMessagesTable.applicationId,
        })
        .from(candidateMessagesTable)
        .where(eq(candidateMessagesTable.externalMessageId, FIXED_EXTERNAL_MESSAGE_ID))
        .limit(1),
      "Fixed message ID preflight",
    );
    assert(
      !existingMessage,
      `Precondition failed: fixed message ID ${FIXED_EXTERNAL_MESSAGE_ID} was already processed; use a new test ID or inspect the existing row.`,
    );

    const candidateApplications = await withTimeout(
      db
        .select({
          id: speculativeApplicationsTable.id,
          companyName: speculativeApplicationsTable.companyName,
          status: speculativeApplicationsTable.status,
          emailRecipient: speculativeApplicationsTable.emailRecipient,
        })
        .from(speculativeApplicationsTable)
        .where(eq(speculativeApplicationsTable.userId, candidate.id)),
      "Speculative application lookup",
    );

    const matchingApplications = candidateApplications.filter((application) =>
      isExpectedApplication(application.companyName, application.emailRecipient),
    );
    const alreadyUsedApplication = matchingApplications.find(
      (application) => !isOpenStatus(application.status),
    );
    assert(
      !alreadyUsedApplication,
      `Precondition failed: matching Test JobSage Email application #${alreadyUsedApplication?.id} is already ${alreadyUsedApplication?.status}; refusing to reuse the fixture.`,
    );

    const openApplications = matchingApplications.filter((application) =>
      isOpenStatus(application.status),
    );
    assert(
      openApplications.length === 1,
      openApplications.length === 0
        ? "Precondition failed: no open speculative application matches Test JobSage Email / ifeo55394@gmail.com."
        : "Precondition failed: more than one open speculative application matches Test JobSage Email / ifeo55394@gmail.com.",
    );
    const applicationBefore = openApplications[0]!;

    const body = JSON.stringify(payload);
    const response = await withTimeout(
      fetch(endpoint, {
        method: "POST",
        headers: signedHeaders(body, process.env.INBOUND_EMAIL_WEBHOOK_SECRET),
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      }),
      "Inbound webhook request",
    );
    const responseText = await withTimeout(
      response.text(),
      "Inbound webhook response",
    );
    assert(
      responseText.length <= 1_000_000,
      "Inbound webhook response exceeded the 1 MB safety limit.",
    );

    let responseBody: unknown;
    try {
      responseBody = JSON.parse(responseText);
    } catch {
      throw new SmokeTestError(
        `Inbound webhook returned HTTP ${response.status} with a non-JSON response.`,
      );
    }
    assert(
      response.status === 200,
      `Inbound webhook returned HTTP ${response.status}; expected HTTP 200.`,
    );
    assert(isJsonObject(responseBody), "Inbound webhook returned a JSON value instead of an object.");
    assert(responseBody.ok === true, "Inbound webhook response did not contain ok: true.");
    assert(
      responseBody.category === "interview_invited",
      `Inbound webhook category was ${String(responseBody.category)}; expected interview_invited.`,
    );
    const matchedApplicationId = responseBody.matchedApplicationId;
    assert(
      typeof matchedApplicationId === "number" &&
        Number.isInteger(matchedApplicationId) &&
        matchedApplicationId > 0,
      "Inbound webhook response did not contain a populated matchedApplicationId.",
    );
    assert(
      matchedApplicationId === applicationBefore.id,
      `Inbound webhook matched application #${matchedApplicationId}, but the preflight fixture was #${applicationBefore.id}.`,
    );
    assert(
      responseBody.candidateUserId === candidate.id,
      "Inbound webhook resolved a different candidate than john dev.",
    );

    const [storedMessage] = await withTimeout(
      db
        .select({
          id: candidateMessagesTable.id,
          recipientUserId: candidateMessagesTable.recipientUserId,
          messageType: candidateMessagesTable.messageType,
          subject: candidateMessagesTable.subject,
          messageText: candidateMessagesTable.messageText,
          senderEmail: candidateMessagesTable.senderEmail,
          applicationId: candidateMessagesTable.applicationId,
          externalMessageId: candidateMessagesTable.externalMessageId,
          companyName: candidateMessagesTable.companyName,
        })
        .from(candidateMessagesTable)
        .where(
          and(
            eq(candidateMessagesTable.externalMessageId, FIXED_EXTERNAL_MESSAGE_ID),
            eq(candidateMessagesTable.recipientUserId, candidate.id),
          ),
        )
        .limit(1),
      "Stored inbox message lookup",
    );
    assert(
      storedMessage,
      `Durable assertion failed: message ${FIXED_EXTERNAL_MESSAGE_ID} was not stored for john dev.`,
    );
    assert(
      storedMessage.messageType === "employer_reply",
      `Durable assertion failed: stored message type was ${storedMessage.messageType}.`,
    );
    assert(
      storedMessage.senderEmail === EXPECTED_SENDER_EMAIL,
      "Durable assertion failed: stored sender does not match the test employer.",
    );
    assert(
      storedMessage.companyName === EXPECTED_SENDER_NAME,
      "Durable assertion failed: stored company/sender name does not match the NHS Recruitment Team.",
    );
    assert(
      storedMessage.subject === `Employer reply: ${EXPECTED_SUBJECT.replace(/^Re:\s*/i, "")}`,
      "Durable assertion failed: stored subject does not contain the employer reply subject.",
    );
    assert(
      storedMessage.messageText === EXPECTED_BODY,
      "Durable assertion failed: stored body does not contain the employer reply.",
    );
    assert(
      storedMessage.applicationId === matchedApplicationId,
      "Durable assertion failed: inbox message is not linked to the matched application.",
    );

    const [applicationAfter] = await withTimeout(
      db
        .select({
          id: speculativeApplicationsTable.id,
          userId: speculativeApplicationsTable.userId,
          companyName: speculativeApplicationsTable.companyName,
          status: speculativeApplicationsTable.status,
        })
        .from(speculativeApplicationsTable)
        .where(eq(speculativeApplicationsTable.id, matchedApplicationId))
        .limit(1),
      "Updated application lookup",
    );
    assert(
      applicationAfter,
      `Durable assertion failed: matched application #${matchedApplicationId} no longer exists.`,
    );
    assert(
      applicationAfter.userId === candidate.id,
      "Durable assertion failed: matched application belongs to a different candidate.",
    );
    assert(
      applicationAfter.status === "interview_invited",
      `Durable assertion failed: application #${matchedApplicationId} is ${applicationAfter.status}, expected interview_invited.`,
    );

    console.log("PASS: inbound employer reply end-to-end smoke test");
    console.log(`  API: ${displayUrl(endpoint)}`);
    console.log(`  Candidate: john dev (${candidate.id}), alias ${EXPECTED_ALIAS}`);
    console.log(`  Application: #${applicationBefore.id} (${applicationBefore.companyName})`);
    console.log(`  Status: ${applicationBefore.status} -> ${applicationAfter.status}`);
    console.log(`  Inbox message: #${storedMessage.id}, external ID ${FIXED_EXTERNAL_MESSAGE_ID}`);
    console.log("  HTTP: 200, ok=true, category=interview_invited");
    console.log("  Walkthrough: sign in as john dev, open /inbox, and open /applications.");
    console.log('  Confirm the Test JobSage Email Recruitment reply in /inbox and the "Interview Invited" badge in /applications.');
  } finally {
    await withTimeout(pool.end(), "Database connection cleanup");
  }
}

try {
  await run();
} catch (error) {
  if (error instanceof SmokeTestError) {
    console.error(`FAIL: ${error.message}`);
  } else {
    console.error("FAIL: unexpected smoke-test error; inspect the API/database logs for details.");
  }
  process.exitCode = 1;
}