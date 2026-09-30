import React, { useState } from "react";
import { Link } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, Button, PageTransition } from "@/components/ui-enhanced";
import {
  useEvaluateEligibility,
  useListEligibilityHistory,
  useGetMyProfile,
  useGetForwardEligibility,
} from "@workspace/api-client-react";
import type { EligibilityResult } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import {
  ShieldCheck,
  ShieldX,
  Clock,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Loader2,
  UserCircle,
  ArrowRight,
  Briefcase,
  MapPin,
  Building2,
  Lock,
  Sparkles,
  BadgeCheck,
  ShieldAlert,
} from "lucide-react";
import { DisclaimerBanner } from "@/components/ui/DisclaimerBanner";

type EligibilityOutcome = "eligible" | "not_eligible" | "ineligible";

type RecommendedRole = {
  id: number;
  title: string;
  employer: string;
  location: string;
  matchScore: number;
  isEligible: boolean;
  matchReason?: string | null;
};

function useEligibleVacancies(enabled: boolean) {
  return useQuery<{ roles: RecommendedRole[] }>({
    queryKey: ["eligibility-eligible-vacancies"],
    enabled,
    queryFn: async () => {
      const base = (import.meta as unknown as { env: { BASE_URL: string } }).env.BASE_URL.replace(/\/$/, "");
      const res = await fetch(`${base}/api/opportunities/recommended?limit=10`, { credentials: "include" });
      if (!res.ok) return { roles: [] };
      return res.json() as Promise<{ roles: RecommendedRole[] }>;
    },
    staleTime: 5 * 60 * 1000,
  });
}

type IdentityStatus = { verification: { status: "pending" | "verified" | "rejected" } | null };

function useIdentityStatus() {
  return useQuery<IdentityStatus>({
    queryKey: ["identity-status"],
    queryFn: async () => {
      const base = (import.meta as unknown as { env: { BASE_URL: string } }).env.BASE_URL.replace(/\/$/, "");
      const res = await fetch(`${base}/api/identity/status`, { credentials: "include" });
      if (!res.ok) return { verification: null };
      return res.json() as Promise<IdentityStatus>;
    },
    staleTime: 5 * 60 * 1000,
  });
}

