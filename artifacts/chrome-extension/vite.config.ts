import { defineConfig } from "vite";
import { resolve } from "path";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import react from "@vitejs/plugin-react";

function copyManifest() {
  return {
    name: "copy-manifest",
    closeBundle() {
      copyFileSync(
        resolve(__dirname, "manifest.json"),
        resolve(__dirname, "dist/manifest.json")
      );
      // Copy store-required icons (16/32/48/128) into the bundle.
      mkdirSync(resolve(__dirname, "dist/icons"), { recursive: true });
      for (const size of [16, 32, 48, 128]) {
        copyFileSync(
          resolve(__dirname, `icons/icon${size}.png`),
          resolve(__dirname, `dist/icons/icon${size}.png`)
        );
      }
    },
  };
}

/**
 * Chrome extension popup pages load scripts from chrome-extension:// which
 * does not serve CORS headers. Vite's ESM build adds `crossorigin` to every
 * <script type="module"> and <link rel="modulepreload">, which tells the
 * browser to use CORS mode for the fetch. That causes the script to fail
 * silently, leaving a blank white popup.
 *
 * This plugin post-processes dist/popup.html after the bundle is written and
 * strips all crossorigin attributes so Chrome loads the scripts without CORS.
 */
function stripCrossorigin() {
  return {
    name: "strip-crossorigin",
    closeBundle() {
      const htmlPath = resolve(__dirname, "dist/popup.html");
      if (!existsSync(htmlPath)) return;
      const original = readFileSync(htmlPath, "utf8");
      const fixed = original.replace(/\s+crossorigin(?:="[^"]*")?/gi, "");
      if (fixed !== original) {
        writeFileSync(htmlPath, fixed);
      }
    },
  };
}

// Dev-server origin baked in at build time; editable in the popup at runtime.
const devDomain = process.env.REPLIT_DEV_DOMAIN;
const devOrigin = devDomain ? `https://${devDomain}` : "";

export default defineConfig({
  plugins: [react(), copyManifest(), stripCrossorigin()],
  define: {
    __DEV_ORIGIN__: JSON.stringify(devOrigin),
  },
  build: {
    outDir: "dist",
    target: "chrome116",
    emptyOutDir: true,
    rollupOptions: {
      // content.tsx is built separately as a classic-script IIFE bundle
      // (vite.config.content.ts) because Chrome injects content scripts as
      // non-module scripts — ESM imports would crash at injection time.
      input: {
        background: resolve(__dirname, "src/background.ts"),
        popup: resolve(__dirname, "popup.html"),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "[name].js",
        assetFileNames: "[name].[ext]",
        format: "esm",
      },
    },
  },
});
