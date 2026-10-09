import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? sourceFiles(path)
      : entry.name.endsWith(".ts") ? [path] : [];
  });
}

describe("JOBSAGE application AI model policy", () => {
  it("uses gpt-4o-mini for every configured application model call", () => {
    const sourceRoot = fileURLToPath(new URL("../../", import.meta.url));
    const files = ["lib", "routes"].flatMap((directory) => sourceFiles(join(sourceRoot, directory)));
    const calls = files.flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(/\bmodel\s*:\s*["']([^"']+)["']/g)]
        .map((match) => ({ file, model: match[1] })),
    );
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.model, `Model policy changed in ${call.file}`).toBe("gpt-4o-mini");
    }
  });
});
