import { AppLayout } from "@/components/layout/AppLayout";
import { Card, PageTransition } from "@/components/ui-enhanced";
import { useListMatchedRoles } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { Briefcase, MapPin, Building2, CheckCircle2, XCircle, HelpCircle, AlertCircle, ArrowRight } from "lucide-react";

function SponsorshipBadge({
  outcome,
}: {
  outcome: "feasible" | "not_feasible" | "uncertain" | undefined;
}) {
  if (!outcome) return null;
  if (outcome === "feasible")
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-800">
        <CheckCircle2 className="w-3 h-3" /> Sponsorship: Feasible
      </span>
    );
  if (outcome === "not_feasible")
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700">
        <XCircle className="w-3 h-3" /> Sponsorship: Not Feasible
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800">
      <HelpCircle className="w-3 h-3" /> Sponsorship: Uncertain
    </span>
  );
}

export default function OpportunitiesPage() {
  const [, setLocation] = useLocation();
  const { data, isLoading, isError } = useListMatchedRoles();

  const outcome = data?.eligibilityOutcome;
  const roles = data?.roles ?? [];

  return (
    <AppLayout>
      <PageTransition className="max-w-4xl mx-auto p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground">Opportunities</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Roles matched to your regulatory eligibility.
          </p>
        </div>

        {isLoading && (
          <Card className="p-8 text-center">
            <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-muted-foreground text-sm">Loading opportunities…</p>
          </Card>
        )}

        {isError && (
          <Card className="p-8 text-center border-destructive/20">
            <AlertCircle className="w-10 h-10 text-destructive mx-auto mb-3" />
            <p className="text-sm text-destructive font-medium">Could not load opportunities.</p>
            <p className="text-xs text-muted-foreground mt-1">
              Please complete your eligibility assessment first.
            </p>
          </Card>
        )}

        {!isLoading && !isError && outcome !== "eligible" && (
          <Card className="p-8 text-center border-amber-200">
            <div className="w-14 h-14 rounded-full bg-amber-50 flex items-center justify-center mx-auto mb-4">
              <Briefcase className="w-7 h-7 text-amber-600" />
            </div>
            <h2 className="text-lg font-semibold text-foreground mb-2">No Matched Roles Yet</h2>
            <p className="text-sm text-muted-foreground mb-5 max-w-sm mx-auto">
              {data?.message ??
                "You need to achieve regulatory eligibility before matched roles are shown. View your remediation plan to understand what steps are needed."}
            </p>
            <button
              onClick={() => setLocation("/path")}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
            >
              View My Remediation Plan <ArrowRight className="w-4 h-4" />
            </button>
          </Card>
        )}

        {!isLoading && !isError && outcome === "eligible" && roles.length === 0 && (
          <Card className="p-8 text-center">
            <Briefcase className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <h2 className="text-lg font-semibold text-foreground mb-1">No Roles in Catalogue</h2>
            <p className="text-sm text-muted-foreground">
              You are eligible for registration. No roles have been imported yet — check back soon.
            </p>
          </Card>
        )}

        {!isLoading && !isError && outcome === "eligible" && roles.length > 0 && (
          <>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <CheckCircle2 className="w-4 h-4 text-green-500" />
              <span>
                {roles.length} matched role{roles.length !== 1 ? "s" : ""} — based on decision #{data?.decisionRecordId} (ruleset v{data?.rulesetVersion})
              </span>
            </div>

            <div className="space-y-4">
              {roles.map(({ role, explanation, sponsorshipFeasibility, rulesetVersion, decisionRecordId, ruleId }) => (
                <Card key={role.id} className="p-5 hover:shadow-md transition-shadow">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <h3 className="text-base font-semibold text-foreground truncate">{role.title}</h3>
                      <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground flex-wrap">
                        <span className="flex items-center gap-1">
                          <Building2 className="w-3.5 h-3.5" /> {role.employer}
                        </span>
                        <span className="flex items-center gap-1">
                          <MapPin className="w-3.5 h-3.5" /> {role.location}
                        </span>
                        <span className="px-1.5 py-0.5 text-xs rounded bg-muted text-muted-foreground font-mono">
                          {role.regulator}
                        </span>
                      </div>
                    </div>
                    <span className="shrink-0 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-800">
                      Matched
                    </span>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {sponsorshipFeasibility && (
                      <SponsorshipBadge outcome={sponsorshipFeasibility.outcome} />
                    )}
                    {role.sponsorshipOffered && (
                      <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                        Sponsorship Available
                      </span>
                    )}
                  </div>

                  <div className="mt-3 p-3 rounded-lg bg-muted/40 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">Why this role is shown: </span>
                    {explanation}
                  </div>

                  {sponsorshipFeasibility && (
                    <div className="mt-2 p-3 rounded-lg bg-amber-50 border border-amber-100 text-xs text-amber-800">
                      <span className="font-medium">Sponsorship note: </span>
                      {sponsorshipFeasibility.explanation}
                      <p className="mt-1 italic text-amber-700">{sponsorshipFeasibility.disclaimer}</p>
                    </div>
                  )}

                  <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                    <span>
                      Required registration: <span className="font-medium text-foreground">{role.requiredRegistration}</span>
                    </span>
                    <span className="ml-auto">
                      Ruleset v{rulesetVersion} · Decision #{decisionRecordId}
                      {ruleId != null && ` · Rule #${ruleId}`}
                    </span>
                  </div>
                </Card>
              ))}
            </div>
          </>
        )}
      </PageTransition>
    </AppLayout>
  );
}
