import { defineConfig } from "vite";
import { resolve } from "path";
import react from "@vitejs/plugin-react";

// Separate build pass for the content script. Chrome injects content scripts
// as classic (non-module) scripts, so content.js must be a single
// self-contained IIFE bundle with no top-level import/export statements.
// Rollup cannot mix output formats or disable code-splitting per entry in a
// single multi-entry build, hence this second config (see vite.config.ts for
// the background/popup ESM build).
const devDomain = process.env.REPLIT_DEV_DOMAIN;
const devOrigin = devDomain ? `https://${devDomain}` : "";

export default defineConfig({
  plugins: [react()],
  define: {
    __DEV_ORIGIN__: JSON.stringify(devOrigin),
    // React's production build reads process.env.NODE_ENV; in the IIFE bundle
    // there is no bundler-injected default, so pin it explicitly.
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  build: {
    outDir: "dist",
    target: "chrome116",
    // The ESM build (background/popup) runs first and owns emptyOutDir.
    emptyOutDir: false,
    rollupOptions: {
      input: resolve(__dirname, "src/content.tsx"),
      output: {
        entryFileNames: "content.js",
        format: "iife",
        inlineDynamicImports: true,
      },
    },
  },
});
