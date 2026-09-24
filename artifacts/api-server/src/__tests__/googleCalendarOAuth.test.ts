import { afterEach, describe, expect, it, vi } from "vitest";
import {
  exchangeGoogleAuthorizationCode,
  googleCalendarAuthorizationUrl,
} from "../lib/googleCalendarOAuth";

describe("Google Calendar OAuth credentials", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("trims the OAuth client ID before building the authorization URL", () => {
    vi.stubEnv("GOOGLE_CALENDAR_CLIENT_ID", "  test-client.apps.googleusercontent.com \n");
    vi.stubEnv("GOOGLE_CALENDAR_REDIRECT_URI", " https://jobsage.co.uk/oauth/callback ");

    const url = new URL(googleCalendarAuthorizationUrl("test-state"));

    expect(url.searchParams.get("client_id")).toBe("test-client.apps.googleusercontent.com");
    expect(url.searchParams.get("redirect_uri")).toBe("https://jobsage.co.uk/oauth/callback");
    expect(url.searchParams.get("scope")?.split(" ")).toEqual([
      "openid",
      "email",
      "https://www.googleapis.com/auth/calendar",
    ]);
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
  });

  it("trims the client credentials during the authorization-code exchange", async () => {
    vi.stubEnv("GOOGLE_CALENDAR_CLIENT_ID", " test-client ");
    vi.stubEnv("GOOGLE_CALENDAR_CLIENT_SECRET", "\ttest-secret\n");
    vi.stubEnv("GOOGLE_CALENDAR_REDIRECT_URI", " https://jobsage.co.uk/oauth/callback ");

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        refresh_token: "refresh-token",
        access_token: "access-token",
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        email: "MARKETER@example.com",
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(exchangeGoogleAuthorizationCode("authorization-code")).resolves.toEqual({
      refreshToken: "refresh-token",
      accountEmail: "marketer@example.com",
    });

    const [, init] = fetchMock.mock.calls[0]!;
    const body = init.body as URLSearchParams;
    expect(body.get("client_id")).toBe("test-client");
    expect(body.get("client_secret")).toBe("test-secret");
    expect(body.get("redirect_uri")).toBe("https://jobsage.co.uk/oauth/callback");
  });
});