function OutcomeBadge({ outcome, reviewFlagged }: { outcome: EligibilityOutcome; reviewFlagged?: boolean }) {
  if (reviewFlagged && outcome === "not_eligible") {
    return (
      <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold bg-purple-100 text-purple-800 border border-purple-200">
        <HelpCircle className="w-4 h-4" />
        Pending Review
      </span>
    );
  }
  const configs: Record<EligibilityOutcome, { label: string; className: string; Icon: React.ElementType }> = {
    eligible: { label: "Eligible Now", className: "bg-emerald-100 text-emerald-800 border border-emerald-200", Icon: CheckCircle2 },
    not_eligible: { label: "Not Yet Eligible", className: "bg-amber-100 text-amber-800 border border-amber-200", Icon: Clock },
    ineligible: { label: "Ineligible", className: "bg-red-100 text-red-800 border border-red-200", Icon: XCircle },
  };
  const config = configs[outcome] ?? configs.not_eligible;
  return (
    <span className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold ${config.className}`}>
      <config.Icon className="w-4 h-4" />
      {config.label}
    </span>
  );
}

function OutcomeIcon({ outcome, reviewFlagged }: { outcome: EligibilityOutcome; reviewFlagged?: boolean }) {
  if (reviewFlagged && outcome === "not_eligible") return <AlertTriangle className="w-14 h-14 text-purple-500" />;
  if (outcome === "eligible") return <ShieldCheck className="w-14 h-14 text-emerald-500" />;
  if (outcome === "not_eligible") return <Clock className="w-14 h-14 text-amber-500" />;
  if (outcome === "ineligible") return <ShieldX className="w-14 h-14 text-red-500" />;
  return <AlertTriangle className="w-14 h-14 text-muted-foreground" />;
}

function StatusSection({
  decision,
  candidateEmail,
  isVerified,
}: {
  decision: EligibilityResult;
  candidateEmail?: string | null;
  isVerified?: boolean;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const outcome = decision.outcome as EligibilityOutcome;
  const heroBg: Record<EligibilityOutcome, string> = {
    eligible: "from-emerald-50 to-white border-emerald-200",
    not_eligible: "from-amber-50 to-white border-amber-200",
    ineligible: "from-red-50 to-white border-red-200",
  };

  return (
    <div className={`rounded-2xl border bg-gradient-to-br p-6 ${heroBg[outcome] ?? "from-muted/20 to-white border-border"}`}>
      {!isVerified && (
        <div className="flex items-start gap-3 p-3 rounded-xl bg-amber-100 border border-amber-300 mb-5">
          <ShieldAlert className="w-4 h-4 text-amber-700 flex-shrink-0 mt-0.5" />
          <p className="text-xs font-medium text-amber-800">
            Identity verification required before applying —{" "}
            <Link to="/identity" className="underline hover:text-amber-900">upload your passport &amp; selfie</Link>.
          </p>
        </div>
      )}

      <div className="flex items-center gap-5 mb-4">
        <OutcomeIcon outcome={outcome} reviewFlagged={decision.reviewFlagged} />
        <div>
          <OutcomeBadge outcome={outcome} reviewFlagged={decision.reviewFlagged} />
          <p className="text-xs text-muted-foreground mt-1.5">
            Last checked: {new Date(decision.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
          </p>
        </div>
      </div>

      <p className="text-sm text-foreground leading-relaxed mb-4">{decision.explanationText}</p>

      {outcome === "not_eligible" && !decision.reviewFlagged && (
        <div className="flex items-center gap-3 p-3 rounded-xl bg-white/70 border border-amber-200">
          <ArrowRight className="w-4 h-4 text-amber-600 flex-shrink-0" />
          <p className="text-xs font-semibold text-amber-800 flex-1 min-w-0">You have a personalised path to eligibility.</p>
          <Link to="/path">
            <Button size="sm" variant="outline" className="gap-1.5 h-7 text-xs shrink-0">
              View Career Path <ArrowRight className="w-3 h-3" />
            </Button>
          </Link>
        </div>
      )}

      {decision.reviewFlagged && (
        <div className="flex items-start gap-3 p-3 rounded-xl bg-purple-50 border border-purple-200">
          <AlertTriangle className="w-4 h-4 text-purple-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-purple-700">
            {candidateEmail
              ? `Under manual review — you'll hear back at ${candidateEmail} within 2–3 working days.`
              : "Under manual review — a JOBSAGE adviser will respond within 2–3 working days."}
          </p>
        </div>
      )}

      {decision.pathways && decision.pathways.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {decision.pathways.map((p) => (
            <span key={p} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-100 text-emerald-800 text-xs font-medium border border-emerald-200">
              <CheckCircle2 className="w-3 h-3 flex-shrink-0" />
              {p}
            </span>
          ))}
        </div>
      )}

      <div className="mt-4 pt-4 border-t border-border/50">
        <button
          onClick={() => setShowDetails(!showDetails)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {showDetails ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          {showDetails ? "Hide" : "Show"} technical details (ruleset v{decision.rulesetVersion})
        </button>
        {showDetails && (
          <div className="mt-2 flex flex-wrap gap-2">
            {decision.reasonCodes.map((code) => (
              <code key={code} className="px-2 py-0.5 rounded bg-muted text-muted-foreground text-xs font-mono">
                {code}
              </code>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function EligibleNowSection({ outcome }: { outcome: EligibilityOutcome }) {
  const { data, isLoading } = useEligibleVacancies(outcome === "eligible");
  const eligibleRoles = (data?.roles ?? []).filter((r) => r.isEligible);

  if (outcome !== "eligible") {
    return (
      <div className="rounded-2xl border border-dashed border-muted-foreground/30 p-8 text-center">
        <Lock className="w-8 h-8 text-muted-foreground/40 mx-auto mb-3" />
        <p className="text-sm font-medium text-muted-foreground">Eligible vacancies appear here once your eligibility check passes.</p>
        <Link to="/path">
          <Button size="sm" variant="outline" className="mt-3 gap-1.5 text-xs">
            View your path to eligibility <ArrowRight className="w-3 h-3" />
          </Button>
        </Link>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => <div key={i} className="h-20 rounded-xl bg-muted/50 animate-pulse" />)}
      </div>
    );
  }

  if (eligibleRoles.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-emerald-300 p-8 text-center bg-emerald-50/50">
        <BadgeCheck className="w-8 h-8 text-emerald-400 mx-auto mb-3" />
        <p className="text-sm font-medium text-emerald-800">You're eligible — but no open vacancies match right now.</p>
        <Link to="/opportunities">
          <Button size="sm" variant="outline" className="mt-3 gap-1.5 text-xs text-emerald-800 border-emerald-300">
            Browse all opportunities <ArrowRight className="w-3 h-3" />
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {eligibleRoles.slice(0, 5).map((role) => (
        <div key={role.id} className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4 flex items-start gap-4">
          <div className="w-9 h-9 rounded-lg bg-emerald-100 flex items-center justify-center shrink-0">
            <Briefcase className="w-4 h-4 text-emerald-700" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground leading-tight">{role.title}</p>
            <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1"><Building2 className="w-3 h-3" />{role.employer}</span>
              {role.location && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{role.location}</span>}
            </div>
            {role.matchReason && (
              <p className="text-xs text-emerald-700 mt-1 italic line-clamp-1">"{role.matchReason}"</p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
              {role.matchScore}%
            </span>
            <Link to="/opportunities">
              <Button size="sm" className="gap-1 h-7 text-xs">
                <Sparkles className="w-3 h-3" /> Apply
              </Button>
            </Link>
          </div>
        </div>
      ))}
      {eligibleRoles.length > 5 && (
        <Link to="/opportunities">
          <p className="text-xs text-center text-primary hover:underline font-medium pt-1 cursor-pointer">
            + {eligibleRoles.length - 5} more eligible roles — view all
          </p>
        </Link>
      )}
    </div>
  );
}

type GapWithRoles = {
  stepId: number;
  title: string;
  gap: string | null;
  timelineRange: string;
  stepSource: string;
  estimatedMonths: number;
  sampleRolesUnlocked: Array<{ id: number; title: string; employer: string; location: string }>;
};

type ForwardEligibilityData = {
  timeToEligibilityLabel?: string;
  timeToEligibilityMonths?: number;
  newlyUnlockedRoles?: Array<{ id: number; title: string; employer: string; location: string }>;
  gapsWithRoles?: GapWithRoles[];
};

function UnlockMoreSection({ outcome }: { outcome: EligibilityOutcome }) {
  const { data: forwardData, isLoading } = useGetForwardEligibility() as { data: ForwardEligibilityData | undefined; isLoading: boolean };

  if (outcome === "eligible") {
    return (
      <div className="rounded-2xl border border-dashed border-emerald-300 p-8 text-center bg-emerald-50/50">
        <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-3" />
        <p className="text-sm font-medium text-emerald-800">You're fully eligible — no gaps to unlock.</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[0, 1].map((i) => <div key={i} className="h-24 rounded-xl bg-muted/50 animate-pulse" />)}
      </div>
    );
  }

  const gaps = forwardData?.gapsWithRoles ?? [];
  const totalRoles = forwardData?.newlyUnlockedRoles?.length ?? 0;

  if (!forwardData || (gaps.length === 0 && totalRoles === 0)) {
    return (
      <div className="rounded-2xl border border-dashed border-muted-foreground/30 p-8 text-center">
        <Lock className="w-8 h-8 text-muted-foreground/40 mx-auto mb-3" />
        <p className="text-sm text-muted-foreground">Complete your eligibility check to see which roles you can unlock.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {forwardData.timeToEligibilityLabel && (
        <div className="flex items-center gap-3 p-3 rounded-xl bg-blue-50 border border-blue-200">
          <Clock className="w-4 h-4 text-blue-600 flex-shrink-0" />
          <p className="text-xs text-blue-800">
            Complete your remediation plan and you could be eligible in{" "}
            <span className="font-semibold">{forwardData.timeToEligibilityLabel}</span>.{" "}
            <span className="text-blue-600">{totalRoles} role{totalRoles !== 1 ? "s" : ""} would become available to you.</span>
          </p>
        </div>
      )}

      {/* Per-gap breakdown */}
      {gaps.length > 0 ? (
        <div className="space-y-4">
          {gaps.slice(0, 4).map((gap) => (
            <div key={gap.stepId} className="rounded-xl border border-blue-100 bg-blue-50/30 p-4">
              <div className="flex items-start gap-3 mb-3">
                <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center shrink-0 mt-0.5">
                  <Lock className="w-3.5 h-3.5 text-blue-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground leading-tight">{gap.title}</p>
                  {gap.gap && <p className="text-xs text-muted-foreground mt-0.5 italic">Gap: {gap.gap}</p>}
                  <div className="flex items-center gap-2 mt-1">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 border border-amber-200">
                      <Clock className="w-3 h-3" /> {gap.timelineRange}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      ~{gap.estimatedMonths > 0 ? `${gap.estimatedMonths} month${gap.estimatedMonths !== 1 ? "s" : ""}` : "varies"}
                    </span>
                  </div>
                </div>
              </div>
              {gap.sampleRolesUnlocked.length > 0 && (
                <div className="ml-11 space-y-2">
                  <p className="text-xs font-medium text-muted-foreground mb-1.5">Roles unlocked by completing this step:</p>
                  {gap.sampleRolesUnlocked.map((role) => (
                    <div key={role.id} className="rounded-lg border border-border bg-background/80 p-3 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-foreground leading-tight">{role.title}</p>
                        <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1"><Building2 className="w-3 h-3" />{role.employer}</span>
                          {role.location && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{role.location}</span>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
          {gaps.length > 4 && (
            <p className="text-xs text-center text-muted-foreground">+ {gaps.length - 4} more gaps in your remediation plan</p>
          )}
        </div>
      ) : (
        /* Fallback: flat role list if no per-gap data */
        <div className="space-y-3">
          {(forwardData.newlyUnlockedRoles ?? []).slice(0, 5).map((role) => (
            <div key={role.id} className="rounded-xl border border-border bg-muted/20 p-4 flex items-start gap-4">
              <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
                <Lock className="w-4 h-4 text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground leading-tight">{role.title}</p>
                <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><Building2 className="w-3 h-3" />{role.employer}</span>
                  {role.location && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{role.location}</span>}
                </div>
                <p className="text-xs text-blue-700 mt-1">Complete your career path to unlock this role</p>
              </div>
            </div>
          ))}
        </div>
      )}

      <Link to="/path">
        <Button variant="outline" size="sm" className="w-full gap-2 mt-2">
          View full remediation plan <ArrowRight className="w-3 h-3" />
        </Button>
      </Link>
    </div>
  );
}

function professionToIndustryLabel(profession: string): string {
  const lower = profession.toLowerCase().replace(/_/g, " ").trim();
  if (lower.includes("doctor") || lower.includes("physician") || lower === "gp" || lower.includes("surgeon") || lower.includes("psychiatrist") || lower.includes("clinical academic")) return "GMC — Medical Registration";
  if (lower.includes("nurse") || lower.includes("nursing") || lower.includes("midwife") || lower.includes("midwifery")) return "NMC — Nursing & Midwifery";
  if (lower.includes("allied health") || lower.includes("physiotherapist") || lower.includes("radiographer") || lower.includes("occupational therapist") || lower.includes("paramedic") || lower.includes("optometrist") || lower.includes("podiatrist") || lower.includes("speech") || lower.includes("dietitian")) return "HCPC — Allied Health Professions";
  if (lower.includes("teacher") || lower.includes("teaching") || lower.includes("qts")) return "Education — Qualified Teacher Status (QTS)";
  if (lower.includes("academic") || lower.includes("lecturer") || lower.includes("professor") || lower.includes("researcher") || lower.includes("postdoc")) return "Higher Education — PhD & Research";
  if (lower.includes("engineer") || lower.includes("engineering") || lower.includes("ceng")) return "Engineering — CEng / Professional Registration";
  return "General — Professional Employment";
}

export default function EligibilityPage() {
  const { data: historyData, isLoading: historyLoading, refetch } = useListEligibilityHistory();
  const { mutate: evaluate, isPending: evaluating } = useEvaluateEligibility({
    mutation: { onSuccess: () => { refetch(); } },
  });
  const { data: profileData } = useGetMyProfile();
  const { data: identityData } = useIdentityStatus();

  const decisions = historyData?.decisions ?? [];
  const latest = decisions[0];
  const profession = profileData?.profession;
  const candidateEmail = null;
  const isVerified = identityData?.verification?.status === "verified";
  const outcome = (latest?.outcome ?? "not_eligible") as EligibilityOutcome;
  const industryLabel = profession ? professionToIndustryLabel(profession) : null;

  return (
    <AppLayout>
      <PageTransition>
        <DisclaimerBanner />

        <header className="mt-6 mb-6">
          <h1 className="text-3xl font-display font-bold text-foreground">Eligibility Status</h1>
          <p className="text-muted-foreground mt-2">
            Find out which UK roles you qualify for today — and what it takes to unlock the rest.
          </p>
        </header>
        <div className="mb-6 flex items-center gap-3 rounded-xl border border-primary/15 bg-primary/5 p-3 text-sm">
          <HelpCircle className="h-4 w-4 shrink-0 text-primary" />
          <p className="flex-1 text-muted-foreground">Questions about sponsor eligibility?</p>
          <Link to="/help#visa" className="shrink-0 font-semibold text-primary hover:underline">Visit our Help Center <ArrowRight className="ml-1 inline h-3.5 w-3.5" /></Link>
        </div>

        {/* Profession context banner */}
        {!profession && (
          <div className="flex items-center gap-3 p-4 rounded-xl bg-amber-50 border border-amber-200 mb-6">
            <UserCircle className="w-5 h-5 text-amber-600 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-amber-800">Profession not set</p>
              <p className="text-xs text-amber-700 mt-0.5">Set your profession in My Profile so we can assess the right eligibility criteria.</p>
            </div>
            <Link to="/profile" className="flex-shrink-0 inline-flex items-center gap-1 text-sm font-medium text-amber-800 hover:text-amber-900 transition-colors">
              Set profession <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        )}

        {profession && industryLabel && (
          <div className="flex items-center gap-3 p-3 rounded-xl bg-primary/5 border border-primary/20 mb-6">
            <UserCircle className="w-4 h-4 text-primary flex-shrink-0" />
            <p className="text-xs text-foreground flex-1 min-w-0">
              Assessed as <span className="font-semibold">{profession}</span> · Ruleset: <span className="font-medium">{industryLabel}</span>
            </p>
            <Link to="/profile" className="flex-shrink-0 text-xs text-primary hover:underline font-medium">Change</Link>
          </div>
        )}

        {historyLoading ? (
          <Card className="p-10 flex items-center justify-center">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </Card>
        ) : decisions.length === 0 ? (
          <Card className="p-10 text-center">
            <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-6">
              <ShieldCheck className="w-10 h-10 text-primary" />
            </div>
            <h2 className="text-xl font-display font-bold text-foreground mb-3">Run your first eligibility check</h2>
            <p className="text-muted-foreground mb-8 max-w-sm mx-auto leading-relaxed text-sm">
              We'll compare your profile against the latest UK regulatory requirements for your profession and tell you where you stand.
            </p>
            <Button onClick={() => evaluate()} disabled={evaluating || !profession} size="lg">
              {evaluating ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Evaluating…</>
              ) : (
                <><ShieldCheck className="w-4 h-4 mr-2" />Run Eligibility Check</>
              )}
            </Button>
            {!profession && (
              <p className="text-xs text-muted-foreground mt-3">
                Please <Link to="/profile" className="text-primary hover:underline">set your profession</Link> in My Profile first.
              </p>
            )}
          </Card>
        ) : (
          <div className="space-y-10">
            {/* ── Section 1: Your Status ── */}
            <section>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-display font-bold text-foreground flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center shrink-0">1</span>
                  Your Status
                </h2>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => evaluate()}
                  disabled={evaluating || !profession}
                  className="gap-1.5 h-8 text-xs"
                >
                  {evaluating ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                  Re-run Check
                </Button>
              </div>
              <StatusSection decision={latest} candidateEmail={candidateEmail} isVerified={isVerified} />
            </section>

            {/* ── Section 2: Eligible Now ── */}
            <section>
              <div className="mb-4">
                <h2 className="text-lg font-display font-bold text-foreground flex items-center gap-2 mb-1">
                  <span className="w-6 h-6 rounded-full bg-emerald-600 text-white text-xs font-bold flex items-center justify-center shrink-0">2</span>
                  Eligible Now
                </h2>
                <p className="text-sm text-muted-foreground ml-8">Vacancies you can apply to today based on your current eligibility.</p>
              </div>
              <EligibleNowSection outcome={outcome} />
            </section>

            {/* ── Section 3: Unlock More ── */}
            <section>
              <div className="mb-4">
                <h2 className="text-lg font-display font-bold text-foreground flex items-center gap-2 mb-1">
                  <span className="w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center shrink-0">3</span>
                  Unlock More
                </h2>
                <p className="text-sm text-muted-foreground ml-8">Roles that become available once you close the remaining gaps in your profile.</p>
              </div>
              <UnlockMoreSection outcome={outcome} />
            </section>

            {/* Previous checks */}
            {decisions.length > 1 && (
              <section>
                <h2 className="text-sm font-semibold text-muted-foreground mb-3">Previous Checks</h2>
                <div className="space-y-2">
                  {decisions.slice(1).map((d) => (
                    <div key={d.id} className="rounded-xl border border-border p-4 flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-4">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold shrink-0 ${
                        d.outcome === "eligible" ? "bg-emerald-100 text-emerald-800" :
                        d.outcome === "ineligible" ? "bg-red-100 text-red-800" :
                        "bg-amber-100 text-amber-800"
                      }`}>
                        {d.outcome === "eligible" ? "Eligible" : d.outcome === "ineligible" ? "Ineligible" : "Not Yet Eligible"}
                      </span>
                      <p className="text-xs text-muted-foreground shrink-0">{new Date(d.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</p>
                      <p className="text-xs text-foreground flex-1 min-w-0 line-clamp-1">{d.explanationText}</p>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Legend + disclaimer */}
            <Card className="p-5 bg-muted/20">
              <h3 className="text-sm font-semibold text-foreground mb-3">Understanding Outcomes</h3>
              <div className="grid grid-cols-2 gap-3 text-xs">
                {[
                  { Icon: CheckCircle2, color: "text-emerald-500", label: "Eligible Now", desc: "Meets current criteria." },
                  { Icon: Clock, color: "text-amber-500", label: "Not Yet Eligible", desc: "Specific gaps to address." },
                  { Icon: XCircle, color: "text-red-500", label: "Ineligible", desc: "Fundamental barrier exists." },
                  { Icon: HelpCircle, color: "text-purple-500", label: "Pending Review", desc: "Manual assessment underway." },
                ].map(({ Icon, color, label, desc }) => (
                  <div key={label} className="flex items-start gap-2">
                    <Icon className={`w-4 h-4 ${color} flex-shrink-0 mt-0.5`} />
                    <div>
                      <span className="font-medium text-foreground">{label}</span>
                      <p className="text-muted-foreground">{desc}</p>
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-3 pt-3 border-t border-border italic">
                <strong>Disclaimer:</strong> Assessments are derived from publicly available regulatory guidance and do not constitute legal advice. Final decisions rest with the relevant regulatory body.
              </p>
            </Card>
          </div>
        )}
      </PageTransition>
    </AppLayout>
  );
}
