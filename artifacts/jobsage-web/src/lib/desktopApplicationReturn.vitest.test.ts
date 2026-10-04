import { afterEach, describe, expect, it, vi } from "vitest";
import { readDesktopApplicationState } from "./desktopApplicationReturn";

const APPLICATION_URL = "https://jobs.example/apply/42?ref=jobsage";

function responseFor(applications: unknown[]) {
  return new Response(JSON.stringify({ applications }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("desktop application return check", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each(["link_clicked", "in_progress"])("prompts only for exact URL status %s", async (status) => {
    const request = vi.fn().mockResolvedValue(responseFor([
      { applicationType: "website", applicationUrl: "https://jobs.example/other", status: "link_clicked" },
      { applicationType: "platform", applicationUrl: APPLICATION_URL, status: "applied" },
      { applicationType: "website", applicationUrl: APPLICATION_URL, status },
    ]));
    await expect(readDesktopApplicationState(APPLICATION_URL, request)).resolves.toBe("pending");
    expect(request).toHaveBeenCalledWith("/api/applications", {
      credentials: "include",
      cache: "no-store",
    });
  });

  it.each(["applied", "shortlisted", "interview", "offer", "rejected"])(
    "stays silent after the extension or tracker confirms %s",
    async (status) => {
      const request = vi.fn().mockResolvedValue(responseFor([
        { applicationType: "website", applicationUrl: APPLICATION_URL, status },
      ]));
      await expect(readDesktopApplicationState(APPLICATION_URL, request)).resolves.toBe("confirmed");
    },
  );

  it("treats a missing exact-URL record separately and surfaces tracker request failures", async () => {
    const request = vi.fn().mockResolvedValue(responseFor([
      { applicationType: "website", applicationUrl: `${APPLICATION_URL}&other=1`, status: "link_clicked" },
    ]));
    await expect(readDesktopApplicationState(APPLICATION_URL, request)).resolves.toBe("not-found");
    await expect(readDesktopApplicationState(APPLICATION_URL, vi.fn().mockResolvedValue(
      new Response(null, { status: 503 }),
    ))).rejects.toThrow("Could not refresh");
  });
});