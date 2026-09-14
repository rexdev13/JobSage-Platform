import { ReplitConnectors } from "@replit/connectors-sdk";
import { db, marketerEventsTable, socialLeadsTable, usersTable } from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";

type CalendlyUser = {
  uri: string;
  email: string;
  name: string;
  scheduling_url: string;
  current_organization: string;
};

type CalendlyEvent = {
  uri: string;
  name: string;
  status: "active" | "canceled";
  start_time: string;
  end_time: string;
  event_memberships?: Array<{
    user?: string;
    user_email?: string;
    user_name?: string;
  }>;
  location?: {
    type?: string;
    location?: string;
    join_url?: string;
  } | null;
};

type CalendlyInvitee = {
  uri: string;
  email: string;
  name: string;
  status: "active" | "canceled";
  rescheduled?: boolean;
  old_invitee?: string | null;
  new_invitee?: string | null;
};

type CalendlyCollection<T> = {
  collection: T[];
  pagination?: {
    next_page_token?: string | null;
  };
};

export type CalendlySyncSummary = {
  imported: number;
  updated: number;
  cancelled: number;
  rescheduled: number;
  linkedLeads: number;
  skippedUnmappedHost: number;
  scanned: number;
  scope: "organization" | "user";
  syncedAt: string;
  alreadyRunning?: boolean;
};

const connectors = new ReplitConnectors();
let runningSync: Promise<CalendlySyncSummary> | null = null;
type LocalEventStatus = "scheduled" | "cancelled" | "rescheduled" | "completed" | "no_show";
type RemoteEventStatus = "scheduled" | "cancelled" | "rescheduled";

export function resolveCalendlySyncStatus(
  existingStatus: LocalEventStatus | null | undefined,
  remoteStatus: RemoteEventStatus,
): LocalEventStatus {
  return existingStatus === "completed" || existingStatus === "no_show"
    ? existingStatus
    : remoteStatus;
}

export function resolveCalendlyLeadId(
  existingLeadId: number | null | undefined,
  inferredLeadId: number | null | undefined,
): number | null {
  return existingLeadId ?? inferredLeadId ?? null;
}

function eventUuid(uri: string): string {
  return uri.split("/").filter(Boolean).at(-1) ?? "";
}

function normalizedUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.hostname}${url.pathname}`.replace(/\/+$/, "").toLowerCase();
  } catch {
    return value.replace(/\/+$/, "").toLowerCase();
  }
}

function meetingUrl(event: CalendlyEvent): string | null {
  for (const value of [event.location?.join_url, event.location?.location]) {
    if (!value) continue;
    try {
      const parsed = new URL(value);
      if (parsed.protocol === "https:" || parsed.protocol === "http:") return parsed.toString();
    } catch {
      // Physical locations and phone numbers are intentionally not stored as URLs.
    }
  }
  return null;
}

async function calendlyRequest<T>(path: string): Promise<T> {
  const response = await connectors.proxy("calendly", path, { method: "GET" });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Calendly request failed (${response.status})${detail ? `: ${detail.slice(0, 300)}` : ""}`);
  }
  return response.json() as Promise<T>;
}

async function listScheduledEvents(
  ownerParam: "organization" | "user",
  ownerUri: string,
  status: "active" | "canceled",
  start: Date,
  end: Date,
): Promise<CalendlyEvent[]> {
  const events: CalendlyEvent[] = [];
  let nextPageToken: string | null = null;
  do {
    const params = new URLSearchParams({
      [ownerParam]: ownerUri,
      status,
      min_start_time: start.toISOString(),
      max_start_time: end.toISOString(),
      sort: "start_time:asc",
      count: "100",
    });
    if (nextPageToken) params.set("page_token", nextPageToken);
    const page = await calendlyRequest<CalendlyCollection<CalendlyEvent>>(`/scheduled_events?${params}`);
    events.push(...(page.collection ?? []));
    nextPageToken = page.pagination?.next_page_token ?? null;
  } while (nextPageToken);
  return events;
}

async function getPrimaryInvitee(event: CalendlyEvent): Promise<CalendlyInvitee | null> {
  const uuid = eventUuid(event.uri);
  if (!uuid) return null;
  const page = await calendlyRequest<CalendlyCollection<CalendlyInvitee>>(
    `/scheduled_events/${encodeURIComponent(uuid)}/invitees?count=100`,
  );
  return page.collection?.[0] ?? null;
}

