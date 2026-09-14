import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subMonths,
  subWeeks,
} from "date-fns";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ExternalLink,
  List,
  Mail,
  MapPin,
  Phone,
  Plus,
  RefreshCw,
  UserRound,
  Video,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export type CalendarLead = {
  id: number;
  firstName?: string;
  lastName?: string;
  name?: string;
  email: string;
  phone: string | null;
  industrySector?: string | null;
  sector?: string | null;
  status: string;
  assignee?: { id: string; name: string; calendlyUrl: string | null } | null;
};

export type CalendarMarketer = {
  id: string;
  name: string;
  email: string | null;
  calendlyUrl: string | null;
};

type CalendarView = "month" | "week" | "agenda" | "calendly";
type EventStatus = "scheduled" | "completed" | "cancelled" | "rescheduled" | "no_show";
type CalendlySyncStatus = {
  lastSyncedAt: string | null;
  importedEvents: number;
};
type CalendlySyncSummary = {
  imported: number;
  updated: number;
  skippedUnmappedHost: number;
  scanned: number;
  scope: "organization" | "user";
  alreadyRunning?: boolean;
};

type CalendarEvent = {
  id: number;
  marketingUserId: string;
  leadId: number | null;
  title: string;
  scheduledAt: string;
  endTime: string;
  meetingUrl: string | null;
  status: EventStatus;
  notes: string | null;
  source: "manual" | "calendly";
  lead: {
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    phone: string | null;
    industrySector: string | null;
    status: string | null;
  } | null;
  marketer?: { name: string | null; email: string | null };
};

const STATUS_STYLES: Record<EventStatus, string> = {
  scheduled: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300",
  completed: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
  rescheduled: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  cancelled: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300",
  no_show: "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300",
};

const STATUS_LABELS: Record<EventStatus, string> = {
  scheduled: "Scheduled",
  completed: "Completed",
  rescheduled: "Rescheduled",
  cancelled: "Cancelled",
  no_show: "No show",
};

function leadName(lead: CalendarLead | CalendarEvent["lead"] | null | undefined): string {
  if (!lead) return "Unlinked lead";
  if ("name" in lead && lead.name) return lead.name;
  return [lead.firstName, lead.lastName].filter(Boolean).join(" ") || "Unnamed lead";
}

function inputDateValue(date = new Date()): string {
  const rounded = new Date(date);
  rounded.setSeconds(0, 0);
  return format(rounded, "yyyy-MM-dd'T'HH:mm");
}

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error((body as { error?: string }).error ?? "Calendar request failed.");
  }
  return body as T;
}

