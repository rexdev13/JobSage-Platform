import { randomUUID } from "node:crypto";

const GOOGLE_CALENDAR_ROOT = "https://www.googleapis.com/calendar/v3";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

export type GoogleCalendarAuth = {
  refreshToken: string;
};

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
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "GoogleCalendarRequestError";
  }
}

async function accessToken(auth: GoogleCalendarAuth): Promise<string> {
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new GoogleCalendarRequestError(
      "Google Calendar OAuth is not configured yet. Add the JOBSAGE Google OAuth credentials.",
      503,
    );
  }
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: auth.refreshToken,
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new GoogleCalendarRequestError(
      `Google Calendar authorization failed${detail ? `: ${detail.slice(0, 240)}` : ""}`,
      response.status === 401 || response.status === 400 ? 401 : 502,
    );
  }
  const body = await response.json() as { access_token?: string };
  if (!body.access_token) {
    throw new GoogleCalendarRequestError("Google did not return a Calendar access token.", 502);
  }
  return body.access_token;
}

async function googleCalendarRequest<T>(
  auth: GoogleCalendarAuth,
  path: string,
  init: { method?: string; body?: string; headers?: Record<string, string> } = {},
): Promise<T> {
  const response = await fetch(`${GOOGLE_CALENDAR_ROOT}${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${await accessToken(auth)}`,
      ...(init.headers ?? {}),
    },
    body: init.body,
  });
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

export function parseGoogleExternalEventUri(value: string | null | undefined): { calendarId: string; eventId: string } | null {
  if (!value?.startsWith("google-calendar:")) return null;
  const parts = value.split(":");
  if (parts.length !== 3 || !parts[1] || !parts[2]) return null;
  try {
    return { calendarId: decodeURIComponent(parts[1]), eventId: decodeURIComponent(parts[2]) };
  } catch {
    return null;
  }
}

export function extractGoogleMeetUrl(event: GoogleCalendarEvent): string | null {
  if (event.hangoutLink) return event.hangoutLink;
  return event.conferenceData?.entryPoints
    ?.find((entry) => entry.entryPointType === "video" && entry.uri)?.uri ?? null;
}

export async function getGoogleCalendarStatus(auth: GoogleCalendarAuth): Promise<{
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
    auth,
    `/users/me/calendarList?${params}`,
  );
  const writable = calendars.items?.find(
    (calendar) => calendar.primary && (calendar.accessRole === "writer" || calendar.accessRole === "owner"),
  ) ?? calendars.items?.find(
    (calendar) => calendar.accessRole === "writer" || calendar.accessRole === "owner",
  );
  if (!writable || (writable.accessRole !== "writer" && writable.accessRole !== "owner")) {
    throw new GoogleCalendarRequestError("No writable Google Calendar is available for this marketer.", 403);
  }
  return {
    connected: true,
    calendarId: writable.id,
    calendarName: writable.summary ?? writable.id,
    accessRole: writable.accessRole,
  };
}

export async function assertGoogleCalendarSlotAvailable(
  auth: GoogleCalendarAuth,
  calendarId: string,
  start: Date,
  end: Date,
  timeZone = "UTC",
): Promise<void> {
  const result = await googleCalendarRequest<GoogleFreeBusyResponse>(auth, "/freeBusy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ timeMin: start.toISOString(), timeMax: end.toISOString(), timeZone, items: [{ id: calendarId }] }),
  });
  const calendar = result.calendars?.[calendarId];
  if (!calendar || calendar.errors?.length) {
    throw new GoogleCalendarRequestError("Google Calendar could not confirm availability for this time.", 503);
  }
  if ((calendar.busy ?? []).length > 0) {
    throw new GoogleCalendarRequestError("That time is already busy in Google Calendar. Choose another time.", 409);
  }
}

