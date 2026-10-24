import PDFDocument from "pdfkit";
import JSZip from "jszip";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  extractStrengthsCvSource,
  MAX_SCANNED_PDF_PAGES,
} from "../lib/applicationStrengthsCvSource";
import {
  prepareCvEvidenceText,
  validateCvStrengths,
} from "../lib/applicationStrengthsFromCv";

const execFileAsync = promisify(execFile);
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const CV_TEXT = [
  "REGISTERED NURSE",
  "Registered nurse with six years of experience in urgent and emergency care.",
  "Led a multidisciplinary team of 12 during a service redesign.",
  "Improved clinical handover completion from 72 percent to 91 percent.",
].join("\n");

function createPdf(write: (document: PDFKit.PDFDocument) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const document = new PDFDocument({ size: "A4", margin: 40 });
    const chunks: Buffer[] = [];
    document.on("data", (chunk: Buffer) => chunks.push(chunk));
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);
    write(document);
    document.end();
  });
}

async function createScannedPdf(text: string): Promise<Buffer> {
  const workDir = await mkdtemp(join(tmpdir(), "jobsage-scan-fixture-"));
  try {
    const sourcePdf = await createPdf((document) => {
      document.font("Helvetica").fontSize(19).lineGap(8).text(text);
    });
    const sourcePath = join(workDir, "source.pdf");
    const imagePrefix = join(workDir, "scanned-page");
    await writeFile(sourcePath, sourcePdf, { mode: 0o600 });
    await execFileAsync(
      "pdftoppm",
      ["-r", "200", "-png", "-f", "1", "-l", "1", sourcePath, imagePrefix],
      { timeout: 15_000 },
    );
    const imageName = (await readdir(workDir)).find((name) => name.endsWith(".png"));
    if (!imageName) throw new Error("Could not render the synthetic CV page.");
    const pageImage = await readFile(join(workDir, imageName));
    return createPdf((document) => {
      document.image(pageImage, 0, 0, { width: 595, height: 842 });
    });
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

async function createDocx(text: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  );
  const paragraphs = text
    .split(/\r?\n/)
    .map((line) => `<w:p><w:r><w:t xml:space="preserve">${line}</w:t></w:r></w:p>`)
    .join("");
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${paragraphs}<w:sectPr/></w:body>
</w:document>`,
  );
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

describe("CV source extraction for professional-strength drafts", () => {
  it("extracts searchable PDF text without using OCR", async () => {
    const pdf = await createPdf((document) => {
      document.font("Helvetica").fontSize(14).text(CV_TEXT);
    });

    const result = await extractStrengthsCvSource(pdf, "application/pdf");
    expect(result.sourceFormat).toBe("searchable_pdf");
    expect(result.notice).toBeNull();
    expect(result.text).toContain("Led a multidisciplinary team of 12");
  });

  it("extracts DOCX text and keeps exact evidence available for verification", async () => {
    const docx = await createDocx(CV_TEXT);
    const result = await extractStrengthsCvSource(docx, DOCX_MIME);
    const evidenceText = prepareCvEvidenceText(result.text);

    expect(result.sourceFormat).toBe("word_docx");
    expect(result.notice).toBeNull();
    expect(evidenceText).toContain("Led a multidisciplinary team of 12 during a service redesign.");
    expect(validateCvStrengths(
      {
        strengths: [{
          text: "I led a multidisciplinary team during a service redesign.",
          evidence: ["Led a multidisciplinary team of 12 during a service redesign."],
        }],
      },
      evidenceText,
    )).toHaveLength(1);
  });

  it("OCRs scanned PDF pages locally, flags the OCR draft, and verifies its excerpts", async () => {
    const scannedPdf = await createScannedPdf(CV_TEXT);
    const result = await extractStrengthsCvSource(scannedPdf, "application/pdf");
    const evidenceText = prepareCvEvidenceText(result.text);

    expect(MAX_SCANNED_PDF_PAGES).toBe(5);
    expect(result.sourceFormat).toBe("scanned_pdf_ocr");
    expect(result.notice).toContain("OCR was used");
    expect(evidenceText.toLowerCase()).toContain("multidisciplinary team of 12");
    const exactExcerpt = evidenceText
      .split(/\r?\n/)
      .find((line) => line.toLowerCase().includes("multidisciplinary team"));
    expect(exactExcerpt).toBeTruthy();
    expect(validateCvStrengths(
      {
        strengths: [{
          text: "I led a multidisciplinary team during a service redesign.",
          evidence: [exactExcerpt!],
        }],
      },
      evidenceText,
    )).toHaveLength(1);
  });

  it("truncates scanned PDFs after the first five pages and discloses the cutoff", async () => {
    const pageTexts = Array.from({ length: 6 }, (_, index) => `CV page ${index + 1}. ${CV_TEXT}`).join("\n");
    const workDir = await mkdtemp(join(tmpdir(), "jobsage-multipage-fixture-"));
    try {
      const pdf = await createPdf((document) => {
        for (const [index, pageText] of pageTexts.split(/(?=CV page \d+\.)/).entries()) {
          if (index > 0) document.addPage();
          document.font("Helvetica").fontSize(14).text(pageText);
        }
      });
      const sourcePath = join(workDir, "searchable.pdf");
      await writeFile(sourcePath, pdf, { mode: 0o600 });
      const prefix = join(workDir, "scanned");
      await execFileAsync("pdftoppm", ["-r", "100", "-png", sourcePath, prefix], { timeout: 30_000 });
      const images = (await readdir(workDir)).filter((name) => name.endsWith(".png")).sort();
      let scanDoc: Buffer | null = null;
      // Build a PDF from page images, so PDF.js has no hidden searchable text to return.
      scanDoc = await new Promise<Buffer>((resolve, reject) => {
        const document = new PDFDocument({ size: "A4", margin: 0, autoFirstPage: false });
        const chunks: Buffer[] = [];
        document.on("data", (chunk: Buffer) => chunks.push(chunk));
        document.on("end", () => resolve(Buffer.concat(chunks)));
        document.on("error", reject);
        for (const image of images) {
          document.addPage({ size: "A4", margin: 0 });
          document.image(join(workDir, image), 0, 0, { width: 595, height: 842 });
        }
        document.end();
      });

      const result = await extractStrengthsCvSource(scanDoc, "application/pdf");
      expect(result.sourceFormat).toBe("scanned_pdf_ocr");
      expect(result.notice).toContain("first 5 pages");
      expect(result.text).toContain("Scanned page 5");
      expect(result.text).not.toContain("Scanned page 6");
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }, 60_000);
});
