#!/usr/bin/env node
/**
 * Packages the built extension (dist/) into:
 *  1. release/jobsage-smart-apply-extension-v<version>.zip — the Chrome Web
 *     Store submission zip (production files only: manifest, JS bundles, icons;
 *     no source maps, no dev files).
 *  2. ../jobsage-web/public/jobsage-smart-apply-extension.zip — the direct
 *     download zip served by the web app ("Load unpacked" install flow).
 *
 * Run after `vite build` (see the `package` script in package.json).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, copyFileSync, rmSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");

if (!existsSync(resolve(dist, "manifest.json"))) {
  console.error("dist/manifest.json not found — run `pnpm run build` first.");
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
if (!permissions.includes("webNavigation") || !hostPermissions.includes("https://*/*")) {
  console.error(
    "Refusing to package: manifest must include webNavigation and https://*/* host access for redirect-safe application tracking.",
  );
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
