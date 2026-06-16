import { useState } from "react";
import { useAuth } from "@workspace/auth-web";
import {
  useGetMyProfile,
  useListEligibilityHistory,
  useListMyDocuments,
  useListMatchedRoles,
  useGetRemediationPlan,
  useListMyApplications,
  useGetForwardEligibility,
  useToggleProfileBoost,
  getGetMyProfileQueryKey,
  useGetJourneyStatus,
  getGetJourneyStatusQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, Button, PageTransition } from "@/components/ui-enhanced";
import {
  Activity,
  FileText,
  ArrowRight,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  MapPin,
  CheckCircle2,
  Circle,
  Files,
  TrendingUp,
  User,
  BadgeCheck,
  ClipboardList,
  Sparkles,
  Loader2,
  Timer,
  Megaphone,
  BarChart2,
  BookOpen,
} from "lucide-react";
import { Link } from "wouter";
import { motion } from "framer-motion";

type EligibilityOutcome = "eligible" | "not_eligible" | "ineligible";

function LiveJourneyWidget() {
  const { data } = useGetJourneyStatus({
    query: { queryKey: getGetJourneyStatusQueryKey(), staleTime: 30_000 },
  });
  const stages = data?.stages ?? [];
  const completeCount = stages.filter((s) => s.status === "complete").length;

  if (stages.length === 0) return null;

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.18, duration: 0.4 }}>
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
              <TrendingUp className="w-3.5 h-3.5" />
            </span>
            Your Journey
          </h2>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">{completeCount}/{stages.length} stages complete</span>
            <Link href="/path">
              <span className="text-xs text-primary font-medium hover:underline flex items-center gap-0.5">
                View all <ArrowRight className="w-3 h-3" />
              </span>
            </Link>
          </div>
        </div>

        {/* Progress bar */}
        <div className="h-1.5 rounded-full bg-muted mb-3 overflow-hidden">
          <motion.div
            className="h-full rounded-full bg-primary"
            initial={{ width: 0 }}
            animate={{ width: `${(completeCount / stages.length) * 100}%` }}
            transition={{ duration: 0.7, delay: 0.3, ease: "easeOut" }}
          />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 lg:grid-cols-10 gap-2">
          {stages.map((stage) => {
            const isComplete = stage.status === "complete";
            const isInProgress = stage.status === "inProgress";
            const isLocked = stage.locked;
            const tileClass = isComplete
              ? "bg-emerald-50 border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-800/40"
              : isInProgress
                ? "bg-blue-50 border-blue-200 dark:bg-blue-950/20 dark:border-blue-800/40"
                : isLocked
                  ? "bg-muted/40 border-border opacity-50"
                  : "bg-muted/20 border-border";
            const dotClass = isComplete ? "bg-emerald-500"
              : isInProgress ? "bg-blue-500"
                : isLocked ? "bg-muted-foreground/20"
                  : "bg-amber-400";
            const textClass = isComplete ? "text-emerald-700 dark:text-emerald-400"
              : isInProgress ? "text-blue-700 dark:text-blue-400"
                : isLocked ? "text-muted-foreground/50"
                  : "text-amber-700 dark:text-amber-400";

            const tile = (
              <div
                key={stage.id}
                className={`relative rounded-xl border p-2.5 flex flex-col items-center text-center gap-1 transition-all ${tileClass} ${!isLocked ? "cursor-pointer hover:shadow-sm hover:scale-[1.02]" : "cursor-default"}`}
              >
                <div className={`w-2 h-2 rounded-full ${dotClass}`} />
                <span className={`text-[10px] font-semibold leading-tight ${textClass}`}>{stage.name}</span>
                {isLocked && <span className="text-[9px] text-muted-foreground/50">🔒</span>}
                {isComplete && <CheckCircle2 className="w-2.5 h-2.5 text-emerald-500 absolute top-1.5 right-1.5" />}
              </div>
            );
            return isLocked ? <div key={stage.id}>{tile}</div> : (
              <Link key={stage.id} href="/path">{tile}</Link>
            );
          })}
        </div>

        <div className="flex items-center gap-4 mt-2 pl-1">
          {[
            { label: "Complete", dot: "bg-emerald-500" },
            { label: "In progress", dot: "bg-blue-500" },
            { label: "Not started", dot: "bg-amber-400" },
            { label: "Locked", dot: "bg-muted-foreground/20" },
          ].map(({ label, dot }) => (
            <span key={label} className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
              {label}
            </span>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

function StageAttentionStrip() {
  const { data } = useGetJourneyStatus({
    query: { queryKey: getGetJourneyStatusQueryKey(), staleTime: 30_000 },
  });
  const stages = data?.stages ?? [];
  const needsAttention = stages.filter(
    (s) => !s.locked && s.status !== "complete" && (s.status === "inProgress" || s.status === "notStarted"),
  ).slice(0, 3);

  if (needsAttention.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1, duration: 0.35 }}
      className="mb-5"
    >
      <div className="rounded-xl border border-blue-200 bg-blue-50/70 dark:bg-blue-950/20 dark:border-blue-800/40 p-3.5">
        <div className="flex items-center gap-2 mb-2.5">
          <Sparkles className="w-4 h-4 text-blue-600 shrink-0" />
          <p className="text-sm font-semibold text-blue-900 dark:text-blue-200">
            {needsAttention.length} stage{needsAttention.length !== 1 ? "s" : ""} need{needsAttention.length === 1 ? "s" : ""} your attention
          </p>
          <Link href="/path" className="ml-auto">
            <span className="text-xs text-blue-600 font-medium hover:underline flex items-center gap-0.5">
              Go to journey <ArrowRight className="w-3 h-3" />
            </span>
          </Link>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          {needsAttention.map((stage) => (
            <Link key={stage.id} href={stage.href ?? "/path"} className="flex-1">
              <div className="flex items-center gap-2 rounded-lg bg-white/70 dark:bg-white/5 border border-blue-100 dark:border-blue-800/30 px-3 py-2 hover:bg-white dark:hover:bg-white/10 transition-colors">
                <Circle className="w-3 h-3 text-blue-400 shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-foreground truncate">{stage.name}</p>
                  <p className="text-[10px] text-muted-foreground truncate">
                    {stage.status === "inProgress" ? `${stage.completionPct}% complete` : "Not started"}
                  </p>
                </div>
                <ArrowRight className="w-3 h-3 text-blue-400 shrink-0 ml-auto" />
              </div>
            </Link>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

function OutcomePill({ outcome, reviewFlagged }: { outcome: EligibilityOutcome; reviewFlagged?: boolean }) {
  if (reviewFlagged && outcome === "not_eligible") {
    return (
      <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-purple-500/20 text-purple-100">
        Pending Review
      </span>
    );
  }
  const configs: Record<EligibilityOutcome, { label: string; className: string }> = {
    eligible: { label: "Eligible Now", className: "bg-emerald-500/20 text-emerald-100" },
    not_eligible: { label: "Not Yet Eligible", className: "bg-amber-500/20 text-amber-100" },
    ineligible: { label: "Ineligible", className: "bg-red-500/20 text-red-100" },
  };
  const { label, className } = configs[outcome] ?? configs.not_eligible;
  return (
    <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${className}`}>
      {label}
    </span>
  );
}

function JourneyReadinessCard({ delay }: { delay: number }) {
  const { data } = useGetJourneyStatus({
    query: { queryKey: getGetJourneyStatusQueryKey(), staleTime: 60_000 },
  });
  const score = data?.readinessScore ?? null;
  const nextAction = data?.nextAction ?? null;
  const color = score === null ? "text-muted-foreground"
    : score >= 75 ? "text-emerald-600"
    : score >= 50 ? "text-blue-600"
    : score >= 25 ? "text-amber-600"
    : "text-muted-foreground";

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.4 }}
    >
      <Link href="/path">
        <Card className="p-5 flex items-center gap-4 hover:shadow-md hover:border-primary/20 transition-all cursor-pointer group">
          <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 group-hover:bg-primary/15 transition-colors">
            <TrendingUp className="w-5 h-5 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground font-medium">Journey Readiness</p>
            <p className={`text-2xl font-display font-bold leading-tight ${color}`}>
              {score !== null ? `${score}%` : "—"}
            </p>
            {nextAction && <p className="text-xs text-muted-foreground truncate">{nextAction}</p>}
            {score === null && <p className="text-xs text-muted-foreground">View your career journey</p>}
          </div>
          <ArrowRight className="w-4 h-4 text-muted-foreground/40 ml-auto shrink-0 group-hover:text-primary/60 group-hover:translate-x-0.5 transition-all" />
        </Card>
      </Link>
    </motion.div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  href,
  delay,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  sub?: string;
  href: string;
  delay: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.4 }}
    >
      <Link href={href}>
        <Card className="p-5 flex items-center gap-4 hover:shadow-md hover:border-primary/20 transition-all cursor-pointer group">
          <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 group-hover:bg-primary/15 transition-colors">
            <Icon className="w-5 h-5 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground font-medium">{label}</p>
            <p className="text-2xl font-display font-bold text-foreground leading-tight">{value}</p>
            {sub && <p className="text-xs text-muted-foreground truncate">{sub}</p>}
          </div>
          <ArrowRight className="w-4 h-4 text-muted-foreground/40 ml-auto shrink-0 group-hover:text-primary/60 group-hover:translate-x-0.5 transition-all" />
        </Card>
      </Link>
    </motion.div>
  );
}

function ProfileCompletionRing({ pct }: { pct: number }) {
  const r = 22;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  return (
    <svg width="60" height="60" className="-rotate-90">
      <circle cx="30" cy="30" r={r} strokeWidth="5" stroke="currentColor" className="text-primary/10" fill="none" />
      <circle
        cx="30"
        cy="30"
        r={r}
        strokeWidth="5"
        stroke="currentColor"
        className="text-primary transition-all duration-700"
        fill="none"
        strokeDasharray={`${dash} ${circ}`}
        strokeLinecap="round"
      />
    </svg>
  );
}

function profileCompletionPct(profile: Record<string, unknown> | undefined): number {
  if (!profile) return 0;
  if (typeof profile.completionPct === "number") return profile.completionPct;
  const fields = [
    "profession",
    "specialty",
    "qualificationCountry",
    "qualificationType",
    "qualificationYear",
    "experienceYears",
    "registrationStatus",
    "residencyStatus",
    "preferredRegion",
    "preferredStartDate",
    "profilePhotoKey",
    "languages",
    "additionalNotes",
  ];
  const filled = fields.filter((f) => profile[f] != null && profile[f] !== "").length;
  return Math.round((filled / fields.length) * 100);
}

export default function DashboardPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data: profile } = useGetMyProfile();
  const { data: eligibilityHistory } = useListEligibilityHistory();
  const { data: documents } = useListMyDocuments();
  const { data: matchedRoles } = useListMatchedRoles();
  const { data: plan } = useGetRemediationPlan();
  const { data: applicationsData } = useListMyApplications();
  const { data: forwardEligibility } = useGetForwardEligibility();
  const toggleBoostMutation = useToggleProfileBoost();

  const latestDecision = eligibilityHistory?.decisions?.[0];
  const [showReasonCodes, setShowReasonCodes] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const showSetupBanner = !profile?.profession && !bannerDismissed;

  const docCount = documents?.documents?.length ?? 0;
  const allRoles = matchedRoles?.roles ?? [];
  const eligibleRolesCount = allRoles.filter((r) => r.isEligible).length;
  const notYetEligibleCount = allRoles.filter((r) => !r.isEligible).length;

  const appStats = applicationsData?.stats;
  const totalApplied = appStats?.total ?? 0;

  const planSteps = plan?.steps ?? [];
  const doneSteps = planSteps.filter((s) => s.status === "done").length;
  const totalSteps = planSteps.length;
  const planPct = totalSteps > 0 ? Math.round((doneSteps / totalSteps) * 100) : 0;
  const nextStep = planSteps.find((s) => s.status !== "done");

  const profilePct = profileCompletionPct(profile as Record<string, unknown> | undefined);

  const boostProfile = profile?.boostProfile ?? false;

  function handleBoostToggle() {
    toggleBoostMutation.mutate(
      { data: { boost: !boostProfile } },
      {
        onSuccess: () => {
          void queryClient.invalidateQueries({ queryKey: getGetMyProfileQueryKey() });
        },
      },
    );
  }

  const professionLabel = profile?.profession
    ? profile.profession.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())
    : null;

  const interviews = appStats?.interviews ?? 0;
  const offers = appStats?.offers ?? 0;


  return (
    <AppLayout>
      <PageTransition>
        {/* No-profile setup banner */}
        {showSetupBanner && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4"
          >
            <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-amber-800">Complete your profile to get started</p>
              <p className="text-xs text-amber-700 mt-0.5">
                Your eligibility check, matched roles, and remediation plan all need your professional details first.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Link href="/onboarding">
                <Button size="sm" className="text-xs h-8">
                  Set up profile <ArrowRight className="w-3 h-3 ml-1" />
                </Button>
              </Link>
              <button
                onClick={() => setBannerDismissed(true)}
                className="text-amber-500 hover:text-amber-700 transition-colors p-1"
                aria-label="Dismiss"
              >
                ×
              </button>
            </div>
          </motion.div>
        )}

        {/* Header */}
        <header className="mb-8 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-display font-bold text-foreground">
              Welcome back, {user?.firstName || "Candidate"}
            </h1>
            <div className="flex items-center gap-2 mt-2">
              {professionLabel && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-primary/10 text-primary">
                  <User className="w-3 h-3" />
                  {professionLabel}
                </span>
              )}
              <p className="text-muted-foreground text-sm">Your professional intelligence overview.</p>
            </div>
          </div>
        </header>

        {/* Quick stats row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatCard
            icon={Files}
            label="Documents"
            value={docCount}
            sub={docCount === 1 ? "1 file uploaded" : `${docCount} files uploaded`}
            href="/documents"
            delay={0.05}
          />
          <StatCard
            icon={BadgeCheck}
            label="Eligible Roles"
            value={eligibleRolesCount}
            sub={notYetEligibleCount > 0 ? `${notYetEligibleCount} more to work towards` : allRoles.length > 0 ? "All matched roles eligible" : "Run eligibility check"}
            href="/opportunities"
            delay={0.1}
          />
          <StatCard
            icon={ClipboardList}
            label="Applications"
            value={totalApplied}
            sub={appStats && totalApplied > 0 ? `${appStats.interviews} interviews · ${appStats.offers} offers · ${appStats.noResponse} no response` : "Track your applications"}
            href="/opportunities"
            delay={0.13}
          />
          <JourneyReadinessCard delay={0.15} />
        </div>

        {/* Stage attention strip — surfaces in-progress/not-started stages */}
        <StageAttentionStrip />

        {/* 10-stage live journey widget */}
        <LiveJourneyWidget />

        {/* Main grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          {/* Eligibility card — spans 2 cols */}
          <Card className="lg:col-span-2 p-8 bg-gradient-to-br from-primary to-primary/90 text-primary-foreground border-0">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                {latestDecision ? (
                  <>
                    <div className="mb-4">
                      <OutcomePill
                        outcome={latestDecision.outcome as EligibilityOutcome}
                        reviewFlagged={latestDecision.reviewFlagged}
                      />
                    </div>

                    <h2 className="text-2xl font-bold mb-3">Your Eligibility Status</h2>

                    <p className="text-primary-foreground/80 mb-4 max-w-md leading-relaxed">
                      {latestDecision.explanationText}
                    </p>

                    {latestDecision.reviewFlagged && latestDecision.reviewNote && (
                      <div className="flex items-start gap-2 p-3 rounded-xl bg-white/10 backdrop-blur-sm mb-4">
                        <AlertTriangle className="w-4 h-4 text-amber-300 flex-shrink-0 mt-0.5" />
                        <p className="text-xs text-primary-foreground/90 leading-relaxed">
                          {latestDecision.reviewNote}
                        </p>
                      </div>
                    )}

                    {latestDecision.pathways && latestDecision.pathways.length > 0 && (
                      <div className="mb-4">
                        <p className="text-xs font-semibold text-primary-foreground/70 uppercase tracking-wide mb-2">
                          Possible Pathways
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {latestDecision.pathways.map((p: string) => (
                            <span
                              key={p}
                              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/15 text-xs text-primary-foreground/90"
                            >
                              <MapPin className="w-3 h-3" />
                              {p}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {latestDecision.reasonCodes && latestDecision.reasonCodes.length > 0 && (
                      <div className="mb-4">
                        <button
                          onClick={() => setShowReasonCodes((v) => !v)}
                          className="flex items-center gap-1.5 text-xs text-primary-foreground/60 hover:text-primary-foreground/80 transition-colors"
                        >
                          {showReasonCodes ? (
                            <ChevronUp className="w-3 h-3" />
                          ) : (
                            <ChevronDown className="w-3 h-3" />
                          )}
                          {showReasonCodes ? "Hide" : "Show"} reason codes
                        </button>
                        {showReasonCodes && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {latestDecision.reasonCodes.map((code: string) => (
                              <code
                                key={code}
                                className="px-2 py-0.5 text-xs bg-white/10 rounded font-mono text-primary-foreground/70"
                              >
                                {code}
                              </code>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    <p className="text-primary-foreground/50 text-xs mb-6">
                      Last checked:{" "}
                      {new Date(latestDecision.createdAt).toLocaleDateString("en-GB", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}{" "}
                      · Ruleset v{latestDecision.rulesetVersion}
                    </p>

                    <p className="text-primary-foreground/40 text-xs mb-6 max-w-sm leading-relaxed">
                      This assessment is for guidance only and does not constitute professional legal or medical regulatory advice. Always verify directly with GMC, NMC, or HCPC.
                    </p>
                  </>
                ) : (
                  <>
                    <div className="inline-flex items-center px-3 py-1 rounded-full bg-white/20 text-white text-xs font-semibold mb-4 backdrop-blur-md">
                      <Activity className="w-3 h-3 mr-2" />
                      Action Required
                    </div>
                    <h2 className="text-2xl font-bold mb-3">Eligibility Evaluation</h2>
                    <p className="text-primary-foreground/80 mb-8 max-w-md leading-relaxed">
                      Run your profile against the latest regulatory criteria to determine your eligibility status and get a personalised remediation plan.
                    </p>
                  </>
                )}
                <Link href="/eligibility" className="inline-flex">
                  <Button variant="accent" size="lg" className="shadow-lg shadow-accent/20">
                    {latestDecision ? "View Full Report" : "Run Check Now"}{" "}
                    <ArrowRight className="w-5 h-5 ml-2" />
                  </Button>
                </Link>
              </div>
              <ShieldCheck className="w-32 h-32 text-white/10 hidden md:block flex-shrink-0" />
            </div>
          </Card>

          {/* Profile card */}
          <Card className="p-6 flex flex-col">
            <h3 className="text-lg font-semibold mb-5 flex items-center">
              <span className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center mr-3">
                <FileText className="w-4 h-4" />
              </span>
              Profile
            </h3>

            {/* Completion ring */}
            <div className="flex items-center gap-4 mb-5 p-4 rounded-xl bg-muted/50">
              <div className="relative shrink-0">
                <ProfileCompletionRing pct={profilePct} />
                <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-primary">
                  {profilePct}%
                </span>
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">
                  {profilePct === 100 ? "Profile complete" : "Profile incomplete"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {profilePct === 100
                    ? "All fields filled in"
                    : "Complete your profile for accurate results"}
                </p>
              </div>
            </div>

            <div className="space-y-3 flex-1">
              {[
                { label: "Profession", val: profile?.profession?.replace(/_/g, " ") },
                { label: "Registration", val: profile?.registrationStatus?.replace(/_/g, " ") },
                {
                  label: "Experience",
                  val: profile?.experienceYears != null ? `${profile.experienceYears} yrs` : null,
                },
                { label: "Qualification Country", val: profile?.qualificationCountry },
              ].map(({ label, val }) => (
                <div key={label} className="flex justify-between items-center py-1.5 border-b border-border/50 last:border-0">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="text-sm font-medium capitalize text-right max-w-[55%] truncate">
                    {(val as string | null | undefined) || (
                      <span className="text-muted-foreground/60 italic font-normal">Not set</span>
                    )}
                  </p>
                </div>
              ))}
            </div>

            <div className="mt-5 pt-5 border-t border-border">
              <Link href="/profile" className="inline-flex w-full">
                <Button variant="outline" className="w-full">
                  Update Profile
                </Button>
              </Link>
            </div>
          </Card>
        </div>

        {/* Remediation progress card — only show when a plan exists */}
        {totalSteps > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.4 }}
          >
            <Card className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold flex items-center gap-2">
                  <span className="w-8 h-8 rounded-lg bg-accent/10 text-accent flex items-center justify-center">
                    <TrendingUp className="w-4 h-4" />
                  </span>
                  Remediation Plan
                </h3>
                <Link href="/path">
                  <Button variant="ghost" size="sm" className="text-xs gap-1">
                    View all <ArrowRight className="w-3 h-3" />
                  </Button>
                </Link>
              </div>

              {/* Progress bar */}
              <div className="mb-4">
                <div className="flex justify-between text-xs text-muted-foreground mb-1.5">
                  <span>{doneSteps} of {totalSteps} steps completed</span>
                  <span className="font-semibold text-foreground">{planPct}%</span>
                </div>
                <div className="h-2.5 rounded-full bg-muted overflow-hidden">
                  <motion.div
                    className="h-full bg-gradient-to-r from-accent to-primary rounded-full"
                    initial={{ width: 0 }}
                    animate={{ width: `${planPct}%` }}
                    transition={{ duration: 0.8, delay: 0.3, ease: "easeOut" }}
                  />
                </div>
              </div>

              {/* Step list — show up to 3 */}
              <div className="space-y-2 mb-4">
                {planSteps.slice(0, 3).map((step) => (
                  <div key={step.id} className="flex items-start gap-3">
                    {step.status === "done" ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                    ) : (
                      <Circle className="w-4 h-4 text-muted-foreground/40 shrink-0 mt-0.5" />
                    )}
                    <p className={`text-sm leading-snug ${step.status === "done" ? "line-through text-muted-foreground/50" : "text-foreground"}`}>
                      {step.title}
                    </p>
                  </div>
                ))}
                {totalSteps > 3 && (
                  <p className="text-xs text-muted-foreground pl-7">+ {totalSteps - 3} more steps</p>
                )}
              </div>

              {/* Next step CTA */}
              {nextStep && (
                <div className="flex items-start gap-3 p-3 rounded-xl bg-accent/5 border border-accent/10">
                  <span className="w-5 h-5 rounded-full bg-accent/20 text-accent flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">↓</span>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-accent mb-0.5">Next Step</p>
                    <p className="text-sm text-foreground font-medium truncate">{nextStep.title}</p>
                    {nextStep.gap && (
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{nextStep.gap}</p>
                    )}
                  </div>
                </div>
              )}

              {/* Motivational message tied to completion state */}
              {(() => {
                if (planPct === 100) {
                  return (
                    <div className="flex items-center gap-3 p-3 rounded-xl bg-emerald-50 border border-emerald-200">
                      <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                      <div>
                        <p className="text-sm font-semibold text-emerald-800">All steps completed — you're ready!</p>
                        <p className="text-xs text-emerald-700 mt-0.5">
                          You've completed your full remediation plan. Now apply to eligible roles with confidence.
                        </p>
                      </div>
                    </div>
                  );
                }
                if (planPct >= 75) {
                  return (
                    <div className="flex items-center gap-3 p-3 rounded-xl bg-blue-50 border border-blue-200">
                      <Sparkles className="w-5 h-5 text-blue-600 shrink-0" />
                      <div>
                        <p className="text-sm font-semibold text-blue-800">Almost there — keep going!</p>
                        <p className="text-xs text-blue-700 mt-0.5">
                          You're {planPct}% through your plan. Just {totalSteps - doneSteps} step{totalSteps - doneSteps !== 1 ? "s" : ""} left to unlock full eligibility.
                        </p>
                      </div>
                    </div>
                  );
                }
                if (planPct >= 40) {
                  return (
                    <div className="flex items-center gap-3 p-3 rounded-xl bg-amber-50 border border-amber-200">
                      <TrendingUp className="w-5 h-5 text-amber-600 shrink-0" />
                      <div>
                        <p className="text-sm font-semibold text-amber-800">Good momentum — stay consistent</p>
                        <p className="text-xs text-amber-700 mt-0.5">
                          {doneSteps} step{doneSteps !== 1 ? "s" : ""} done. Each milestone brings you closer to UK registration.
                        </p>
                      </div>
                    </div>
                  );
                }
                return (
                  <div className="flex items-center gap-3 p-3 rounded-xl bg-primary/5 border border-primary/15">
                    <Timer className="w-5 h-5 text-primary shrink-0" />
                    <div>
                      <p className="text-sm font-semibold text-foreground">Your journey starts here</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Work through each step in order — completing them unlocks new roles and accelerates your path to registration.
                      </p>
                    </div>
                  </div>
                );
              })()}
            </Card>
          </motion.div>
        )}
        {/* Interview Prep Card */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.45 }}>
          <Card className="mt-0 mb-6 p-5 border-violet-200 bg-gradient-to-br from-violet-50/50 to-purple-50/30">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl bg-violet-100 flex items-center justify-center shrink-0">
                <Sparkles className="w-5 h-5 text-violet-600" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-semibold text-foreground mb-1">NHS Interview Preparation</h3>
                <p className="text-xs text-muted-foreground leading-relaxed mb-3">
                  AI-generated question banks and structured interview guidance tailored to your profession and specialty.
                </p>
                <Link href="/interview-prep" className="inline-flex">
                  <Button variant="outline" size="sm" className="text-xs gap-1.5 border-violet-300 text-violet-700 hover:bg-violet-50">
                    <Sparkles className="w-3.5 h-3.5" /> Open Interview Prep
                  </Button>
                </Link>
              </div>
              {forwardEligibility?.timeToEligibilityMonths != null ? (
                <div className="shrink-0 text-right hidden sm:block">
                  <div className="flex items-center gap-1.5 justify-end mb-0.5">
                    <Timer className="w-4 h-4 text-accent" />
                    <span className="text-xs font-semibold text-accent">Time to Eligibility</span>
                  </div>
                  <p className="text-sm font-bold text-foreground">{forwardEligibility.timeToEligibilityLabel}</p>
                  <p className="text-[11px] text-muted-foreground">{forwardEligibility.regulator} estimate</p>
                </div>
              ) : null}
            </div>
          </Card>
        </motion.div>

        {/* Boost your profile — live toggle */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}>
          <Card className={`mt-6 p-5 border-2 transition-colors ${boostProfile ? "border-emerald-300 bg-gradient-to-br from-emerald-50/60 to-primary/5" : "border-dashed border-primary/20 bg-gradient-to-br from-primary/3 to-accent/3"}`}>
            <div className="flex items-start gap-4">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${boostProfile ? "bg-emerald-100" : "bg-primary/10"}`}>
                <Megaphone className={`w-5 h-5 ${boostProfile ? "text-emerald-600" : "text-primary"}`} />
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
                  <h3 className="text-sm font-semibold text-foreground">Boost Your Visibility to Employers</h3>
                  <span className={`px-2 py-0.5 text-xs rounded-full font-semibold ${boostProfile ? "bg-emerald-100 text-emerald-800" : "bg-muted text-muted-foreground"}`}>
                    {boostProfile ? "Active" : "Inactive"}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed max-w-lg mb-3">
                  {boostProfile
                    ? "Your profile is now visible to NHS trusts, academic institutions, and regulated employers actively recruiting in your specialty."
                    : "Enable boost to promote your profile to NHS trusts, academic institutions, and regulated employers in your specialty."}
                </p>
                <Button
                  size="sm"
                  variant={boostProfile ? "outline" : "default"}
                  className="text-xs gap-1.5"
                  onClick={handleBoostToggle}
                  disabled={toggleBoostMutation.isPending || !profile?.profession}
                >
                  {toggleBoostMutation.isPending ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : boostProfile ? (
                    "Turn Off Boost"
                  ) : (
                    "Enable Boost"
                  )}
                </Button>
                {!profile?.profession && (
                  <p className="text-xs text-muted-foreground mt-2">
                    Complete your profile to enable boost.
                  </p>
                )}
              </div>
            </div>
          </Card>
        </motion.div>

        {/* Candidate Portal quick-links */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.55 }}>
          <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Link href="/my-report">
              <Card className="p-5 hover:shadow-md hover:border-primary/20 transition-all cursor-pointer group flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 group-hover:bg-primary/15 transition-colors">
                  <BarChart2 className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground">My Progress Report</p>
                  <p className="text-xs text-muted-foreground">AI-powered monthly insights & next steps</p>
                </div>
                <ArrowRight className="w-4 h-4 text-muted-foreground/40 shrink-0 group-hover:text-primary/60 group-hover:translate-x-0.5 transition-all" />
              </Card>
            </Link>
            <Link href="/regulatory-guidance">
              <Card className="p-5 hover:shadow-md hover:border-primary/20 transition-all cursor-pointer group flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 group-hover:bg-primary/15 transition-colors">
                  <BookOpen className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground">Regulatory Guidance</p>
                  <p className="text-xs text-muted-foreground">GMC, NMC, GDC & HCPC registration pathways</p>
                </div>
                <ArrowRight className="w-4 h-4 text-muted-foreground/40 shrink-0 group-hover:text-primary/60 group-hover:translate-x-0.5 transition-all" />
              </Card>
            </Link>
          </div>
        </motion.div>
      </PageTransition>
    </AppLayout>
  );
}
