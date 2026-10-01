import { useMemo, useState } from "react";
import { Mail, RefreshCw, Save, Ticket } from "lucide-react";
import {
  getListAdminSupportTicketsQueryKey,
  useListAdminSupportTickets,
  useUpdateAdminSupportTicket,
  type SupportTicketItem,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

type TicketStatus = "new" | "in_review" | "resolved";
type TicketFilter = "all" | TicketStatus;

const filters: Array<{ id: TicketFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "new", label: "New" },
  { id: "in_review", label: "In review" },
  { id: "resolved", label: "Resolved" },
];

const statusLabels: Record<TicketStatus, string> = {
  new: "New",
  in_review: "In review",
  resolved: "Resolved",
};

function formatDate(value: string) {
  return new Date(value).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function AdminSupportTicketsTab() {
  const [filter, setFilter] = useState<TicketFilter>("all");
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [savingId, setSavingId] = useState<number | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const params = useMemo(
    () => ({
      ...(filter === "all" ? {} : { status: filter }),
      limit: 100,
      offset: 0,
    }),
    [filter],
  );
  const queryKey = getListAdminSupportTicketsQueryKey(params);
  const { data, isLoading, isError, refetch } = useListAdminSupportTickets(params, {
    query: { queryKey, refetchOnWindowFocus: false },
  });
  const updateTicket = useUpdateAdminSupportTicket();
  const tickets = data ?? [];

  function noteValue(ticket: SupportTicketItem) {
    return notes[ticket.id] ?? ticket.adminNotes ?? "";
  }

  function refreshList() {
    void queryClient.invalidateQueries({ queryKey: getListAdminSupportTicketsQueryKey() });
  }

  function saveTicket(ticket: SupportTicketItem, update: { status?: TicketStatus; adminNotes?: string | null }) {
    setSavingId(ticket.id);
    updateTicket.mutate(
      { id: ticket.id, data: update },
      {
        onSuccess: () => {
          toast({ title: "Support ticket updated", description: `${ticket.ticketId} has been saved.` });
          refreshList();
        },
        onError: () => toast({ title: "Update failed", description: "Please try again.", variant: "destructive" }),
        onSettled: () => setSavingId(null),
      },
    );
  }

  return (
    <section className="space-y-5" aria-labelledby="support-inbox-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="support-inbox-title" className="font-display text-xl font-semibold text-foreground">Support tickets</h2>
          <p className="mt-1 text-sm text-muted-foreground">Requests from the Help &amp; Support page, newest first.</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          data-testid="button-refresh-support-tickets"
          onClick={() => void refetch()}
          disabled={isLoading}
          className="gap-2"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <div className="mobile-scroll-x flex gap-1 rounded-xl border border-border bg-muted/30 p-1" role="tablist" aria-label="Support ticket filters">
        {filters.map((option) => (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={filter === option.id}
            data-testid={`button-support-filter-${option.id}`}
            onClick={() => setFilter(option.id)}
            className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              filter === option.id ? "bg-background text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {isError ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Ticket className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">Support tickets could not be loaded.</p>
            <Button variant="outline" size="sm" data-testid="button-retry-support-tickets" onClick={() => void refetch()}>
              Try again
            </Button>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <div className="space-y-3" aria-label="Loading support tickets">
          {[1, 2, 3].map((item) => <div key={item} className="h-48 animate-pulse rounded-2xl border border-border bg-muted/40" />)}
        </div>
      ) : tickets.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-14 text-center">
            <Ticket className="h-8 w-8 text-muted-foreground/70" />
            <p className="font-medium text-foreground">No tickets in this view.</p>
            <p className="text-sm text-muted-foreground">New Help &amp; Support requests will appear here.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {tickets.map((ticket) => (
            <Card key={ticket.id} data-testid={`card-support-ticket-${ticket.id}`} className="overflow-hidden">
              <CardContent className="space-y-4 p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-primary">
                        {ticket.ticketId}
                      </span>
                      <span className="rounded-full bg-secondary px-2.5 py-1 text-[11px] font-semibold text-secondary-foreground">
                        {ticket.category}
                      </span>
                      <span className="text-xs text-muted-foreground">{formatDate(ticket.createdAt)}</span>
                    </div>
                    <h3 className="mt-2 text-base font-semibold text-foreground">{ticket.subject}</h3>
                    <p className="mt-1 text-xs text-muted-foreground">{ticket.name}</p>
                    <a
                      href={`mailto:${ticket.email}`}
                      data-testid={`link-support-ticket-email-${ticket.id}`}
                      className="mt-1 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
                    >
                      <Mail className="h-3.5 w-3.5" />
                      {ticket.email}
                    </a>
                  </div>
                  <select
                    value={ticket.status}
                    data-testid={`select-support-ticket-status-${ticket.id}`}
                    aria-label={`Status for support ticket ${ticket.ticketId}`}
                    disabled={savingId === ticket.id}
                    onChange={(event) => saveTicket(ticket, { status: event.target.value as TicketStatus })}
                    className="field-support min-h-9 w-auto min-w-32 py-1.5 text-xs font-semibold"
                  >
                    {(Object.keys(statusLabels) as TicketStatus[]).map((status) => (
                      <option key={status} value={status}>{statusLabels[status]}</option>
                    ))}
                  </select>
                </div>

                <p data-testid={`text-support-ticket-message-${ticket.id}`} className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                  {ticket.message}
                </p>

                <div className="border-t border-border/70 pt-4">
                  <label htmlFor={`support-ticket-notes-${ticket.id}`} className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    Internal notes
                  </label>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                    <textarea
                      id={`support-ticket-notes-${ticket.id}`}
                      data-testid={`input-support-ticket-notes-${ticket.id}`}
                      value={noteValue(ticket)}
                      onChange={(event) => setNotes((current) => ({ ...current, [ticket.id]: event.target.value }))}
                      maxLength={5000}
                      rows={2}
                      placeholder="Add an internal note…"
                      className="field-support min-h-16 resize-y text-sm"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      data-testid={`button-save-support-ticket-notes-${ticket.id}`}
                      onClick={() => saveTicket(ticket, { adminNotes: noteValue(ticket) || null })}
                      disabled={savingId === ticket.id}
                      className="shrink-0 gap-2 sm:mt-0.5"
                    >
                      <Save className="h-3.5 w-3.5" />
                      Save note
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}