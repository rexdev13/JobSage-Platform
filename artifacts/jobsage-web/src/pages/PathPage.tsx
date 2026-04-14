import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, PageTransition, Button } from "@/components/ui-enhanced";
import {
  useGetRemediationPlan,
  useUpdateRemediationStep,
  useGetAiRemediationSuggestions,
  useUpdateRemediationPlanOrdering,
  useGetForwardEligibility,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetRemediationPlanQueryKey } from "@workspace/api-client-react";
import {
  CheckCircle2,
  Clock,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Loader2,
  AlertTriangle,
  TrendingUp,
  ArrowRight,
  Sparkles,
  Circle,
  Zap,
  Timer,
  Briefcase,
  MapPin,
  Building2,
} from "lucide-react";
import { useLocation, Link } from "wouter";
import type { RemediationStep } from "@workspace/api-client-react";
import { DisclaimerBanner } from "@/components/ui/DisclaimerBanner";
import { motion } from "framer-motion";

type StepStatus = "planned" | "in_progress" | "done";

function getStepIcon(status: StepStatus, index: number) {
  if (status === "done") {
    return (
      <div className="w-9 h-9 rounded-full bg-emerald-100 border-2 border-emerald-500 flex items-center justify-center shadow-sm">
        <CheckCircle2 className="w-5 h-5 text-emerald-600" />
      </div>
    );
  }
  if (status === "in_progress") {
    return (
      <div className="w-9 h-9 rounded-full bg-blue-100 border-2 border-blue-500 flex items-center justify-center shadow-sm animate-pulse">
        <Zap className="w-4 h-4 text-blue-600" />
      </div>
    );
  }
  return (
    <div className="w-9 h-9 rounded-full bg-muted border-2 border-border flex items-center justify-center shadow-sm">
      <span className="text-xs font-bold text-muted-foreground">{index + 1}</span>
    </div>
  );
}

function TimelineStep({ step, index, isLast }: { step: RemediationStep; index: number; isLast: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const queryClient = useQueryClient();
  const { mutate: updateStep, isPending } = useUpdateRemediationStep({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetRemediationPlanQueryKey() });
      },
    },
  });

  const STATUS_CYCLE: StepStatus[] = ["planned", "in_progress", "done"];
  const nextStatus = STATUS_CYCLE[(STATUS_CYCLE.indexOf(step.status as StepStatus) + 1) % STATUS_CYCLE.length];

  const statusColors: Record<StepStatus, string> = {
    done: "border-l-emerald-400 bg-emerald-50/20",
    in_progress: "border-l-blue-400 bg-blue-50/20",
    planned: "border-l-border",
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.06, duration: 0.35 }}
      className="flex gap-4"
    >
      <div className="flex flex-col items-center">
        {getStepIcon(step.status as StepStatus, index)}
        {!isLast && (
          <div className={`w-0.5 flex-1 mt-1.5 ${step.status === "done" ? "bg-emerald-300" : "bg-border"}`} />
        )}
      </div>

      <div className={`flex-1 pb-6 ${isLast ? "" : ""}`}>
        <Card className={`p-4 border-l-4 ${statusColors[step.status as StepStatus] ?? ""} ${step.status === "done" ? "opacity-80" : ""}`}>
          <div className="flex items-start justify-between gap-3 mb-2">
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                {step.status === "in_progress" && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-800">
                    <Zap className="w-3 h-3" /> In Progress
                  </span>
                )}
                {step.status === "done" && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">
                    <CheckCircle2 className="w-3 h-3" /> Done
                  </span>
                )}
                {step.pathway && (
                  <span className="text-xs text-primary/70 font-medium">{step.pathway}</span>
                )}
              </div>
              <h3 className={`text-sm font-semibold leading-snug ${step.status === "done" ? "line-through text-muted-foreground/60" : "text-foreground"}`}>
                {step.title}
              </h3>
            </div>
            <button
              onClick={() => updateStep({ id: step.id, data: { status: nextStatus } })}
              disabled={isPending}
              className="shrink-0 px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-foreground hover:bg-muted/60 transition-colors disabled:opacity-50 whitespace-nowrap"
            >
              {isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                `Mark ${nextStatus.replace("_", " ")}`
              )}
            </button>
          </div>

          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground mt-2">
            {step.timelineRange && (
              <span className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                <span className="font-medium text-foreground">{step.timelineRange}</span>
              </span>
            )}
            {step.costRange && (
              <span className="flex items-center gap-1">
                Cost: <span className="font-medium text-foreground">{step.costRange}</span>
              </span>
            )}
            {step.gap && (
              <span className="text-muted-foreground/70 italic truncate max-w-xs">Gap: {step.gap}</span>
            )}
          </div>

          <div className="mt-2">
            <button
              onClick={() => setExpanded((v) => !v)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              {expanded ? "Hide details" : "Show details"}
            </button>
            {expanded && (
              <p className="mt-2 text-xs text-muted-foreground leading-relaxed">{step.description}</p>
            )}
          </div>
        </Card>
      </div>
    </motion.div>
  );
}

