import { useAuth } from "@workspace/replit-auth-web";
import { useGetMyProfile, useListEligibilityHistory } from "@workspace/api-client-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, Button, PageTransition } from "@/components/ui-enhanced";
import { Activity, FileText, ArrowRight, ShieldCheck, CheckCircle2, Clock, XCircle, HelpCircle } from "lucide-react";
import { Link } from "wouter";

type EligibilityOutcome = "eligible" | "not_eligible" | "ineligible" | "review";

function OutcomePill({ outcome }: { outcome: EligibilityOutcome }) {
  const configs: Record<EligibilityOutcome, { label: string; className: string }> = {
    eligible: { label: "Eligible Now", className: "bg-emerald-500/20 text-emerald-100" },
    not_eligible: { label: "Not Yet Eligible", className: "bg-amber-500/20 text-amber-100" },
    ineligible: { label: "Ineligible", className: "bg-red-500/20 text-red-100" },
    review: { label: "Under Review", className: "bg-purple-500/20 text-purple-100" },
  };
  const { label, className } = configs[outcome] ?? configs.review;
  return (
    <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${className}`}>
      {label}
    </span>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const { data: profile } = useGetMyProfile();
  const { data: eligibilityHistory } = useListEligibilityHistory();
  const latestDecision = eligibilityHistory?.decisions?.[0];

  return (
    <AppLayout>
      <PageTransition>
        <header className="mb-8">
          <h1 className="text-3xl font-display font-bold text-foreground">
            Welcome back, {user?.firstName || 'Candidate'}
          </h1>
          <p className="text-muted-foreground mt-2">
            Here is your professional intelligence overview.
          </p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          {/* Main Action Card */}
          <Card className="lg:col-span-2 p-8 bg-gradient-to-br from-primary to-primary/90 text-primary-foreground border-0">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                {latestDecision ? (
                  <>
                    <div className="mb-4">
                      <OutcomePill outcome={latestDecision.outcome as EligibilityOutcome} />
                    </div>
                    <h2 className="text-2xl font-bold mb-3">Your Eligibility Status</h2>
                    <p className="text-primary-foreground/80 mb-6 max-w-md leading-relaxed line-clamp-3">
                      {latestDecision.explanationText}
                    </p>
                    <p className="text-primary-foreground/60 text-xs mb-6">
                      Last checked: {new Date(latestDecision.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })} · Ruleset v{latestDecision.rulesetVersion}
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
                    {latestDecision ? "View Full Report" : "Run Check Now"} <ArrowRight className="w-5 h-5 ml-2" />
                  </Button>
                </Link>
              </div>
              <ShieldCheck className="w-32 h-32 text-white/10 hidden md:block flex-shrink-0" />
            </div>
          </Card>

          {/* Profile Summary Card */}
          <Card className="p-6 flex flex-col">
            <h3 className="text-lg font-semibold mb-4 flex items-center">
              <span className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center mr-3">
                <FileText className="w-4 h-4" />
              </span>
              Profile Snapshot
            </h3>
            
            <div className="space-y-4 flex-1">
              <div>
                <p className="text-sm text-muted-foreground">Profession</p>
                <p className="font-medium capitalize">{profile?.profession?.replace(/_/g, ' ') || 'Not set'}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Registration</p>
                <p className="font-medium capitalize">{profile?.registrationStatus?.replace(/_/g, ' ') || 'Not set'}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Experience</p>
                <p className="font-medium">{profile?.experienceYears ? `${profile.experienceYears} Years` : 'Not set'}</p>
              </div>
            </div>

            <div className="mt-6 pt-6 border-t border-border">
              <Link href="/profile" className="inline-flex w-full">
                <Button variant="outline" className="w-full">Update Profile</Button>
              </Link>
            </div>
          </Card>
        </div>

      </PageTransition>
    </AppLayout>
  );
}
