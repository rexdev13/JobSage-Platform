import { Link } from "wouter";
import { cn } from "@/components/ui-enhanced";
import type { CareerJourneyStage } from "@/lib/candidateJourney";

interface CareerJourneyCardProps {
  stages: CareerJourneyStage[];
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
  onNavigate?: () => void;
  layout?: "sidebar" | "vertical" | "grid";
  title?: string;
  className?: string;
  testId?: string;
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
  testId = "career-journey",
}: CareerJourneyCardProps) {
  const completeCount = stages.filter((stage) => stage.status === "complete").length;
  const currentStage = stages.find((stage) => stage.status === "current");
  const progressToLastComplete = stages.length > 1
    ? Math.max(0, ((completeCount - 1) / (stages.length - 1)) * 100)
    : completeCount > 0 ? 100 : 0;

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
          data-testid={testId}
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
            <Link href="/path" onClick={onNavigate}
              className="shrink-0 text-[10px] font-semibold text-primary hover:underline">
              Full journey
            </Link>
          </div>
          {layout === "grid" && currentStage && (
            <p className="mb-3 text-xs text-muted-foreground">
              Your next stage is {currentStage.label}
            </p>
          )}
          {layout === "grid" ? (
            <div className="relative">
              <div className="absolute bottom-4 left-4 top-4 w-1 rounded-full bg-muted md:hidden" aria-hidden="true">
                <div
                  className="w-full rounded-full bg-primary transition-[height] duration-500"
                  style={{ height: `${progressToLastComplete}%` }}
                />
              </div>
              <div className="absolute left-[5.55%] right-[5.55%] top-4 hidden h-1 rounded-full bg-muted md:block" aria-hidden="true">
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-500"
                  style={{ width: `${progressToLastComplete}%` }}
                />
              </div>
              <div
                className="sr-only"
                role="progressbar"
                aria-label="UK Career Journey progress"
                aria-valuemin={0}
                aria-valuemax={stages.length}
                aria-valuenow={completeCount}
                aria-valuetext={`${completeCount} of ${stages.length} stages complete`}
              />
              <ol className="relative grid grid-cols-1 gap-y-1 md:grid-cols-9 md:gap-0">
                {stages.map((stage, index) => (
                  <li
                    key={stage.label}
                    data-testid={`career-journey-stage-${index + 1}`}
                    aria-label={`Stage ${index + 1}: ${stage.label}, ${stage.status}`}
                    aria-current={stage.status === "current" ? "step" : undefined}
                    className="flex min-h-10 min-w-0 items-center gap-3 py-1 md:min-h-0 md:flex-col md:items-center md:px-1 md:py-0 md:text-center"
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 bg-background text-xs font-bold tabular-nums transition-colors",
                        stage.status === "complete"
                          ? "border-primary bg-primary text-primary-foreground"
                          : stage.status === "current"
                            ? "border-primary text-primary shadow-[0_0_0_4px_hsl(var(--primary)/0.12)]"
                            : "border-border text-muted-foreground",
                      )}
                    >
                      {index + 1}
                    </span>
                    <span
                      className={cn(
                        "min-w-0 flex-1 text-left text-xs leading-snug md:mt-2 md:flex-none md:text-center md:text-[10px] md:leading-tight",
                        stage.status === "complete" && "font-semibold text-primary",
                        stage.status === "current" && "font-bold text-foreground",
                        stage.status === "upcoming" && "text-muted-foreground",
                      )}
                    >
                      {stage.label}
                    </span>
                    {stage.status === "current" && (
                      <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-primary md:mt-1">
                        Current
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          ) : (
            <>
              <div
                role="progressbar"
                aria-label="UK Career Journey progress"
                aria-valuemin={0}
                aria-valuemax={stages.length}
                aria-valuenow={completeCount}
                aria-valuetext={`${completeCount} of ${stages.length} stages complete`}
                className="mb-2 h-1.5 overflow-hidden rounded-full bg-muted"
              >
                <div className="h-full rounded-full bg-primary transition-[width]"
                  style={{ width: `${stages.length ? (completeCount / stages.length) * 100 : 0}%` }} />
              </div>
              <div className={cn(
                "flex gap-1",
                layout === "sidebar" && "mobile-scroll-x pb-1 md:flex-col md:gap-1 md:overflow-visible",
                layout === "vertical" && "flex-col",
              )}>
                {stages.map((stage, index) => (
                  <div
                    key={stage.label}
                    data-testid={`career-journey-stage-${index + 1}`}
                    aria-label={`${stage.label}: ${stage.status}`}
                    className={cn(
                      "flex min-w-[112px] items-center gap-2 rounded-lg px-2.5 py-2 text-[11px]",
                      layout === "sidebar" && "md:min-w-0",
                      stage.status === "complete"
                        ? "bg-primary/10 text-primary"
                        : stage.status === "current"
                          ? "bg-primary/[0.07] font-semibold text-foreground"
                          : "text-muted-foreground",
                    )}
                  >
                    <span className={cn(
                      "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[9px] font-semibold tabular-nums",
                      stage.status === "complete"
                        ? "border-primary bg-primary text-primary-foreground"
                        : stage.status === "current"
                          ? "border-primary text-primary"
                          : "border-border",
                    )} aria-hidden="true">
                      {index + 1}
                    </span>
                    <span className="min-w-0 leading-tight">{stage.label}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
