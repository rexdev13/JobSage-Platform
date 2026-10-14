import { afterEach, describe, expect, it, vi } from "vitest";

describe("development AI provider safety", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("does not contact the configured external provider unless development explicitly opts in", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ENABLE_DEVELOPMENT_EXTERNAL_PROVIDERS", "");
    vi.stubEnv("AI_INTEGRATIONS_OPENAI_BASE_URL", "");
    vi.stubEnv("AI_INTEGRATIONS_OPENAI_API_KEY", "");
    vi.resetModules();

    const { openai } = await import("@workspace/integrations-openai-ai-server");
    await expect(openai.chat.completions.create({
      model: "development-safety-check",
      messages: [{ role: "user", content: "safety check" }],
    })).rejects.toBeTruthy();
  });
});
