import React, { useState } from "react";
import { Link } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, Button, PageTransition } from "@/components/ui-enhanced";
import {
  useEvaluateEligibility,
  useListEligibilityHistory,
  useGetMyProfile,
  useGetCurrentAuthUser,
} from "@workspace/api-client-react";
import type { EligibilityResult } from "@workspace/api-client-react";
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
} from "lucide-react";
import { DisclaimerBanner } from "@/components/ui/DisclaimerBanner";

type EligibilityOutcome = "eligible" | "not_eligible" | "ineligible";

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
    eligible: {
      label: "Eligible Now",
      className: "bg-emerald-100 text-emerald-800 border border-emerald-200",
      Icon: CheckCircle2,
    },
    not_eligible: {
      label: "Not Yet Eligible",
      className: "bg-amber-100 text-amber-800 border border-amber-200",
      Icon: Clock,
    },
    ineligible: {
      label: "Ineligible",
      className: "bg-red-100 text-red-800 border border-red-200",
      Icon: XCircle,
    },
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
  if (reviewFlagged && outcome === "not_eligible") return <AlertTriangle className="w-12 h-12 text-purple-500" />;
  if (outcome === "eligible") return <ShieldCheck className="w-12 h-12 text-emerald-500" />;
  if (outcome === "not_eligible") return <Clock className="w-12 h-12 text-amber-500" />;
  if (outcome === "ineligible") return <ShieldX className="w-12 h-12 text-red-500" />;
  return <AlertTriangle className="w-12 h-12 text-muted-foreground" />;
}

