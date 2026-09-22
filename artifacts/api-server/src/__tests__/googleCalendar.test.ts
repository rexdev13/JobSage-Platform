import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertGoogleCalendarSlotAvailable,
  createGoogleMeetBooking,
  extractGoogleMeetUrl,
  getGoogleCalendarStatus,
  googleExternalEventUri,
  parseGoogleExternalEventUri,
} from "../lib/googleCalendar";

const auth = { refreshToken: "encrypted-test-refresh-token" };

function tokenResponse() {
  return new Response(JSON.stringify({ access_token: "test-access-token" }), { status: 200 });
}

describe("Google Calendar helper", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubEnv("GOOGLE_CALENDAR_CLIENT_ID", "test-client");
    vi.stubEnv("GOOGLE_CALENDAR_CLIENT_SECRET", "test-secret");
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValueOnce(tokenResponse());
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("selects the writable primary calendar for the marketer", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      items: [
        { id: "readonly", accessRole: "reader" },
        { id: "primary@example.com", summary: "Main calendar", primary: true, accessRole: "owner" },
      ],
    }), { status: 200 }));

    await expect(getGoogleCalendarStatus(auth)).resolves.toEqual({
      connected: true,
      calendarId: "primary@example.com",
      calendarName: "Main calendar",
      accessRole: "owner",
    });
  });

  it("rejects a busy slot before creating an event", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      calendars: {
        "primary@example.com": {
          busy: [{ start: "2026-09-23T09:00:00.000Z", end: "2026-09-23T09:30:00.000Z" }],
        },
      },
    }), { status: 200 }));

    await expect(assertGoogleCalendarSlotAvailable(
      auth,
      "primary@example.com",
      new Date("2026-09-23T09:00:00.000Z"),
      new Date("2026-09-23T09:30:00.000Z"),
    )).rejects.toMatchObject({ status: 409 });
  });

  it("creates a Meet event and deduplicates attendee emails", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      id: "event-123",
      htmlLink: "https://calendar.google.com/event?eid=123",
      hangoutLink: "https://meet.google.com/abc-defg-hij",
    }), { status: 200 }));

    const result = await createGoogleMeetBooking({
      auth,
      calendarId: "primary@example.com",
      title: "Discovery call",
      start: new Date("2026-09-23T09:00:00.000Z"),
      end: new Date("2026-09-23T09:30:00.000Z"),
      attendeeEmails: ["Lead@example.com", "lead@example.com", "marketer@example.com"],
      marketingUserId: "marketer-1",
    });

    expect(result.meetingUrl).toBe("https://meet.google.com/abc-defg-hij");
    expect(result.externalEventUri).toBe(googleExternalEventUri("primary@example.com", "event-123"));
    const [path, init] = fetchMock.mock.calls[1]!;
    expect(path).toContain("/calendars/primary%40example.com/events?");
    const body = JSON.parse(String(init.body));
    expect(body.attendees).toEqual([
      { email: "lead@example.com" },
      { email: "marketer@example.com" },
    ]);
    expect(body.conferenceData.createRequest.conferenceSolutionKey.type).toBe("hangoutsMeet");
  });

  it("round-trips encoded Google event identities and extracts video links", () => {
    const value = googleExternalEventUri("team:calendar@example.com", "event:123");
    expect(parseGoogleExternalEventUri(value)).toEqual({
      calendarId: "team:calendar@example.com",
      eventId: "event:123",
    });
    expect(extractGoogleMeetUrl({
      id: "event",
      conferenceData: {
        entryPoints: [{ entryPointType: "video", uri: "https://meet.google.com/test" }],
      },
    })).toBe("https://meet.google.com/test");
  });
});