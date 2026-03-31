import { useState } from "react";
import { useAuth } from "@workspace/auth-web";
import {
  useGetMyProfile,
  useListEligibilityHistory,
  useListMyDocuments,
  useListMatchedRoles,
  useGetRemediationPlan,
} from "@workspace/api-client-react";
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
  Briefcase,
  CheckCircle2,
  Circle,
  Files,
  TrendingUp,
  User,
} from "lucide-react";
import { Link } from "wouter";
import { motion } from "framer-motion";

type EligibilityOutcome = "eligible" | "not_eligible" | "ineligible";

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
  const fields = [
    "profession",
    "specialty",
    "qualificationCountry",
    "qualificationType",
    "qualificationYear",
    "experienceYears",
    "registrationStatus",
    "residencyStatus",
  ];
  const filled = fields.filter((f) => profile[f] != null && profile[f] !== "").length;
  return Math.round((filled / fields.length) * 100);
}

export default function DashboardPage() {
  const { user } = useAuth();
  const { data: profile } = useGetMyProfile();
  const { data: eligibilityHistory } = useListEligibilityHistory();
  const { data: documents } = useListMyDocuments();
  const { data: matchedRoles } = useListMatchedRoles();
  const { data: plan } = useGetRemediationPlan();

  const latestDecision = eligibilityHistory?.decisions?.[0];
  const [showReasonCodes, setShowReasonCodes] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const showSetupBanner = !profile?.profession && !bannerDismissed;

  const docCount = documents?.documents?.length ?? 0;
  const rolesCount = matchedRoles?.roles?.length ?? 0;

  const planSteps = plan?.steps ?? [];
  const doneSteps = planSteps.filter((s) => s.status === "done").length;
  const totalSteps = planSteps.length;
  const planPct = totalSteps > 0 ? Math.round((doneSteps / totalSteps) * 100) : 0;
  const nextStep = planSteps.find((s) => s.status !== "done");

  const profilePct = profileCompletionPct(profile as Record<string, unknown> | undefined);

  const professionLabel = profile?.profession
    ? profile.profession.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())
    : null;

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
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          <StatCard
            icon={Files}
            label="Documents"
            value={docCount}
            sub={docCount === 1 ? "1 file uploaded" : `${docCount} files uploaded`}
            href="/documents"
            delay={0.05}
          />
          <StatCard
            icon={Briefcase}
            label="Matched Roles"
            value={rolesCount}
            sub={rolesCount > 0 ? "View opportunities" : "Run eligibility check first"}
            href="/opportunities"
            delay={0.1}
          />
          <StatCard
            icon={TrendingUp}
            label="Plan Progress"
            value={totalSteps > 0 ? `${planPct}%` : "—"}
            sub={totalSteps > 0 ? `${doneSteps} of ${totalSteps} steps done` : "No plan generated yet"}
            href="/path"
            delay={0.15}
          />
        </div>

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

              {planPct === 100 && (
                <div className="flex items-center gap-3 p-3 rounded-xl bg-emerald-50 border border-emerald-200">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                  <p className="text-sm font-semibold text-emerald-800">All remediation steps completed!</p>
                </div>
              )}
            </Card>
          </motion.div>
        )}
      </PageTransition>
    </AppLayout>
  );
}