function DecisionCard({
  decision,
  isLatest,
  candidateEmail,
}: {
  decision: EligibilityResult;
  isLatest?: boolean;
  candidateEmail?: string | null;
}) {
  const [showTechnical, setShowTechnical] = useState(false);
  const outcome = decision.outcome as EligibilityOutcome;

  const heroBg: Record<EligibilityOutcome, string> = {
    eligible: "bg-emerald-50 border-b border-emerald-100",
    not_eligible: "bg-amber-50 border-b border-amber-100",
    ineligible: "bg-red-50 border-b border-red-100",
  };

  return (
    <Card className={`overflow-hidden ${isLatest ? "shadow-md border-primary/20" : ""}`}>
      {/* Outcome hero */}
      <div className={`px-6 pt-5 pb-5 ${heroBg[outcome] ?? "bg-muted/30"}`}>
        {isLatest && (
          <div className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-white/80 text-foreground text-xs font-semibold mb-3 border border-border/40">
            Latest Check
          </div>
        )}
        <div className="flex items-center gap-4 mb-3">
          <OutcomeIcon outcome={outcome} reviewFlagged={decision.reviewFlagged} />
          <div>
            <OutcomeBadge outcome={outcome} reviewFlagged={decision.reviewFlagged} />
            <p className="text-xs text-muted-foreground mt-1.5">
              {new Date(decision.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
            </p>
          </div>
        </div>
        <p className="text-sm text-foreground leading-relaxed">{decision.explanationText}</p>
      </div>

      <div className="p-6 space-y-5">
        {/* Eligible roles */}
        {decision.pathways && decision.pathways.length > 0 && (
          <div>
            <h4 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              Roles you qualify for
            </h4>
            <div className="flex flex-wrap gap-2">
              {decision.pathways.map((pathway) => (
                <span
                  key={pathway}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-100 text-emerald-800 text-sm font-medium border border-emerald-200"
                >
                  <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
                  {pathway}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Not yet eligible — remediation CTA */}
        {outcome === "not_eligible" && !decision.reviewFlagged && (
          <div className="p-4 rounded-xl bg-primary/5 border border-primary/20">
            <h4 className="text-sm font-semibold text-foreground mb-1.5 flex items-center gap-2">
              <ArrowRight className="w-4 h-4 text-primary" />
              Your route to eligibility
            </h4>
            <p className="text-sm text-muted-foreground mb-3">
              You have a personalised step-by-step plan to close the gaps. Follow your Path to become eligible.
            </p>
            <Link to="/path">
              <Button size="sm" variant="outline" className="gap-2 h-8 text-xs">
                View Career Path <ArrowRight className="w-3 h-3" />
              </Button>
            </Link>
          </div>
        )}

        {/* Pending review */}
        {decision.reviewFlagged && (
          <div className="flex items-start gap-3 p-4 rounded-xl bg-purple-50 border border-purple-200">
            <AlertTriangle className="w-5 h-5 text-purple-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-purple-800">Pending Manual Review</p>
              <p className="text-sm text-purple-700 mt-1">
                {candidateEmail
                  ? `Your assessment is being reviewed by a JOBSAGE adviser. You'll hear back at ${candidateEmail} within 2–3 working days.`
                  : "Your assessment is being reviewed by a JOBSAGE adviser. You'll receive a response within 2–3 working days."}
              </p>
            </div>
          </div>
        )}

        {/* Technical details */}
        <div className="pt-3 border-t border-border">
          <p className="text-xs text-muted-foreground italic mb-2">
            Based on publicly available regulatory guidance — indicative only. Final decisions rest with the relevant regulatory body.
          </p>
          <button
            onClick={() => setShowTechnical(!showTechnical)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {showTechnical ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            {showTechnical ? "Hide" : "Show"} technical details (ruleset v{decision.rulesetVersion})
          </button>
          {showTechnical && (
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
    </Card>
  );
}

function professionToIndustryLabel(profession: string): string {
  const lower = profession.toLowerCase().replace(/_/g, " ").trim();
  if (
    lower.includes("doctor") || lower.includes("physician") || lower === "gp" ||
    lower.includes("gp ") || lower.includes("surgeon") || lower.includes("psychiatrist") ||
    lower.includes("clinical academic")
  ) return "GMC — Medical Registration";
  if (
    lower.includes("nurse") || lower.includes("nursing") ||
    lower.includes("midwife") || lower.includes("midwifery")
  ) return "NMC — Nursing & Midwifery";
  if (
    lower.includes("allied health") || lower.includes("physiotherapist") ||
    lower.includes("radiographer") || lower.includes("occupational therapist") ||
    lower.includes("paramedic") || lower.includes("optometrist") ||
    lower.includes("podiatrist") || lower.includes("speech") || lower.includes("dietitian")
  ) return "HCPC — Allied Health Professions";
  if (lower.includes("teacher") || lower.includes("teaching") || lower.includes("qts"))
    return "Education — Qualified Teacher Status (QTS)";
  if (
    lower.includes("academic") || lower.includes("lecturer") || lower.includes("professor") ||
    lower.includes("researcher") || lower.includes("postdoc")
  ) return "Higher Education — PhD & Research";
  if (lower.includes("engineer") || lower.includes("engineering") || lower.includes("ceng"))
    return "Engineering — CEng / Professional Registration";
  return "General — Professional Employment";
}

function ProfessionContextBanner({ profession }: { profession: string | null | undefined }) {
  if (!profession) {
    return (
      <div className="flex items-center gap-3 p-4 rounded-xl bg-amber-50 border border-amber-200 mb-6">
        <UserCircle className="w-5 h-5 text-amber-600 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-amber-800">Profession not set</p>
          <p className="text-sm text-amber-700 mt-0.5">
            Set your profession in My Profile so we can assess the right eligibility criteria for your industry.
          </p>
        </div>
        <Link
          to="/profile"
          className="flex-shrink-0 inline-flex items-center gap-1 text-sm font-medium text-amber-800 hover:text-amber-900 transition-colors"
        >
          Set profession
          <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    );
  }

  const industryLabel = professionToIndustryLabel(profession);

  return (
    <div className="flex items-start gap-3 p-4 rounded-xl bg-primary/5 border border-primary/20 mb-6">
      <UserCircle className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground">
          Your eligibility is assessed based on your profession —{" "}
          <span className="font-semibold">{profession}</span>.
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Applying ruleset: <span className="font-medium">{industryLabel}</span>
        </p>
      </div>
      <Link
        to="/profile"
        className="flex-shrink-0 text-sm text-primary hover:underline font-medium transition-colors"
      >
        Change
      </Link>
    </div>
  );
}

export default function EligibilityPage() {
  const { data: historyData, isLoading: historyLoading, refetch } = useListEligibilityHistory();
  const { mutate: evaluate, isPending: evaluating } = useEvaluateEligibility({
    mutation: {
      onSuccess: () => {
        refetch();
      },
    },
  });
  const { data: profileData } = useGetMyProfile();
  const { data: authUser } = useGetCurrentAuthUser();

  const decisions = historyData?.decisions ?? [];
  const latest = decisions[0];
  const profession = profileData?.profession;
  const candidateEmail = authUser?.user?.email;

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

        <ProfessionContextBanner profession={profession} />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            {historyLoading ? (
              <Card className="p-10 flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
              </Card>
            ) : decisions.length === 0 ? (
              <Card className="p-10 text-center">
                <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-6">
                  <ShieldCheck className="w-10 h-10 text-primary" />
                </div>
                <h2 className="text-xl font-display font-bold text-foreground mb-3">
                  No Eligibility Check Run Yet
                </h2>
                <p className="text-muted-foreground mb-8 max-w-sm mx-auto leading-relaxed">
                  Run your first eligibility check to see whether your profile meets the UK requirements
                  for your profession and industry.
                </p>
                <Button
                  onClick={() => evaluate()}
                  disabled={evaluating || !profession}
                  size="lg"
                >
                  {evaluating ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Evaluating…
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="w-4 h-4 mr-2" />
                      Run Eligibility Check
                    </>
                  )}
                </Button>
                {!profession && (
                  <p className="text-xs text-muted-foreground mt-3">
                    Please{" "}
                    <Link to="/profile" className="text-primary hover:underline">
                      set your profession
                    </Link>{" "}
                    in My Profile first.
                  </p>
                )}
              </Card>
            ) : (
              <>
                {latest && <DecisionCard decision={latest} isLatest candidateEmail={candidateEmail} />}

                {decisions.length > 1 && (
                  <div>
                    <h3 className="text-lg font-display font-semibold text-foreground mb-4">
                      Previous Checks
                    </h3>
                    <div className="space-y-4">
                      {decisions.slice(1).map((d) => (
                        <DecisionCard key={d.id} decision={d} candidateEmail={candidateEmail} />
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="space-y-4">
            <Card className="p-6">
              <h3 className="text-base font-semibold text-foreground mb-4">Run a New Check</h3>
              <p className="text-sm text-muted-foreground mb-4 leading-relaxed">
                Each check evaluates your current profile against the latest published ruleset for your profession. Update your profile
                first if your circumstances have changed.
              </p>
              <Button
                className="w-full"
                onClick={() => evaluate()}
                disabled={evaluating || !profession}
              >
                {evaluating ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Evaluating…
                  </>
                ) : (
                  <>
                    <RotateCcw className="w-4 h-4 mr-2" />
                    Re-run Check
                  </>
                )}
              </Button>
              {!profession && (
                <p className="text-xs text-muted-foreground mt-2 text-center">
                  <Link to="/profile" className="text-primary hover:underline">
                    Set your profession
                  </Link>{" "}
                  to enable checks.
                </p>
              )}
            </Card>

            <Card className="p-6">
              <h3 className="text-base font-semibold text-foreground mb-3">Understanding Outcomes</h3>
              <div className="space-y-3 text-sm">
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <span className="font-medium text-foreground">Eligible Now</span>
                    <p className="text-muted-foreground text-xs mt-0.5">
                      Your profile meets current regulatory or professional criteria.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <Clock className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <span className="font-medium text-foreground">Not Yet Eligible</span>
                    <p className="text-muted-foreground text-xs mt-0.5">
                      You have a remediation path — specific gaps to address.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <XCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <span className="font-medium text-foreground">Ineligible</span>
                    <p className="text-muted-foreground text-xs mt-0.5">
                      A fundamental barrier exists for this pathway.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <HelpCircle className="w-4 h-4 text-purple-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <span className="font-medium text-foreground">Pending Review</span>
                    <p className="text-muted-foreground text-xs mt-0.5">
                      Complex case — a JOBSAGE adviser will assess and respond within 2–3 working days.
                    </p>
                  </div>
                </div>
              </div>
            </Card>

            <Card className="p-5 bg-muted/30">
              <p className="text-xs text-muted-foreground leading-relaxed">
                <strong className="text-foreground">Disclaimer:</strong> Assessments are derived from publicly
                available regulatory and professional guidance and do not constitute legal advice. Final
                registration or licensing decisions rest with the relevant regulatory or professional body.
              </p>
            </Card>
          </div>
        </div>
      </PageTransition>
    </AppLayout>
  );
}
