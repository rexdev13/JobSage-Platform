import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, PageTransition, Button } from "@/components/ui-enhanced";
import {
  useGetRemediationPlan,
  useUpdateRemediationStep,
  useGetAiRemediationSuggestions,
  useUpdateRemediationPlanOrdering,
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
} from "lucide-react";
import { useLocation } from "wouter";
import type { RemediationStep } from "@workspace/api-client-react";
import { DisclaimerBanner } from "@/components/ui/DisclaimerBanner";

type StepStatus = "planned" | "in_progress" | "done";

function StatusBadge({ status }: { status: StepStatus }) {
  if (status === "done")
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-800">
        <CheckCircle2 className="w-3 h-3" /> Done
      </span>
    );
  if (status === "in_progress")
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-800">
        <Loader2 className="w-3 h-3 animate-spin" /> In Progress
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-muted text-muted-foreground">
      <Clock className="w-3 h-3" /> Planned
    </span>
  );
}

const STATUS_CYCLE: StepStatus[] = ["planned", "in_progress", "done"];

function getNextStatus(current: StepStatus): StepStatus {
  const idx = STATUS_CYCLE.indexOf(current);
  return STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length];
}

function StepCard({ step }: { step: RemediationStep }) {
  const [expanded, setExpanded] = useState(false);
  const queryClient = useQueryClient();
  const { mutate: updateStep, isPending } = useUpdateRemediationStep({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetRemediationPlanQueryKey() });
      },
    },
  });

  const handleToggleStatus = () => {
    const next = getNextStatus(step.status as StepStatus);
    updateStep({ id: step.id, data: { status: next } });
  };

  return (
    <Card
      className={`p-5 transition-all ${step.status === "done" ? "opacity-70" : ""} ${step.status === "in_progress" ? "border-blue-300 bg-blue-50/30" : ""}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
              Step {step.stepOrder + 1}
            </span>
            <StatusBadge status={step.status as StepStatus} />
          </div>
          <h3 className="text-base font-semibold text-foreground">{step.title}</h3>
          <p className="text-xs text-muted-foreground mt-0.5 italic">Gap: {step.gap}</p>
        </div>

        <button
          onClick={handleToggleStatus}
          disabled={isPending}
          className="shrink-0 px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-foreground hover:bg-muted/60 transition-colors disabled:opacity-50"
        >
          {isPending ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            `Mark ${getNextStatus(step.status as StepStatus).replace("_", " ")}`
          )}
        </button>
      </div>

      {step.pathway && (
        <p className="mt-2 text-xs text-primary/80 font-medium">
          Pathway: {step.pathway}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
        {step.timelineRange && (
          <span className="flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" />
            Timeline: <span className="font-medium text-foreground">{step.timelineRange}</span>
          </span>
        )}
        {step.costRange && (
          <span className="flex items-center gap-1">
            Cost estimate: <span className="font-medium text-foreground">{step.costRange}</span>
          </span>
        )}
        <span className="ml-auto text-muted-foreground/70">
          Ruleset v{step.rulesetVersion}
          {step.ruleId != null && ` · Rule #${step.ruleId}`}
          {step.stepSource === "sponsorship" && " · Visa Requirement"}
          {step.stepSource === "manual" && " · Manual Review"}
        </span>
      </div>

      <div className="mt-3">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          {expanded ? "Hide details" : "Show details"}
        </button>
        {expanded && (
          <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{step.description}</p>
        )}
      </div>
    </Card>
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
    const orderedIds = sorted.map((s) => s.stepId);
    applyOrdering({ id: planId, data: { stepOrder: orderedIds } });
  };

  const handleKeep = () => {
    const currentOrder = steps.map((s) => s.id);
    applyOrdering({ id: planId, data: { stepOrder: currentOrder } });
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
            <p className="text-xs text-destructive">
              Could not load AI suggestions. Please try again.
            </p>
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
                      <p className="font-medium text-foreground">
                        {stepLookup[s.stepId] ?? `Step #${s.stepId}`}
                      </p>
                      <p className="text-muted-foreground mt-0.5">{s.rationale}</p>
                    </div>
                  </div>
                ))}
              {data.overallRationale && (
                <p className="text-xs text-muted-foreground italic mt-2 border-t border-violet-100 pt-2">
                  {data.overallRationale}
                </p>
              )}
              <p className="text-[10px] text-amber-700 mt-2 border-t border-violet-100 pt-2">
                {data.disclaimer}
              </p>

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

