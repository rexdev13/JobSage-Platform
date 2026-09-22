import { randomUUID } from "node:crypto";
import { ReplitConnectors } from "@replit/connectors-sdk";

const connectors = new ReplitConnectors();
const GOOGLE_CALENDAR_ROOT = "/calendar/v3";

type GoogleCalendarList = {
  items?: Array<{
    id: string;
    summary?: string;
    primary?: boolean;
    accessRole?: "freeBusyReader" | "reader" | "writer" | "owner";
  }>;
};

type GoogleFreeBusyResponse = {
  calendars?: Record<string, {
    busy?: Array<{ start: string; end: string }>;
    errors?: Array<{ reason?: string }>;
  }>;
};

type GoogleCalendarEvent = {
  id: string;
  htmlLink?: string;
  hangoutLink?: string;
  status?: "confirmed" | "tentative" | "cancelled";
  conferenceData?: {
    entryPoints?: Array<{
      entryPointType?: "video" | "phone" | "sip" | "more";
      uri?: string;
    }>;
  };
};

export class GoogleCalendarRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "GoogleCalendarRequestError";
  }
}

async function googleCalendarRequest<T>(
  path: string,
  init: { method?: string; body?: string; headers?: Record<string, string> } = {},
): Promise<T> {
  const response = await connectors.proxy("google-calendar", `${GOOGLE_CALENDAR_ROOT}${path}`, init);
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new GoogleCalendarRequestError(
      `Google Calendar request failed (${response.status})${detail ? `: ${detail.slice(0, 300)}` : ""}`,
      response.status,
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function googleExternalEventUri(calendarId: string, eventId: string): string {
  return `google-calendar:${encodeURIComponent(calendarId)}:${encodeURIComponent(eventId)}`;
}

export function parseGoogleExternalEventUri(
  value: string | null | undefined,
): { calendarId: string; eventId: string } | null {
  if (!value?.startsWith("google-calendar:")) return null;
  const parts = value.split(":");
  if (parts.length !== 3 || !parts[1] || !parts[2]) return null;
  try {
    return {
      calendarId: decodeURIComponent(parts[1]),
      eventId: decodeURIComponent(parts[2]),
    };
  } catch {
    return null;
  }
}

export function extractGoogleMeetUrl(event: GoogleCalendarEvent): string | null {
  if (event.hangoutLink) return event.hangoutLink;
  return event.conferenceData?.entryPoints
    ?.find((entry) => entry.entryPointType === "video" && entry.uri)
    ?.uri ?? null;
}

export async function getGoogleCalendarStatus(): Promise<{
  connected: true;
  calendarId: string;
  calendarName: string;
  accessRole: "writer" | "owner";
}> {
  const params = new URLSearchParams({
    minAccessRole: "writer",
    maxResults: "100",
    fields: "items(id,summary,primary,accessRole)",
  });
  const calendars = await googleCalendarRequest<GoogleCalendarList>(
    `/users/me/calendarList?${params}`,
  );
  const writable = calendars.items?.find(
    (calendar) =>
      calendar.primary &&
      (calendar.accessRole === "writer" || calendar.accessRole === "owner"),
  ) ?? calendars.items?.find(
    (calendar) => calendar.accessRole === "writer" || calendar.accessRole === "owner",
  );
  if (!writable || (writable.accessRole !== "writer" && writable.accessRole !== "owner")) {
    throw new GoogleCalendarRequestError(
      "No writable Google Calendar is available for automated bookings.",
      403,
    );
  }
  return {
    connected: true,
    calendarId: writable.id,
    calendarName: writable.summary ?? writable.id,
    accessRole: writable.accessRole,
  };
}

export async function assertGoogleCalendarSlotAvailable(
  calendarId: string,
  start: Date,
  end: Date,
  timeZone = "UTC",
): Promise<void> {
  const result = await googleCalendarRequest<GoogleFreeBusyResponse>("/freeBusy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      timeZone,
      items: [{ id: calendarId }],
    }),
  });
  const calendar = result.calendars?.[calendarId];
  if (!calendar || calendar.errors?.length) {
    throw new GoogleCalendarRequestError(
      "Google Calendar could not confirm availability for this time.",
      503,
    );
  }
  if ((calendar.busy ?? []).length > 0) {
    throw new GoogleCalendarRequestError(
      "That time is already busy in Google Calendar. Choose another time.",
      409,
    );
  }
}