function EventBadge({ event, onClick }: { event: CalendarEvent; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${event.title} — ${format(new Date(event.scheduledAt), "p")}`}
      className={`block w-full truncate rounded border px-1.5 py-1 text-left text-[10px] font-semibold transition-opacity hover:opacity-75 ${STATUS_STYLES[event.status]}`}
    >
      {format(new Date(event.scheduledAt), "HH:mm")} · {event.title}
    </button>
  );
}

export function MarketerCalendar({
  leads,
  assignees,
  isAdmin,
  currentUserId,
  myCalendlyUrl,
  initialLeadId,
  onInitialLeadHandled,
}: {
  leads: CalendarLead[];
  assignees: CalendarMarketer[];
  isAdmin: boolean;
  currentUserId?: string;
  myCalendlyUrl: string | null;
  initialLeadId: number | null;
  onInitialLeadHandled: () => void;
}) {
  const queryClient = useQueryClient();
  const [view, setView] = useState<CalendarView>("month");
  const [cursor, setCursor] = useState(new Date());
  const [selectedMarketerId, setSelectedMarketerId] = useState("");
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [scheduleLeadId, setScheduleLeadId] = useState("");
  const [scheduleTitle, setScheduleTitle] = useState("");
  const [scheduleAt, setScheduleAt] = useState(inputDateValue());
  const [scheduleEnd, setScheduleEnd] = useState("");
  const [scheduleUrl, setScheduleUrl] = useState("");
  const [scheduleNotes, setScheduleNotes] = useState("");
  const [eventTitle, setEventTitle] = useState("");
  const [eventScheduledAt, setEventScheduledAt] = useState("");
  const [eventEndTime, setEventEndTime] = useState("");
  const [eventMeetingUrl, setEventMeetingUrl] = useState("");
  const [eventNotes, setEventNotes] = useState("");
  const [eventStatus, setEventStatus] = useState<EventStatus>("scheduled");
  const [message, setMessage] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const autoSyncStarted = useRef(false);

  const range = useMemo(() => {
    if (view === "week") {
      return {
        start: startOfWeek(cursor, { weekStartsOn: 1 }),
        end: endOfWeek(cursor, { weekStartsOn: 1 }),
      };
    }
    if (view === "agenda" || view === "calendly") {
      return { start: startOfDay(new Date()), end: endOfWeek(addMonths(new Date(), 3), { weekStartsOn: 1 }) };
    }
    return {
      start: startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 }),
      end: endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 }),
    };
  }, [cursor, view]);

  const eventQuery = useQuery<{ events: CalendarEvent[] }>({
    queryKey: ["marketer-calendar-events", range.start.toISOString(), range.end.toISOString(), selectedMarketerId || "all"],
    queryFn: async () => {
      const params = new URLSearchParams({
        start: range.start.toISOString(),
        end: range.end.toISOString(),
      });
      if (selectedMarketerId) params.set("marketingUserId", selectedMarketerId);
      return readJson<{ events: CalendarEvent[] }>(
        await fetch(`${BASE}/api/marketer/calendar/events?${params}`, { credentials: "include" }),
      );
    },
    staleTime: 15_000,
  });
  const events = eventQuery.data?.events ?? [];

  const calendlyStatusQuery = useQuery<CalendlySyncStatus>({
    queryKey: ["marketer-calendly-sync-status", selectedMarketerId || (isAdmin ? "all" : currentUserId)],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (isAdmin && selectedMarketerId) params.set("marketingUserId", selectedMarketerId);
      return readJson<CalendlySyncStatus>(
        await fetch(`${BASE}/api/marketer/calendar/calendly/status?${params}`, { credentials: "include" }),
      );
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const syncMutation = useMutation({
    mutationFn: async () => readJson<{
      summary: CalendlySyncSummary;
      status: CalendlySyncStatus;
    }>(
      await fetch(`${BASE}/api/marketer/calendar/calendly/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          marketingUserId: isAdmin && selectedMarketerId ? selectedMarketerId : undefined,
        }),
      }),
    ),
    onSuccess: async ({ summary }) => {
      if (summary.alreadyRunning) {
        setSyncMessage("A Calendly synchronization is already running.");
        return;
      }
      const imported = summary.imported > 0 ? `${summary.imported} new` : "no new";
      const unmapped = summary.skippedUnmappedHost > 0
        ? ` ${summary.skippedUnmappedHost} could not be assigned because the Calendly host email or link does not match a JOBSAGE marketer.`
        : "";
      setSyncMessage(`Calendly synchronized: ${imported} event${summary.imported === 1 ? "" : "s"}.${unmapped}`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["marketer-calendar-events"] }),
        queryClient.invalidateQueries({ queryKey: ["marketer-calendly-sync-status"] }),
      ]);
    },
    onError: (error: Error) => setSyncMessage(error.message),
  });

  useEffect(() => {
    if (!isAdmin || autoSyncStarted.current) return;
    autoSyncStarted.current = true;
    syncMutation.mutate();
  }, [isAdmin, syncMutation]);

  const selectedCalendarUrl = selectedMarketerId
    ? assignees.find((assignee) => assignee.id === selectedMarketerId)?.calendlyUrl ?? null
    : myCalendlyUrl;

  useEffect(() => {
    if (initialLeadId == null) return;
    const lead = leads.find((candidate) => candidate.id === initialLeadId);
    if (!lead) return;
    setScheduleLeadId(String(lead.id));
    setScheduleTitle(`Discovery Call with ${leadName(lead)}`);
    setScheduleUrl(lead.assignee?.calendlyUrl ?? selectedCalendarUrl ?? "");
    setScheduleAt(inputDateValue());
    setScheduleEnd("");
    setScheduleNotes("");
    setMessage(null);
    setScheduleOpen(true);
    onInitialLeadHandled();
  }, [initialLeadId, leads, onInitialLeadHandled, selectedCalendarUrl]);

  const createMutation = useMutation({
    mutationFn: async () => {
      const scheduledAt = new Date(scheduleAt);
      const endTime = scheduleEnd ? new Date(scheduleEnd) : undefined;
      const selectedLead = leads.find((lead) => String(lead.id) === scheduleLeadId);
      return readJson<{ event: CalendarEvent }>(
        await fetch(`${BASE}/api/marketer/calendar/events`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            leadId: scheduleLeadId ? Number(scheduleLeadId) : undefined,
            marketingUserId: isAdmin && selectedMarketerId ? selectedMarketerId : undefined,
            title: scheduleTitle.trim() || `Call with ${selectedLead ? leadName(selectedLead) : "lead"}`,
            scheduledAt: scheduledAt.toISOString(),
            endTime: endTime?.toISOString(),
            meetingUrl: scheduleUrl.trim() || undefined,
            notes: scheduleNotes.trim() || undefined,
          }),
        }),
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["marketer-calendar-events"] });
      await queryClient.invalidateQueries({ queryKey: ["admin-leads"] });
      setScheduleOpen(false);
      setMessage(null);
    },
    onError: (error: Error) => setMessage(error.message),
  });

  const updateMutation = useMutation({
    mutationFn: async (update: {
      title?: string;
      scheduledAt?: string;
      endTime?: string;
      status?: EventStatus;
      notes?: string;
      meetingUrl?: string;
    }) => {
      if (!selectedEvent) throw new Error("No event selected.");
      return readJson<{ event: CalendarEvent }>(
        await fetch(`${BASE}/api/marketer/calendar/events/${selectedEvent.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(update),
        }),
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["marketer-calendar-events"] });
      setSelectedEvent(null);
    },
    onError: (error: Error) => setMessage(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!selectedEvent) throw new Error("No event selected.");
      return readJson<{ id: number }>(
        await fetch(`${BASE}/api/marketer/calendar/events/${selectedEvent.id}`, {
          method: "DELETE",
          credentials: "include",
        }),
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["marketer-calendar-events"] });
      setSelectedEvent(null);
    },
    onError: (error: Error) => setMessage(error.message),
  });

  function openSchedule(lead?: CalendarLead) {
    setScheduleLeadId(lead ? String(lead.id) : "");
    setScheduleTitle(lead ? `Discovery Call with ${leadName(lead)}` : "");
    setScheduleAt(inputDateValue());
    setScheduleEnd("");
    setScheduleUrl(lead?.assignee?.calendlyUrl ?? selectedCalendarUrl ?? "");
    setScheduleNotes("");
    setMessage(null);
    setScheduleOpen(true);
  }

  function openEvent(event: CalendarEvent) {
    setSelectedEvent(event);
    setEventTitle(event.title);
    setEventScheduledAt(inputDateValue(new Date(event.scheduledAt)));
    setEventEndTime(inputDateValue(new Date(event.endTime)));
    setEventMeetingUrl(event.meetingUrl ?? "");
    setEventStatus(event.status);
    setEventNotes(event.notes ?? "");
    setMessage(null);
  }

  function saveEventChanges() {
    const title = eventTitle.trim();
    const scheduledAt = new Date(eventScheduledAt);
    const endTime = new Date(eventEndTime);

    if (!title) {
      setMessage("Enter an event title.");
      return;
    }
    if (
      !eventScheduledAt ||
      !eventEndTime ||
      Number.isNaN(scheduledAt.getTime()) ||
      Number.isNaN(endTime.getTime())
    ) {
      setMessage("Enter valid start and end times.");
      return;
    }
    if (endTime <= scheduledAt) {
      setMessage("The end time must be after the start time.");
      return;
    }

    setMessage(null);
    updateMutation.mutate({
      ...(selectedEvent?.source === "calendly" ? {} : {
        title,
        scheduledAt: scheduledAt.toISOString(),
        endTime: endTime.toISOString(),
        meetingUrl: eventMeetingUrl.trim(),
      }),
      ...(
        selectedEvent?.source !== "calendly"
        || (selectedEvent.status !== "cancelled" && selectedEvent.status !== "rescheduled")
          ? { status: eventStatus }
          : {}
      ),
      notes: eventNotes,
    });
  }

  function moveCursor(direction: number) {
    setCursor((current) => view === "week" ? (direction > 0 ? addWeeks(current, 1) : subWeeks(current, 1)) : (direction > 0 ? addMonths(current, 1) : subMonths(current, 1)));
  }

  const calendarDays = view === "week"
    ? eachDayOfInterval(range)
    : eachDayOfInterval(range);

  const agendaEvents = [...events].sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());

  return (
    <section className="space-y-4 rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-primary/10 p-2 text-primary"><CalendarDays className="h-5 w-5" /></div>
          <div>
            <h2 className="text-base font-semibold text-foreground">Schedule &amp; Upcoming Calls</h2>
            <p className="text-xs text-muted-foreground">Book, manage, and track marketer conversations.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isAdmin && (
            <select
              value={selectedMarketerId}
              onChange={(event) => setSelectedMarketerId(event.target.value)}
              className="h-9 max-w-full rounded-lg border border-input bg-background px-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/30"
              aria-label="Filter calendar by marketer"
            >
              <option value="">All Marketers</option>
              {assignees.map((assignee) => <option key={assignee.id} value={assignee.id}>{assignee.name || assignee.email}</option>)}
            </select>
          )}
          {isAdmin && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={syncMutation.isPending}
              onClick={() => {
                setSyncMessage(null);
                syncMutation.mutate();
              }}
            >
              <RefreshCw className={`h-4 w-4 ${syncMutation.isPending ? "animate-spin" : ""}`} />
              {syncMutation.isPending ? "Syncing…" : "Sync Calendly"}
            </Button>
          )}
          <Button size="sm" onClick={() => openSchedule()} className="gap-1.5">
            <Plus className="h-4 w-4" /> Schedule New Call
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-1 rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <span>
          {calendlyStatusQuery.data?.lastSyncedAt
            ? `Last Calendly sync ${format(new Date(calendlyStatusQuery.data.lastSyncedAt), "d MMM yyyy, h:mm a")} · ${calendlyStatusQuery.data.importedEvents} synced event${calendlyStatusQuery.data.importedEvents === 1 ? "" : "s"}`
            : "Calendly has not imported any events for this calendar yet."}
        </span>
        <span>Automatic sync runs every 10 minutes.</span>
      </div>
      {syncMessage && (
        <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground" role="status">
          {syncMessage}
        </p>
      )}

      <div className="flex flex-col gap-3 border-b border-border pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-1 overflow-x-auto rounded-lg bg-muted p-1">
          {([
            ["month", "Month View"],
            ["week", "Week View"],
            ["agenda", "Upcoming Agenda"],
            ["calendly", "Live Calendly"],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setView(id)}
              className={`whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${view === id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              {id === "agenda" ? <List className="mr-1 inline h-3.5 w-3.5" /> : id === "calendly" ? <Video className="mr-1 inline h-3.5 w-3.5" /> : <CalendarDays className="mr-1 inline h-3.5 w-3.5" />}
              {label}
            </button>
          ))}
        </div>
        {view !== "calendly" && view !== "agenda" && (
          <div className="flex items-center justify-between gap-2">
            <button type="button" onClick={() => moveCursor(-1)} className="rounded-lg border border-input p-1.5 hover:bg-muted" aria-label="Previous period"><ChevronLeft className="h-4 w-4" /></button>
            <span className="min-w-36 text-center text-sm font-semibold">{view === "week" ? `${format(range.start, "d MMM")} – ${format(range.end, "d MMM yyyy")}` : format(cursor, "MMMM yyyy")}</span>
            <button type="button" onClick={() => moveCursor(1)} className="rounded-lg border border-input p-1.5 hover:bg-muted" aria-label="Next period"><ChevronRight className="h-4 w-4" /></button>
          </div>
        )}
        {view === "agenda" && <span className="text-xs text-muted-foreground">{events.length} upcoming event{events.length === 1 ? "" : "s"}</span>}
      </div>

      {eventQuery.isLoading && view !== "calendly" ? (
        <div className="flex items-center justify-center py-16 text-sm text-muted-foreground"><RefreshCw className="mr-2 h-4 w-4 animate-spin" /> Loading calendar…</div>
      ) : eventQuery.isError && view !== "calendly" ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-center text-sm text-rose-700">Could not load calendar events. Refresh the page and try again.</div>
      ) : view === "calendly" ? (
        selectedCalendarUrl ? (
          <div className="overflow-hidden rounded-xl border border-border bg-muted/20">
            <iframe title="Live Calendly booking page" src={selectedCalendarUrl} className="h-[680px] w-full min-w-[320px] border-0" />
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-border p-10 text-center">
            <CalendarDays className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm font-medium text-foreground">No Calendly link configured</p>
            <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
              {isAdmin && !selectedMarketerId ? "Select a marketer above to view their Calendly page." : "Save a Calendly link above before opening the live booking view."}
            </p>
          </div>
        )
      ) : view === "agenda" ? (
        <div className="space-y-2">
          {agendaEvents.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">No calls scheduled in the upcoming period.</div>
          ) : agendaEvents.map((event) => (
            <button key={event.id} type="button" onClick={() => openEvent(event)} className={`flex w-full flex-col gap-2 rounded-xl border p-3 text-left transition-colors hover:bg-muted/40 sm:flex-row sm:items-center sm:justify-between ${STATUS_STYLES[event.status]}`}>
              <span className="flex min-w-0 items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-lg bg-background/70 text-[10px] font-bold">
                  <span>{format(new Date(event.scheduledAt), "d")}</span><span>{format(new Date(event.scheduledAt), "MMM")}</span>
                </span>
                <span className="min-w-0"><span className="block truncate text-sm font-semibold">{event.title}</span><span className="block text-xs opacity-80">{format(new Date(event.scheduledAt), "EEEE, h:mm a")} · {leadName(event.lead)}</span></span>
              </span>
              <span className="text-xs font-semibold">{STATUS_LABELS[event.status]}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[680px]">
            <div className="grid grid-cols-7 border-b border-border">
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => <div key={day} className="px-2 py-2 text-center text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{day}</div>)}
            </div>
            <div className={`grid grid-cols-7 ${view === "week" ? "" : "grid-rows-6"}`}>
              {calendarDays.map((day) => {
                const dayEvents = events.filter((event) => isSameDay(new Date(event.scheduledAt), day));
                return (
                  <div key={day.toISOString()} className={`min-h-24 border-b border-r border-border p-1.5 ${!isSameMonth(day, cursor) && view === "month" ? "bg-muted/20 text-muted-foreground" : ""}`}>
                    <div className={`mb-1 flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${isToday(day) ? "bg-primary text-primary-foreground" : ""}`}>{format(day, "d")}</div>
                    <div className="space-y-1">{dayEvents.map((event) => <EventBadge key={event.id} event={event} onClick={() => openEvent(event)} />)}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
        <DialogContent className="max-h-[90vh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-2xl">
          <DialogHeader><DialogTitle>Schedule a call</DialogTitle><DialogDescription>Book a conversation and keep the lead timeline up to date.</DialogDescription></DialogHeader>
          <div className="grid gap-3">
            {message && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{message}</p>}
            <label className="grid gap-1.5 text-xs font-medium">Lead
              <select value={scheduleLeadId} onChange={(event) => {
                const lead = leads.find((candidate) => String(candidate.id) === event.target.value);
                setScheduleLeadId(event.target.value);
                if (lead) {
                  setScheduleTitle(`Discovery Call with ${leadName(lead)}`);
                  if (lead.assignee?.calendlyUrl) setScheduleUrl(lead.assignee.calendlyUrl);
                }
              }} className="h-10 rounded-lg border border-input bg-background px-3 text-sm font-normal" aria-label="Select lead">
                <option value="">No linked lead</option>
                {leads.map((lead) => <option key={lead.id} value={lead.id}>{leadName(lead)} — {lead.email}</option>)}
              </select>
            </label>
            <label className="grid gap-1.5 text-xs font-medium">Title<input value={scheduleTitle} onChange={(event) => setScheduleTitle(event.target.value)} placeholder="Discovery Call with Jane Doe" className="h-10 rounded-lg border border-input bg-background px-3 text-sm font-normal" /></label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1.5 text-xs font-medium">Start<input type="datetime-local" value={scheduleAt} onChange={(event) => setScheduleAt(event.target.value)} className="h-10 rounded-lg border border-input bg-background px-3 text-sm font-normal" /></label>
              <label className="grid gap-1.5 text-xs font-medium">End (optional)<input type="datetime-local" value={scheduleEnd} onChange={(event) => setScheduleEnd(event.target.value)} className="h-10 rounded-lg border border-input bg-background px-3 text-sm font-normal" /></label>
            </div>
            <label className="grid gap-1.5 text-xs font-medium">Meeting link<input type="url" value={scheduleUrl} onChange={(event) => setScheduleUrl(event.target.value)} placeholder="Calendly, Google Meet, or Zoom link" className="h-10 rounded-lg border border-input bg-background px-3 text-sm font-normal" /></label>
            <label className="grid gap-1.5 text-xs font-medium">Notes / agenda<textarea value={scheduleNotes} onChange={(event) => setScheduleNotes(event.target.value)} rows={3} placeholder="What should be covered?" className="rounded-lg border border-input bg-background px-3 py-2 text-sm font-normal" /></label>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setScheduleOpen(false)}>Cancel</Button><Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending || !scheduleAt || !scheduleTitle.trim()}>{createMutation.isPending ? "Saving…" : "Schedule call"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!selectedEvent} onOpenChange={(open) => !open && setSelectedEvent(null)}>
        <DialogContent className="max-h-[90vh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-2xl">
          {selectedEvent && (
            <>
              <DialogHeader><DialogTitle>{selectedEvent.title}</DialogTitle><DialogDescription>{format(new Date(selectedEvent.scheduledAt), "EEEE, d MMMM yyyy · h:mm a")} – {format(new Date(selectedEvent.endTime), "h:mm a")}</DialogDescription></DialogHeader>
              <div className="space-y-4">
                <div className="rounded-xl border border-border bg-muted/20 p-3">
                  <p className="mb-2 text-xs font-semibold text-muted-foreground">Lead contact</p>
                  <p className="text-sm font-semibold">{leadName(selectedEvent.lead)}</p>
                  <div className="mt-2 grid gap-1 text-xs text-muted-foreground">
                    {selectedEvent.lead?.email && <a className="flex items-center gap-2 hover:text-primary" href={`mailto:${selectedEvent.lead.email}`}><Mail className="h-3.5 w-3.5" />{selectedEvent.lead.email}</a>}
                    {selectedEvent.lead?.phone && <a className="flex items-center gap-2 hover:text-primary" href={`tel:${selectedEvent.lead.phone}`}><Phone className="h-3.5 w-3.5" />{selectedEvent.lead.phone}</a>}
                    {selectedEvent.lead?.industrySector && <span className="flex items-center gap-2"><MapPin className="h-3.5 w-3.5" />{selectedEvent.lead.industrySector}</span>}
                  </div>
                </div>
                <div className="space-y-3 rounded-xl border border-border p-3">
                  <div>
                    <p className="text-xs font-semibold text-foreground">Edit schedule</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      Change the call details, date, time, or meeting link.
                    </p>
                  </div>
                  <label className="grid gap-1.5 text-xs font-medium">
                    Title
                    <input
                      value={eventTitle}
                      onChange={(event) => setEventTitle(event.target.value)}
                      disabled={selectedEvent.source === "calendly"}
                      className="h-10 rounded-lg border border-input bg-background px-3 text-sm font-normal"
                    />
                  </label>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="grid gap-1.5 text-xs font-medium">
                      Start
                      <input
                        type="datetime-local"
                        value={eventScheduledAt}
                        onChange={(event) => setEventScheduledAt(event.target.value)}
                        disabled={selectedEvent.source === "calendly"}
                        className="h-10 rounded-lg border border-input bg-background px-3 text-sm font-normal"
                      />
                    </label>
                    <label className="grid gap-1.5 text-xs font-medium">
                      End
                      <input
                        type="datetime-local"
                        value={eventEndTime}
                        onChange={(event) => setEventEndTime(event.target.value)}
                        disabled={selectedEvent.source === "calendly"}
                        className="h-10 rounded-lg border border-input bg-background px-3 text-sm font-normal"
                      />
                    </label>
                  </div>
                  <label className="grid gap-1.5 text-xs font-medium">
                    Meeting link
                    <input
                      type="url"
                      value={eventMeetingUrl}
                      onChange={(event) => setEventMeetingUrl(event.target.value)}
                      disabled={selectedEvent.source === "calendly"}
                      placeholder="Calendly, Google Meet, or Zoom link"
                      className="h-10 rounded-lg border border-input bg-background px-3 text-sm font-normal"
                    />
                  </label>
                  {selectedEvent.source === "calendly" && (
                    <p className="rounded-lg bg-blue-50 px-3 py-2 text-[11px] text-blue-700 dark:bg-blue-950/30 dark:text-blue-300">
                      This booking is managed by Calendly. Change its time, meeting link, or cancellation in Calendly; JOBSAGE will import the update automatically. Call outcome and notes remain editable here.
                    </p>
                  )}
                </div>
                <label className="grid gap-1.5 text-xs font-medium">Call outcome
                  <select
                    value={eventStatus}
                    onChange={(event) => setEventStatus(event.target.value as EventStatus)}
                    disabled={selectedEvent.source === "calendly" && (selectedEvent.status === "cancelled" || selectedEvent.status === "rescheduled")}
                    className="h-10 rounded-lg border border-input bg-background px-3 text-sm font-normal"
                  >
                    {(selectedEvent.source === "calendly"
                      ? (selectedEvent.status === "cancelled" || selectedEvent.status === "rescheduled"
                          ? [selectedEvent.status]
                          : ["scheduled", "completed", "no_show"] as EventStatus[])
                      : Object.keys(STATUS_LABELS) as EventStatus[]
                    ).map((status) => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}
                  </select>
                </label>
                <label className="grid gap-1.5 text-xs font-medium">Notes<textarea value={eventNotes} onChange={(event) => setEventNotes(event.target.value)} rows={4} placeholder="What was discussed?" className="rounded-lg border border-input bg-background px-3 py-2 text-sm font-normal" /></label>
                <div className="flex flex-wrap gap-2">
                  {selectedEvent.meetingUrl && <a href={selectedEvent.meetingUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90"><Video className="h-3.5 w-3.5" /> Join meeting <ExternalLink className="h-3 w-3" /></a>}
                  <span className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground"><UserRound className="h-3.5 w-3.5" />{selectedEvent.marketer?.name ?? "Marketing team"}</span>
                </div>
              </div>
              {message && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{message}</p>}
              <DialogFooter className="gap-2 sm:justify-between">
                {selectedEvent.source === "manual" ? (
                  <Button variant="outline" className="text-rose-600 hover:text-rose-700" onClick={() => deleteMutation.mutate()} disabled={deleteMutation.isPending}>Delete event</Button>
                ) : (
                  <span className="self-center text-xs text-muted-foreground">Synced from Calendly</span>
                )}
                <Button onClick={saveEventChanges} disabled={updateMutation.isPending}>
                  {updateMutation.isPending ? "Saving…" : "Save changes"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}