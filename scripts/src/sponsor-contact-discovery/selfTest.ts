import assert from "node:assert/strict";
import { parseCsv, stringifyCsv } from "./csv";
import { normaliseImportName, normaliseImportWebsite } from "./importValidation";

const parsed = parseCsv('name,notes\n"Acme, Ltd","line 1\nline 2"\n');
assert.deepEqual(parsed[1], ["Acme, Ltd", "line 1\nline 2"]);
assert.equal(stringifyCsv([{ name: "Acme, Ltd", notes: "ok" }], ["name", "notes"]), 'name,notes\n"Acme, Ltd",ok\n');
assert.equal(normaliseImportName("The Acme Limited"), "acme");
assert.equal(normaliseImportWebsite("https://example.org/path/"), "https://example.org/path");
console.log("sponsor-contact-discovery self-test passed");