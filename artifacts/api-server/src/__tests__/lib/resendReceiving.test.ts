import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const resendMocks = vi.hoisted(() => ({
  receivingGet: vi.fn(),
  attachmentsList: vi.fn(),
  send: vi.fn(),
  constructedKeys: [] as string[],
}));

vi.mock("resend", () => ({
  Resend: class {
    readonly emails = {
      receiving: {
        get: resendMocks.receivingGet,
        attachments: { list: resendMocks.attachmentsList },
      },
      send: resendMocks.send,
    };

    constructor(key?: string) {
      resendMocks.constructedKeys.push(key ?? "");
    }
  },
}));

vi.mock("../../lib/email", () => ({
  getEmailConfigurationStatus: () => ({ senderAddress: "noreply@jobsage.co.uk" }),
}));

import { forwardReceivedEmail } from "../../lib/resendReceiving";

const receivedEmail = {
  object: "email",
  id: "received-message-1",
  from: "App Store Review <app-review@apple.com>",
  to: ["developer@jobsage.co.uk"],
  created_at: "2026-10-09T09:00:00.000Z",
  subject: "Apple Developer verification",
  bcc: null,
  cc: ["team@jobsage.co.uk"],
  reply_to: ["reply@apple.com"],
  html: "<p>Your verification code is <strong>184260</strong>.</p>",
  text: "Your verification code is 184260.",
  headers: { date: "Fri, 09 Oct 2026 09:00:00 +0000" },
  message_id: "<apple-verification@example.com>",
  raw: null,
  attachments: [],
};

describe("Resend inbound forwarding", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resendMocks.constructedKeys.length = 0;
    vi.stubEnv("RESEND_API_KEY", "re_test_only");
    resendMocks.receivingGet.mockResolvedValue({ data: receivedEmail, error: null });
    resendMocks.attachmentsList.mockResolvedValue({
      data: {
        object: "list",
        has_more: false,
        data: [
          {
            id: "attachment-1",
            filename: "verification.pdf",
            size: 4,
            content_type: "application/pdf",
            content_disposition: "attachment",
            content_id: null,
            download_url: "https://inbound-cdn.resend.com/test/attachment",
            expires_at: "2026-10-09T10:00:00.000Z",
          },
        ],
      },
      error: null,
    });
    resendMocks.send.mockResolvedValue({ data: { id: "outbound-message-1" }, error: null });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(Buffer.from("%PDF"), {
          headers: { "content-length": "4" },
        }),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("preserves sender details, body, reply address, and downloaded attachments", async () => {
    const result = await forwardReceivedEmail(
      "received-message-1",
      "jobsage.inbox@gmail.com",
    );

    expect(result).toBe("outbound-message-1");
    expect(resendMocks.receivingGet).toHaveBeenCalledWith("received-message-1");
    expect(resendMocks.attachmentsList).toHaveBeenCalledWith({ emailId: "received-message-1" });
    expect(resendMocks.send).toHaveBeenCalledOnce();
    const [payload, requestOptions] = resendMocks.send.mock.calls[0]!;
    expect(payload).toMatchObject({
      from: "JOBSAGE <noreply@jobsage.co.uk>",
      to: "jobsage.inbox@gmail.com",
      subject: "Fwd: Apple Developer verification",
      replyTo: ["reply@apple.com"],
    });
    expect(payload.text).toContain("From: App Store Review <app-review@apple.com>");
    expect(payload.text).toContain("Your verification code is 184260.");
    expect(payload.html).toContain("Apple Developer verification");
    expect(payload.attachments).toHaveLength(1);
    expect(Buffer.isBuffer(payload.attachments[0].content)).toBe(true);
    expect(payload.attachments[0]).toMatchObject({
      filename: "verification.pdf",
      contentType: "application/pdf",
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({ redirect: "error" }),
    );
    expect(requestOptions).toEqual({
      idempotencyKey: "jobsage-developer-forward-received-message-1",
    });
  });

  it("stops reading an attachment once the aggregate size limit is exceeded", async () => {
    const chunk = new Uint8Array(1024 * 1024);
    let emittedChunks = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              controller.enqueue(chunk);
              emittedChunks += 1;
              if (emittedChunks === 19) controller.close();
            },
          }),
        ),
      ),
    );

    await expect(
      forwardReceivedEmail("received-message-1", "jobsage.inbox@gmail.com"),
    ).rejects.toMatchObject({ stage: "attachment-size" });

    expect(emittedChunks).toBeLessThanOrEqual(19);
    expect(resendMocks.send).not.toHaveBeenCalled();
  });

  it("uses the same provider idempotency key when Resend retries the inbound event", async () => {
    resendMocks.attachmentsList.mockResolvedValue({
      data: { object: "list", has_more: false, data: [] },
      error: null,
    });

    await forwardReceivedEmail("received-message-1", "jobsage.inbox@gmail.com");
    await forwardReceivedEmail("received-message-1", "jobsage.inbox@gmail.com");

    expect(resendMocks.send).toHaveBeenCalledTimes(2);
    expect(resendMocks.send.mock.calls[0]![1]).toEqual(resendMocks.send.mock.calls[1]![1]);
    expect(resendMocks.send.mock.calls[0]![1]).toEqual({
      idempotencyKey: "jobsage-developer-forward-received-message-1",
    });
  });
});
