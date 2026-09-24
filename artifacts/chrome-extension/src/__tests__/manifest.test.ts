import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const manifest = JSON.parse(
  readFileSync(resolve(process.cwd(), "manifest.json"), "utf8"),
) as { version?: string; host_permissions?: string[]; permissions?: string[] };

describe("extension manifest", () => {
  it("grants HTTPS host access required to retain JOBSAGE clicks through employer redirects", () => {
    expect(manifest.version).toBe("0.4.20");
    expect(manifest.permissions).toContain("webNavigation");
    expect(manifest.host_permissions).toContain("https://*/*");
  });
});