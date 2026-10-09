import { CheckCircle2 } from "lucide-react";

export type CareerJourneyStage = {
  label: string;
  status: "complete" | "current" | "upcoming";
};

interface CareerJourneyCardProps {
  stages: CareerJourneyStage[];
  layout?: "sidebar" | "vertical";
  title?: string;
  className?: string;
}

function cn(...parts: Array<string | false | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function CareerJourneyCard({
  stages,
  layout = "sidebar",
  title,
  className,
}: CareerJourneyCardProps) {
  const completeCount = stages.filter((stage) => stage.status === "complete").length;

  return (
    <div className={className}>
      {title && (
        <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground">
          {title}
        </p>
      )}
      <div className="rounded-xl border border-border bg-background p-3">
        <p className="sr-only" role="status">
          Career journey: {completeCount} of {stages.length} stages complete.
        </p>
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold text-foreground">
            {completeCount} of {stages.length} stages complete
          </span>
          <a href="/path" className="shrink-0 text-[10px] font-semibold text-primary hover:underline">
            Full journey
          </a>
        </div>
        <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
          <div
            className="h-full rounded-full bg-primary transition-[width]"
            style={{ width: `${stages.length ? (completeCount / stages.length) * 100 : 0}%` }}
          />
        </div>
        <div className={cn(
          "flex gap-1",
          layout === "sidebar"
            ? "mobile-scroll-x pb-1 md:flex-col md:gap-1 md:overflow-visible"
            : "flex-col",
        )}>
          {stages.map((stage, index) => (
            <div
              key={stage.label}
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
                "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[9px]",
                stage.status === "complete"
                  ? "border-primary bg-primary text-primary-foreground"
                  : stage.status === "current"
                    ? "border-primary text-primary"
                    : "border-border",
              )}>
                {stage.status === "complete" ? <CheckCircle2 className="h-3 w-3" /> : index + 1}
              </span>
              <span className="min-w-0 leading-tight">{stage.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