export async function listGoogleCalendarAvailableSlots(input: {
  calendarId: string;
  windowStart: Date;
  windowEnd: Date;
  durationMinutes?: number;
  minimumStart?: Date;
  timeZone?: string;
}): Promise<Array<{ start: string; end: string }>> {
  const durationMs = (input.durationMinutes ?? 30) * 60_000;
  const result = await googleCalendarRequest<GoogleFreeBusyResponse>("/freeBusy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      timeMin: input.windowStart.toISOString(),
      timeMax: input.windowEnd.toISOString(),
      timeZone: input.timeZone || "UTC",
      items: [{ id: input.calendarId }],
    }),
  });
  const calendar = result.calendars?.[input.calendarId];
  if (!calendar || calendar.errors?.length) {
    throw new GoogleCalendarRequestError(
      "Google Calendar could not confirm availability for this date.",
      503,
    );
  }
  const busy = (calendar.busy ?? [])
    .map((range) => ({ start: new Date(range.start).getTime(), end: new Date(range.end).getTime() }))
    .filter((range) => Number.isFinite(range.start) && Number.isFinite(range.end));
  const minimumStart = input.minimumStart?.getTime() ?? Date.now();
  const slots: Array<{ start: string; end: string }> = [];
  for (
    let start = input.windowStart.getTime();
    start + durationMs <= input.windowEnd.getTime();
    start += durationMs
  ) {
    const end = start + durationMs;
    if (start < minimumStart) continue;
    if (busy.some((range) => start < range.end && end > range.start)) continue;
    slots.push({
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
    });
  }
  return slots;
}

export async function createGoogleMeetBooking(input: {
  calendarId: string;
  title: string;
  description?: string | null;
  start: Date;
  end: Date;
  timeZone?: string;
  attendeeEmails?: Array<string | null | undefined>;
  marketingUserId: string;
  leadId?: number | null;
}): Promise<{
  eventId: string;
  externalEventUri: string;
  meetingUrl: string;
  htmlLink: string | null;
}> {
  const params = new URLSearchParams({
    conferenceDataVersion: "1",
    sendUpdates: "all",
  });
  const event = await googleCalendarRequest<GoogleCalendarEvent>(
    `/calendars/${encodeURIComponent(input.calendarId)}/events?${params}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        summary: input.title,
        description: input.description || undefined,
        start: {
          dateTime: input.start.toISOString(),
          timeZone: input.timeZone || "UTC",
        },
        end: {
          dateTime: input.end.toISOString(),
          timeZone: input.timeZone || "UTC",
        },
        attendees: [...new Set(
          (input.attendeeEmails ?? [])
            .map((email) => email?.trim().toLowerCase())
            .filter((email): email is string => !!email),
        )].map((email) => ({ email })),
        conferenceData: {
          createRequest: {
            requestId: randomUUID(),
            conferenceSolutionKey: { type: "hangoutsMeet" },
          },
        },
        extendedProperties: {
          private: {
            jobsageManaged: "true",
            jobsageMarketingUserId: input.marketingUserId,
            ...(input.leadId ? { jobsageLeadId: String(input.leadId) } : {}),
          },
        },
      }),
    },
  );
  const meetingUrl = extractGoogleMeetUrl(event);
  if (!meetingUrl) {
    await deleteGoogleCalendarEvent(input.calendarId, event.id).catch(() => {});
    throw new GoogleCalendarRequestError(
      "Google Calendar created the event but did not return a Google Meet link.",
      502,
    );
  }
  return {
    eventId: event.id,
    externalEventUri: googleExternalEventUri(input.calendarId, event.id),
    meetingUrl,
    htmlLink: event.htmlLink ?? null,
  };
}

export async function updateGoogleCalendarEvent(
  calendarId: string,
  eventId: string,
  update: {
    title?: string;
    description?: string | null;
    start?: Date;
    end?: Date;
    timeZone?: string;
  },
): Promise<void> {
  const params = new URLSearchParams({ sendUpdates: "all" });
  await googleCalendarRequest<GoogleCalendarEvent>(
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?${params}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        summary: update.title,
        description: update.description === null ? "" : update.description,
        start: update.start
          ? { dateTime: update.start.toISOString(), timeZone: update.timeZone || "UTC" }
          : undefined,
        end: update.end
          ? { dateTime: update.end.toISOString(), timeZone: update.timeZone || "UTC" }
          : undefined,
      }),
    },
  );
}

export async function deleteGoogleCalendarEvent(
  calendarId: string,
  eventId: string,
): Promise<void> {
  const params = new URLSearchParams({ sendUpdates: "all" });
  await googleCalendarRequest<void>(
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?${params}`,
    { method: "DELETE" },
  );
}