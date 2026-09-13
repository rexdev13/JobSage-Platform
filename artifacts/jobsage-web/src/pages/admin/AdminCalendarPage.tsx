import { useCallback, useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@workspace/auth-web";
import { CalendarDays, Loader2 } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import {
  MarketerCalendar,
  type CalendarLead,
  type CalendarMarketer,
} from "@/components/admin/MarketerCalendar";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type LeadsResponse = {
  leads: CalendarLead[];
  total: number;
  page: number;
  limit: number;
};

async function fetchAllAccessibleLeads(): Promise<CalendarLead[]> {
  const limit = 100;
  const firstResponse = await fetch(`${BASE}/api/leads?page=1&limit=${limit}`, {
    credentials: "include",
  });
  if (!firstResponse.ok) throw new Error("Could not load leads for the calendar.");
  const first = await firstResponse.json() as LeadsResponse;
  const pageCount = Math.ceil(first.total / limit);
  if (pageCount <= 1) return first.leads;

  const remainingPages = await Promise.all(
    Array.from({ length: pageCount - 1 }, async (_, index) => {
      const page = index + 2;
      const response = await fetch(`${BASE}/api/leads?page=${page}&limit=${limit}`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Could not load all leads for the calendar.");
      return response.json() as Promise<LeadsResponse>;
    }),
  );

  return [first, ...remainingPages].flatMap((result) => result.leads);
}

function CalendlyLinkCard({ onUrlChange }: { onUrlChange: (url: string | null) => void }) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const { data, isLoading } = useQuery<{ calendlyUrl: string | null }>({
    queryKey: ["my-marketing-calendly-url"],
    queryFn: async () => {
      const response = await fetch(`${BASE}/api/me/calendly-url`, { credentials: "include" });
      if (!response.ok) throw new Error("Could not load your Calendly link.");
      return response.json() as Promise<{ calendlyUrl: string | null }>;
    },
  });

  const loadedUrl = data?.calendlyUrl ?? null;
  useEffect(() => {
    if (!data) return;
    setValue(data.calendlyUrl ?? "");
    onUrlChange(data.calendlyUrl);
  }, [data, onUrlChange]);

  const mutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`${BASE}/api/me/calendly-url`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ calendlyUrl: value.trim() }),
      });
      const body = await response.json().catch(() => ({})) as {
        calendlyUrl?: string | null;
        error?: string;
      };
      if (!response.ok) throw new Error(body.error ?? "Could not save your Calendly link.");
      return body;
    },
    onSuccess: async (body) => {
      const savedUrl = body.calendlyUrl ?? null;
      setValue(savedUrl ?? "");
      setMessage(savedUrl ? "Calendly link saved." : "Calendly link cleared.");
      onUrlChange(savedUrl);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["my-marketing-calendly-url"] }),
        queryClient.invalidateQueries({ queryKey: ["calendar-leads"] }),
      ]);
    },
    onError: (error) => {
      setMessage(error instanceof Error ? error.message : "Could not save your Calendly link.");
    },
  });

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <CalendarDays className="mt-0.5 h-5 w-5 text-primary" />
        <div className="flex-1 space-y-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">My Calendly link</h2>
            <p className="text-xs text-muted-foreground">
              Use this link for calls assigned to you and for the Live Calendly view.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="url"
              placeholder="https://calendly.com/your-name"
              value={value}
              disabled={isLoading || mutation.isPending}
              onChange={(event) => {
                setValue(event.target.value);
                setMessage(null);
              }}
              className="min-w-0 flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
            <Button
              type="button"
              disabled={isLoading || mutation.isPending}
              onClick={() => mutation.mutate()}
            >
              {mutation.isPending ? "Saving..." : "Save link"}
            </Button>
          </div>
          {message && <p className="text-xs text-muted-foreground" role="status">{message}</p>}
        </div>
      </div>
    </div>
  );
}

export default function AdminCalendarPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || user?.role === "super_admin";
  const isMarketing = user?.role === "marketing";
  const requestedLeadId = Number(new URLSearchParams(window.location.search).get("leadId"));
  const [initialLeadId, setInitialLeadId] = useState<number | null>(
    Number.isInteger(requestedLeadId) && requestedLeadId > 0 ? requestedLeadId : null,
  );
  const [myCalendlyUrl, setMyCalendlyUrl] = useState<string | null>(null);

  const leadsQuery = useQuery<CalendarLead[]>({
    queryKey: ["calendar-leads"],
    queryFn: fetchAllAccessibleLeads,
    staleTime: 30_000,
  });

  const assigneesQuery = useQuery<{ assignees: CalendarMarketer[] }>({
    queryKey: ["lead-assignees"],
    enabled: isAdmin,
    queryFn: async () => {
      const response = await fetch(`${BASE}/api/leads/assignees`, { credentials: "include" });
      if (!response.ok) throw new Error("Could not load marketers.");
      return response.json() as Promise<{ assignees: CalendarMarketer[] }>;
    },
    staleTime: 60_000,
  });

  const handleInitialLead = useCallback(() => {
    setInitialLeadId(null);
    window.history.replaceState({}, "", `${BASE}/admin/calendar`);
  }, []);

  const isLoading = leadsQuery.isLoading || (isAdmin && assigneesQuery.isLoading);
  const isError = leadsQuery.isError || (isAdmin && assigneesQuery.isError);

  return (
    <AppLayout>
      <div className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">Calendar</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Schedule, manage, and track marketer calls.
          </p>
        </div>

        {isMarketing && <CalendlyLinkCard onUrlChange={setMyCalendlyUrl} />}

        {isLoading ? (
          <div className="flex items-center justify-center rounded-xl border border-border py-24">
            <Loader2 className="h-8 w-8 animate-spin text-primary/40" />
          </div>
        ) : isError ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-sm text-destructive">
            The calendar could not load. Please refresh and try again.
          </div>
        ) : (
          <MarketerCalendar
            leads={leadsQuery.data ?? []}
            assignees={assigneesQuery.data?.assignees ?? []}
            isAdmin={isAdmin}
            currentUserId={user?.id}
            myCalendlyUrl={myCalendlyUrl}
            initialLeadId={initialLeadId}
            onInitialLeadHandled={handleInitialLead}
          />
        )}
      </div>
    </AppLayout>
  );
}