import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? sourceFiles(path)
      : entry.name.endsWith(".ts") ? [path] : [];
  });
}

const STRONGER_MODEL_OVERRIDES: Record<string, string> = {
  "lib/applyUrlBackfill.ts": "gpt-4o",
  "lib/candidateAiMatch.ts": "gpt-4o",
  "lib/contactEnrichmentRunner.ts": "gpt-5.4-mini",
  "lib/coverLetterGenerator.ts": "gpt-4o",
  "lib/cvParser.ts": "gpt-4o",
  "lib/progressReportGenerator.ts": "gpt-4o",
  "lib/smartApply.ts": "gpt-4o",
  "lib/sponsorVacancyMatch.ts": "gpt-4o",
  "lib/vacancyGapAnalysis.ts": "gpt-4o",
  "routes/ai.ts": "gpt-4o",
  "routes/careerProfiles.ts": "gpt-4o",
  "routes/coverLetter.ts": "gpt-4o",
  "routes/cvEnhancement.ts": "gpt-4o",
  "routes/identity.ts": "gpt-4o",
  "routes/interviewPrep.ts": "gpt-4o",
  "routes/roles.ts": "gpt-4o",
  "routes/smartApply.ts": "gpt-4o",
  "routes/sponsorLicences.ts": "gpt-4o",
};

describe("JOBSAGE application AI model policy", () => {
  it("keeps stronger models on complex or accuracy-sensitive workflows", () => {
    const sourceRoot = fileURLToPath(new URL("../../", import.meta.url));
    const files = ["lib", "routes"].flatMap((directory) => sourceFiles(join(sourceRoot, directory)));
    const calls = files.flatMap((file) => {
      const relativePath = relative(sourceRoot, file).replaceAll("\\", "/");
      return [...readFileSync(file, "utf8").matchAll(/\bmodel\s*:\s*["']([^"']+)["']/g)]
        .map((match) => ({ relativePath, model: match[1] }));
    });
    expect(calls.length).toBeGreaterThan(0);
    const seenOverrides = new Set<string>();
    for (const call of calls) {
      const expected = STRONGER_MODEL_OVERRIDES[call.relativePath] ?? "gpt-4o-mini";
      expect(call.model, `Model policy changed in ${call.relativePath}`).toBe(expected);
      if (STRONGER_MODEL_OVERRIDES[call.relativePath]) seenOverrides.add(call.relativePath);
    }
    expect([...seenOverrides].sort()).toEqual(Object.keys(STRONGER_MODEL_OVERRIDES).sort());
  });
});
