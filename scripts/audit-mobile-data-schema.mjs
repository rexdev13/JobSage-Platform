/**
 * Source-only evidence generator. Never imports DB code, connects to a DB,
 * reads environment values, or loads any user's records.
 */
import ts from "typescript";
import { readdir, readFile, writeFile } from "node:fs/promises";

const directory = "lib/db/src/schema";
const tables = [];
const walk = (node, visit) => { visit(node); ts.forEachChild(node, child => walk(child, visit)); };
for (const filename of (await readdir(directory)).filter(name => name.endsWith(".ts")).sort()) {
  const source = ts.createSourceFile(filename, await readFile(`${directory}/${filename}`, "utf8"),
    ts.ScriptTarget.Latest, true);
  walk(source, node => {
    if (!ts.isVariableDeclaration(node) || !node.initializer || !ts.isCallExpression(node.initializer)) return;
    const call = node.initializer;
    if (call.expression.getText(source) !== "pgTable" || !call.arguments[0] || !ts.isStringLiteral(call.arguments[0])) return;
    const object = call.arguments[1];
    if (!object || !ts.isObjectLiteralExpression(object)) return;
    const columns = [];
    const review = [];
    const references = [];
    for (const property of object.properties) {
      if (!ts.isPropertyAssignment(property)) continue;
      const column = property.name.getText(source).replace(/["']/g, "");
      columns.push(column);
      const calls = [];
      walk(property.initializer, expression => {
        if (!ts.isCallExpression(expression)) return;
        const name = ts.isIdentifier(expression.expression) ? expression.expression.text
          : ts.isPropertyAccessExpression(expression.expression) ? expression.expression.name.text : "";
        calls.push(name);
      });
      const reasons = [];
      if (/^(?:userId|.*UserId|candidateId|ownerId|recipientId|senderId|actor|createdBy|updatedBy|reviewedBy|assignedTo|assignedToId|convertedBy|employerProfileId|senderEmployerProfileId)$/i.test(column)) {
        reasons.push("possible account/actor/indirect ownership selector — verify writes and role semantics");
      }
      if (calls.includes("json") || calls.includes("jsonb")) reasons.push("JSON container — inspect nested identities, personal data and credentials");
      if (calls.includes("array")) reasons.push("array container — inspect element ownership and shared values");
      if (/(?:email|phone|firstName|lastName|displayName|ipHash|ipAddress|userAgent)/i.test(column)) reasons.push("possible direct personal/contact metadata — not necessarily exclusive ownership");
      if (/(?:password|token|secret)/i.test(column)) reasons.push("credential-like field — never presume exportable; verify purpose");
      if (/(?:storageKey|passportKey|selfieKey|profileImageUrl|DocumentId)/i.test(column)) reasons.push("possible document/object pointer — resolve ownership and copies before deleting references");
      if (reasons.length) review.push({ column, reasons });
      walk(property.initializer, expression => {
        if (!ts.isCallExpression(expression) || !ts.isPropertyAccessExpression(expression.expression)
          || expression.expression.name.text !== "references") return;
        const callback = expression.arguments[0];
        if (!callback || !ts.isArrowFunction(callback) || !ts.isPropertyAccessExpression(callback.body)) {
          references.push({ column, target: "UNRESOLVED callback", action: "manual review required" }); return;
        }
        const target = callback.body.expression.getText(source);
        let action = "NO ACTION (no explicit onDelete)";
        const options = expression.arguments[1];
        if (options && ts.isObjectLiteralExpression(options)) {
          const deletion = options.properties.find(p => ts.isPropertyAssignment(p) && p.name.getText(source) === "onDelete");
          if (deletion && ts.isPropertyAssignment(deletion)) action = deletion.initializer.getText(source);
        }
        references.push({ column, target, action });
      });
    }
    tables.push({ variable: node.name.getText(source), table: call.arguments[0].text, filename, columns, references, review });
  });
}
if (!tables.length) throw new Error("No pgTable definitions found; audit not generated.");
const user = tables.find(table => table.table === "users");
if (!user) throw new Error("User table unresolved; audit not generated.");
const associated = new Set([user.variable]);
let expanded = true;
while (expanded) {
  expanded = false;
  for (const table of tables) if (!associated.has(table.variable)
    && table.references.some(reference => associated.has(reference.target))) {
    associated.add(table.variable); expanded = true;
  }
}
const lines = [
  "# Database relationship evidence for the mobile privacy/deletion audit",
  "",
  `Generated from source on ${new Date().toISOString().slice(0, 10)} using scripts/audit-mobile-data-schema.mjs.`,
  `Found ${tables.length} pgTable definitions. No database connection, environment values or user data were accessed.`,
  "",
  "## Scope and limits",
  "",
  "- This is a relationship inventory, not a finished deletion policy or proof of actual database constraints.",
  "- “User-associated” includes indirect/shared relationships; it does not mean an entire table or every related row belongs exclusively to one user.",
  "- Listed onDelete behavior is from source only. Compare migrations and the target database before relying on it.",
  "- Foreign-key-free IDs, JSON, arrays, object storage, email, calendars, AI processors, local native/extension memory, logs and backups require additional review.",
  "- Do not cascade-delete public employer/source catalogues or another person's applications or messages merely because a path reaches them.",
  "- Retention durations, legal exceptions, backup timing and processor erasure are UNRESOLVED pending owner/provider/legal confirmation. No duration is inferred.",
  "- An export must use explicit field allowlists and ownership joins; never export passwords, session material, email-verification/reset tokens, OAuth credentials or internal administrative notes.",
  "- The review candidates below are conservative name/type heuristics, not proven ownership, a deletion allowlist or an exhaustive personal-data detector. Unflagged free text can also contain personal data.",
  "",
  "## Non-FK and container review candidates",
  "",
  "| Table | Column | Why manual review is required |",
  "| --- | --- | --- |",
  ...tables.flatMap(table => table.review.map(item =>
    `| ${table.table} | ${item.column} | ${item.reasons.join("; ")} |`)),
  "",
  "## Source relationships",
  "",
  "| Table / definition | User-associated through declared FK graph | Columns | Declared references and deletion action |",
  "| --- | --- | --- | --- |",
];
for (const table of tables) lines.push(
  `| ${table.table} (${table.variable}), [source](../../${directory}/${table.filename}) | ${associated.has(table.variable) ? "Yes — ownership and sharing need review" : "Not established by graph; inspect raw identifiers/JSON"} | ${table.columns.join(", ")} | ${table.references.map(ref => `${ref.column} → ${ref.target}; ${ref.action}`).join("<br>") || "No inline FK declaration"} |`,
);
lines.push("", "## Mandatory non-FK follow-up", "",
  "- Authentication/session JSON includes both ordinary user snapshots and short-lived mobile exchange records. Delete/revoke both ownership forms; do not expose either in exports.",
  "- Find every user-owned object path before deleting database references. Preserve an idempotent, retryable erasure ledger until object/provider work finishes.",
  "- Shared messages, employer jobs, received references, audit and financial/marketing records need explicit delete/anonymise/retain decisions; source FK actions are not legal justification.",
  "- Review native SecureStore credentials and opt-in answer library, temporary documents, WebView cookies/cache, Chrome storage and saved server drafts separately.",
  "- Record erasure failures without file contents, credentials or personal data; distinguish accepted, processing, failed/retrying and completed requests.",
  "- Before destructive implementation, complete the data-inventory.md decisions and verify all row selectors against isolated fixtures.", "");
await writeFile("docs/mobile-store-compliance/schema-ownership-inventory.md", lines.join("\n"));
await writeFile("docs/mobile-store-compliance/schema-ownership-candidates.json", JSON.stringify({
  scope: "SOURCE_ONLY_NOT_AN_ERASURE_OR_EXPORT_POLICY",
  generatedAt: new Date().toISOString(),
  databaseAccessed: false,
  limits: ["Name/type heuristics are not exhaustive", "Actual constraints unverified", "Retention and shared ownership unresolved"],
  tables: tables.map(table => ({
    definition: table.variable, table: table.table, source: `${directory}/${table.filename}`,
    declaredUserGraph: associated.has(table.variable), references: table.references, review: table.review,
  })),
}, null, 2) + "\n");
console.log(`Source-only relationship inventory generated: ${tables.length} tables; ${associated.size} user-associated definitions.`);
