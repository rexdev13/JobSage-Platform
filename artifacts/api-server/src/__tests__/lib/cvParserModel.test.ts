import PDFDocument from "pdfkit";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createCompletion } = vi.hoisted(() => ({ createCompletion: vi.fn() }));

vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: { chat: { completions: { create: createCompletion } } },
}));

vi.mock("child_process", () => ({
  execFile: vi.fn((_command, _args, callback) => callback(new Error("Renderer unavailable"))),
}));

vi.mock("fs/promises", () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockRejectedValue(new Error("No rendered image")),
  unlink: vi.fn().mockResolvedValue(undefined),
}));

import { extractCvFields } from "../../lib/cvParser";

describe("CV extraction model compatibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createCompletion.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({
        profession: "engineer",
        experienceYears: 5,
        confidence: { profession: "high", experienceYears: "high" },
      }) } }],
    });
  });

  it("uses gpt-4o with image inputs and retains parsed profile fields", async () => {
    const result = await extractCvFields(Buffer.from("synthetic-image"), "image/png");
    expect(result.profession).toBe("Engineer");
    expect(result.experienceYears).toBe(5);
    expect(createCompletion).toHaveBeenCalledWith(expect.objectContaining({
      model: "gpt-4o",
      response_format: { type: "json_object" },
      messages: expect.arrayContaining([expect.objectContaining({
        role: "user",
        content: expect.arrayContaining([expect.objectContaining({ type: "image_url" })]),
      })]),
    }));
  });

  it("normalizes profession aliases against the full supported catalogue", async () => {
    createCompletion.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({
        profession: "Business Development Manager",
        registrationStatus: "registered",
        confidence: { profession: "high" },
      }) } }],
    });

    const result = await extractCvFields(Buffer.from("synthetic-image"), "image/png");
    expect(result.profession).toBe("Business Development");
    expect(result.registrationStatus).toBe("not_applicable");
    expect(createCompletion.mock.calls[0]?.[0].messages[0].content).toContain("Research / Academia");
  });

  it("keeps clinical qualification mismatch checks working with canonical labels", async () => {
    createCompletion.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({
        profession: "Nurse",
        qualificationType: "PhD in Education",
        confidence: { profession: "high" },
      }) } }],
    });

    const result = await extractCvFields(Buffer.from("synthetic-image"), "image/png");
    expect(result.profession).toBe("Nurse");
    expect(result.professionQualMismatch).toBe(true);
    expect(result.professionQualMismatchWarning).toContain("qualification");
  });

  it("preserves reviewable CV details beyond the former 200-character limit", async () => {
    const rawNotes = "Synthetic reviewed experience detail. ".repeat(24);
    createCompletion.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ rawNotes }) } }],
    });

    const result = await extractCvFields(Buffer.from("synthetic-image"), "image/png");
    expect(result.rawNotes).toBe(rawNotes);
    expect(result.rawNotes.length).toBeGreaterThan(200);
  });

  it("uses gpt-4o for text extracted from a PDF", async () => {
    const document = new PDFDocument();
    const parts: Buffer[] = [];
    const buffer = new Promise<Buffer>((resolve, reject) => {
      document.on("data", (part: Buffer) => parts.push(part));
      document.on("end", () => resolve(Buffer.concat(parts)));
      document.on("error", reject);
    });
    document.text("Synthetic CV. Profession: Engineer. Experience: 5 years.");
    document.end();
    await extractCvFields(await buffer, "application/pdf");
    expect(createCompletion).toHaveBeenCalledWith(expect.objectContaining({
      model: "gpt-4o",
      messages: expect.arrayContaining([expect.objectContaining({
        role: "user",
        content: expect.stringContaining("Profession: Engineer"),
      })]),
    }));
  });

  it("includes PDF text after the former 8,000-character cutoff", async () => {
    const tailMarker = "SYNTHETIC_TAIL_ROLE_AFTER_EIGHT_THOUSAND_CHARACTERS";
    const document = new PDFDocument();
    const parts: Buffer[] = [];
    const buffer = new Promise<Buffer>((resolve, reject) => {
      document.on("data", (part: Buffer) => parts.push(part));
      document.on("end", () => resolve(Buffer.concat(parts)));
      document.on("error", reject);
    });
    document.text("Repeated synthetic work-history detail. ".repeat(400));
    document.text(tailMarker);
    document.end();

    await extractCvFields(await buffer, "application/pdf");
    const request = createCompletion.mock.calls[0]?.[0];
    expect(request.messages[1].content).toContain(tailMarker);
  });

  it("warns when a very long PDF needs its middle section omitted", async () => {
    const document = new PDFDocument();
    const parts: Buffer[] = [];
    const buffer = new Promise<Buffer>((resolve, reject) => {
      document.on("data", (part: Buffer) => parts.push(part));
      document.on("end", () => resolve(Buffer.concat(parts)));
      document.on("error", reject);
    });
    document.text("Synthetic CV detail. ".repeat(3_500));
    document.end();

    const result = await extractCvFields(await buffer, "application/pdf");
    const request = createCompletion.mock.calls[0]?.[0];
    expect(request.messages[1].content).toContain("[Middle section omitted");
    expect(result.rawNotes).toContain("Some middle CV text was omitted");
  });

  it("sends the direct PDF fallback as a file, never as an image URL", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const buffer = Buffer.from("synthetic-unparseable-pdf");
      await extractCvFields(buffer, "application/pdf");
      expect(createCompletion).toHaveBeenCalledWith(expect.objectContaining({
        model: "gpt-4o",
        messages: expect.arrayContaining([expect.objectContaining({
          role: "user",
          content: expect.arrayContaining([{
            type: "file",
            file: {
              filename: "cv.pdf",
              file_data: `data:application/pdf;base64,${buffer.toString("base64")}`,
            },
          }]),
        })]),
      }));
      const request = createCompletion.mock.calls[0]?.[0];
      expect(request.messages[1].content.some((part: { type: string }) => part.type === "image_url")).toBe(false);
    } finally {
      warning.mockRestore();
    }
  });
});
