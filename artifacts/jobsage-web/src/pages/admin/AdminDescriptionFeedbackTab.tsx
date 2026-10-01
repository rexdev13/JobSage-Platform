import { useMemo, useState } from "react";
import { RefreshCw, ThumbsDown, ThumbsUp } from "lucide-react";
import {
  getListAdminDescriptionFeedbackQueryKey,
  useListAdminDescriptionFeedback,
  type AdminDescriptionFeedbackInbox,
  type ListAdminDescriptionFeedbackParams,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type SentimentFilter = "all" | "up" | "down";
type RatingItem = AdminDescriptionFeedbackInbox["items"][number];

const filters: Array<{ id: SentimentFilter; label: string }> = [
  { id: "all", label: "All ratings" },
  { id: "up", label: "Helpful" },
  { id: "down", label: "Not helpful" },
];

function formatDate(value: string) {
  return new Date(value).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function AdminDescriptionFeedbackTab() {
  const [filter, setFilter] = useState<SentimentFilter>("all");
  const [offset, setOffset] = useState(0);
  const limit = 100;
  const params = useMemo<ListAdminDescriptionFeedbackParams>(
    () => ({
      ...(filter === "all" ? {} : { sentiment: filter }),
      limit,
      offset,
    }),
    [filter, offset],
  );
  const { data, isLoading, isError, refetch } = useListAdminDescriptionFeedback(params, {
    query: { queryKey: getListAdminDescriptionFeedbackQueryKey(params), refetchOnWindowFocus: false },
  });
  const items = data?.items ?? [];
  const summary = data?.summary;

  function changeFilter(next: SentimentFilter) {
    setFilter(next);
    setOffset(0);
  }

  return (
    <section className="space-y-5" aria-labelledby="ai-description-ratings-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 id="ai-description-ratings-title" className="font-display text-lg font-semibold text-foreground">AI job-description ratings</h3>
          <p className="mt-1 text-sm text-muted-foreground">Employer thumbs-up/down responses are saved here with the role and employer context.</p>
        </div>
        <Button variant="outline" size="sm" data-testid="button-refresh-ai-ratings" onClick={() => void refetch()} disabled={isLoading} className="gap-2">
          <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[
          ["Total ratings", summary?.total ?? "—", "text-foreground"],
          ["Helpful", summary?.up ?? "—", "text-emerald-700"],
          ["Not helpful", summary?.down ?? "—", "text-rose-700"],
        ].map(([label, value, color]) => (
          <Card key={label} data-testid={`card-ai-rating-summary-${String(label).toLowerCase().replaceAll(" ", "-")}`}>
            <CardContent className="p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
              <p className={`mt-2 font-display text-2xl font-semibold ${color}`}>{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="mobile-scroll-x flex gap-1 rounded-xl border border-border bg-muted/30 p-1" role="tablist" aria-label="AI rating filters">
        {filters.map((option) => (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={filter === option.id}
            data-testid={`button-ai-rating-filter-${option.id}`}
            onClick={() => changeFilter(option.id)}
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
            <p className="text-sm font-medium text-foreground">AI ratings could not be loaded.</p>
            <Button variant="outline" size="sm" data-testid="button-retry-ai-ratings" onClick={() => void refetch()}>Try again</Button>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <div className="space-y-3" aria-label="Loading AI ratings">
          {[1, 2, 3].map((item) => <div key={item} className="h-32 animate-pulse rounded-2xl border border-border bg-muted/40" />)}
        </div>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-14 text-center">
            <p className="font-medium text-foreground">No AI ratings in this view.</p>
            <p className="text-sm text-muted-foreground">Ratings will appear here after an employer responds to an AI-generated description.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="space-y-3">
            {items.map((item) => <RatingRow key={item.id} item={item} />)}
          </div>
          {(offset > 0 || items.length === limit) && (
            <div className="flex justify-between">
              <Button variant="outline" size="sm" onClick={() => setOffset(Math.max(0, offset - limit))} disabled={offset === 0}>Previous</Button>
              <Button variant="outline" size="sm" onClick={() => setOffset(offset + limit)} disabled={items.length < limit}>Next</Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function RatingRow({ item }: { item: RatingItem }) {
  const isHelpful = item.sentiment === "up";

  return (
    <Card data-testid={`card-ai-rating-${item.id}`}>
      <CardContent className="space-y-3 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
                isHelpful ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"
              }`}>
                {isHelpful ? <ThumbsUp className="h-3.5 w-3.5" /> : <ThumbsDown className="h-3.5 w-3.5" />}
                {isHelpful ? "Helpful" : "Not helpful"}
              </span>
              <span className="text-xs text-muted-foreground">{formatDate(item.createdAt)}</span>
            </div>
            <h4 data-testid={`text-ai-rating-job-${item.id}`} className="mt-2 font-semibold text-foreground">{item.jobTitle}</h4>
            {item.specialty && <p className="mt-0.5 text-sm text-muted-foreground">{item.specialty}</p>}
          </div>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border/70 pt-3 text-xs text-muted-foreground">
          <span data-testid={`text-ai-rating-company-${item.id}`}>{item.companyName ?? "Employer profile unavailable"}</span>
          {item.email && <a href={`mailto:${item.email}`} className="hover:text-primary hover:underline">{item.email}</a>}
        </div>
      </CardContent>
    </Card>
  );
}