function AiSuggestionsPanel({ planId, steps }: { planId: number; steps: RemediationStep[] }) {
  const [show, setShow] = useState(false);
  const [applied, setApplied] = useState(false);
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useGetAiRemediationSuggestions(planId, {
    query: {
      enabled: show,
      queryKey: ["getAiRemediationSuggestions", planId, show],
    },
  });

  const { mutate: applyOrdering, isPending: isApplying } = useUpdateRemediationPlanOrdering({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetRemediationPlanQueryKey() });
        setApplied(true);
      },
    },
  });

  const handleApply = () => {
    if (!data?.suggestions?.length) return;
    const sorted = [...data.suggestions].sort((a, b) => a.suggestedOrder - b.suggestedOrder);
    applyOrdering({ id: planId, data: { stepOrder: sorted.map((s) => s.stepId) } });
  };

  const handleKeep = () => {
    applyOrdering({ id: planId, data: { stepOrder: steps.map((s) => s.id) } });
    setShow(false);
  };

  const stepLookup = Object.fromEntries(steps.map((s) => [s.id, s.title]));

  return (
    <Card className="p-5 border-violet-200 bg-violet-50/30">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-violet-600" />
          <span className="text-sm font-semibold text-violet-900">AI Step Ordering Suggestions</span>
        </div>
        <button
          onClick={() => { setShow((v) => !v); setApplied(false); }}
          className="text-xs text-violet-700 font-medium hover:underline"
        >
          {show ? "Hide" : "Get suggestions"}
        </button>
      </div>

      {show && (
        <div className="mt-4 space-y-3">
          {isLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> Generating AI suggestions…
            </div>
          )}
          {isError && (
            <p className="text-xs text-destructive">Could not load AI suggestions. Please try again.</p>
          )}
          {!isLoading && !isError && data && (
            <>
              <p className="text-xs text-muted-foreground mb-1">Recommended order:</p>
              {[...data.suggestions]
                .sort((a, b) => a.suggestedOrder - b.suggestedOrder)
                .map((s) => (
                  <div key={s.stepId} className="flex gap-3 text-xs">
                    <span className="w-6 h-6 shrink-0 rounded-full bg-violet-200 text-violet-900 font-bold flex items-center justify-center">
                      {s.suggestedOrder}
                    </span>
                    <div>
                      <p className="font-medium text-foreground">{stepLookup[s.stepId] ?? `Step #${s.stepId}`}</p>
                      <p className="text-muted-foreground mt-0.5">{s.rationale}</p>
                    </div>
                  </div>
                ))}
              {data.overallRationale && (
                <p className="text-xs text-muted-foreground italic mt-2 border-t border-violet-100 pt-2">
                  {data.overallRationale}
                </p>
              )}
              <p className="text-[10px] text-amber-700 mt-2 border-t border-violet-100 pt-2">{data.disclaimer}</p>
              {applied ? (
                <div className="flex items-center gap-2 text-xs text-green-700 font-medium mt-2">
                  <CheckCircle2 className="w-4 h-4" /> AI ordering applied
                </div>
              ) : (
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={handleApply}
                    disabled={isApplying || !data.suggestions.length}
                    className="px-3 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-semibold hover:bg-violet-700 disabled:opacity-50 transition-colors flex items-center gap-1"
                  >
                    {isApplying ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                    Apply suggested order
                  </button>
                  <button
                    onClick={handleKeep}
                    disabled={isApplying}
                    className="px-3 py-1.5 rounded-lg border border-border text-xs font-medium hover:bg-muted/50 disabled:opacity-50 transition-colors"
                  >
                    Keep my order
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </Card>
  );
}

function ForwardEligibilityCard() {
  const { data, isLoading, isError } = useGetForwardEligibility();

  if (isLoading) {
    return (
      <Card className="p-5 border-primary/20 bg-primary/5">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Calculating forward eligibility…
        </div>
      </Card>
    );
  }

  if (isError || !data) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3, duration: 0.4 }}
    >
      <Card className="p-5 border-accent/20 bg-accent/5">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-9 h-9 rounded-xl bg-accent/10 flex items-center justify-center shrink-0">
            <Timer className="w-5 h-5 text-accent" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">Time to Eligibility Estimate</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Based on your remaining {data.incompleteStepCount} step{data.incompleteStepCount !== 1 ? "s" : ""}
            </p>
          </div>
        </div>

        <div className="rounded-xl bg-accent/10 p-4 mb-4 text-center">
          <p className="text-2xl font-display font-bold text-accent">{data.timeToEligibilityLabel}</p>
          <p className="text-xs text-muted-foreground mt-1">estimated to {data.regulator} eligibility</p>
        </div>

        {data.newlyUnlockedRoles.length > 0 ? (
          <div>
            <p className="text-xs font-semibold text-foreground mb-2 flex items-center gap-1.5">
              <Briefcase className="w-3.5 h-3.5 text-accent" />
              {data.newlyUnlockedRoles.length} role{data.newlyUnlockedRoles.length !== 1 ? "s" : ""} you'll qualify for next
            </p>
            <div className="space-y-2">
              {data.newlyUnlockedRoles.slice(0, 4).map((role) => (
                <div key={role.id} className="flex items-start gap-2 p-2.5 rounded-lg bg-background border border-border/60">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-foreground truncate">{role.title}</p>
                    <p className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5">
                      <Building2 className="w-3 h-3" />{role.employer}
                      <span className="mx-1">·</span>
                      <MapPin className="w-3 h-3" />{role.location}
                    </p>
                  </div>
                  {role.sponsorshipOffered && (
                    <span className="shrink-0 text-[10px] font-semibold text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded-full">
                      Sponsorship
                    </span>
                  )}
                </div>
              ))}
              {data.newlyUnlockedRoles.length > 4 && (
                <p className="text-xs text-muted-foreground pl-1">
                  + {data.newlyUnlockedRoles.length - 4} more roles
                </p>
              )}
            </div>
            <Link href="/opportunities" className="block mt-3">
              <Button variant="outline" size="sm" className="w-full text-xs gap-1">
                View all opportunities <ArrowRight className="w-3 h-3" />
              </Button>
            </Link>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Once you complete all remediation steps, you will qualify for all {data.regulator} roles in our database.
          </p>
        )}

        <p className="text-[10px] text-muted-foreground/60 mt-3 border-t border-border pt-2">
          {data.disclaimer}
        </p>
      </Card>
    </motion.div>
  );
}

export default function PathPage() {
  const [, setLocation] = useLocation();
  const { data: plan, isLoading, isError, error } = useGetRemediationPlan();

  const steps = plan?.steps ?? [];
  const doneCount = steps.filter((s) => s.status === "done").length;
  const inProgressCount = steps.filter((s) => s.status === "in_progress").length;
  const plannedCount = steps.length - doneCount - inProgressCount;
  const progressPct = steps.length > 0 ? Math.round((doneCount / steps.length) * 100) : 0;

  const errorMsg = error instanceof Error ? error.message : "Could not load your remediation plan.";
  const isEligible = errorMsg.toLowerCase().includes("eligible");

  return (
    <AppLayout>
      <PageTransition className="max-w-4xl mx-auto p-6 space-y-6">
        <DisclaimerBanner />

        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-display font-bold text-foreground">My Path</h1>
            <p className="text-muted-foreground mt-1 text-sm">
              Your structured action plan for achieving UK regulatory eligibility.
            </p>
          </div>
          <Link href="/interview-prep">
            <Button variant="outline" size="sm" className="gap-1.5 shrink-0">
              <Sparkles className="w-4 h-4" /> Interview Prep
            </Button>
          </Link>
        </div>

        {isLoading && (
          <Card className="p-8 text-center">
            <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-muted-foreground text-sm">Loading your remediation plan…</p>
          </Card>
        )}

        {isError && isEligible && (
          <Card className="p-8 text-center border-green-200 bg-green-50/40">
            <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto mb-3" />
            <h2 className="text-lg font-semibold text-foreground mb-2">You Are Eligible</h2>
            <p className="text-sm text-muted-foreground mb-5 max-w-sm mx-auto">
              You are already eligible for UK registration. No remediation plan is required — head to Opportunities to see matched roles.
            </p>
            <Button onClick={() => setLocation("/opportunities")}>
              View Opportunities <ArrowRight className="w-4 h-4 ml-1.5" />
            </Button>
          </Card>
        )}

        {isError && !isEligible && (
          <Card className="p-8 text-center border-destructive/20">
            <AlertCircle className="w-10 h-10 text-destructive mx-auto mb-3" />
            <h2 className="text-lg font-semibold text-foreground mb-1">No Plan Available</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Please complete your eligibility assessment first.
            </p>
            <Button variant="outline" onClick={() => setLocation("/eligibility")}>
              Go to Eligibility Check
            </Button>
          </Card>
        )}

        {!isLoading && !isError && plan && plan.reviewFlagged && !plan.reviewComplete && (
          <Card className="p-4 bg-amber-50 border-amber-300 flex items-start gap-3">
            <Clock className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-amber-900">Your assessment is under review</p>
              <p className="text-xs text-amber-800 mt-0.5">
                A qualified reviewer is checking your eligibility result. Your plan steps are visible below but final decisions rest with the relevant regulator.
              </p>
            </div>
          </Card>
        )}

        {!isLoading && !isError && plan && plan.reviewComplete && (
          <Card className="p-4 bg-green-50 border-green-300 flex items-start gap-3">
            <CheckCircle2 className="w-5 h-5 text-green-600 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-green-900">Your assessment has been reviewed</p>
              {plan.reviewNote && (
                <p className="text-xs text-green-700 mt-1 italic">Reviewer note: "{plan.reviewNote}"</p>
              )}
            </div>
          </Card>
        )}

        {!isLoading && !isError && plan && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-5">
              {/* Progress banner */}
              <Card className="p-5 bg-gradient-to-r from-primary/5 to-accent/5 border-primary/20">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-primary" />
                    <span className="font-semibold text-foreground text-sm">Overall Progress</span>
                  </div>
                  <span className="text-lg font-bold text-primary">{progressPct}%</span>
                </div>
                <div className="w-full h-2.5 bg-muted rounded-full overflow-hidden mb-3">
                  <motion.div
                    className="h-full bg-gradient-to-r from-primary to-accent rounded-full"
                    initial={{ width: 0 }}
                    animate={{ width: `${progressPct}%` }}
                    transition={{ duration: 0.8, ease: "easeOut" }}
                  />
                </div>
                <div className="flex gap-4 text-xs text-muted-foreground">
                  <span>
                    <span className="font-semibold text-emerald-600">{doneCount}</span> done
                  </span>
                  <span>
                    <span className="font-semibold text-blue-600">{inProgressCount}</span> in progress
                  </span>
                  <span>
                    <span className="font-semibold text-muted-foreground">{plannedCount}</span> planned
                  </span>
                </div>
              </Card>

              {/* AI suggestions */}
              {steps.length > 0 && <AiSuggestionsPanel planId={plan.id} steps={steps} />}

              {/* Gaps summary */}
              {steps.length > 0 && (
                <Card className="p-4 bg-amber-50 border-amber-200">
                  <h3 className="text-sm font-semibold text-amber-900 mb-2 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4" /> Identified Gaps
                  </h3>
                  <ul className="space-y-1.5">
                    {steps.map((step, i) => (
                      <li key={step.id} className="flex items-start gap-2 text-xs text-amber-800">
                        <span className="mt-0.5 w-4 h-4 rounded-full bg-amber-200 flex items-center justify-center text-amber-900 font-bold shrink-0 text-[10px]">
                          {i + 1}
                        </span>
                        {step.gap}
                      </li>
                    ))}
                  </ul>
                </Card>
              )}

              {/* Visual milestone timeline */}
              {steps.length > 0 && (
                <div>
                  <h2 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
                    <Circle className="w-4 h-4 text-primary" />
                    Milestone Timeline
                  </h2>
                  <div>
                    {steps.map((step, index) => (
                      <TimelineStep
                        key={step.id}
                        step={step}
                        index={index}
                        isLast={index === steps.length - 1}
                      />
                    ))}
                  </div>
                </div>
              )}

              <p className="text-xs text-muted-foreground text-center py-2">
                This plan was generated based on your eligibility assessment (decision #{plan.decisionRecordId}).
                Timeline and cost ranges are indicative only.
              </p>
            </div>

            {/* Right sidebar */}
            <div className="space-y-5">
              <ForwardEligibilityCard />

              <Card className="p-4">
                <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-violet-500" />
                  Interview Prep
                </h3>
                <p className="text-xs text-muted-foreground mb-3">
                  Get AI-generated NHS interview questions tailored to your profession and specialty.
                </p>
                <Link href="/interview-prep">
                  <Button variant="outline" size="sm" className="w-full text-xs gap-1">
                    Open Interview Prep <ArrowRight className="w-3 h-3" />
                  </Button>
                </Link>
              </Card>
            </div>
          </div>
        )}
      </PageTransition>
    </AppLayout>
  );
}
