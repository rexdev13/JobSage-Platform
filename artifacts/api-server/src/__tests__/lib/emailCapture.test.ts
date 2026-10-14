import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmailClient, getEmailConfigurationStatus } from "../../lib/email";

describe("development email capture", () => {
  let captureDirectory: string | undefined;

  afterEach(async () => {
    if (captureDirectory) {
      await rm(captureDirectory, { recursive: true, force: true });
      captureDirectory = undefined;
    }
  });

  it("captures messages locally and never calls the provider", async () => {
    captureDirectory = await mkdtemp(join(tmpdir(), "jobsage-email-capture-"));
    const capturePath = join(captureDirectory, "outbox.jsonl");
    const providerSend = vi.fn();
    const client = createEmailClient(
      {
        NODE_ENV: "development",
        JOBSAGE_DEV_EMAIL_CAPTURE_PATH: capturePath,
        RESEND_API_KEY: "unused-test-value",
      },
      { emails: { send: providerSend } } as never,
    );

    const result = await client.emails.send({
      from: "JOBSAGE <noreply@jobsage.co.uk>",
      to: "validation.candidate@jobsage.test",
      subject: "Reset your password",
      html: "https://jobsage.test/reset-password?token=fixture-only",
    });

    expect(result.error).toBeNull();
    expect(result.data?.id).toMatch(/^dev-capture-/);
    expect(providerSend).not.toHaveBeenCalled();
    const captured = JSON.parse((await readFile(capturePath, "utf8")).trim());
    expect(captured.to).toBe("validation.candidate@jobsage.test");
    expect(captured.html).toContain("fixture-only");
  });

  it("reports capture mode explicitly instead of presenting it as live email", () => {
    const status = getEmailConfigurationStatus({
      NODE_ENV: "development",
      RESEND_API_KEY: "unused-test-value",
    });

    expect(status.deliveryMode).toBe("development_capture");
    expect(status.ready).toBe(true);
    expect(status.resendApiKeyPresent).toBe(false);
    expect(status.diagnostics.join(" ")).toContain("external delivery is disabled");
    expect(status.diagnostics.join(" ")).not.toContain("unused-test-value");
  });
});
