import "./_group.css";
import { ArrowRight } from "lucide-react";
import type { CareerJourneyStage } from "./_shared/CareerJourneyCard";

const stages: CareerJourneyStage[] = [
  { label: "Upload", status: "complete" },
  { label: "Enhance", status: "complete" },
  { label: "Match", status: "complete" },
  { label: "Apply", status: "current" },
  { label: "Interview", status: "upcoming" },
  { label: "Offer", status: "upcoming" },
  { label: "Visa", status: "upcoming" },
  { label: "Relocate", status: "upcoming" },
  { label: "Start Your New Career in the UK", status: "upcoming" },
];

export function Expanded() {
  const completeCount = stages.filter((stage) => stage.status === "complete").length;
  const progressToLastComplete = stages.length > 1
    ? Math.max(0, ((completeCount - 1) / (stages.length - 1)) * 100)
    : completeCount > 0 ? 100 : 0;

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
                Your next stage is Apply
              </p>
            </div>
            <a
              href="/path"
              className="inline-flex min-h-11 items-center gap-1 rounded-lg px-3 text-xs font-semibold text-primary transition-colors hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              Full journey <ArrowRight className="h-3.5 w-3.5" />
            </a>
          </div>
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
              role="progressbar"
              aria-label="UK Career Journey progress"
              aria-valuemin={0}
              aria-valuemax={stages.length}
              aria-valuenow={completeCount}
              aria-valuetext={`${completeCount} of ${stages.length} stages complete`}
              className="sr-only"
            />
            <ol className="relative grid grid-cols-1 gap-y-1 md:grid-cols-9 md:gap-0">
              {stages.map((stage, index) => (
                <li
                  key={stage.label}
                  data-testid={`journey-stage-${index + 1}`}
                  aria-label={`Stage ${index + 1}: ${stage.label}, ${stage.status}`}
                  aria-current={stage.status === "current" ? "step" : undefined}
                  className="flex min-h-10 min-w-0 items-center gap-3 py-1 md:min-h-0 md:flex-col md:items-center md:px-1 md:py-0 md:text-center"
                >
                  <span
                    className={[
                      "z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 bg-background text-xs font-bold tabular-nums transition-colors",
                      stage.status === "complete"
                        ? "border-primary bg-primary text-primary-foreground"
                        : stage.status === "current"
                          ? "border-primary text-primary shadow-[0_0_0_4px_hsl(var(--primary)/0.12)]"
                          : "border-border text-muted-foreground",
                    ].join(" ")}
                  >
                    {index + 1}
                  </span>
                  <span className={[
                    "min-w-0 flex-1 text-left text-xs leading-snug md:mt-2 md:flex-none md:text-center md:text-[10px] md:leading-tight",
                    stage.status === "complete" ? "font-semibold text-primary" : "",
                    stage.status === "current" ? "font-bold text-foreground" : "",
                    stage.status === "upcoming" ? "text-muted-foreground" : "",
                  ].join(" ")}>
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
        </div>
      </section>
    </main>
  );
}
