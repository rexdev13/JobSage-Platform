import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
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
  Building2,
  GraduationCap,
  Lock,
  Briefcase,
  Activity,
  ShieldAlert,
  Send,
} from "lucide-react";
import { Link } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { AIChatSlideover } from "@/components/AIChatSlideover";
import { cn } from "@/components/ui-enhanced";

type EligibilityOutcome = "eligible" | "not_eligible" | "ineligible";

// ── Stage icon map (mirrors PathPage) ────────────────────────────────────────
const ICON_MAP: Record<string, React.ElementType> = {
  User,
  Files,
  ShieldCheck,
  Briefcase,
  ClipboardList,
  Send,
  TrendingUp,
  Building2,
  Sparkles,
  BadgeCheck,
};
function getStageIcon(name: string): React.ElementType {
  return ICON_MAP[name] ?? Circle;
}

// ── Milestone Journey Track ───────────────────────────────────────────────────
function MilestoneJourneyTrack() {
  const { data } = useGetJourneyStatus({
    query: { queryKey: getGetJourneyStatusQueryKey(), staleTime: 30_000 },
  });
  const stages = data?.stages ?? [];
  const completeCount = stages.filter((s) => s.status === "complete").length;

  if (stages.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.18, duration: 0.4 }}
      className="mb-6"
    >
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <span className="w-6 h-6 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
            <TrendingUp className="w-3 h-3" />
          </span>
          UK Journey — {completeCount}/{stages.length} stages complete
        </h2>
        <Link href="/path">
          <span className="text-xs text-primary font-medium hover:underline flex items-center gap-0.5">
            Full journey <ArrowRight className="w-3 h-3" />
          </span>
        </Link>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 rounded-full bg-muted mb-4 overflow-hidden">
        <motion.div
          className="h-full rounded-full bg-primary"
          initial={{ width: 0 }}
          animate={{ width: `${(completeCount / stages.length) * 100}%` }}
          transition={{ duration: 0.8, delay: 0.3, ease: "easeOut" }}
        />
      </div>

      {/* Horizontal milestone track */}
      <div className="relative">
        {/* Connector line */}
        <div className="absolute top-7 left-7 right-7 h-px bg-border hidden sm:block" />

        <div className="grid grid-cols-5 sm:grid-cols-10 gap-1 relative">
          {stages.map((stage) => {
            const isComplete = stage.status === "complete";
            const isInProgress = stage.status === "inProgress";
            const isLocked = stage.locked;
            const Icon = getStageIcon(stage.iconName);

            const nodeClass = isComplete
              ? "bg-emerald-500 border-emerald-400 text-white"
              : isInProgress
                ? "bg-primary border-primary text-primary-foreground"
                : isLocked
                  ? "bg-muted/50 border-border text-muted-foreground/30"
                  : "bg-background border-border text-muted-foreground";

            const tile = (
              <div
                key={stage.id}
                className={cn(
                  "flex flex-col items-center gap-1.5 p-1",
                  !isLocked && "cursor-pointer group",
                )}
              >
                <div
                  className={cn(
                    "relative w-14 h-14 rounded-2xl border-2 flex items-center justify-center transition-all z-10",
                    nodeClass,
                    !isLocked && "group-hover:scale-105 group-hover:shadow-md",
                    isLocked && "opacity-50",
                  )}
                >
                  {isLocked ? (
                    <Lock className="w-4 h-4" />
                  ) : isComplete ? (
                    <CheckCircle2 className="w-5 h-5" />
                  ) : (
                    <Icon className="w-5 h-5" />
                  )}
                  {isInProgress && !isComplete && (
                    <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-primary border-2 border-background animate-pulse" />
                  )}
                </div>
                <span
                  className={cn(
                    "text-[9px] sm:text-[10px] font-semibold text-center leading-tight max-w-[56px]",
                    isComplete
                      ? "text-emerald-700 dark:text-emerald-400"
                      : isInProgress
                        ? "text-primary"
                        : isLocked
                          ? "text-muted-foreground/40"
                          : "text-foreground/70",
                  )}
                >
                  {stage.name}
                </span>
              </div>
            );

            return isLocked ? (
              <div key={stage.id}>{tile}</div>
            ) : (
              <Link key={stage.id} href={stage.href ?? "/path"}>
                {tile}
              </Link>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-3 pl-1">
        {[
          { label: "Complete", cls: "bg-emerald-500" },
          { label: "Active", cls: "bg-primary" },
          { label: "Pending", cls: "bg-border" },
        ].map(({ label, cls }) => (
          <span key={label} className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <span className={cn("w-2 h-2 rounded-full", cls)} />
            {label}
          </span>
        ))}
      </div>
    </motion.div>
  );
}

// ── Top-3 Recommended Opportunities ─────────────────────────────────────────
interface RecommendedRole {
  id: number;
  title: string;
  employer: string;
  location: string | null;
  matchScore: number;
  isEligible: boolean;
  sponsorshipOffered: boolean;
  matchReason?: string | null;
}

function RecommendedOpportunitiesWidget() {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const { data, isLoading } = useQuery<{ roles: RecommendedRole[] }>({
    queryKey: ["opportunities-recommended"],
    queryFn: async () => {
      const res = await fetch(`${base}/api/opportunities/recommended?limit=3`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json() as Promise<{ roles: RecommendedRole[] }>;
    },
    staleTime: 5 * 60 * 1000,
  });

  const roles = data?.roles ?? [];

  if (!isLoading && roles.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.25, duration: 0.4 }}
      className="mb-6"
    >
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <span className="w-6 h-6 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
            <Sparkles className="w-3 h-3" />
          </span>
          Your Top 3 Matched Roles
        </h2>
        <Link href="/opportunities">
          <span className="text-xs text-primary font-medium hover:underline flex items-center gap-0.5">
            Browse all <ArrowRight className="w-3 h-3" />
          </span>
        </Link>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
          <Loader2 className="w-4 h-4 animate-spin text-primary" />
          Finding your best matches…
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {roles.map((role, i) => (
            <motion.div
              key={role.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.28 + i * 0.06 }}
            >
              <Card className="p-4 flex flex-col gap-2.5 hover:shadow-md hover:border-primary/20 transition-all h-full group">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-foreground leading-snug truncate">{role.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1 truncate">
                      <Building2 className="w-3 h-3 shrink-0" /> {role.employer}
                    </p>
                    {role.matchReason && (
                      <p className="text-[10px] text-primary/70 italic mt-1 leading-snug line-clamp-2">
                        {role.matchReason}
                      </p>
                    )}
                  </div>
                  <div className="shrink-0 flex flex-col items-end gap-1">
                    <span
                      className={cn(
                        "text-sm font-black leading-none",
                        role.matchScore >= 75
                          ? "text-emerald-600"
                          : role.matchScore >= 50
                            ? "text-primary"
                            : "text-amber-600",
                      )}
                    >
                      {role.matchScore}%
                    </span>
                    <span className="text-[9px] text-muted-foreground">match</span>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  {role.isEligible && (
                    <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 font-semibold">
                      <CheckCircle2 className="w-2.5 h-2.5" /> Eligible
                    </span>
                  )}
                  {role.sponsorshipOffered && (
                    <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-700 font-semibold">
                      <BadgeCheck className="w-2.5 h-2.5" /> Sponsor
                    </span>
                  )}
                  {role.location && (
                    <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <MapPin className="w-2.5 h-2.5" /> {role.location}
                    </span>
                  )}
                </div>

                <Link href="/opportunities" className="mt-auto">
                  <Button
                    size="sm"
                    variant={role.isEligible ? "default" : "outline"}
                    className="w-full text-xs h-7 gap-1 group-hover:gap-1.5 transition-all"
                  >
                    Apply <ArrowRight className="w-3 h-3" />
                  </Button>
                </Link>
              </Card>
            </motion.div>
          ))}
        </div>
      )}
    </motion.div>
  );
}

