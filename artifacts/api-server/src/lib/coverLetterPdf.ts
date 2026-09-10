import PDFDocument from "pdfkit";

const MAX_COVER_LETTER_CHARACTERS = 20_000;

export function safeCoverLetterFilename(companyName: string, vacancyTitle?: string | null): string {
  const base = `Cover Letter - ${vacancyTitle?.trim() || companyName.trim() || "Application"}`
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 110);
  return `${base || "Cover Letter"}.pdf`;
}

export function buildCoverLetterPdf(params: {
  candidateName: string;
  jobsageEmail: string;
  companyName: string;
  vacancyTitle?: string | null;
  finalText: string;
  date?: Date;
}): Promise<Buffer> {
  const finalText = params.finalText.trim();
  if (!finalText) {
    return Promise.reject(new Error("Cover letter text is required."));
  }
  if (finalText.length > MAX_COVER_LETTER_CHARACTERS) {
    return Promise.reject(new Error("Cover letter is too long to attach."));
  }

  return new Promise((resolve, reject) => {
    const margin = 58;
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: margin, right: margin, bottom: margin, left: margin },
      info: {
        Title: safeCoverLetterFilename(params.companyName, params.vacancyTitle).replace(/\.pdf$/i, ""),
        Author: params.candidateName,
      },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    const pageWidth = 595.28;
    const contentWidth = pageWidth - margin * 2;
    const sentDate = (params.date ?? new Date()).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });

    doc.font("Helvetica-Bold").fontSize(18).fillColor("#0f172a")
      .text(params.candidateName, { width: contentWidth });
    doc.moveDown(0.25);
    doc.font("Helvetica").fontSize(10).fillColor("#475569")
      .text(params.jobsageEmail, { width: contentWidth });
    doc.moveDown(0.8);
    doc.moveTo(margin, doc.y).lineTo(pageWidth - margin, doc.y)
      .strokeColor("#8B1A1A").lineWidth(1.2).stroke();
    doc.moveDown(1.2);

    doc.font("Helvetica").fontSize(10.5).fillColor("#334155")
      .text(sentDate)
      .moveDown(0.75)
      .text(params.companyName);
    if (params.vacancyTitle?.trim()) {
      doc.text(`Re: ${params.vacancyTitle.trim()}`);
    }
    doc.moveDown(1.25);

    doc.font("Helvetica").fontSize(11).fillColor("#111827")
      .text(finalText, { width: contentWidth, lineGap: 4, align: "left" });

    if (!/\b(yours sincerely|yours faithfully|kind regards|best regards)\b/i.test(finalText)) {
      doc.moveDown(1.25);
      doc.text("Yours sincerely,");
      doc.moveDown(0.75);
      doc.font("Helvetica-Bold").text(params.candidateName);
    }

    doc.end();
  });
}