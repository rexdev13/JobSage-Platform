import { defineConfig } from "vite";
import { resolve } from "path";
import { copyFileSync, mkdirSync } from "fs";
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

export default defineConfig({
  plugins: [react(), copyManifest()],
  build: {
    outDir: "dist",
    target: "chrome116",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        background: resolve(__dirname, "src/background.ts"),
        content: resolve(__dirname, "src/content.tsx"),
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