// ── Identity Verification Banner ──────────────────────────────────────────────
function VerificationCTABanner() {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const { data, isLoading } = useQuery<{ verification: { status: string } | null }>({
    queryKey: ["identity-status-dashboard"],
    queryFn: async () => {
      const res = await fetch(`${base}/api/identity/status`, { credentials: "include" });
      if (!res.ok) return { verification: null };
      return res.json() as Promise<{ verification: { status: string } | null }>;
    },
    staleTime: 60_000,
  });

  if (isLoading) return null;
  const status = data?.verification?.status;
  if (status === "verified") return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.05 }}
      className="mb-5 rounded-xl border border-amber-200 bg-amber-50/80 dark:bg-amber-950/20 dark:border-amber-800/40 p-4"
    >
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center shrink-0">
          <ShieldAlert className="w-4 h-4 text-amber-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
            {status === "pending" ? "ID Verification in progress" : "Identity not yet verified"}
          </p>
          <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5 leading-relaxed">
            {status === "pending"
              ? "Your documents are under review — this usually takes a few minutes."
              : "Upload your passport and a selfie to unlock the verified badge and increase employer trust."}
          </p>
          {status !== "pending" && (
            <div className="mt-2.5 flex items-center gap-3 flex-wrap text-xs text-amber-800">
              {["Upload Passport / ID", "Upload selfie photo", "AI verifies in minutes"].map((step, i) => (
                <span key={step} className="flex items-center gap-1.5">
                  <span className="w-4 h-4 rounded-full bg-amber-200 text-amber-800 font-bold flex items-center justify-center text-[10px]">{i + 1}</span>
                  {step}
                </span>
              ))}
            </div>
          )}
        </div>
        <Link href="/identity" className="shrink-0">
          <Button size="sm" className="h-8 text-xs gap-1 bg-amber-600 hover:bg-amber-700 text-white">
            {status === "pending" ? "View status" : "Verify now"} <ArrowRight className="w-3 h-3" />
          </Button>
        </Link>
      </div>
    </motion.div>
  );
}

