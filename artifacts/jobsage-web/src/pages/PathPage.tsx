import { useState, useEffect, useRef } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, Button, PageTransition } from "@/components/ui-enhanced";
import {
  useGetJourneyStatus, getGetJourneyStatusQueryKey,
  useGetRemediationPlan, getGetRemediationPlanQueryKey,
  useGetForwardEligibility, getGetForwardEligibilityQueryKey,
} from "@workspace/api-client-react";
import type { JourneyStageItem, JourneyBadge, RemediationStep, ForwardEligibilityResponse } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  User, Files, ShieldCheck, Briefcase, ClipboardList,
  MessageSquare, Trophy, Globe, Home, TrendingUp,
  CheckCircle2, Lock, Circle, ChevronRight,
  Star, Send, UserCheck, X, ArrowRight, Sparkles,
  Loader2, AlertCircle, ListChecks, Clock, CalendarClock,
} from "lucide-react";
import { cn } from "@/components/ui-enhanced";
import confetti from "canvas-confetti";

const JOURNEY_STORAGE_KEY = "jobsage_journey_complete_v1";

const ICON_MAP: Record<string, React.ElementType> = {
  User, Files, ShieldCheck, Briefcase, ClipboardList,
  MessageSquare, Trophy, Globe, Home, TrendingUp,
  Star, Send, UserCheck,
};

function getIcon(name: string): React.ElementType {
  return ICON_MAP[name] ?? Circle;
}

function BadgeIcon({ iconName, size = 20 }: { iconName: string; size?: number }) {
  const Icon = getIcon(iconName);
  return <Icon style={{ width: size, height: size }} />;
}