export async function listGoogleCalendarAvailableSlots(input: {
  auth: GoogleCalendarAuth;
  calendarId: string;
  windowStart: Date;
  windowEnd: Date;
  durationMinutes?: number;
  minimumStart?: Date;
  timeZone?: string;
}): Promise<Array<{ start: string; end: string }>> {
  const durationMs = (input.durationMinutes ?? 30) * 60_000;
  const result = await googleCalendarRequest<GoogleFreeBusyResponse>(input.auth, "/freeBusy", {
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
    throw new GoogleCalendarRequestError("Google Calendar could not confirm availability for this date.", 503);
  }
  const busy = (calendar.busy ?? [])
    .map((range) => ({ start: new Date(range.start).getTime(), end: new Date(range.end).getTime() }))
    .filter((range) => Number.isFinite(range.start) && Number.isFinite(range.end));
  const minimumStart = input.minimumStart?.getTime() ?? Date.now();
  const slots: Array<{ start: string; end: string }> = [];
  for (let start = input.windowStart.getTime(); start + durationMs <= input.windowEnd.getTime(); start += durationMs) {
    const end = start + durationMs;
    if (start < minimumStart || busy.some((range) => start < range.end && end > range.start)) continue;
    slots.push({ start: new Date(start).toISOString(), end: new Date(end).toISOString() });
  }
  return slots;
}

export async function createGoogleMeetBooking(input: {
  auth: GoogleCalendarAuth;
  calendarId: string;
  title: string;
  description?: string | null;
  start: Date;
  end: Date;
  timeZone?: string;
  attendeeEmails?: Array<string | null | undefined>;
  marketingUserId: string;
  leadId?: number | null;
}): Promise<{ eventId: string; externalEventUri: string; meetingUrl: string; htmlLink: string | null }> {
  const params = new URLSearchParams({ conferenceDataVersion: "1", sendUpdates: "all" });
  const event = await googleCalendarRequest<GoogleCalendarEvent>(
    input.auth,
    `/calendars/${encodeURIComponent(input.calendarId)}/events?${params}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        summary: input.title,
        description: input.description || undefined,
        start: { dateTime: input.start.toISOString(), timeZone: input.timeZone || "UTC" },
        end: { dateTime: input.end.toISOString(), timeZone: input.timeZone || "UTC" },
        attendees: [...new Set((input.attendeeEmails ?? []).map((email) => email?.trim().toLowerCase()).filter((email): email is string => !!email))].map((email) => ({ email })),
        conferenceData: { createRequest: { requestId: randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } } },
        extendedProperties: { private: { jobsageManaged: "true", jobsageMarketingUserId: input.marketingUserId, ...(input.leadId ? { jobsageLeadId: String(input.leadId) } : {}) } },
      }),
    },
  );
  const meetingUrl = extractGoogleMeetUrl(event);
  if (!meetingUrl) {
    await deleteGoogleCalendarEvent(input.auth, input.calendarId, event.id).catch(() => {});
    throw new GoogleCalendarRequestError("Google Calendar created the event but did not return a Google Meet link.", 502);
  }
  return {
    eventId: event.id,
    externalEventUri: googleExternalEventUri(input.calendarId, event.id),
    meetingUrl,
    htmlLink: event.htmlLink ?? null,
  };
}

export async function updateGoogleCalendarEvent(
  auth: GoogleCalendarAuth,
  calendarId: string,
  eventId: string,
  update: { title?: string; description?: string | null; start?: Date; end?: Date; timeZone?: string },
): Promise<void> {
  const params = new URLSearchParams({ sendUpdates: "all" });
  await googleCalendarRequest<GoogleCalendarEvent>(
    auth,
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?${params}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        summary: update.title,
        description: update.description === null ? "" : update.description,
        start: update.start ? { dateTime: update.start.toISOString(), timeZone: update.timeZone || "UTC" } : undefined,
        end: update.end ? { dateTime: update.end.toISOString(), timeZone: update.timeZone || "UTC" } : undefined,
      }),
    },
  );
}

export async function deleteGoogleCalendarEvent(auth: GoogleCalendarAuth, calendarId: string, eventId: string): Promise<void> {
  const params = new URLSearchParams({ sendUpdates: "all" });
  await googleCalendarRequest<void>(
    auth,
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?${params}`,
    { method: "DELETE" },
  );
}