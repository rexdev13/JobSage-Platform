import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEmployerInput } from "../../tools/companySiteDiscoveryInput";

const temporaryDirectories: string[] = [];

async function temporaryFile(name: string, content: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "company-site-input-"));
  temporaryDirectories.push(directory);
  const filePath = join(directory, name);
  await writeFile(filePath, content, "utf8");
  return filePath;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true }),
  ));
});

describe("company-site employer input provenance", () => {
  it("loads JSON only when environment and source are explicitly declared", async () => {
    const filePath = await temporaryFile("employers.json", JSON.stringify({
      sourceEnvironment: "production",
      sourceDescription: "approved production read-only export",
      employers: [{
        organisation_name: "Example Employer",
        website: "https://example.org",
        careers_url: "https://jobs.example.org",
      }],
    }));
    const input = await loadEmployerInput(filePath);
    expect(input).toMatchObject({
      sourceEnvironment: "production",
      sourceDescription: "approved production read-only export",
      employers: [{
        organisation_name: "Example Employer",
        website: "https://example.org",
        careers_url: "https://jobs.example.org",
      }],
    });
    expect(input.path).toContain("employers.json");
    expect(input.sha256).toMatch(/^[0-9a-f]{64}$/);

    const undeclared = await temporaryFile("undeclared.json", JSON.stringify({
      employers: [{ organisation_name: "Example Employer", website: "https://example.org" }],
    }));
    await expect(loadEmployerInput(undeclared)).rejects.toThrow("sourceEnvironment");
  });

  it("requires consistent source declarations on every CSV row", async () => {
    const filePath = await temporaryFile(
      "employers.csv",
      [
        "source_environment,source_description,organisation_name,website",
        "development,development fixture,Example One,https://one.example",
        "development,development fixture,Example Two,https://two.example",
      ].join("\n"),
    );
    const input = await loadEmployerInput(filePath);
    expect(input.sourceEnvironment).toBe("development");
    expect(input.sourceDescription).toBe("development fixture");
    expect(input.employers).toHaveLength(2);

    const mixed = await temporaryFile(
      "mixed.csv",
      [
        "source_environment,source_description,organisation_name,website",
        "production,production export,Example One,https://one.example",
        "development,development fixture,Example Two,https://two.example",
      ].join("\n"),
    );
    await expect(loadEmployerInput(mixed)).rejects.toThrow("same source_environment");
  });
});