function ReadinessRing({ score }: { score: number }) {
  const r = 52;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  const color = score >= 75 ? "#10b981" : score >= 50 ? "#3b82f6" : score >= 25 ? "#f59e0b" : "#6b7280";

  return (
    <div className="relative w-36 h-36">
      <svg width="144" height="144" className="-rotate-90">
        <circle cx="72" cy="72" r={r} strokeWidth="10" stroke="currentColor" className="text-muted/30" fill="none" />
        <motion.circle
          cx="72" cy="72" r={r} strokeWidth="10"
          stroke={color}
          fill="none"
          strokeDasharray={`${dash} ${circ}`}
          strokeLinecap="round"
          initial={{ strokeDasharray: `0 ${circ}` }}
          animate={{ strokeDasharray: `${dash} ${circ}` }}
          transition={{ duration: 1.2, ease: "easeOut" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <motion.span
          className="text-3xl font-display font-black"
          style={{ color }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
        >
          {score}
        </motion.span>
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Readiness</span>
      </div>
    </div>
  );
}

function StageNode({
  stage,
  isSelected,
  onClick,
}: {
  stage: JourneyStageItem;
  isSelected: boolean;
  onClick: () => void;
}) {
  const Icon = getIcon(stage.iconName);
  const isLocked = stage.locked;
  const isComplete = stage.status === "complete";
  const isInProgress = stage.status === "inProgress";

  const nodeStyle = isComplete
    ? "bg-emerald-500 border-emerald-400 text-white shadow-emerald-200 shadow-md"
    : isInProgress
      ? "bg-blue-500 border-blue-400 text-white shadow-blue-200 shadow-md"
      : isLocked
        ? "bg-muted/50 border-border text-muted-foreground/40"
        : "bg-background border-border text-muted-foreground hover:border-primary/40 hover:text-primary";

  const ringStyle = isSelected
    ? "ring-2 ring-primary ring-offset-2"
    : "";

  return (
    <motion.button
      onClick={!isLocked ? onClick : undefined}
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: stage.index * 0.06, duration: 0.35 }}
      className={cn(
        "relative flex flex-col items-center gap-2 p-1 rounded-xl transition-all",
        !isLocked && "cursor-pointer",
        isLocked && "cursor-default opacity-60",
      )}
    >
      <div className={cn(
        "w-14 h-14 rounded-2xl border-2 flex items-center justify-center transition-all",
        nodeStyle,
        ringStyle,
      )}>
        {isLocked ? (
          <Lock className="w-5 h-5" />
        ) : isComplete ? (
          <CheckCircle2 className="w-6 h-6" />
        ) : (
          <Icon className="w-6 h-6" />
        )}
        {isInProgress && !isComplete && (
          <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-blue-500 border-2 border-background animate-pulse" />
        )}
      </div>
      <span className={cn(
        "text-[11px] font-semibold text-center leading-tight max-w-[72px]",
        isComplete ? "text-emerald-700 dark:text-emerald-400"
          : isInProgress ? "text-blue-700 dark:text-blue-400"
            : isLocked ? "text-muted-foreground/50"
              : "text-foreground",
      )}>
        {stage.name}
      </span>
      {stage.completionPct > 0 && stage.completionPct < 100 && !isLocked && (
        <div className="w-14 h-1 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full bg-blue-500 rounded-full transition-all"
            style={{ width: `${stage.completionPct}%` }}
          />
        </div>
      )}
    </motion.button>
  );
}

function RemediationPlanInDrawer({ steps }: { steps: RemediationStep[] }) {
  if (steps.length === 0) return null;
  const done = steps.filter(s => s.status === "done").length;
  return (
    <div>
      <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
        <ListChecks className="w-4 h-4 text-primary" />
        Your Remediation Plan
        <span className="ml-auto text-xs text-muted-foreground">{done}/{steps.length} done</span>
      </h3>
      <div className="space-y-2">
        {steps.map((step, i) => (
          <div
            key={step.id}
            className={cn(
              "p-3 rounded-xl border text-sm transition-colors",
              step.status === "done"
                ? "bg-emerald-50/50 border-emerald-200/60 dark:bg-emerald-950/20 dark:border-emerald-800/40"
                : step.status === "in_progress"
                  ? "bg-blue-50/50 border-blue-200/60 dark:bg-blue-950/20 dark:border-blue-800/40"
                  : "bg-muted/30 border-border",
            )}
          >
            <div className="flex items-start gap-2">
              <div className={cn(
                "w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5 text-[10px] font-bold",
                step.status === "done" ? "bg-emerald-500 border-emerald-500 text-white"
                  : step.status === "in_progress" ? "bg-blue-500 border-blue-500 text-white"
                    : "border-muted-foreground/30 text-muted-foreground",
              )}>
                {step.status === "done" ? <CheckCircle2 className="w-3.5 h-3.5" /> : i + 1}
              </div>
              <div className="flex-1 min-w-0">
                <p className={cn("font-medium leading-tight", step.status === "done" && "line-through text-muted-foreground")}>{step.title}</p>
                {step.timelineRange && (
                  <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                    <Clock className="w-3 h-3" /> {step.timelineRange}
                  </p>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
      <Link href="/eligibility">
        <span className="mt-3 inline-flex items-center gap-1 text-xs text-primary font-medium hover:underline">
          View full eligibility assessment <ArrowRight className="w-3 h-3" />
        </span>
      </Link>
    </div>
  );
}

function ForwardEligibilityInDrawer({ data }: { data: ForwardEligibilityResponse }) {
  return (
    <div className="p-4 rounded-xl bg-blue-50/50 border border-blue-200/60 dark:bg-blue-950/20 dark:border-blue-800/40">
      <h3 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
        <CalendarClock className="w-4 h-4 text-blue-600" />
        Eligibility Timeline
      </h3>
      {data.timeToEligibilityMonths != null && (
        <p className="text-sm text-foreground">
          Estimated <span className="font-bold text-blue-700">{data.timeToEligibilityLabel}</span> to full eligibility
        </p>
      )}
      {data.newlyUnlockedRoles.length > 0 && (
        <p className="text-xs text-muted-foreground mt-1">
          Completing your plan could unlock {data.newlyUnlockedRoles.length} more matched role{data.newlyUnlockedRoles.length !== 1 ? "s" : ""}.
        </p>
      )}
    </div>
  );
}

function StageDrawer({
  stage,
  badge,
  onClose,
  planSteps,
  forwardEligibility,
}: {
  stage: JourneyStageItem;
  badge?: JourneyBadge;
  onClose: () => void;
  planSteps?: RemediationStep[];
  forwardEligibility?: ForwardEligibilityResponse | null;
}) {
  const Icon = getIcon(stage.iconName);
  const doneTasks = stage.subTasks.filter((t) => t.done).length;

  return (
    <motion.div
      initial={{ x: "100%", opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: "100%", opacity: 0 }}
      transition={{ type: "spring", stiffness: 320, damping: 32 }}
      className="fixed right-0 top-0 bottom-0 w-full max-w-md bg-background border-l border-border shadow-2xl z-50 flex flex-col"
    >
      {/* Header */}
      <div className={cn(
        "p-6 border-b border-border",
        stage.status === "complete" ? "bg-emerald-50/50 dark:bg-emerald-950/20"
          : stage.status === "inProgress" ? "bg-blue-50/50 dark:bg-blue-950/20"
            : stage.locked ? "bg-muted/30" : "bg-background",
      )}>
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className={cn(
              "w-12 h-12 rounded-2xl flex items-center justify-center",
              stage.status === "complete" ? "bg-emerald-500 text-white"
                : stage.status === "inProgress" ? "bg-blue-500 text-white"
                  : stage.locked ? "bg-muted text-muted-foreground"
                    : "bg-primary/10 text-primary",
            )}>
              {stage.locked ? <Lock className="w-6 h-6" /> : stage.status === "complete" ? <CheckCircle2 className="w-6 h-6" /> : <Icon className="w-6 h-6" />}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-foreground">{stage.name}</h2>
                {stage.status === "complete" && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800">
                    <CheckCircle2 className="w-3 h-3" /> Complete
                  </span>
                )}
                {stage.status === "inProgress" && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-blue-800">
                    In Progress
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">{stage.description}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
            <X className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>

        {/* Progress bar */}
        {!stage.locked && (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs text-muted-foreground">{doneTasks}/{stage.subTasks.length} tasks complete</span>
              <span className="text-xs font-bold text-foreground">{stage.completionPct}%</span>
            </div>
            <div className="w-full h-2 bg-muted/50 rounded-full overflow-hidden">
              <motion.div
                className={cn(
                  "h-full rounded-full",
                  stage.status === "complete" ? "bg-emerald-500"
                    : stage.status === "inProgress" ? "bg-blue-500"
                      : "bg-primary",
                )}
                initial={{ width: 0 }}
                animate={{ width: `${stage.completionPct}%` }}
                transition={{ duration: 0.6, delay: 0.2 }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        {stage.locked && stage.nextUnlockHint && (
          <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-50 border border-amber-200">
            <Lock className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-amber-900">Stage locked</p>
              <p className="text-xs text-amber-700 mt-0.5">{stage.nextUnlockHint}</p>
            </div>
          </div>
        )}

        {/* Sub-tasks checklist */}
        <div>
          <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-primary" />
            Checklist
          </h3>
          <div className="space-y-2">
            {stage.subTasks.map((task) => (
              <div
                key={task.id}
                className={cn(
                  "flex items-center gap-3 p-3 rounded-xl border transition-colors",
                  task.done
                    ? "bg-emerald-50/50 border-emerald-200/60 dark:bg-emerald-950/20 dark:border-emerald-800/40"
                    : "bg-muted/30 border-border",
                )}
              >
                <div className={cn(
                  "w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0",
                  task.done ? "bg-emerald-500 border-emerald-500" : "border-muted-foreground/30",
                )}>
                  {task.done && <CheckCircle2 className="w-3.5 h-3.5 text-white" />}
                </div>
                <span className={cn(
                  "text-sm flex-1",
                  task.done ? "line-through text-muted-foreground" : "text-foreground",
                )}>
                  {task.label}
                </span>
                {!task.done && task.href && (
                  <Link href={task.href}>
                    <span className="text-xs text-primary font-medium flex items-center gap-0.5 hover:underline">
                      Go <ChevronRight className="w-3 h-3" />
                    </span>
                  </Link>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Embedded remediation plan (eligibility stage) */}
        {planSteps && planSteps.length > 0 && !stage.locked && (
          <RemediationPlanInDrawer steps={planSteps} />
        )}

        {/* Forward eligibility timeline (eligibility stage) */}
        {forwardEligibility && !stage.locked && (
          <ForwardEligibilityInDrawer data={forwardEligibility} />
        )}

        {/* Badge earned */}
        {badge && (
          <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 dark:bg-amber-950/20 dark:border-amber-800/40">
            <h3 className="text-sm font-semibold text-amber-900 dark:text-amber-200 mb-2 flex items-center gap-2">
              <Star className="w-4 h-4" /> Badge
            </h3>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center">
                <BadgeIcon iconName={badge.iconName} size={20} />
              </div>
              <div>
                <p className="text-sm font-bold text-foreground">{badge.name}</p>
                <p className="text-xs text-muted-foreground">{badge.description}</p>
              </div>
            </div>
          </div>
        )}

        {/* What unlocks next */}
        {stage.nextUnlockHint && !stage.locked && (
          <div className="p-4 rounded-xl bg-primary/5 border border-primary/20">
            <h3 className="text-sm font-semibold text-foreground mb-1 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" /> Next
            </h3>
            <p className="text-xs text-muted-foreground">{stage.nextUnlockHint}</p>
          </div>
        )}
      </div>

      {/* CTA */}
      {!stage.locked && (
        <div className="p-5 border-t border-border">
          <Link href={stage.href}>
            <Button className="w-full gap-2">
              {stage.status === "complete" ? "View Section" : "Continue"} <ArrowRight className="w-4 h-4" />
            </Button>
          </Link>
        </div>
      )}
    </motion.div>
  );
}

function BadgeShelf({ badges }: { badges: JourneyBadge[] }) {
  if (badges.length === 0) return null;
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.7 }}
    >
      <Card className="p-5">
        <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
          <Star className="w-4 h-4 text-amber-500" />
          My Badges
          <span className="ml-1 inline-flex items-center justify-center px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800">
            {badges.length}
          </span>
        </h3>
        <div className="flex flex-wrap gap-3">
          {badges.map((badge) => (
            <motion.div
              key={badge.key}
              initial={badge.isNew ? { scale: 0 } : false}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 300, damping: 20 }}
              title={badge.description}
              className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-amber-50 border border-amber-200 hover:shadow-sm transition-all dark:bg-amber-950/20 dark:border-amber-800/40 min-w-[80px]"
            >
              <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center text-amber-700 dark:text-amber-400">
                <BadgeIcon iconName={badge.iconName} size={20} />
              </div>
              <span className="text-[10px] font-semibold text-amber-900 dark:text-amber-300 text-center leading-tight">
                {badge.name}
              </span>
            </motion.div>
          ))}
        </div>
      </Card>
    </motion.div>
  );
}

export default function PathPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const confettiFired = useRef(false);
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useGetJourneyStatus({
    query: { queryKey: getGetJourneyStatusQueryKey(), staleTime: 30_000 },
  });
  const { data: planData } = useGetRemediationPlan({
    query: { queryKey: getGetRemediationPlanQueryKey(), staleTime: 60_000 },
  });
  const { data: forwardElig } = useGetForwardEligibility({
    query: { queryKey: getGetForwardEligibilityQueryKey(), staleTime: 60_000 },
  });

  const stages = data?.stages ?? [];
  const badges = data?.badges ?? [];
  const readinessScore = data?.readinessScore ?? 0;
  const nextAction = data?.nextAction ?? null;
  const planSteps = planData?.steps ?? [];

  // Fire confetti when a stage newly completes (localStorage) OR a new badge is awarded (isNew)
  useEffect(() => {
    if (!data || confettiFired.current) return;
    const nowComplete = stages.filter(s => s.status === "complete").map(s => s.id);
    const nowCompleteSet = new Set(nowComplete);
    let prevComplete: Set<string>;
    try {
      const stored = localStorage.getItem(JOURNEY_STORAGE_KEY);
      prevComplete = stored ? new Set(JSON.parse(stored) as string[]) : new Set();
    } catch {
      prevComplete = new Set();
    }
    const newlyCompleteStages = nowComplete.filter(id => !prevComplete.has(id));
    const hasNewBadge = badges.some(b => b.isNew);
    if ((newlyCompleteStages.length > 0 && prevComplete.size > 0) || hasNewBadge) {
      void confetti({
        particleCount: 140,
        spread: 80,
        origin: { y: 0.45 },
        colors: ["#3b82f6", "#10b981", "#f59e0b", "#8b5cf6"],
      });
      confettiFired.current = true;
    }
    try {
      localStorage.setItem(JOURNEY_STORAGE_KEY, JSON.stringify([...nowCompleteSet]));
    } catch { /* ignore quota errors */ }
  }, [data]);

  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: getGetJourneyStatusQueryKey() });
  }, []);

  const selectedStage = selectedId ? stages.find((s) => s.id === selectedId) ?? null : null;
  const selectedBadge = selectedStage?.badgeKey
    ? badges.find((b) => b.key === selectedStage.badgeKey)
    : undefined;
  // Pass plan data only to eligibility-related stages
  const drawerPlanSteps = (selectedStage?.id === "eligibility" || selectedStage?.id === "career_growth")
    ? planSteps : undefined;
  const drawerForwardElig = selectedStage?.id === "eligibility" ? forwardElig : undefined;

  const completeCount = stages.filter((s) => s.status === "complete").length;
  const inProgressCount = stages.filter((s) => s.status === "inProgress").length;

  return (
    <AppLayout>
      <PageTransition className="max-w-5xl mx-auto p-6 space-y-6">
        {/* Header + Readiness Score */}
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6"
        >
          <div className="flex-1">
            <h1 className="text-2xl font-display font-bold text-foreground">My Journey</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Your staged UK healthcare career path — {completeCount} of {stages.length} stages complete
            </p>
            {nextAction && (
              <div className="mt-3 inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-primary/8 border border-primary/20">
                <Sparkles className="w-4 h-4 text-primary shrink-0" />
                <span className="text-sm text-foreground font-medium">Next: </span>
                <span className="text-sm text-muted-foreground">{nextAction}</span>
              </div>
            )}
          </div>
          <ReadinessRing score={readinessScore} />
        </motion.div>

        {/* Stats strip */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Complete", value: completeCount, color: "text-emerald-600" },
            { label: "In Progress", value: inProgressCount, color: "text-blue-600" },
            { label: "Badges", value: badges.length, color: "text-amber-600" },
          ].map((stat) => (
            <Card key={stat.label} className="p-4 text-center">
              <p className={cn("text-2xl font-display font-black", stat.color)}>{stat.value}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{stat.label}</p>
            </Card>
          ))}
        </div>

        {/* Loading / error */}
        {isLoading && (
          <Card className="p-12 flex flex-col items-center gap-3">
            <Loader2 className="w-10 h-10 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Loading your journey…</p>
          </Card>
        )}
        {isError && (
          <Card className="p-10 flex flex-col items-center gap-3 border-destructive/20">
            <AlertCircle className="w-10 h-10 text-destructive" />
            <p className="text-sm text-muted-foreground">Could not load journey. Please try again.</p>
          </Card>
        )}

        {/* Stage track */}
        {!isLoading && !isError && stages.length > 0 && (
          <Card className="p-6">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-6">
              Your 10-Stage Journey
            </h2>

            {/* 5 × 2 grid with connecting arrows */}
            <div className="grid grid-cols-5 gap-x-2 gap-y-6">
              {stages.map((stage, i) => {
                const isEvenRow = Math.floor(i / 5) % 2 === 0;
                const posInRow = isEvenRow ? i % 5 : 4 - (i % 5);
                const isLast = i === stages.length - 1;
                const isRowEnd = (i + 1) % 5 === 0;

                return (
                  <div key={stage.id} className="relative flex flex-col items-center" style={{ order: Math.floor(i / 5) * 5 + posInRow }}>
                    <StageNode
                      stage={stage}
                      isSelected={selectedId === stage.id}
                      onClick={() => setSelectedId(selectedId === stage.id ? null : stage.id)}
                    />
                    {/* Connector line */}
                    {!isLast && !isRowEnd && (
                      <div className="absolute right-0 top-7 w-1/2 h-0.5 bg-border translate-x-full" />
                    )}
                  </div>
                );
              })}
            </div>

            {/* Legend */}
            <div className="flex flex-wrap gap-4 mt-6 pt-4 border-t border-border">
              {[
                { color: "bg-emerald-500", label: "Complete" },
                { color: "bg-blue-500", label: "In Progress" },
                { color: "bg-primary/10 border border-border", label: "Not Started" },
                { color: "bg-muted/50 border border-border", label: "Locked" },
              ].map((item) => (
                <span key={item.label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className={cn("w-3 h-3 rounded-full", item.color)} />
                  {item.label}
                </span>
              ))}
            </div>
          </Card>
        )}

        {/* Badges shelf */}
        <BadgeShelf badges={badges} />

        {/* Quick links to existing tools */}
        {!isLoading && !isError && (
          <Card className="p-5">
            <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <ChevronRight className="w-4 h-4 text-primary" />
              Journey Tools
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: "Eligibility Check", href: "/eligibility", icon: ShieldCheck },
                { label: "Interview Prep", href: "/interview-prep", icon: MessageSquare },
                { label: "Opportunities", href: "/opportunities", icon: Briefcase },
                { label: "Progress Report", href: "/my-report", icon: TrendingUp },
              ].map((tool) => (
                <Link key={tool.href} href={tool.href}>
                  <div className="flex items-center gap-2 p-3 rounded-xl border border-border bg-muted/30 hover:bg-primary/5 hover:border-primary/30 transition-all cursor-pointer group">
                    <tool.icon className="w-4 h-4 text-muted-foreground group-hover:text-primary shrink-0 transition-colors" />
                    <span className="text-xs font-medium text-muted-foreground group-hover:text-foreground transition-colors leading-tight">
                      {tool.label}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </Card>
        )}
      </PageTransition>

      {/* Stage detail drawer */}
      <AnimatePresence>
        {selectedStage && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40"
              onClick={() => setSelectedId(null)}
            />
            <StageDrawer
              stage={selectedStage}
              badge={selectedBadge}
              onClose={() => setSelectedId(null)}
              planSteps={drawerPlanSteps}
              forwardEligibility={drawerForwardElig}
            />
          </>
        )}
      </AnimatePresence>
    </AppLayout>
  );
}
