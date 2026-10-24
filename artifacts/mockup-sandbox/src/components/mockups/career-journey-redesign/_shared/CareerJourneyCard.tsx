import { CheckCircle2 } from "lucide-react";

export type CareerJourneyStage = {
  label: string;
  status: "complete" | "current" | "upcoming";
};

interface CareerJourneyCardProps {
  stages: CareerJourneyStage[];
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
  onNavigate?: () => void;
  layout?: "sidebar" | "vertical" | "grid";
  title?: string;
  className?: string;
}

function cn(...parts: Array<string | false | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function CareerJourneyCard({
  stages,
  isLoading = false,
  isError = false,
  onRetry,
  onNavigate,
  layout = "sidebar",
  title,
  className,
}: CareerJourneyCardProps) {
  const completeCount = stages.filter((stage) => stage.status === "complete").length;
  const currentStage = stages.find((stage) => stage.status === "current");

  return (
    <div className={className}>
      {title && (
        <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground">
          {title}
        </p>
      )}
      {isLoading ? (
        <div className="h-24 animate-pulse rounded-xl bg-muted/60" aria-label="Loading career journey" />
      ) : isError ? (
        <div className="rounded-xl border border-border bg-background/70 p-3 text-xs">
          <p className="font-medium text-foreground">Journey progress is unavailable</p>
          {onRetry && (
            <button type="button" className="mt-2 min-h-11 text-primary underline underline-offset-2"
              onClick={onRetry}>
              Retry
            </button>
          )}
        </div>
      ) : (
        <div
          className={cn(
            "rounded-xl border border-border bg-background p-3",
            layout === "grid" && "p-4 sm:p-5",
          )}
        >
          <p className="sr-only" role="status">
            Career journey: {completeCount} of {stages.length} stages complete.
          </p>
          <div className={cn(
            "flex items-center justify-between gap-2",
            layout === "grid" ? "mb-1" : "mb-2",
          )}>
            <span className="text-[11px] font-semibold text-foreground">
              {completeCount} of {stages.length} stages complete
            </span>
            <a href="/path" onClick={onNavigate}
              className="shrink-0 text-[10px] font-semibold text-primary hover:underline">
              Full journey
            </a>
          </div>
          {layout === "grid" && currentStage && (
            <p className="mb-3 text-xs text-muted-foreground">
              Your next stage is {currentStage.label}
            </p>
          )}
          <div
            role="progressbar"
            aria-label="UK Career Journey progress"
            aria-valuemin={0}
            aria-valuemax={stages.length}
            aria-valuenow={completeCount}
            className={cn(
              "mb-2 overflow-hidden rounded-full bg-muted",
              layout === "grid" ? "h-2 mb-4" : "h-1.5",
            )}
          >
            <div className="h-full rounded-full bg-primary transition-[width]"
              style={{ width: `${stages.length ? (completeCount / stages.length) * 100 : 0}%` }} />
          </div>
          <div className={cn(
            layout === "grid"
              ? "grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3"
              : "flex gap-1",
            layout === "sidebar" && "mobile-scroll-x pb-1 md:flex-col md:gap-1 md:overflow-visible",
            layout === "vertical" && "flex-col",
          )}>
            {stages.map((stage, index) => (
              <div key={stage.label} aria-label={`${stage.label}: ${stage.status}`}
                className={cn(
                  "flex min-w-[112px] items-center gap-2 rounded-lg px-2.5 py-2 text-[11px]",
                  layout === "sidebar" && "md:min-w-0",
                  layout === "grid" && "min-h-12 min-w-0 gap-3 border px-3 py-2.5 text-xs",
                  stage.status === "complete"
                    ? cn(
                        "bg-primary/10 text-primary",
                        layout === "grid" && "border-transparent",
                      )
                    : stage.status === "current"
                      ? cn(
                          "bg-primary/[0.07] font-semibold text-foreground",
                          layout === "grid" && "border-primary/25 bg-primary/[0.06] shadow-sm",
                        )
                      : cn(
                          "text-muted-foreground",
                          layout === "grid" && "border-transparent bg-muted/45",
                        ),
                )}>
                <span className={cn(
                  "flex shrink-0 items-center justify-center rounded-full border",
                  layout === "grid" ? "h-7 w-7 text-[11px] font-semibold" : "h-5 w-5 text-[9px]",
                  stage.status === "complete"
                    ? "border-primary bg-primary text-primary-foreground"
                    : stage.status === "current"
                      ? cn("border-primary text-primary", layout === "grid" && "bg-background")
                      : "border-border",
                )} aria-hidden="true">
                  {stage.status === "complete" ? <CheckCircle2 className="h-3 w-3" /> : index + 1}
                </span>
                <span className="min-w-0 leading-tight">{stage.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
