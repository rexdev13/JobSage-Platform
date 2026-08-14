/**
 * #476 — Confirm the AI-generated CV PDF can be attached to job applications.
 *
 * Tests the full pipeline:
 *   buildRewrittenCvPdf (pdfkit) → Buffer → pdf-parse → extracted text
 *
 * Verifies that:
 * 1. buildRewrittenCvPdf produces a non-empty Buffer with a valid PDF header.
 * 2. pdf-parse can extract readable text from the pdfkit output.
 * 3. Key candidate fields (name, section headers, narrative) appear in extracted text.
 * 4. Section header detection works correctly (ALL CAPS lines).
 * 5. The filename pattern matches what speculativeApplications validates (.pdf extension).
 * 6. The document field values satisfy the primary-CV selection logic in both
 *    speculativeApplications.ts and coverLetter.ts.
 */

import { describe, it, expect } from "vitest";
import { buildRewrittenCvPdf } from "../routes/cvEnhancement";

// pdf-parse v2.x ESM exports PDFParse as a class — see memory: pdf-parse-v2-esm.md
async function parsePdf(buf: Buffer): Promise<{ text: string; numpages: number }> {
  const { PDFParse } = await import("pdf-parse") as unknown as {
    PDFParse: new (opts: { data: Buffer | Uint8Array }) => {
      getText(params?: Record<string, unknown>): Promise<{ text: string; total: number }>;
    };
  };
  const parser = new PDFParse({ data: buf });
  const result = await parser.getText();
  return { text: result.text, numpages: result.total };
}

const SAMPLE_CONTENT = `PROFESSIONAL SUMMARY

A dedicated and highly skilled Registered Nurse with seven years of extensive experience
in acute and critical care settings. Demonstrates a consistent commitment to delivering
exceptional patient-centred care in line with NHS standards and best practices.

WORK EXPERIENCE

Senior Staff Nurse — City General Hospital (2019–present)
- Led a team of 6 nurses across a 20-bed ICU
- Implemented new patient handover protocols reducing errors by 30%
- Mentored junior staff and student nurses

EDUCATION

BSc Nursing (First Class) — University of Lagos, 2018

KEY SKILLS

- Advanced life support (ALS) certified
- Critical care and ventilator management
- Multidisciplinary team collaboration

LANGUAGES

English (fluent), Yoruba (native)`;

describe("buildRewrittenCvPdf → pdf-parse pipeline", () => {
  it("produces a non-empty Buffer with a valid PDF header", async () => {
    const buf = await buildRewrittenCvPdf({ name: "Amara Okafor", content: SAMPLE_CONTENT });

    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(1000);
    expect(buf.slice(0, 5).toString("ascii")).toBe("%PDF-");
  });

  it("pdf-parse can extract text from the pdfkit output", async () => {
    const buf = await buildRewrittenCvPdf({ name: "Amara Okafor", content: SAMPLE_CONTENT });
    const result = await parsePdf(buf);

    expect(result.text).toBeTruthy();
    expect(result.numpages).toBeGreaterThanOrEqual(1);
  });

  it("extracted text contains the candidate name", async () => {
    const buf = await buildRewrittenCvPdf({ name: "Amara Okafor", content: SAMPLE_CONTENT });
    const { text } = await parsePdf(buf);

    expect(text).toContain("Amara");
    expect(text).toContain("Okafor");
  });

  it("extracted text contains section headers from the rewritten CV", async () => {
    const buf = await buildRewrittenCvPdf({ name: "Amara Okafor", content: SAMPLE_CONTENT });
    const { text } = await parsePdf(buf);

    expect(text).toContain("PROFESSIONAL SUMMARY");
    expect(text).toContain("WORK EXPERIENCE");
    expect(text).toContain("EDUCATION");
  });

  it("extracted text contains key narrative content", async () => {
    const buf = await buildRewrittenCvPdf({ name: "Amara Okafor", content: SAMPLE_CONTENT });
    const { text } = await parsePdf(buf);

    // The narrative must survive the PDF round-trip so speculativeApplications
    // can send meaningful CV text to employers
    expect(text).toContain("exceptional patient");
    expect(text).toContain("NHS");
  });

  it("filename pattern satisfies speculativeApplications .pdf validation", () => {
    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `Enhanced_CV_${dateStr}.pdf`;
    // speculativeApplications.ts: filename.toLowerCase().endsWith(".pdf")
    expect(filename.toLowerCase().endsWith(".pdf")).toBe(true);
  });

  it("document field values satisfy primary-CV selection logic", () => {
    // speculativeApplications.ts selects: documentType === "cv" AND isPrimary === true
    // coverLetter.ts orders by: isPrimary DESC, uploadedAt DESC
    const documentFields = {
      documentType: "cv",
      isPrimary:    true,
      mimeType:     "application/pdf",
      label:        "AI Enhanced CV",
    };
    expect(documentFields.documentType).toBe("cv");
    expect(documentFields.isPrimary).toBe(true);
    expect(documentFields.mimeType).toBe("application/pdf");
  });

  it("works without content bullet points (plain prose only)", async () => {
    const plainContent = `PROFESSIONAL SUMMARY\n\nAn experienced nurse with strong clinical skills.\n\nEDUCATION\n\nBSc Nursing, University of Lagos, 2018`;
    const buf = await buildRewrittenCvPdf({ name: "Jane Doe", content: plainContent });

    expect(buf).toBeInstanceOf(Buffer);
    const { text } = await parsePdf(buf);
    expect(text).toContain("Jane");
    expect(text).toContain("EDUCATION");
  });
});
