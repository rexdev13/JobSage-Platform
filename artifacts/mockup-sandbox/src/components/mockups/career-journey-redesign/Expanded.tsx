import "./_group.css";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import type { CareerJourneyStage } from "./_shared/CareerJourneyCard";

const stages: CareerJourneyStage[] = [
  { label: "Upload", status: "complete" },
  { label: "Enhance", status: "complete" },
  { label: "Match", status: "complete" },
  { label: "Apply", status: "complete" },
  { label: "Interview", status: "current" },
  { label: "Offer", status: "upcoming" },
  { label: "Visa", status: "upcoming" },
  { label: "Relocate", status: "upcoming" },
  { label: "Start Your New Career in the UK", status: "upcoming" },
];

export function Expanded() {
  const completeCount = stages.filter((stage) => stage.status === "complete").length;

  return (
    <main className="min-h-screen w-full bg-background p-6 font-sans text-foreground">
      <section className="mx-auto w-full max-w-[920px]">
        <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground">
          UK Career Journey
        </p>
        <div className="w-full rounded-xl border border-border bg-background p-4 sm:p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                {completeCount} of {stages.length} stages complete
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Your next stage is Interview
              </p>
            </div>
            <a
              href="/path"
              className="inline-flex min-h-11 items-center gap-1 rounded-lg px-3 text-xs font-semibold text-primary transition-colors hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              Full journey <ArrowRight className="h-3.5 w-3.5" />
            </a>
          </div>
          <div
            role="progressbar"
            aria-label="UK Career Journey progress"
            aria-valuemin={0}
            aria-valuemax={stages.length}
            aria-valuenow={completeCount}
            className="mb-4 h-2 overflow-hidden rounded-full bg-muted"
          >
            <div
              className="h-full rounded-full bg-primary transition-[width]"
              style={{ width: `${(completeCount / stages.length) * 100}%` }}
            />
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {stages.map((stage, index) => (
              <div
                key={stage.label}
                data-testid={`journey-stage-${index + 1}`}
                aria-label={`${stage.label}: ${stage.status}`}
                className={[
                  "flex min-h-12 min-w-0 items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors",
                  stage.status === "complete"
                    ? "border-transparent bg-primary/10 text-primary"
                    : stage.status === "current"
                      ? "border-primary/25 bg-primary/[0.06] font-semibold text-foreground shadow-sm"
                      : "border-transparent bg-muted/45 text-muted-foreground",
                ].join(" ")}
              >
                <span
                  aria-hidden="true"
                  className={[
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold",
                    stage.status === "complete"
                      ? "border-primary bg-primary text-primary-foreground"
                      : stage.status === "current"
                        ? "border-primary bg-background text-primary"
                        : "border-border bg-background/70",
                  ].join(" ")}
                >
                  {stage.status === "complete"
                    ? <CheckCircle2 className="h-4 w-4" />
                    : index + 1}
                </span>
                <span className="min-w-0 flex-1 text-xs leading-snug">{stage.label}</span>
                {stage.status === "current" && (
                  <span className="shrink-0 rounded-full bg-primary/10 px-2 py-1 text-[9px] font-bold uppercase tracking-wide text-primary">
                    Now
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