// ── Outcome Pill ─────────────────────────────────────────────────────────────
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

// ── Profile completion % ──────────────────────────────────────────────────────
function profileCompletionPct(profile: { completionPct?: number | null } | undefined): number {
  return profile?.completionPct ?? 0;
}

function ProfileCompletionRing({ pct }: { pct: number }) {
  const r = 18;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  return (
    <svg width="44" height="44" className="-rotate-90">
      <circle cx="22" cy="22" r={r} strokeWidth="4" stroke="currentColor" className="text-primary/10" fill="none" />
      <circle cx="22" cy="22" r={r} strokeWidth="4" stroke="currentColor" className="text-primary transition-all duration-700" fill="none"
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" />
    </svg>
  );
}

// ── Stat Card ─────────────────────────────────────────────────────────────────
function StatCard({
  icon: Icon, label, value, sub, href, delay,
}: { icon: React.ElementType; label: string; value: string | number; sub?: string; href: string; delay: number }) {
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay, duration: 0.4 }}>
      <Link href={href}>
        <Card className="p-4 flex items-center gap-3 hover:shadow-md hover:border-primary/20 transition-all cursor-pointer group">
          <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 group-hover:bg-primary/15 transition-colors">
            <Icon className="w-4 h-4 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] text-muted-foreground font-medium">{label}</p>
            <p className="text-xl font-display font-bold text-foreground leading-tight">{value}</p>
            {sub && <p className="text-[10px] text-muted-foreground truncate">{sub}</p>}
          </div>
          <ArrowRight className="w-3.5 h-3.5 text-muted-foreground/40 ml-auto shrink-0 group-hover:text-primary/60 group-hover:translate-x-0.5 transition-all" />
        </Card>
      </Link>
    </motion.div>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────
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
  const appStats = applicationsData?.stats;
  const totalApplied = appStats?.total ?? 0;
  const planSteps = plan?.steps ?? [];
  const doneSteps = planSteps.filter((s) => s.status === "done").length;
  const totalSteps = planSteps.length;
  const planPct = totalSteps > 0 ? Math.round((doneSteps / totalSteps) * 100) : 0;
  const nextStep = planSteps.find((s) => s.status !== "done");
  const profilePct = profileCompletionPct(profile as Record<string, unknown> | undefined);
  const boostProfile = profile?.boostProfile ?? false;

  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const profilePhotoUrl = profile?.profilePhotoKey
    ? `${base}/api/storage/objects/${(profile.profilePhotoKey as string).replace(/^\/objects\//, "")}`
    : null;
  const { data: vacancyStatsData } = useQuery<{ totalVacanciesFound: number; companiesWithVacancies: number }>({
    queryKey: ["sponsor-vacancy-stats"],
    queryFn: async () => {
      const res = await fetch(`${base}/api/sponsor-licences/vacancy-stats`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json() as Promise<{ totalVacanciesFound: number; companiesWithVacancies: number }>;
    },
    staleTime: 5 * 60 * 1000,
  });
  const totalVacanciesFound = vacancyStatsData?.totalVacanciesFound ?? 0;
  const companiesWithVacancies = vacancyStatsData?.companiesWithVacancies ?? 0;

  function handleBoostToggle() {
    toggleBoostMutation.mutate(
      { data: { boost: !boostProfile } },
      { onSuccess: () => { void queryClient.invalidateQueries({ queryKey: getGetMyProfileQueryKey() }); } },
    );
  }

  const professionLabel = profile?.profession
    ? profile.profession.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())
    : null;

  const qualLabel = profile?.qualificationType ?? undefined;
  const qualCountry = profile?.qualificationCountry;

  return (
    <AppLayout>
      <PageTransition>
        {/* ─── Setup banner ─────────────────────────────────────────────── */}
        {showSetupBanner && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
            className="mb-5 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4"
          >
            <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-amber-800">Complete your profile to get started</p>
              <p className="text-xs text-amber-700 mt-0.5">Your eligibility, matched roles, and remediation plan need your professional details first.</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Link href="/onboarding">
                <Button size="sm" className="text-xs h-8">Set up profile <ArrowRight className="w-3 h-3 ml-1" /></Button>
              </Link>
              <button onClick={() => setBannerDismissed(true)} className="text-amber-500 hover:text-amber-700 p-1">×</button>
            </div>
          </motion.div>
        )}

        {/* ─── ZONE 1: Profile strip + Journey track ────────────────────── */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05, duration: 0.4 }}>
          <Card className="p-5 mb-5 border-primary/10 bg-gradient-to-r from-primary/3 to-background">
            <div className="flex items-start gap-4">
              {/* Profile photo or completion ring */}
              {profilePhotoUrl ? (
                <div className="relative shrink-0">
                  <div className="w-14 h-14 rounded-full overflow-hidden ring-2 ring-primary/20 ring-offset-1">
                    <img src={profilePhotoUrl} alt="Profile" className="w-full h-full object-cover" />
                  </div>
                  <div className="absolute -bottom-1 -right-1 bg-background rounded-full p-0.5 shadow-sm">
                    <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center">
                      <span className="text-[8px] font-bold text-primary">{profilePct}%</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="relative shrink-0">
                  <ProfileCompletionRing pct={profilePct} />
                  <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-primary">{profilePct}%</span>
                </div>
              )}

              <div className="flex-1 min-w-0">
                <h1 className="text-xl font-display font-bold text-foreground leading-tight">
                  Welcome back, {user?.firstName || "Candidate"}
                </h1>
                <div className="flex flex-wrap items-center gap-2 mt-1.5">
                  {professionLabel && (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-primary/10 text-primary">
                      <User className="w-3 h-3" /> {professionLabel}
                    </span>
                  )}
                  {qualLabel && (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-violet-500/10 text-violet-700">
                      <GraduationCap className="w-3 h-3" />
                      {qualLabel}{qualCountry ? ` · ${qualCountry}` : ""}
                    </span>
                  )}
                  {latestDecision && (
                    <span className={cn(
                      "inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold",
                      latestDecision.outcome === "eligible"
                        ? "bg-emerald-500/10 text-emerald-700"
                        : "bg-amber-500/10 text-amber-700",
                    )}>
                      <ShieldCheck className="w-3 h-3" />
                      {latestDecision.outcome === "eligible" ? "Eligible" : "Not yet eligible"}
                    </span>
                  )}
                </div>
              </div>

              <div className="shrink-0 hidden sm:block">
                <Link href="/profile">
                  <Button variant="outline" size="sm" className="text-xs gap-1">
                    <User className="w-3 h-3" /> Profile
                  </Button>
                </Link>
              </div>
            </div>
          </Card>
        </motion.div>

        {/* Identity verification CTA */}
        <VerificationCTABanner />

        {/* Journey milestone track */}
        <MilestoneJourneyTrack />

        {/* ─── ZONE 2: Recommended opportunities ───────────────────────── */}
        {profile?.profession && <RecommendedOpportunitiesWidget />}

        {/* ─── Quick stats (3 key metrics) ──────────────────────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
          <StatCard icon={Files} label="Documents" value={docCount}
            sub={docCount === 1 ? "1 file uploaded" : `${docCount} files uploaded`}
            href="/documents" delay={0.08} />
          <StatCard icon={ClipboardList} label="Applications" value={totalApplied}
            sub={appStats && totalApplied > 0 ? `${appStats.interviews} interviews · ${appStats.offers} offers` : "Track your applications"}
            href="/applications" delay={0.11} />
          <StatCard
            icon={Building2}
            label="Sponsor Opportunities"
            value={totalVacanciesFound > 0 ? totalVacanciesFound : companiesWithVacancies}
            sub={totalVacanciesFound > 0 ? `${companiesWithVacancies} employer${companiesWithVacancies !== 1 ? "s" : ""} with open roles` : "Check employers for vacancies"}
            href="/sponsor-licences"
            delay={0.14}
          />
        </div>

        {/* ─── ZONE 3: Eligibility card + Remediation ──────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-5">
          {/* Eligibility card — crimson accent background */}
          <Card
            className="lg:col-span-2 p-8 border-0 text-primary-foreground"
            style={{ background: "linear-gradient(135deg, hsl(0 70% 38%), hsl(0 70% 30%))" }}
          >
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
                        <p className="text-xs text-primary-foreground/90 leading-relaxed">{latestDecision.reviewNote}</p>
                      </div>
                    )}
                    {latestDecision.pathways && latestDecision.pathways.length > 0 && (
                      <div className="mb-4">
                        <p className="text-xs font-semibold text-primary-foreground/70 uppercase tracking-wide mb-2">Possible Pathways</p>
                        <div className="flex flex-wrap gap-2">
                          {latestDecision.pathways.map((p: string) => (
                            <span key={p} className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/15 text-xs text-primary-foreground/90">
                              <MapPin className="w-3 h-3" />{p}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {latestDecision.reasonCodes && latestDecision.reasonCodes.length > 0 && (
                      <div className="mb-4">
                        <button onClick={() => setShowReasonCodes((v) => !v)}
                          className="flex items-center gap-1.5 text-xs text-primary-foreground/60 hover:text-primary-foreground/80 transition-colors">
                          {showReasonCodes ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                          {showReasonCodes ? "Hide" : "Show"} reason codes
                        </button>
                        {showReasonCodes && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {latestDecision.reasonCodes.map((code: string) => (
                              <code key={code} className="px-2 py-0.5 text-xs bg-white/10 rounded font-mono text-primary-foreground/70">{code}</code>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    <p className="text-primary-foreground/50 text-xs mb-6">
                      Last checked: {new Date(latestDecision.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })} · Ruleset v{latestDecision.rulesetVersion}
                    </p>
                    <p className="text-primary-foreground/40 text-xs mb-6 max-w-sm leading-relaxed">
                      This assessment is for guidance only. Always verify directly with GMC, NMC, or HCPC.
                    </p>
                  </>
                ) : (
                  <>
                    <div className="inline-flex items-center px-3 py-1 rounded-full bg-white/20 text-white text-xs font-semibold mb-4 backdrop-blur-md">
                      <Activity className="w-3 h-3 mr-2" /> Action Required
                    </div>
                    <h2 className="text-2xl font-bold mb-3">Eligibility Evaluation</h2>
                    <p className="text-primary-foreground/80 mb-8 max-w-md leading-relaxed">
                      Run your profile against the latest regulatory criteria to determine your eligibility status and get a personalised remediation plan.
                    </p>
                  </>
                )}
                <Link href="/eligibility" className="inline-flex">
                  <Button variant="accent" size="lg" className="shadow-lg shadow-accent/20">
                    {latestDecision ? "View Full Report" : "Run Check Now"} <ArrowRight className="w-5 h-5 ml-2" />
                  </Button>
                </Link>
              </div>
              <ShieldCheck className="w-28 h-28 text-white/10 hidden md:block flex-shrink-0" />
            </div>
          </Card>

          {/* Profile detail card */}
          <Card className="p-5 flex flex-col">
            <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
              <span className="w-7 h-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                <User className="w-3.5 h-3.5" />
              </span>
              Profile Details
            </h3>
            <div className="space-y-2.5 flex-1">
              {[
                { label: "Profession", val: profile?.profession?.replace(/_/g, " ") },
                { label: "Qualification", val: qualLabel },
                { label: "Trained in", val: qualCountry },
                { label: "Registration", val: profile?.registrationStatus?.replace(/_/g, " ") },
                { label: "Experience", val: profile?.experienceYears != null ? `${profile.experienceYears} yrs` : null },
              ].map(({ label, val }) => (
                <div key={label} className="flex justify-between items-center py-1 border-b border-border/50 last:border-0">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="text-xs font-semibold capitalize text-right max-w-[55%] truncate">
                    {val || <span className="text-muted-foreground/50 italic font-normal">Not set</span>}
                  </p>
                </div>
              ))}
            </div>
            <div className="mt-4 pt-4 border-t border-border">
              {forwardEligibility?.timeToEligibilityMonths != null && (
                <div className="flex items-center gap-2 mb-3 p-2.5 rounded-lg bg-accent/5 border border-accent/10">
                  <Timer className="w-3.5 h-3.5 text-accent shrink-0" />
                  <div className="min-w-0">
                    <p className="text-[10px] text-muted-foreground">Time to eligibility</p>
                    <p className="text-xs font-bold text-foreground">{forwardEligibility.timeToEligibilityLabel}</p>
                  </div>
                </div>
              )}
              <Link href="/profile" className="inline-flex w-full">
                <Button variant="outline" className="w-full text-xs">Update Profile</Button>
              </Link>
            </div>
          </Card>
        </div>

        {/* Remediation plan */}
        {totalSteps > 0 && (
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3, duration: 0.4 }}>
            <Card className="p-5 mb-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <span className="w-7 h-7 rounded-lg bg-accent/10 text-accent flex items-center justify-center">
                    <TrendingUp className="w-3.5 h-3.5" />
                  </span>
                  Remediation Plan
                  <span className="text-xs text-muted-foreground ml-1">({doneSteps}/{totalSteps} done)</span>
                </h3>
                <Link href="/path">
                  <Button variant="ghost" size="sm" className="text-xs gap-1">View all <ArrowRight className="w-3 h-3" /></Button>
                </Link>
              </div>
              <div className="mb-3">
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <motion.div className="h-full bg-gradient-to-r from-accent to-primary rounded-full"
                    initial={{ width: 0 }} animate={{ width: `${planPct}%` }}
                    transition={{ duration: 0.8, delay: 0.3, ease: "easeOut" }} />
                </div>
              </div>
              <div className="space-y-1.5 mb-3">
                {planSteps.slice(0, 3).map((step) => (
                  <div key={step.id} className="flex items-start gap-2.5">
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
                {totalSteps > 3 && <p className="text-xs text-muted-foreground pl-6">+ {totalSteps - 3} more steps</p>}
              </div>
              {nextStep && (
                <div className="flex items-start gap-2.5 p-3 rounded-xl bg-accent/5 border border-accent/10">
                  <span className="w-5 h-5 rounded-full bg-accent/20 text-accent flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">↓</span>
                  <div>
                    <p className="text-xs font-semibold text-accent">Next Step</p>
                    <p className="text-sm text-foreground font-medium">{nextStep.title}</p>
                  </div>
                </div>
              )}
            </Card>
          </motion.div>
        )}

        {/* Boost card + Interview prep */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.38 }}>
            <Card className={cn(
              "p-5 border-2 transition-colors h-full",
              boostProfile ? "border-emerald-300 bg-gradient-to-br from-emerald-50/60 to-primary/5" : "border-dashed border-primary/20",
            )}>
              <div className="flex items-start gap-3">
                <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center shrink-0", boostProfile ? "bg-emerald-100" : "bg-primary/10")}>
                  <Megaphone className={cn("w-4 h-4", boostProfile ? "text-emerald-600" : "text-primary")} />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-sm font-semibold text-foreground">Boost Visibility</h3>
                    <span className={cn("px-1.5 py-0.5 text-[10px] rounded-full font-semibold", boostProfile ? "bg-emerald-100 text-emerald-800" : "bg-muted text-muted-foreground")}>
                      {boostProfile ? "Active" : "Off"}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed mb-3">
                    {boostProfile ? "Your profile is visible to NHS trusts actively recruiting in your specialty." : "Enable to be found by NHS trusts and regulated employers."}
                  </p>
                  <Button size="sm" variant={boostProfile ? "outline" : "default"} className="text-xs"
                    onClick={handleBoostToggle} disabled={toggleBoostMutation.isPending || !profile?.profession}>
                    {toggleBoostMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : boostProfile ? "Turn Off" : "Enable Boost"}
                  </Button>
                </div>
              </div>
            </Card>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.42 }}>
            <Card className="p-5 border-violet-200 bg-gradient-to-br from-violet-50/50 to-purple-50/30 h-full">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-violet-100 flex items-center justify-center shrink-0">
                  <Sparkles className="w-4 h-4 text-violet-600" />
                </div>
                <div className="flex-1">
                  <h3 className="text-sm font-semibold text-foreground mb-1">NHS Interview Preparation</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed mb-3">
                    AI-generated question banks and structured guidance tailored to your profession.
                  </p>
                  <Link href="/interview-prep">
                    <Button variant="outline" size="sm" className="text-xs gap-1.5 border-violet-300 text-violet-700 hover:bg-violet-50">
                      <Sparkles className="w-3 h-3" /> Open
                    </Button>
                  </Link>
                </div>
              </div>
            </Card>
          </motion.div>
        </div>

        {/* Floating AI chat */}
        <AIChatSlideover />
      </PageTransition>
    </AppLayout>
  );
}
