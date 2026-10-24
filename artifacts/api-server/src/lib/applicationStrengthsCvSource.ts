import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import mammoth from "mammoth";
import WordExtractor from "word-extractor";

const execFileAsync = promisify(execFile);
const MAX_CV_TEXT_LENGTH = 24_000;
export const MAX_SCANNED_PDF_PAGES = 5;

export type StrengthsCvSourceFormat =
  | "searchable_pdf"
  | "scanned_pdf_ocr"
  | "word_docx"
  | "word_doc";

export interface ExtractedStrengthsCvSource {
  text: string;
  sourceFormat: StrengthsCvSourceFormat;
  notice: string | null;
}

const WORD_EXTRACTOR = new WordExtractor();

function limitText(text: string): string {
  return text.slice(0, MAX_CV_TEXT_LENGTH).trim();
}

async function extractScannedPdfText(
  buffer: Buffer,
  pageLimit: number,
): Promise<string> {
  const workDir = await mkdtemp(join(tmpdir(), "jobsage-cv-ocr-"));
  const token = randomUUID();
  const pdfPath = join(workDir, `${token}.pdf`);
  const outputPrefix = join(workDir, "page");

  try {
    await writeFile(pdfPath, buffer, { mode: 0o600 });
    await execFileAsync(
      "pdftoppm",
      ["-r", "180", "-png", "-f", "1", "-l", String(pageLimit), pdfPath, outputPrefix],
      { timeout: 30_000, maxBuffer: 1024 * 1024 },
    );

    const pageFiles = (await readdir(workDir))
      .filter((name) => /^page-\d+\.png$/.test(name))
      .sort((left, right) => {
        const pageNumber = (name: string) => Number(name.match(/-(\d+)\.png$/)?.[1] ?? 0);
        return pageNumber(left) - pageNumber(right);
      });

    const pageTexts: string[] = [];
    for (const file of pageFiles.slice(0, pageLimit)) {
      const { stdout } = await execFileAsync(
        "tesseract",
        [join(workDir, file), "stdout", "-l", "eng", "--psm", "6"],
        { timeout: 15_000, maxBuffer: 512 * 1024 },
      );
      const pageNumber = file.match(/-(\d+)\.png$/)?.[1] ?? "?";
      pageTexts.push(`[Scanned page ${pageNumber}]\n${stdout}`);
    }

    return limitText(pageTexts.join("\n\n"));
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

async function extractPdfText(buffer: Buffer): Promise<ExtractedStrengthsCvSource> {
  const { PDFParse } = (await import("pdf-parse")) as unknown as {
    PDFParse: new (opts: { data: Buffer | Uint8Array }) => {
      getText(): Promise<{ text: string; total?: number }>;
      destroy(): Promise<void>;
    };
  };
  const parser = new PDFParse({ data: buffer });
  let text = "";
  let totalPages = MAX_SCANNED_PDF_PAGES;
  let parseError: unknown;

  try {
    const result = await parser.getText();
    text = result.text ?? "";
    totalPages = result.total || MAX_SCANNED_PDF_PAGES;
  } catch (error) {
    parseError = error;
  } finally {
    await parser.destroy().catch(() => {});
  }

  if (text.trim().length >= 40) {
    return {
      text: limitText(text),
      sourceFormat: "searchable_pdf",
      notice: null,
    };
  }

  const pagesToRead = Math.max(1, Math.min(totalPages, MAX_SCANNED_PDF_PAGES));
  try {
    const ocrText = await extractScannedPdfText(buffer, pagesToRead);
    return {
      text: ocrText,
      sourceFormat: "scanned_pdf_ocr",
      notice:
        totalPages > MAX_SCANNED_PDF_PAGES
          ? `OCR checked the first ${MAX_SCANNED_PDF_PAGES} pages of this scanned CV. Review the excerpts carefully.`
          : "OCR was used for this scanned PDF. Review the excerpts carefully.",
    };
  } catch (error) {
    if (parseError) throw error;
    throw error;
  }
}

export async function extractStrengthsCvSource(
  buffer: Buffer,
  mimeType: string,
): Promise<ExtractedStrengthsCvSource> {
  if (mimeType === "application/pdf") {
    return extractPdfText(buffer);
  }

  if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    const result = await mammoth.extractRawText({ buffer });
    return {
      text: limitText(result.value),
      sourceFormat: "word_docx",
      notice: null,
    };
  }

  if (mimeType === "application/msword") {
    const result = await WORD_EXTRACTOR.extract(buffer);
    return {
      text: limitText(result.getBody()),
      sourceFormat: "word_doc",
      notice: null,
    };
  }

  throw new Error("Choose a PDF, DOC, or DOCX CV.");
}