export default function PathPage() {
  const [, setLocation] = useLocation();
  const { data: plan, isLoading, isError, error } = useGetRemediationPlan();

  const steps = plan?.steps ?? [];
  const doneCount = steps.filter((s) => s.status === "done").length;
  const inProgressCount = steps.filter((s) => s.status === "in_progress").length;
  const progressPct = steps.length > 0 ? Math.round((doneCount / steps.length) * 100) : 0;

  const errorMsg =
    error instanceof Error ? error.message : "Could not load your remediation plan.";
  const isEligible = errorMsg.toLowerCase().includes("eligible");

  return (
    <AppLayout>
      <PageTransition className="max-w-4xl mx-auto p-6 space-y-6">
        <DisclaimerBanner />
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground">My Path</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Your structured action plan for achieving UK regulatory eligibility.
          </p>
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

        {!isLoading && !isError && plan && plan.reviewFlagged && (
          <Card className="p-4 bg-amber-50 border-amber-300 flex items-start gap-3">
            <Clock className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-amber-900">Your assessment is under review</p>
              <p className="text-xs text-amber-800 mt-0.5">
                A qualified reviewer is checking your eligibility result. Your plan steps are visible below but final decisions rest with the relevant regulator. You will be notified once the review is complete.
              </p>
              {plan.reviewNote && (
                <p className="text-xs text-amber-700 mt-1 italic">"{plan.reviewNote}"</p>
              )}
            </div>
          </Card>
        )}

        {!isLoading && !isError && plan && (
          <>
            <Card className="p-5 bg-gradient-to-r from-primary/5 to-accent/5 border-primary/20">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-primary" />
                  <span className="font-semibold text-foreground text-sm">Overall Progress</span>
                </div>
                <span className="text-sm font-semibold text-primary">{progressPct}%</span>
              </div>
              <div className="w-full h-2.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-500"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <div className="mt-3 flex gap-4 text-xs text-muted-foreground">
                <span>
                  <span className="font-semibold text-green-600">{doneCount}</span> done
                </span>
                <span>
                  <span className="font-semibold text-blue-600">{inProgressCount}</span> in progress
                </span>
                <span>
                  <span className="font-semibold text-muted-foreground">
                    {steps.length - doneCount - inProgressCount}
                  </span>{" "}
                  planned
                </span>
              </div>
            </Card>

            {steps.length > 0 && <AiSuggestionsPanel planId={plan.id} steps={steps} />}

            {steps.length > 0 && (
              <Card className="p-4 bg-amber-50 border-amber-200">
                <h3 className="text-sm font-semibold text-amber-900 mb-2 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" /> Identified Gaps
                </h3>
                <ul className="space-y-1.5">
                  {steps.map((step) => (
                    <li key={step.id} className="flex items-start gap-2 text-xs text-amber-800">
                      <span className="mt-0.5 w-4 h-4 rounded-full bg-amber-200 flex items-center justify-center text-amber-900 font-bold shrink-0">
                        {step.stepOrder + 1}
                      </span>
                      {step.gap}
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            <div className="space-y-3">
              {steps
                .slice()
                .sort((a, b) => a.stepOrder - b.stepOrder)
                .map((step) => (
                  <StepCard key={step.id} step={step} />
                ))}
            </div>

            <p className="text-xs text-muted-foreground text-center py-2">
              This plan was generated based on your eligibility assessment (decision #{plan.decisionRecordId}).
              Timeline and cost ranges are indicative only. Consult the relevant regulator for authoritative guidance.
            </p>
          </>
        )}
      </PageTransition>
    </AppLayout>
  );
}
