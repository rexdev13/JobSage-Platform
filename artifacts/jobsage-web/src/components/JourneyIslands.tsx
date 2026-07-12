import { motion } from "framer-motion";
import { Link } from "wouter";
import { CheckCircle2, ArrowRight, Lock } from "lucide-react";
import { Button } from "@/components/ui-enhanced";
import { cn } from "@/components/ui-enhanced";
import type { IslandState } from "@/lib/journeySteps";

interface JourneyIslandsProps {
  islands: IslandState[];
  activeStep: number;
  compact?: boolean;
}

function TrophySvg({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" fill="none" className={className} aria-hidden>
      <rect x="14" y="28" width="12" height="4" rx="2" fill="currentColor" opacity="0.7" />
      <rect x="11" y="32" width="18" height="3" rx="1.5" fill="currentColor" opacity="0.5" />
      <path d="M10 8h20v12a10 10 0 01-20 0V8z" fill="currentColor" opacity="0.9" />
      <path d="M10 12H6a4 4 0 004 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M30 12h4a4 4 0 01-4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="20" cy="15" r="3" fill="white" opacity="0.4" />
    </svg>
  );
}

function IslandNode({
  island,
  index,
  compact,
}: {
  island: IslandState;
  index: number;
  compact: boolean;
}) {
  const { step, status } = island;
  const isComplete = status === "complete";
  const isActive = status === "active";
  const isLocked = status === "locked";
  const isDream = step.id === "dream";

  const nodeSize = compact ? "w-12 h-12" : "w-16 h-16";

  const nodeBg = isDream && !isLocked
    ? "bg-gradient-to-br from-amber-400 to-orange-500 border-amber-300 text-white shadow-amber-200/60"
    : isComplete
      ? "bg-emerald-500 border-emerald-400 text-white shadow-emerald-200/50"
      : isActive
        ? "bg-primary border-primary text-primary-foreground shadow-primary/20"
        : "bg-muted/40 border-border/60 text-muted-foreground/30";

  const labelColor = isDream && !isLocked
    ? "text-amber-700 dark:text-amber-400 font-bold"
    : isComplete
      ? "text-emerald-700 dark:text-emerald-400"
      : isActive
        ? "text-primary font-semibold"
        : "text-muted-foreground/40";

  const content = (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.07, duration: 0.35 }}
      className={cn("flex flex-col items-center gap-1.5", !isLocked && "group cursor-pointer")}
    >
      <div
        className={cn(
          "relative rounded-2xl border-2 flex items-center justify-center transition-all z-10 shadow-lg",
          nodeSize,
          nodeBg,
          !isLocked && "group-hover:scale-105 group-hover:shadow-xl",
          isLocked && "opacity-40",
        )}
      >
        {isLocked ? (
          <Lock className="w-4 h-4" />
        ) : isComplete ? (
          <CheckCircle2 className={compact ? "w-5 h-5" : "w-6 h-6"} />
        ) : isDream ? (
          <TrophySvg className={compact ? "w-6 h-6" : "w-8 h-8"} />
        ) : (
          <span className={cn("font-display font-black", compact ? "text-base" : "text-xl")}>{step.number}</span>
        )}

        {isActive && !isDream && (
          <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-primary border-2 border-background animate-pulse" />
        )}
      </div>

      <span
        className={cn(
          "text-center leading-tight font-medium",
          compact ? "text-[9px] max-w-[48px]" : "text-[10px] sm:text-xs max-w-[60px]",
          labelColor,
        )}
      >
        {step.shortName}
      </span>
    </motion.div>
  );

  if (isLocked) return <div key={step.id}>{content}</div>;
  return (
    <Link key={step.id} href={step.route}>
      {content}
    </Link>
  );
}

function Connector({ fromStatus, toStatus, compact }: { fromStatus: string; toStatus: string; compact: boolean }) {
  const filled = fromStatus === "complete";
  return (
    <div className={cn("flex-1 flex items-center justify-center", compact ? "mt-[-16px]" : "mt-[-22px]")}>
      <div className={cn(
        "w-full border-t-2 transition-all",
        filled ? "border-emerald-400" : "border-dashed border-border/60",
      )} />
    </div>
  );
}

export function JourneyIslands({ islands, activeStep, compact = false }: JourneyIslandsProps) {
  const completedCount = islands.filter((i) => i.status === "complete").length;
  const activeIsland = islands.find((i) => i.status === "active");

  return (
    <div className="w-full">
      {/* Step N of N summary */}
      {!compact && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.05 }}
          className="flex items-center justify-between mb-3"
        >
          <div>
            <p className="text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">Step {activeStep} of {islands.length}</span>
              {" — "}
              {activeIsland?.step.name ?? "Journey complete"}
            </p>
          </div>
          <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
            {[
              { label: "Done", cls: "bg-emerald-500" },
              { label: "Active", cls: "bg-primary" },
              { label: "Ahead", cls: "bg-border" },
            ].map(({ label, cls }) => (
              <span key={label} className="flex items-center gap-1">
                <span className={cn("w-2 h-2 rounded-full", cls)} />
                {label}
              </span>
            ))}
          </div>
        </motion.div>
      )}

      {/* Progress bar */}
      {!compact && (
        <div className="h-1.5 rounded-full bg-muted mb-5 overflow-hidden">
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-primary"
            initial={{ width: 0 }}
            animate={{ width: `${(completedCount / (islands.length - 1)) * 100}%` }}
            transition={{ duration: 0.9, delay: 0.2, ease: "easeOut" }}
          />
        </div>
      )}

      {/* Island row */}
      <div className="relative flex items-start">
        {islands.map((island, i) => (
          <div key={island.step.id} className="flex items-start flex-1 min-w-0">
            <div className="flex flex-col items-center flex-1 min-w-0">
              <IslandNode island={island} index={i} compact={compact} />
            </div>
            {i < islands.length - 1 && (
              <Connector
                fromStatus={island.status}
                toStatus={islands[i + 1].status}
                compact={compact}
              />
            )}
          </div>
        ))}
      </div>

      {/* Active step CTA */}
      {!compact && activeIsland && activeIsland.step.id !== "dream" && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.45 }}
          className="mt-5 flex items-center gap-3 p-4 rounded-xl bg-primary/5 border border-primary/15"
        >
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground">{activeIsland.step.name}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{activeIsland.step.description}</p>
          </div>
          <Link href={activeIsland.step.route}>
            <Button size="sm" className="shrink-0 gap-1.5 text-xs">
              {activeIsland.step.ctaLabel} <ArrowRight className="w-3 h-3" />
            </Button>
          </Link>
        </motion.div>
      )}

      {/* Dream job reached state */}
      {!compact && activeIsland?.step.id === "dream" && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.45 }}
          className="mt-5 flex items-center gap-3 p-4 rounded-xl bg-amber-50/80 dark:bg-amber-950/20 border border-amber-200/60"
        >
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-amber-800 dark:text-amber-300">You're on track for your dream role 🏆</p>
            <p className="text-xs text-amber-700/80 dark:text-amber-400/80 mt-0.5">
              Keep your profile growing — JOBSAGE supports your career long after you land the role.
            </p>
          </div>
          <Link href="/opportunities">
            <Button size="sm" variant="outline" className="shrink-0 gap-1.5 text-xs border-amber-300 text-amber-700 hover:bg-amber-50">
              Browse roles <ArrowRight className="w-3 h-3" />
            </Button>
          </Link>
        </motion.div>
      )}
    </div>
  );
}
