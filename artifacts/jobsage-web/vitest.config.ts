import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "jsdom",
    include: ["src/**/*.vitest.test.ts", "src/**/*.vitest.test.tsx", "src/**/*.test.tsx", "src/**/*.http.test.ts"],
    exclude: ["src/lib/journeySteps.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
    },
  },
});
