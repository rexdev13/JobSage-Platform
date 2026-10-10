import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();

describe("conservative vacancy URL liveness checks", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requires repeated 404/410 responses before returning confirmed dead", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("", { status: 404 }))
      .mockResolvedValueOnce(new Response("", { status: 410 }));

    const { checkDestinationDead } = await import("../../lib/linkHealth");
    await expect(checkDestinationDead("https://8.8.8.8/jobs/123")).resolves.toMatchObject({
      verdict: "dead",
      reason: "confirmed_dead:persistent_http_404_410",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([429, 500, 503])("treats HTTP %s as inconclusive", async (status) => {
    fetchMock.mockResolvedValue(new Response("", { status }));

    const { checkDestinationDead } = await import("../../lib/linkHealth");
    await expect(checkDestinationDead("https://8.8.8.8/jobs/123")).resolves.toMatchObject({
      verdict: "inconclusive",
      reason: `HTTP ${status}`,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("treats a one-off 404 followed by a healthy response as inconclusive", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("", { status: 404 }))
      .mockResolvedValueOnce(new Response("<html>Current vacancy</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }));

    const { checkDestinationDead } = await import("../../lib/linkHealth");
    await expect(checkDestinationDead("https://8.8.8.8/jobs/123")).resolves.toMatchObject({
      verdict: "inconclusive",
      reason: "inconclusive:http_404_not_repeated_retry_200",
    });
  });

  it("does not follow redirects to a private destination", async () => {
    fetchMock.mockResolvedValue(
      new Response("", { status: 302, headers: { location: "http://127.0.0.1/admin" } }),
    );

    const { checkDestinationDead } = await import("../../lib/linkHealth");
    await expect(checkDestinationDead("https://8.8.8.8/jobs/123")).resolves.toMatchObject({
      verdict: "unsafe",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("marks an explicit closed advert banner as confirmed dead", async () => {
    fetchMock.mockResolvedValue(
      new Response('<div class="nhs-closed-job-inset">This job is closed</div>', {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );

    const { checkDestinationDead } = await import("../../lib/linkHealth");
    await expect(checkDestinationDead("https://8.8.8.8/jobs/123")).resolves.toMatchObject({
      verdict: "dead",
      reason: "confirmed_dead:closed board advert banner",
    });
  });
});