async function performSync(): Promise<CalendlySyncSummary> {
  const meResponse = await calendlyRequest<{ resource: CalendlyUser }>("/users/me");
  const me = meResponse.resource;
  const [existingSync] = await db
    .select({ id: marketerEventsTable.id })
    .from(marketerEventsTable)
    .where(eq(marketerEventsTable.source, "calendly"))
    .limit(1);
  const start = new Date(Date.now() - (existingSync ? 7 : 90) * 24 * 60 * 60_000);
  const end = new Date(Date.now() + 365 * 24 * 60 * 60_000);
  let scope: "organization" | "user" = "organization";
  let events: CalendlyEvent[];

  try {
    const [active, cancelled] = await Promise.all([
      listScheduledEvents("organization", me.current_organization, "active", start, end),
      listScheduledEvents("organization", me.current_organization, "canceled", start, end),
    ]);
    events = [...active, ...cancelled];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("(403)")) throw error;
    scope = "user";
    const [active, cancelled] = await Promise.all([
      listScheduledEvents("user", me.uri, "active", start, end),
      listScheduledEvents("user", me.uri, "canceled", start, end),
    ]);
    events = [...active, ...cancelled];
  }

  const deduped = [...new Map(events.map((event) => [event.uri, event])).values()];
  const marketingUsers = await db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      calendlyUrl: usersTable.calendlyUrl,
    })
    .from(usersTable)
    .where(eq(usersTable.role, "marketing"));
  const marketerByEmail = new Map(
    marketingUsers
      .filter((user) => user.email)
      .map((user) => [user.email!.trim().toLowerCase(), user]),
  );
  const marketerByUrl = new Map(
    marketingUsers
      .map((user) => [normalizedUrl(user.calendlyUrl), user] as const)
      .filter((entry): entry is [string, (typeof marketingUsers)[number]] => !!entry[0]),
  );
  const invitees: Array<CalendlyInvitee | null | undefined> = new Array(deduped.length).fill(undefined);
  let nextInviteeIndex = 0;
  await Promise.all(Array.from({ length: Math.min(5, deduped.length) }, async () => {
    while (nextInviteeIndex < deduped.length) {
      const index = nextInviteeIndex++;
      try {
        invitees[index] = await getPrimaryInvitee(deduped[index]!);
      } catch {
        // Unknown is different from an authoritative empty invitee list. Skip
        // this event so a transient API failure cannot erase stored details.
        invitees[index] = undefined;
      }
    }
  }));
  const inviteeEmails = [...new Set(
    invitees.map((invitee) => invitee?.email?.trim().toLowerCase()).filter((email): email is string => !!email),
  )];
  const matchingLeads = inviteeEmails.length
    ? await db
        .select({
          id: socialLeadsTable.id,
          email: socialLeadsTable.email,
          marketingUserId: socialLeadsTable.marketingUserId,
          status: socialLeadsTable.status,
        })
        .from(socialLeadsTable)
        .where(inArray(sql<string>`lower(${socialLeadsTable.email})`, inviteeEmails))
    : [];
  const leadsByEmail = new Map<string, typeof matchingLeads>();
  for (const lead of matchingLeads) {
    const key = lead.email.trim().toLowerCase();
    leadsByEmail.set(key, [...(leadsByEmail.get(key) ?? []), lead]);
  }

  let imported = 0;
  let updated = 0;
  let cancelled = 0;
  let rescheduled = 0;
  let linkedLeads = 0;
  let skippedUnmappedHost = 0;
  const syncedAt = new Date();

  for (let index = 0; index < deduped.length; index++) {
    const remoteEvent = deduped[index]!;
    const invitee = invitees[index];
    if (invitee === undefined) continue;
    const membershipEmails = remoteEvent.event_memberships
      ?.map((membership) => membership.user_email?.trim().toLowerCase())
      .filter((email): email is string => !!email) ?? [];
    let marketer = membershipEmails.map((email) => marketerByEmail.get(email)).find(Boolean);
    if (scope === "user" && !marketer && me.email) {
      marketer = marketerByEmail.get(me.email.trim().toLowerCase());
    }
    if (scope === "user" && !marketer) {
      marketer = marketerByUrl.get(normalizedUrl(me.scheduling_url) ?? "");
    }
    if (!marketer) {
      skippedUnmappedHost++;
      continue;
    }

    const candidateLeads = invitee?.email
      ? leadsByEmail.get(invitee.email.trim().toLowerCase()) ?? []
      : [];
    const linkedLead = candidateLeads.find((lead) => lead.marketingUserId === marketer!.id)
      ?? candidateLeads.find((lead) => lead.marketingUserId == null)
      ?? null;
    const remoteStatus: "scheduled" | "cancelled" | "rescheduled" = invitee?.rescheduled
      ? "rescheduled"
      : remoteEvent.status === "canceled" || invitee?.status === "canceled"
        ? "cancelled"
        : "scheduled";
    if (remoteStatus === "cancelled") cancelled++;
    if (remoteStatus === "rescheduled") rescheduled++;

    const [existing] = await db
      .select({
        id: marketerEventsTable.id,
        status: marketerEventsTable.status,
        leadId: marketerEventsTable.leadId,
      })
      .from(marketerEventsTable)
      .where(eq(marketerEventsTable.externalEventUri, remoteEvent.uri))
      .limit(1);
    const status = resolveCalendlySyncStatus(existing?.status, remoteStatus);
    const values = {
      marketingUserId: marketer.id,
      leadId: resolveCalendlyLeadId(existing?.leadId, linkedLead?.id),
      title: invitee?.name ? `${remoteEvent.name} with ${invitee.name}` : remoteEvent.name,
      scheduledAt: new Date(remoteEvent.start_time),
      endTime: new Date(remoteEvent.end_time),
      meetingUrl: meetingUrl(remoteEvent),
      status,
      source: "calendly" as const,
      externalEventUri: remoteEvent.uri,
      externalInviteeUri: invitee?.uri ?? null,
      externalInviteeEmail: invitee?.email?.trim().toLowerCase() ?? null,
      calendlySyncedAt: syncedAt,
    };
    await db
      .insert(marketerEventsTable)
      .values(values)
      .onConflictDoUpdate({
        target: marketerEventsTable.externalEventUri,
        set: values,
      });
    if (linkedLead?.status === "new" && remoteStatus === "scheduled") {
      await db
        .update(socialLeadsTable)
        .set({ status: "contacted", contactedAt: new Date() })
        .where(and(eq(socialLeadsTable.id, linkedLead.id), eq(socialLeadsTable.status, "new")));
    }
    if (existing) updated++;
    else imported++;
    if (linkedLead) linkedLeads++;
  }

  return {
    imported,
    updated,
    cancelled,
    rescheduled,
    linkedLeads,
    skippedUnmappedHost,
    scanned: deduped.length,
    scope,
    syncedAt: syncedAt.toISOString(),
  };
}

