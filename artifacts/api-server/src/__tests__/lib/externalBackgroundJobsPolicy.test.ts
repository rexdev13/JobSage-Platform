import { describe, expect, it } from "vitest";
import { shouldRunExternalBackgroundJobs } from "../../lib/externalBackgroundJobsPolicy";

describe("external background jobs startup policy", () => {
  it("keeps scheduled provider work disabled in development by default", () => {
    expect(shouldRunExternalBackgroundJobs({ NODE_ENV: "development" })).toBe(false);
  });

  it("requires explicit opt-in for development background jobs", () => {
    expect(shouldRunExternalBackgroundJobs({
      NODE_ENV: "development",
      ENABLE_DEVELOPMENT_EXTERNAL_BACKGROUND_JOBS: "true",
    })).toBe(true);
  });

  it("preserves production scheduling", () => {
    expect(shouldRunExternalBackgroundJobs({ NODE_ENV: "production" })).toBe(true);
  });
});
