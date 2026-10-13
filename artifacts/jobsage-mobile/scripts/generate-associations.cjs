const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const {
  buildAssociationDocuments,
  resolveUniversalLinkConfig,
} = require("./deep-link-config.cjs");

const defaultOutputDirectory = path.resolve(
  __dirname,
  "../../jobsage-web/public/.well-known",
);
const defaultManifestPath = path.resolve(
  __dirname,
  "../../jobsage-web/.generated-association-files.json",
);

function removeGeneratedFiles(outputDirectory, manifestPath) {
  if (!fs.existsSync(manifestPath)) return;
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch {
    throw new Error("The generated app-link manifest is invalid; inspect it before removing association files.");
  }
  for (const [filename, expectedHash] of Object.entries(manifest.files || {})) {
    if (!["apple-app-site-association", "assetlinks.json"].includes(filename)) continue;
    const outputPath = path.join(outputDirectory, filename);
    if (!fs.existsSync(outputPath)) continue;
    const actualHash = crypto.createHash("sha256").update(fs.readFileSync(outputPath)).digest("hex");
    if (actualHash === expectedHash) fs.unlinkSync(outputPath);
  }
  fs.unlinkSync(manifestPath);
}

function writeAssociationFiles(links, outputDirectory, manifestPath) {
  const documents = buildAssociationDocuments(links);
  fs.mkdirSync(outputDirectory, { recursive: true });
  const files = {};
  for (const [filename, contents] of Object.entries(documents)) {
    fs.writeFileSync(path.join(outputDirectory, filename), contents, { encoding: "utf8", mode: 0o644 });
    files[filename] = crypto.createHash("sha256").update(contents).digest("hex");
  }
  fs.writeFileSync(manifestPath, `${JSON.stringify({ files }, null, 2)}\n`, "utf8");
}

function main(argv = process.argv.slice(2), env = process.env) {
  const required = argv.includes("--required") || argv.includes("--validate-only");
  const validateOnly = argv.includes("--validate-only");
  const links = resolveUniversalLinkConfig(env, { required });
  if (!links) {
    removeGeneratedFiles(defaultOutputDirectory, defaultManifestPath);
    console.warn("Universal/App Links were not generated; final owner-approved domain, app identifiers, and signing fingerprint are not configured.");
    return;
  }
  if (validateOnly) {
    console.log("Universal/App Links configuration is valid.");
    return;
  }
  writeAssociationFiles(links, defaultOutputDirectory, defaultManifestPath);
  console.log("Generated apple-app-site-association and assetlinks.json from owner-provided configuration.");
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`Universal/App Links configuration error: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { main, removeGeneratedFiles, writeAssociationFiles };
