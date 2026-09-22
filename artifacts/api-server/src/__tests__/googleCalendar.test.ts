import { beforeEach, describe, expect, it, vi } from "vitest";

const { proxy } = vi.hoisted(() => ({ proxy: vi.fn() }));

vi.mock("@replit/connectors-sdk", () => ({
  ReplitConnectors: class {
    proxy = proxy;
  },
}));

import {
  assertGoogleCalendarSlotAvailable,
  createGoogleMeetBooking,
  extractGoogleMeetUrl,
  getGoogleCalendarStatus,
  googleExternalEventUri,
  GoogleCalendarRequestError,
  parseGoogleExternalEventUri,
} from "../lib/googleCalendar";

describe("Google Calendar connector helper", () => {
  beforeEach(() => {
    proxy.mockReset();
  });

  it("selects the writable primary calendar", async () => {
    proxy.mockResolvedValueOnce(new Response(JSON.stringify({
      items: [
        { id: "readonly", accessRole: "reader" },
        { id: "primary@example.com", summary: "Main calendar", primary: true, accessRole: "owner" },
      ],
    }), { status: 200 }));

    await expect(getGoogleCalendarStatus()).resolves.toEqual({
      connected: true,
      calendarId: "primary@example.com",
      calendarName: "Main calendar",
      accessRole: "owner",
    });
  });

  it("rejects a busy slot before creating an event", async () => {
    proxy.mockResolvedValueOnce(new Response(JSON.stringify({
      calendars: {
        "primary@example.com": {
          busy: [{ start: "2026-09-23T09:00:00.000Z", end: "2026-09-23T09:30:00.000Z" }],
        },
      },
    }), { status: 200 }));

    await expect(assertGoogleCalendarSlotAvailable(
      "primary@example.com",
      new Date("2026-09-23T09:00:00.000Z"),
      new Date("2026-09-23T09:30:00.000Z"),
    )).rejects.toMatchObject({
      status: 409,
    });
  });

  it("creates a Meet event and deduplicates attendee emails", async () => {
    proxy.mockResolvedValueOnce(new Response(JSON.stringify({
      id: "event-123",
      htmlLink: "https://calendar.google.com/event?eid=123",
      hangoutLink: "https://meet.google.com/abc-defg-hij",
    }), { status: 200 }));

    const result = await createGoogleMeetBooking({
      calendarId: "primary@example.com",
      title: "Discovery call",
      start: new Date("2026-09-23T09:00:00.000Z"),
      end: new Date("2026-09-23T09:30:00.000Z"),
      attendeeEmails: ["Lead@example.com", "lead@example.com", "marketer@example.com"],
      marketingUserId: "marketer-1",
    });

    expect(result.meetingUrl).toBe("https://meet.google.com/abc-defg-hij");
    expect(result.externalEventUri).toBe(googleExternalEventUri("primary@example.com", "event-123"));
    const [, path, init] = proxy.mock.calls[0]!;
    expect(path).toContain("conferenceDataVersion=1");
    expect(path).toContain("sendUpdates=all");
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