import { useMemo, useState } from "react";
import { LifeBuoy, Mail, RefreshCw, Save, Send, Ticket } from "lucide-react";
import {
  getGetAdminSupportTicketQueryKey,
  getListAdminSupportTicketsQueryKey,
  useGetAdminSupportTicket,
  useListAdminSupportTickets,
  useReplyToAdminSupportTicket,
  useUpdateAdminSupportTicket,
  type SupportTicketItem,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

type TicketStatus = "new" | "in_review" | "attended" | "resolved";
type TicketFilter = "needs_attention" | "attended" | "resolved" | "all";
type TicketCategory =
  | "Visa Sponsorship"
  | "Readiness Checks"
  | "Account/Billing"
  | "Technical Support"
  | "Other";

const filters: Array<{ id: TicketFilter; label: string }> = [
  { id: "needs_attention", label: "Needs Attention" },
  { id: "attended", label: "Attended" },
  { id: "resolved", label: "Resolved" },
  { id: "all", label: "All" },
];

const categories: TicketCategory[] = [
  "Visa Sponsorship",
  "Readiness Checks",
  "Account/Billing",
  "Technical Support",
  "Other",
];

const statusLabels: Record<TicketStatus, string> = {
  new: "New",
  in_review: "In review",
  attended: "Attended",
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

function getErrorStatus(error: unknown): number | undefined {
  return typeof error === "object" && error !== null && "status" in error
    ? Number((error as { status?: unknown }).status)
    : undefined;
}

export default function AdminSupportTicketsTab() {
  const [filter, setFilter] = useState<TicketFilter>("needs_attention");
  const [category, setCategory] = useState<TicketCategory | "all">("all");
  const [sort, setSort] = useState<"newest" | "oldest">("newest");
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [replyText, setReplyText] = useState("");
  const [selectedTicketId, setSelectedTicketId] = useState<number | null>(null);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [replyingId, setReplyingId] = useState<number | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const params = useMemo(
    () => ({
      ...(filter === "all" ? {} : { status: filter }),
      ...(category === "all" ? {} : { category }),
      sort,
      limit: 100,
      offset: 0,
    }),
    [filter, category, sort],
  );
  const queryKey = getListAdminSupportTicketsQueryKey(params);
  const { data, isLoading, isError, refetch } = useListAdminSupportTickets(params, {
    query: { queryKey, refetchOnWindowFocus: false },
  });
  const detailQuery = useGetAdminSupportTicket(selectedTicketId ?? 0, {
    query: {
      queryKey: getGetAdminSupportTicketQueryKey(selectedTicketId ?? 0),
      enabled: selectedTicketId !== null,
      refetchOnMount: "always",
      refetchOnWindowFocus: true,
    },
  });
  const updateTicket = useUpdateAdminSupportTicket();
  const replyToTicket = useReplyToAdminSupportTicket();
  const tickets = data ?? [];
  const activeTicket = detailQuery.data?.ticket;

  function noteValue(ticket: SupportTicketItem) {
    return notes[ticket.id] ?? ticket.adminNotes ?? "";
  }

  function refreshList() {
    void queryClient.invalidateQueries({ queryKey: getListAdminSupportTicketsQueryKey() });
  }

  function refreshDetail(ticketId: number) {
    void queryClient.invalidateQueries({ queryKey: getGetAdminSupportTicketQueryKey(ticketId) });
  }

  function saveTicket(ticket: SupportTicketItem, update: { status?: TicketStatus; adminNotes?: string | null }) {
    setSavingId(ticket.id);
    updateTicket.mutate(
      { id: ticket.id, data: update },
      {
        onSuccess: () => {
          toast({ title: "Support ticket updated", description: `${ticket.ticketId} has been saved.` });
          refreshList();
          refreshDetail(ticket.id);
        },
        onError: () => toast({ title: "Update failed", description: "Please try again.", variant: "destructive" }),
        onSettled: () => setSavingId(null),
      },
    );
  }

  function sendReply(status: "attended" | "resolved") {
    if (!activeTicket || !replyText.trim()) return;
    const ticketId = activeTicket.id;
    setReplyingId(ticketId);
    replyToTicket.mutate(
      {
        id: ticketId,
        data: {
          replyText,
          status,
          expectedUpdatedAt: activeTicket.updatedAt,
        },
      },
      {
        onSuccess: (detail) => {
          setReplyText("");
          toast({
            title: status === "resolved" ? "Reply sent and ticket resolved" : "Reply sent and ticket attended",
            description: `${detail.ticket.ticketId} was delivered via ${detail.replies.at(-1)?.deliveryChannel === "email" ? "email" : "the candidate inbox"}.`,
          });
          refreshList();
          refreshDetail(ticketId);
        },
        onError: (error) => {
          const statusCode = getErrorStatus(error);
          const description = statusCode === 409
            ? "Another admin changed this ticket. Refresh its details before replying."
            : statusCode === 502
              ? "The guest email could not be delivered. The ticket was not marked attended or resolved."
              : "The reply was not sent. Please refresh the ticket and try again.";
          toast({ title: "Reply failed", description, variant: "destructive" });
          refreshDetail(ticketId);
        },
        onSettled: () => setReplyingId(null),
      },
    );
  }

  return (
    <section className="space-y-5" aria-labelledby="support-inbox-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="support-inbox-title" className="font-display text-xl font-semibold text-foreground">Support tickets</h2>
          <p className="mt-1 text-sm text-muted-foreground">Review requests, see replies, and respond to candidates.</p>
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

      <div className="flex flex-wrap items-center gap-3">
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

        <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          Category
          <select
            aria-label="Filter support tickets by category"
            data-testid="select-support-ticket-category"
            value={category}
            onChange={(event) => setCategory(event.target.value as TicketCategory | "all")}
            className="field-support min-h-9 w-auto py-1.5 text-xs"
          >
            <option value="all">All categories</option>
            {categories.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>

        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="button-support-ticket-sort"
          aria-label={`Sort ${sort === "newest" ? "oldest first" : "newest first"}`}
          onClick={() => setSort((current) => current === "newest" ? "oldest" : "newest")}
        >
          {sort === "newest" ? "Newest first" : "Oldest first"}
        </Button>
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

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/70 pt-3">
                  <Button
                    type="button"
                    variant={selectedTicketId === ticket.id ? "default" : "outline"}
                    size="sm"
                    data-testid={`button-support-ticket-details-${ticket.id}`}
                    onClick={() => {
                      setSelectedTicketId((current) => current === ticket.id ? null : ticket.id);
                      setReplyText("");
                    }}
                  >
                    {selectedTicketId === ticket.id ? "Close conversation" : "View conversation"}
                  </Button>
                  {ticket.reviewedBy && ticket.reviewedAt && (
                    <span className="text-xs text-muted-foreground">
                      Last attended {formatDate(ticket.reviewedAt)}
                    </span>
                  )}
                </div>

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

      {selectedTicketId !== null && (
        <Card data-testid="card-support-ticket-conversation" className="overflow-hidden">
          <CardContent className="space-y-5 p-5 sm:p-6">
            {detailQuery.isLoading ? (
              <div className="py-8 text-center text-sm text-muted-foreground">Loading conversation…</div>
            ) : detailQuery.isError || !detailQuery.data ? (
              <div className="space-y-3 py-6 text-center">
                <p className="text-sm font-medium text-foreground">This conversation could not be loaded.</p>
                <Button variant="outline" size="sm" onClick={() => void detailQuery.refetch()}>Try again</Button>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <LifeBuoy className="h-5 w-5 text-primary" />
                      <h3 className="text-lg font-semibold text-foreground">Conversation · {activeTicket?.ticketId}</h3>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{activeTicket?.subject}</p>
                  </div>
                  <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-semibold text-secondary-foreground">
                    {activeTicket ? statusLabels[activeTicket.status] : ""}
                  </span>
                </div>

                <ol className="space-y-3" aria-label="Support reply history">
                  <li className="rounded-xl border border-border bg-muted/30 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-foreground">{activeTicket?.name}</p>
                      <time className="text-xs text-muted-foreground" dateTime={activeTicket?.createdAt}>
                        {activeTicket ? formatDate(activeTicket.createdAt) : ""}
                      </time>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">Original support request</p>
                    <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-foreground">{activeTicket?.message}</p>
                  </li>
                  {detailQuery.data.replies.map((reply) => (
                    <li key={reply.id} className="rounded-xl border border-primary/20 bg-primary/[0.035] p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-foreground">{reply.adminDisplayName}</p>
                        <time className="text-xs text-muted-foreground" dateTime={reply.createdAt}>{formatDate(reply.createdAt)}</time>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Admin reply · {reply.deliveryStatus === "failed"
                          ? "Email delivery failed"
                          : `Sent via ${reply.deliveryChannel === "inbox" ? "candidate inbox" : "email"}`}
                      </p>
                      <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-foreground">{reply.replyText}</p>
                    </li>
                  ))}
                </ol>

                <div className="space-y-3 border-t border-border pt-5">
                  <div>
                    <label htmlFor="support-ticket-reply" className="block text-sm font-semibold text-foreground">
                      Reply to Candidate
                    </label>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {activeTicket?.userId
                        ? "Will be sent to Candidate's JobSage Inbox"
                        : "Will be sent via email"}
                    </p>
                  </div>
                  <textarea
                    id="support-ticket-reply"
                    data-testid="input-support-ticket-reply"
                    value={replyText}
                    onChange={(event) => setReplyText(event.target.value)}
                    maxLength={5000}
                    rows={5}
                    placeholder="Write a clear response to the candidate…"
                    className="field-support min-h-28 resize-y text-sm"
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      data-testid="button-send-reply-attended"
                      onClick={() => sendReply("attended")}
                      disabled={!replyText.trim() || replyingId === selectedTicketId}
                      className="gap-2"
                    >
                      <Send className="h-4 w-4" />
                      Send Reply &amp; Mark Attended
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      data-testid="button-send-reply-resolved"
                      onClick={() => sendReply("resolved")}
                      disabled={!replyText.trim() || replyingId === selectedTicketId}
                    >
                      Send Reply &amp; Mark Resolved
                    </Button>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </section>
  );
}
