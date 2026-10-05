import { useMemo, useState } from "react";
import { ExternalLink, LoaderCircle, MessageSquareText, RefreshCw, Save, Send, UserRound } from "lucide-react";
import {
  getListAdminFeedbackQueryKey,
  useListAdminFeedback,
  useReplyToAdminFeedback,
  useUpdateAdminFeedback,
  type FeedbackItem,
  type ListAdminFeedbackParams,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

type FeedbackFilter = "all" | "issue" | "idea" | "general" | "unresolved";
type FeedbackStatus = "new" | "in_review" | "resolved";

const filters: Array<{ id: FeedbackFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "issue", label: "Issues" },
  { id: "idea", label: "Ideas" },
  { id: "general", label: "General" },
  { id: "unresolved", label: "Unresolved" },
];

const statusLabels: Record<FeedbackStatus, string> = {
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

function submitter(item: FeedbackItem) {
  if (item.userId) return `Signed-in user · ${item.email ?? item.userId}`;
  return item.email ? `Guest · ${item.email}` : "Guest";
}

export function ProductFeedbackInbox() {
  const [filter, setFilter] = useState<FeedbackFilter>("all");
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [savingId, setSavingId] = useState<number | null>(null);
  const [replyDrafts, setReplyDrafts] = useState<Record<number, string>>({});
  const [openConversationId, setOpenConversationId] = useState<number | null>(null);
  const [replyingId, setReplyingId] = useState<number | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const params = useMemo<ListAdminFeedbackParams>(() => {
    if (filter === "all") return { limit: 100, offset: 0 };
    if (filter === "unresolved") return { status: "unresolved", limit: 100, offset: 0 };
    return { category: filter, limit: 100, offset: 0 };
  }, [filter]);
  const queryKey = getListAdminFeedbackQueryKey(params);
  const { data, isLoading, isError, refetch } = useListAdminFeedback(params, {
    query: { queryKey, refetchOnWindowFocus: false },
  });
  const updateFeedback = useUpdateAdminFeedback();
  const replyToFeedback = useReplyToAdminFeedback();
  const items = data?.items ?? [];
  const summary = data?.summary;

  function noteValue(item: FeedbackItem) {
    return notes[item.id] ?? item.adminNotes ?? "";
  }

  function refreshList() {
    void queryClient.invalidateQueries({ queryKey: getListAdminFeedbackQueryKey() });
  }

  function saveItem(item: FeedbackItem, update: { status?: FeedbackStatus; adminNotes?: string | null }) {
    setSavingId(item.id);
    updateFeedback.mutate(
      { id: item.id, data: update },
      {
        onSuccess: () => {
          toast({ title: "Feedback updated", description: "The current inbox has been refreshed." });
          refreshList();
        },
        onError: () => toast({ title: "Update failed", description: "Please try again.", variant: "destructive" }),
        onSettled: () => setSavingId(null),
      },
    );
  }

  function sendReply(item: FeedbackItem) {
    const replyText = (replyDrafts[item.id] ?? "").trim();
    if (!replyText || (!item.userId && !item.email)) return;

    setReplyingId(item.id);
    replyToFeedback.mutate(
      { id: item.id, data: { replyText, expectedUpdatedAt: item.updatedAt } },
      {
        onSuccess: () => {
          setReplyDrafts((current) => {
            const next = { ...current };
            delete next[item.id];
            return next;
          });
          toast({
            title: "Reply sent",
            description: item.userId
              ? "The reply was sent to the user's JOBSAGE inbox."
              : "The reply was sent by email.",
          });
          refreshList();
        },
        onError: () => {
          void queryClient.invalidateQueries({ queryKey: getListAdminFeedbackQueryKey() });
          toast({
            title: "Reply could not be sent",
            description: "Check the delivery status and try again.",
            variant: "destructive",
          });
        },
        onSettled: () => setReplyingId(null),
      },
    );
  }

  return (
    <section className="space-y-5" aria-labelledby="feedback-inbox-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="feedback-inbox-title" className="font-display text-xl font-semibold text-foreground">Product feedback</h2>
          <p className="mt-1 text-sm text-muted-foreground">A focused inbox for the notes people leave across JOBSAGE.</p>
        </div>
        <Button variant="outline" size="sm" data-testid="button-refresh-feedback" onClick={() => void refetch()} disabled={isLoading} className="gap-2">
          <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          ["Total", summary?.total ?? "—", "text-foreground"],
          ["Issues", summary?.issues ?? "—", "text-rose-700"],
          ["Ideas", summary?.ideas ?? "—", "text-amber-700"],
          ["General", summary?.general ?? "—", "text-sky-700"],
          ["Unresolved", summary?.unresolved ?? "—", "text-primary"],
        ].map(([label, value, color]) => (
          <Card key={label} data-testid={`card-feedback-summary-${String(label).toLowerCase()}`}>
            <CardContent className="p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
              <p className={`mt-2 font-display text-2xl font-semibold ${color}`}>{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="mobile-scroll-x flex gap-1 rounded-xl border border-border bg-muted/30 p-1" role="tablist" aria-label="Feedback filters">
        {filters.map((option) => (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={filter === option.id}
            data-testid={`button-feedback-filter-${option.id}`}
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
            <MessageSquareText className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">Feedback could not be loaded.</p>
            <Button variant="outline" size="sm" data-testid="button-retry-feedback" onClick={() => void refetch()}>Try again</Button>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <div className="space-y-3" aria-label="Loading feedback">
          {[1, 2, 3].map((item) => <div key={item} className="h-40 animate-pulse rounded-2xl border border-border bg-muted/40" />)}
        </div>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-14 text-center">
            <MessageSquareText className="h-8 w-8 text-muted-foreground/70" />
            <p className="font-medium text-foreground">No feedback in this view.</p>
            <p className="text-sm text-muted-foreground">New notes will appear here as people share them.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <FeedbackRow
              key={item.id}
              item={item}
              note={noteValue(item)}
              saving={savingId === item.id}
              onNoteChange={(value) => setNotes((current) => ({ ...current, [item.id]: value }))}
              onStatusChange={(status) => saveItem(item, { status })}
              onNotesSave={() => saveItem(item, { adminNotes: noteValue(item) || null })}
              replyDraft={replyDrafts[item.id] ?? ""}
              conversationOpen={openConversationId === item.id}
              replying={replyingId === item.id}
              onReplyDraftChange={(value) => setReplyDrafts((current) => ({ ...current, [item.id]: value }))}
              onToggleConversation={() => setOpenConversationId((current) => current === item.id ? null : item.id)}
              onReplySend={() => sendReply(item)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function FeedbackRow({
  item,
  note,
  saving,
  onNoteChange,
  onStatusChange,
  onNotesSave,
  replyDraft,
  conversationOpen,
  replying,
  onReplyDraftChange,
  onToggleConversation,
  onReplySend,
}: {
  item: FeedbackItem;
  note: string;
  saving: boolean;
  onNoteChange: (value: string) => void;
  onStatusChange: (status: FeedbackStatus) => void;
  onNotesSave: () => void;
  replyDraft: string;
  conversationOpen: boolean;
  replying: boolean;
  onReplyDraftChange: (value: string) => void;
  onToggleConversation: () => void;
  onReplySend: () => void;
}) {
  const replies = item.replies ?? [];
  const hasDeliveryRoute = Boolean(item.userId || item.email);

  return (
    <Card data-testid={`card-feedback-item-${item.id}`} className="overflow-hidden">
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <MessageSquareText className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-secondary px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-secondary-foreground">{item.category}</span>
                <span className="text-xs text-muted-foreground">{formatDate(item.createdAt)}</span>
              </div>
              <p data-testid={`text-feedback-submitter-${item.id}`} className="mt-2 flex items-center gap-1.5 text-xs font-medium text-foreground">
                <UserRound className="h-3.5 w-3.5 text-muted-foreground" />
                {submitter(item)}
              </p>
            </div>
          </div>
          <select
            value={item.status}
            data-testid={`select-feedback-status-${item.id}`}
            aria-label={`Status for feedback ${item.id}`}
            disabled={saving}
            onChange={(event) => onStatusChange(event.target.value as FeedbackStatus)}
            className="field-support min-h-9 w-auto min-w-32 py-1.5 text-xs font-semibold"
          >
            {(Object.keys(statusLabels) as FeedbackStatus[]).map((status) => <option key={status} value={status}>{statusLabels[status]}</option>)}
          </select>
        </div>

        {!conversationOpen && (
          <p data-testid={`text-feedback-message-${item.id}`} className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
            {item.message}
          </p>
        )}

        <div className="flex min-w-0 items-start gap-2 rounded-xl bg-muted/45 px-3 py-2.5 text-xs text-muted-foreground">
          <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <a href={item.pageUrl} target="_blank" rel="noreferrer" data-testid={`link-feedback-origin-${item.id}`} className="min-w-0 break-all hover:text-primary hover:underline">{item.pageUrl}</a>
          <span className="ml-auto shrink-0 border-l border-border pl-2">{item.screenResolution}</span>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/70 pt-3">
          <Button
            type="button"
            variant={conversationOpen ? "default" : "outline"}
            size="sm"
            data-testid={`button-feedback-conversation-${item.id}`}
            aria-expanded={conversationOpen}
            aria-controls={`feedback-conversation-${item.id}`}
            onClick={onToggleConversation}
          >
            {conversationOpen ? "Close conversation" : "View conversation"}
          </Button>
          {item.reviewedBy && item.reviewedAt && (
            <span className="text-xs text-muted-foreground">Last attended {formatDate(item.reviewedAt)}</span>
          )}
        </div>

        {conversationOpen && (
          <section
            id={`feedback-conversation-${item.id}`}
            data-testid={`feedback-conversation-${item.id}`}
            aria-label={`Feedback conversation for ${submitter(item)}`}
            className="space-y-5 border-t border-border/70 pt-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <MessageSquareText className="h-5 w-5 text-primary" />
                  <h3 className="text-lg font-semibold text-foreground">Conversation · Feedback #{item.id}</h3>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {item.category.charAt(0).toUpperCase() + item.category.slice(1)} feedback
                </p>
              </div>
              <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-semibold text-secondary-foreground">
                {statusLabels[item.status]}
              </span>
            </div>

            <ol className="space-y-3" aria-label="Feedback reply history">
              <li className="rounded-xl border border-border bg-muted/30 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-foreground">{submitter(item)}</p>
                  <time className="text-xs text-muted-foreground" dateTime={item.createdAt}>
                    {formatDate(item.createdAt)}
                  </time>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">Original product feedback</p>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-foreground">{item.message}</p>
              </li>
              {replies.map((reply) => (
                <li
                  key={reply.id}
                  data-testid={`feedback-reply-${reply.id}`}
                  className="rounded-xl border border-primary/20 bg-primary/[0.035] p-4"
                >
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
                <label htmlFor={`feedback-reply-input-${item.id}`} className="block text-sm font-semibold text-foreground">
                  Reply to {item.userId ? "Candidate" : "Submitter"}
                </label>
                <p className="mt-1 text-xs text-muted-foreground">
                  {item.userId
                    ? "Will be sent to the candidate's JOBSAGE inbox."
                    : item.email
                      ? `Will be sent via email to ${item.email}.`
                      : "This submission has no account or email address for delivery."}
                </p>
              </div>
              <textarea
                id={`feedback-reply-input-${item.id}`}
                data-testid={`input-feedback-reply-${item.id}`}
                value={replyDraft}
                onChange={(event) => onReplyDraftChange(event.target.value)}
                maxLength={5000}
                rows={5}
                disabled={!hasDeliveryRoute || replying}
                placeholder="Write a clear response to the submitter…"
                className="field-support min-h-28 resize-y text-sm"
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  data-testid={`button-send-feedback-reply-${item.id}`}
                  onClick={onReplySend}
                  disabled={!hasDeliveryRoute || !replyDraft.trim() || replying}
                  className="gap-2"
                >
                  {replying ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  {replying ? "Sending…" : "Send reply"}
                </Button>
              </div>
            </div>
          </section>
        )}

        <div className="border-t border-border/70 pt-4">
          <label htmlFor={`feedback-notes-${item.id}`} className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Admin notes</label>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
            <textarea
              id={`feedback-notes-${item.id}`}
              data-testid={`input-feedback-notes-${item.id}`}
              value={note}
              onChange={(event) => onNoteChange(event.target.value)}
              maxLength={5000}
              rows={2}
              placeholder="Add an internal note…"
              className="field-support min-h-16 resize-y text-sm"
            />
            <Button type="button" variant="outline" size="sm" data-testid={`button-save-feedback-notes-${item.id}`} onClick={onNotesSave} disabled={saving} className="shrink-0 gap-2 sm:mt-0.5">
              {saving ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Save note
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}