export function syncCalendlyEvents(): Promise<CalendlySyncSummary> {
  if (runningSync) return runningSync;
  const syncPromise: Promise<CalendlySyncSummary> = db.transaction(async (tx) => {
    const lock = await tx.execute<{ acquired: boolean }>(
      sql`SELECT pg_try_advisory_xact_lock(hashtext('jobsage_calendly_sync')) AS acquired`,
    );
    if (!lock.rows[0]?.acquired) {
      return {
        imported: 0,
        updated: 0,
        cancelled: 0,
        rescheduled: 0,
        linkedLeads: 0,
        skippedUnmappedHost: 0,
        scanned: 0,
        scope: "user" as const,
        syncedAt: new Date().toISOString(),
        alreadyRunning: true,
      };
    }
    return performSync();
  }).finally(() => {
    runningSync = null;
  });
  runningSync = syncPromise;
  return syncPromise;
}

export async function getCalendlySyncStatus(marketingUserId?: string): Promise<{
  lastSyncedAt: string | null;
  importedEvents: number;
}> {
  const where = marketingUserId
    ? and(eq(marketerEventsTable.source, "calendly"), eq(marketerEventsTable.marketingUserId, marketingUserId))
    : eq(marketerEventsTable.source, "calendly");
  const result = await db
    .select({
      lastSyncedAt: sql<Date | null>`max(${marketerEventsTable.calendlySyncedAt})`,
      importedEvents: sql<number>`count(*)::int`,
    })
    .from(marketerEventsTable)
    .where(where);
  return {
    lastSyncedAt: result[0]?.lastSyncedAt?.toISOString?.() ?? null,
    importedEvents: Number(result[0]?.importedEvents ?? 0),
  };
}