import { defineConfig, devices } from "@playwright/test";

const PORT = process.env.PORT ?? "18557";
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: 1,
  timeout: 30000,
  reporter: [["list"], ["html", { outputFolder: "e2e-report", open: "never" }]],
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], headless: true },
    },
  ],
});
