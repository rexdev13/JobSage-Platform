export interface CandidateCv {
  data: string;
  filename: string;
  mimeType: string;
}

export interface CvAttachResult {
  attached: boolean;
  reason: "attached" | "no-input" | "blocked";
  filename: string;
}

function labelText(input: HTMLInputElement): string {
  const doc = input.ownerDocument;
  const ariaLabelledBy = input.getAttribute("aria-labelledby");
  const labelledBy = ariaLabelledBy
    ? ariaLabelledBy
        .split(/\s+/)
        .map((id) => doc.getElementById(id)?.textContent ?? "")
        .join(" ")
    : "";
  const escapedId =
    typeof CSS !== "undefined" && CSS.escape
      ? CSS.escape(input.id)
      : input.id.replace(/["\\]/g, "\\$&");
  const externalLabel = input.id ? doc.querySelector(`label[for="${escapedId}"]`)?.textContent ?? "" : "";
  return [input.closest("label")?.textContent, externalLabel, labelledBy].filter(Boolean).join(" ");
}

function inputScore(input: HTMLInputElement): number {
  const metadata = [
    input.name,
    input.id,
    input.getAttribute("aria-label"),
    input.getAttribute("data-automation-id"),
    input.getAttribute("accept"),
    labelText(input),
  ].join(" ");
  let score = 0;
  if (/\b(cv|resume|résumé|curriculum\s*vitae|curriculum)\b/i.test(metadata)) score += 8;
  if (/\b(upload|attach)\b/i.test(metadata)) score += 1;
  if (/\bcover(ing)?\s*letter\b/i.test(metadata)) score -= 10;
  if (/\b(photo|avatar|image|headshot|passport|identity|proof\s*of\s*(id|identity)|national\s*insurance)\b/i.test(metadata)) {
    score -= 10;
  }
  return score;
}

export function findCvFileInput(doc: Document = document): HTMLInputElement | null {
  // ATSes often hide the native file input behind a visible “Upload CV” label.
  // Strong CV-specific metadata is still required, so hidden generic/photo
  // inputs remain ineligible.
  const inputs = Array.from(doc.querySelectorAll<HTMLInputElement>("input[type='file']")).filter(
    (input) => !input.disabled && input.getAttribute("aria-hidden") !== "true",
  );
  if (inputs.length === 0) return null;
  const ranked = inputs
    .map((input) => ({ input, score: inputScore(input) }))
    .sort((a, b) => b.score - a.score);
  if (ranked[0]!.score > 0) return ranked[0]!.input;
  return null;
}

function decodeBase64(data: string): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function attachCvToForm(
  cv: CandidateCv,
  doc: Document = document,
): CvAttachResult {
  const input = findCvFileInput(doc);
  if (!input) return { attached: false, reason: "no-input", filename: cv.filename };

  try {
    const bytes = decodeBase64(cv.data);
    const fileBytes = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    const file = new File([fileBytes], cv.filename, { type: cv.mimeType || "application/pdf" });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return { attached: true, reason: "attached", filename: cv.filename };
  } catch {
    return { attached: false, reason: "blocked", filename: cv.filename };
  }
}