import { beforeEach, describe, expect, it, vi } from "vitest";

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));

vi.mock("resend", () => ({
  Resend: class {
    emails = { send: sendMock };
  },
}));

const {
  escapeEmailHtml,
  getEmailConfigurationStatus,
  sendSpeculativeCVToOps,
} = await import("../lib/email");

describe("speculative CV email", () => {
  beforeEach(() => {
    sendMock.mockReset();
    sendMock.mockResolvedValue({ data: { id: "email-1" }, error: null });
  });

  it("sends the selected CV and finalized cover letter as two PDF attachments", async () => {
    await sendSpeculativeCVToOps({
      candidateEmail: "login@example.test",
      candidateName: "Amara Okafor",
      candidateUserId: "candidate-1",
      companyName: "North Health Trust",
      applicationId: 42,
      cvFilename: "Amara CV.pdf",
      cvContent: Buffer.from("cv"),
      coverLetterFilename: "Cover Letter - Senior Nurse.pdf",
      coverLetterContent: Buffer.from("letter"),
      vacancyTitle: "Senior Nurse",
      jobsageEmail: "amara@jobsage.app",
      recipientEmail: "recruitment@example.test",
    });

    expect(sendMock).toHaveBeenCalledOnce();
    const payload = sendMock.mock.calls[0]![0];
    expect(payload.from).toMatch(/^JOBSAGE <[^>]+>$/);
    expect(payload.from).not.toContain("amara@jobsage.app");
    expect(payload.replyTo).toBe("amara@jobsage.app");
    expect(payload.to).toBe("recruitment@example.test");
    expect(payload.subject).toBe("Job Application: Amara Okafor — Senior Nurse (via JOBSAGE)");
    expect(payload.attachments).toEqual([
      { filename: "Amara CV.pdf", content: Buffer.from("cv") },
      { filename: "Cover Letter - Senior Nurse.pdf", content: Buffer.from("letter") },
    ]);
    expect(payload.html).toContain("Candidate Introduction &amp; Speculative Application");
    expect(payload.html).toContain("Attached Documents");
    expect(payload.html).toContain("📄 Amara CV.pdf");
    expect(payload.html).toContain("Ref: JS-42");
    expect(payload.html).not.toContain("User ID");
    expect(payload.html).not.toContain("candidate-1");
    expect(payload.html).not.toContain("Sent by JOBSAGE platform");
  });

  it("escapes candidate and employer-controlled HTML", async () => {
    await sendSpeculativeCVToOps({
      candidateEmail: "login@example.test",
      candidateName: "Candidate <script>alert(1)</script>",
      candidateUserId: "candidate-1",
      companyName: "Employer <img src=x>",
      applicationId: 43,
      cvFilename: "CV <draft>.pdf",
      cvContent: Buffer.from("cv"),
      vacancyTitle: "Nurse <b>Lead</b>",
      vacancyUrl: "https://example.test/job?x=<unsafe>",
      notes: "Motivation\n- Hello <script>bad()</script>\n- Ready to start",
      jobsageEmail: "candidate@jobsage.app",
      recipientEmail: "recruitment@example.test",
    });

    const html = sendMock.mock.calls[0]![0].html as string;
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img src=x&gt;");
    expect(html).toContain("Message &amp; Qualifications from Candidate");
    expect(html).toContain("<ul");
    expect(html).toContain("<li style=");
    expect(html).toContain("Ref: JS-43");
    expect(html).not.toContain("candidate-1");
  });

  it("escapes all HTML metacharacters", () => {
    expect(escapeEmailHtml(`<&>"'`)).toBe("&lt;&amp;&gt;&quot;&#39;");
  });

  it("does not treat a provider error response as successful delivery", async () => {
    sendMock.mockResolvedValueOnce({
      data: null,
      error: { message: "Attachment rejected" },
    });

    await expect(sendSpeculativeCVToOps({
      candidateEmail: "login@example.test",
      candidateName: "Amara Okafor",
      candidateUserId: "candidate-1",
      companyName: "North Health Trust",
      applicationId: 44,
      cvFilename: "Amara CV.pdf",
      cvContent: Buffer.from("cv"),
      coverLetterFilename: "Cover Letter.pdf",
      coverLetterContent: Buffer.from("letter"),
      jobsageEmail: "amara@jobsage.app",
      recipientEmail: "recruitment@example.test",
    })).rejects.toThrow("Attachment rejected");
  });

  it("reports missing credentials and invalid senders without exposing credential values", () => {
    const status = getEmailConfigurationStatus({
      RESEND_API_KEY: "super-secret-value",
      EMAIL_FROM: "not-an-email",
    });

    expect(status.ready).toBe(false);
    expect(status.diagnostics).toEqual(
      expect.arrayContaining(["EMAIL_FROM is missing or not a usable email address"]),
    );
    expect(status.diagnostics.join(" ")).not.toContain("super-secret-value");
    expect(status).not.toHaveProperty("resendApiKey");
  });
});