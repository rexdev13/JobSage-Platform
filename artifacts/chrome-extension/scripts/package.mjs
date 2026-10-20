#!/usr/bin/env node
/**
 * Packages the built extension (dist/) into:
 *  1. release/jobsage-smart-apply-extension-v<version>.zip — the Chrome Web
 *     Store submission zip (production files only: manifest, JS bundles, icons;
 *     no source maps, no dev files).
 *  2. ../jobsage-web/public/jobsage-smart-apply-extension.zip — the direct
 *     download zip served by the web app ("Load unpacked" install flow).
 *
 * Run with `pnpm run package`; that command creates a production-only build
 * before packaging, so the development-origin controls cannot ship by accident.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, copyFileSync, rmSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");

if (!existsSync(resolve(dist, "manifest.json"))) {
  console.error("dist/manifest.json not found — run `pnpm run package` to build and package.");
  process.exit(1);
}

// Sanity: refuse to package dev artifacts.
const forbidden = readdirSync(dist, { recursive: true }).filter(
  (f) => String(f).endsWith(".map") || String(f).endsWith(".ts") || String(f).endsWith(".tsx")
);
if (forbidden.length > 0) {
  console.error("Refusing to package dev files:", forbidden.join(", "));
  process.exit(1);
}

// Content scripts are injected as classic scripts — a top-level import/export
// in content.js crashes immediately on every page. Refuse to package one.
const contentJs = readFileSync(resolve(dist, "content.js"), "utf8");
if (/^\s*(import|export)[\s{"']/m.test(contentJs)) {
  console.error(
    "dist/content.js contains top-level import/export statements — it must be a classic-script IIFE bundle (see vite.config.content.ts)."
  );
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(resolve(dist, "manifest.json"), "utf8"));
const { version, permissions = [], host_permissions: hostPermissions = [] } = manifest;
if (
  !permissions.includes("webNavigation")
  || permissions.includes("tabs")
  || !permissions.includes("downloads")
  || !hostPermissions.includes("https://*/*")
  || hostPermissions.some((host) => /replit\.dev/i.test(host))
) {
  console.error(
    "Refusing to package: manifest needs webNavigation, downloads, and HTTPS host access, without tabs or Replit development hosts.",
  );
  process.exit(1);
}

const bundleFiles = readdirSync(dist, { recursive: true })
  .map(String)
  .filter((file) => file.endsWith(".js"));
const bundleText = bundleFiles
  .map((file) => readFileSync(resolve(dist, file), "utf8"))
  .join("\n");
const developmentOnlyContent =
  /\.replit\.dev|REPLIT_DEV_DOMAIN|your-app\.replit\.dev|Development server URL|\bDevelopment\b/i;
if (developmentOnlyContent.test(bundleText)) {
  console.error("Refusing to package: development origin or selector remains in the store JavaScript bundles.");
  process.exit(1);
}

const releaseDir = resolve(root, "release");
mkdirSync(releaseDir, { recursive: true });
const storeZip = resolve(releaseDir, `jobsage-smart-apply-extension-v${version}.zip`);
rmSync(storeZip, { force: true });

// Zip the *contents* of dist so manifest.json sits at the zip root (store requirement).
execFileSync("zip", ["-r", "-X", storeZip, "."], { cwd: dist, stdio: "inherit" });

// Refresh the direct-download zip served by the web app.
const webZip = resolve(root, "../jobsage-web/public/jobsage-smart-apply-extension.zip");
copyFileSync(storeZip, webZip);

console.log(`\nStore zip:    ${storeZip}`);
console.log(`Download zip: ${webZip}`);
