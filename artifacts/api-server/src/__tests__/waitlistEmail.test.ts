import { beforeEach, describe, expect, it, vi } from "vitest";

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));

vi.mock("resend", () => ({
  Resend: class {
    emails = { send: sendMock };
  },
}));

const { sendWaitlistWelcomeEmail } = await import("../lib/email");

describe("waitlist welcome email", () => {
  beforeEach(() => {
    sendMock.mockReset().mockResolvedValue({
      data: { id: "waitlist-email-1" },
      error: null,
    });
  });

  it("sends the branded welcome email and returns the provider ID", async () => {
    const result = await sendWaitlistWelcomeEmail({
      to: "ada+waitlist@example.com",
      firstName: "Ada",
      industrySector: "Technology",
      desiredRole: "Software Engineer",
    });

    expect(result).toEqual({ success: true, messageId: "waitlist-email-1" });
    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({
      from: "JOBSAGE <noreply@jobsage.co.uk>",
      to: "ada+waitlist@example.com",
      subject: "Welcome to JOBSAGE — We've received your details!",
      html: expect.stringContaining(
        "https://jobsage.co.uk/register?email=ada%2Bwaitlist%40example.com",
      ),
    }));
    expect(sendMock.mock.calls[0]![0].html).toContain(
      "interest in Technology opportunities",
    );
  });

  it("returns a structured failure when Resend rejects the request", async () => {
    sendMock.mockResolvedValueOnce({
      data: null,
      error: { message: "Sender domain is not verified" },
    });

    await expect(sendWaitlistWelcomeEmail({
      to: "ada@example.com",
      firstName: "Ada",
    })).resolves.toEqual({
      success: false,
      error: "Sender domain is not verified",
    });
  });

  it("returns a structured failure when the Resend client throws", async () => {
    sendMock.mockRejectedValueOnce(new Error("Network unavailable"));

    await expect(sendWaitlistWelcomeEmail({
      to: "ada@example.com",
      firstName: "Ada",
    })).resolves.toEqual({
      success: false,
      error: "Network unavailable",
    });
  });
});