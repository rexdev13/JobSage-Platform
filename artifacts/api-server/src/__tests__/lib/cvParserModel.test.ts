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

  it("uses mini with image inputs and retains parsed profile fields", async () => {
    const result = await extractCvFields(Buffer.from("synthetic-image"), "image/png");
    expect(result.profession).toBe("engineer");
    expect(result.experienceYears).toBe(5);
    expect(createCompletion).toHaveBeenCalledWith(expect.objectContaining({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: expect.arrayContaining([expect.objectContaining({
        role: "user",
        content: expect.arrayContaining([expect.objectContaining({ type: "image_url" })]),
      })]),
    }));
  });

  it("uses mini for text extracted from a PDF", async () => {
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
      model: "gpt-4o-mini",
      messages: expect.arrayContaining([expect.objectContaining({
        role: "user",
        content: expect.stringContaining("Profession: Engineer"),
      })]),
    }));
  });

  it("sends the direct PDF fallback as a file, never as an image URL", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const buffer = Buffer.from("synthetic-unparseable-pdf");
      await extractCvFields(buffer, "application/pdf");
      expect(createCompletion).toHaveBeenCalledWith(expect.objectContaining({
        model: "gpt-4o-mini",
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
