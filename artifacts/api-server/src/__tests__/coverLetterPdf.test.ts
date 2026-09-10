import { describe, expect, it } from "vitest";
import { PDFParse } from "pdf-parse";
import {
  buildCoverLetterPdf,
  safeCoverLetterFilename,
} from "../lib/coverLetterPdf";

describe("cover letter PDF", () => {
  it("renders candidate, employer, vacancy, alias, and finalized text", async () => {
    const buffer = await buildCoverLetterPdf({
      candidateName: "Amara Okafor",
      jobsageEmail: "amara@jobsage.app",
      companyName: "North Health NHS Trust",
      vacancyTitle: "Senior Nurse",
      finalText: "Dear Hiring Manager,\n\nI am applying for this role.\n\nYours sincerely,\nAmara Okafor",
      date: new Date("2026-09-10T00:00:00.000Z"),
    });

    expect(buffer.subarray(0, 4).toString()).toBe("%PDF");
    const parsed = await new PDFParse({ data: buffer }).getText();
    expect(parsed.text).toContain("Amara Okafor");
    expect(parsed.text).toContain("amara@jobsage.app");
    expect(parsed.text).toContain("North Health NHS Trust");
    expect(parsed.text).toContain("Senior Nurse");
    expect(parsed.text).toContain("I am applying for this role.");
  });

  it("creates an email-safe filename", () => {
    expect(safeCoverLetterFilename("Health/Trust", "Nurse: ICU?"))
      .toBe("Cover Letter - Nurse ICU.pdf");
  });

  it("rejects empty or excessive cover-letter text", async () => {
    await expect(buildCoverLetterPdf({
      candidateName: "Candidate",
      jobsageEmail: "candidate@jobsage.app",
      companyName: "Employer",
      finalText: " ",
    })).rejects.toThrow("required");

    await expect(buildCoverLetterPdf({
      candidateName: "Candidate",
      jobsageEmail: "candidate@jobsage.app",
      companyName: "Employer",
      finalText: "x".repeat(20_001),
    })).rejects.toThrow("too long");
  });
});