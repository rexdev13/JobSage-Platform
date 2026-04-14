import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, Button, PageTransition } from "@/components/ui-enhanced";
import {
  useListMatchedRoles,
  useListMyApplications,
  useMarkApplication,
  getListMyApplicationsQueryKey,
  getListMatchedRolesQueryKey,
  type MatchedRole,
  type ApplicationList,
} from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import {
  Briefcase,
  MapPin,
  Building2,
  CheckCircle2,
  XCircle,
  HelpCircle,
  AlertCircle,
  ArrowRight,
  Star,
  ChevronDown,
  ChevronUp,
  X,
  Megaphone,
  ClipboardList,
  Linkedin,
  Globe,
  TrendingUp,
  Search,
  BadgeCheck,
  Clock,
  DollarSign,
} from "lucide-react";
import { DisclaimerBanner } from "@/components/ui/DisclaimerBanner";
import { motion, AnimatePresence } from "framer-motion";

type Tab = "board" | "employers" | "applications";

function SponsorshipBadge({ outcome }: { outcome: "feasible" | "not_feasible" | "uncertain" | undefined }) {
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

function MatchScoreBadge({ score }: { score: number }) {
  const color =
    score >= 80 ? "bg-emerald-100 text-emerald-800" : score >= 50 ? "bg-blue-100 text-blue-800" : "bg-muted text-muted-foreground";
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold ${color}`}>
      <Star className="w-3 h-3" /> {score}% match
    </span>
  );
}

function RoleDetailModal({ item, appliedRoleIds, onClose, onApply }: {
  item: MatchedRole;
  appliedRoleIds: number[];
  onClose: () => void;
  onApply: (roleId: number) => void;
}) {
  const [, setLocation] = useLocation();
  const { role, isEligible, matchScore, eligibilityGaps, sponsorshipFeasibility } = item;
  const applied = appliedRoleIds.includes(role.id);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        className="relative bg-background rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto z-10"
      >
        <div className={`h-2 rounded-t-2xl ${isEligible ? "bg-gradient-to-r from-emerald-500 to-green-400" : "bg-gradient-to-r from-amber-400 to-orange-400"}`} />
        <div className="p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="text-xl font-bold text-foreground">{role.title}</h2>
              <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
                <span className="flex items-center gap-1"><Building2 className="w-3.5 h-3.5" /> {role.employer}</span>
                <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /> {role.location}</span>
              </div>
            </div>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1 rounded-lg hover:bg-muted transition-colors ml-2">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex flex-wrap gap-2 mb-4">
            {isEligible ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">
                <BadgeCheck className="w-3.5 h-3.5" /> Eligible Now
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800">
                <Clock className="w-3.5 h-3.5" /> Not Yet Eligible
              </span>
            )}
            <MatchScoreBadge score={matchScore} />
            <SponsorshipBadge outcome={sponsorshipFeasibility?.outcome} />
          </div>

          <div className="space-y-3 mb-5">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="p-3 rounded-lg bg-muted/40">
                <p className="text-xs text-muted-foreground mb-0.5">Regulator</p>
                <p className="font-semibold">{role.regulator}</p>
              </div>
              <div className="p-3 rounded-lg bg-muted/40">
                <p className="text-xs text-muted-foreground mb-0.5">Required Registration</p>
                <p className="font-semibold text-xs leading-tight">{role.requiredRegistration}</p>
              </div>
              <div className="p-3 rounded-lg bg-muted/40">
                <p className="text-xs text-muted-foreground mb-0.5">Sponsorship Offered</p>
                <p className="font-semibold">{role.sponsorshipOffered ? "Yes" : "No"}</p>
              </div>
            </div>
          </div>

          {!isEligible && eligibilityGaps && eligibilityGaps.length > 0 && (
            <div className="mb-4 p-4 rounded-xl bg-amber-50 border border-amber-200">
              <p className="text-xs font-semibold text-amber-800 mb-2 uppercase tracking-wide">Why you&apos;re not yet eligible</p>
              <ul className="space-y-1.5">
                {eligibilityGaps.map((gap, i) => (
                  <li key={i} className="text-xs text-amber-800 flex items-start gap-2">
                    <span className="text-amber-500 mt-0.5">•</span> {gap}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {sponsorshipFeasibility && (
            <div className="mb-4 p-3 rounded-xl bg-blue-50 border border-blue-100 text-xs text-blue-800">
              <p className="font-semibold mb-0.5">Sponsorship note:</p>
              <p>{sponsorshipFeasibility.explanation}</p>
              {sponsorshipFeasibility.disclaimer && (
                <p className="mt-1 italic text-blue-700">{sponsorshipFeasibility.disclaimer}</p>
              )}
            </div>
          )}

          <div className="flex gap-3">
            {isEligible ? (
              <Button
                className="flex-1"
                onClick={() => { onApply(role.id); onClose(); }}
                disabled={applied}
              >
                {applied ? <><CheckCircle2 className="w-4 h-4 mr-2" /> Applied</> : <><ClipboardList className="w-4 h-4 mr-2" /> Mark as Applied</>}
              </Button>
            ) : (
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => { onClose(); setLocation("/path"); }}
              >
                View Remediation Path <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function RoleCard({
  item,
  appliedRoleIds,
  onApply,
  onViewDetail,
}: {
  item: MatchedRole;
  appliedRoleIds: number[];
  onApply: (roleId: number) => void;
  onViewDetail: (item: MatchedRole) => void;
}) {
  const [, setLocation] = useLocation();
  const { role, isEligible, matchScore, eligibilityGaps, sponsorshipFeasibility } = item;
  const [expanded, setExpanded] = useState(false);
  const applied = appliedRoleIds.includes(role.id);

  return (
    <Card
      className={`p-5 hover:shadow-md transition-all cursor-pointer ${isEligible ? "border-emerald-100 hover:border-emerald-200" : "hover:border-amber-100"}`}
      onClick={() => onViewDetail(item)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            {isEligible ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">
                <BadgeCheck className="w-3 h-3" /> Eligible Now
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800">
                <Clock className="w-3 h-3" /> Not Yet Eligible
              </span>
            )}
            <MatchScoreBadge score={matchScore} />
          </div>
          <h3 className="text-base font-semibold text-foreground">{role.title}</h3>
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
        {applied && (
          <span className="shrink-0 inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-800">
            <CheckCircle2 className="w-3 h-3" /> Applied
          </span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <SponsorshipBadge outcome={sponsorshipFeasibility?.outcome} />
        {role.sponsorshipOffered && (
          <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
            Sponsorship Available
          </span>
        )}
      </div>

      {!isEligible && eligibilityGaps && eligibilityGaps.length > 0 && (
        <div className="mt-3">
          <button
            className="text-xs text-amber-700 hover:text-amber-900 flex items-center gap-1 transition-colors"
            onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
          >
            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            {expanded ? "Hide" : "See"} eligibility gaps
          </button>
          {expanded && (
            <div className="mt-2 p-3 rounded-lg bg-amber-50 border border-amber-100">
              <ul className="space-y-1">
                {eligibilityGaps.map((gap, i) => (
                  <li key={i} className="text-xs text-amber-800 flex items-start gap-1.5">
                    <span className="text-amber-500 mt-0.5 shrink-0">•</span> {gap}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div
        className="mt-4 flex items-center justify-between"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="text-xs text-muted-foreground">
          Required: <span className="font-medium text-foreground">{role.requiredRegistration}</span>
        </span>
        <div className="flex gap-2">
          {isEligible && (
            <Button
              size="sm"
              variant={applied ? "outline" : "default"}
              className="text-xs h-8"
              onClick={() => onApply(role.id)}
              disabled={applied}
            >
              {applied ? "Applied" : "Mark Applied"}
            </Button>
          )}
          {!isEligible && (
            <Button
              size="sm"
              variant="ghost"
              className="text-xs h-8 text-amber-700"
              onClick={(e) => { e.stopPropagation(); setLocation("/path"); }}
            >
              View path <ArrowRight className="w-3 h-3 ml-1" />
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

function EmployerCard({ employer, roles }: { employer: string; roles: MatchedRole[] }) {
  const sponsorsCount = roles.filter((r) => r.role.sponsorshipOffered).length;
  const locations = [...new Set(roles.map((r) => r.role.location))].slice(0, 2);
  const regulator = roles[0]?.role.regulator;

  return (
    <Card className="p-5 hover:shadow-md transition-shadow">
      <div className="flex items-start gap-3 mb-3">
        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary font-bold text-sm shrink-0">
          {employer.charAt(0)}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-foreground text-sm leading-tight truncate">{employer}</h3>
          <p className="text-xs text-muted-foreground">{regulator} · {locations.join(", ")}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 items-center mb-3">
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-muted">
          <Briefcase className="w-3 h-3" /> {roles.length} open role{roles.length !== 1 ? "s" : ""}
        </span>
        {sponsorsCount > 0 && (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-800">
            <CheckCircle2 className="w-3 h-3" /> Offers sponsorship
          </span>
        )}
      </div>

      <div className="flex gap-2">
        <a
          href={`https://www.linkedin.com/search/results/companies/?keywords=${encodeURIComponent(employer)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0077B5]/10 text-[#0077B5] text-xs font-medium hover:bg-[#0077B5]/20 transition-colors"
        >
          <Linkedin className="w-3.5 h-3.5" /> LinkedIn
        </a>
        <a
          href={`https://www.google.com/search?q=${encodeURIComponent(employer + " healthcare careers")}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted text-muted-foreground text-xs font-medium hover:bg-muted/80 transition-colors"
        >
          <Globe className="w-3.5 h-3.5" /> Web
        </a>
      </div>
    </Card>
  );
}

function ApplicationsTab({ data }: { data: ApplicationList | undefined }) {
  if (!data) {
    return (
      <Card className="p-8 text-center">
        <ClipboardList className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
        <p className="text-sm text-muted-foreground">No applications tracked yet.</p>
        <p className="text-xs text-muted-foreground mt-1">Use &quot;Mark Applied&quot; on eligible roles to track your journey.</p>
      </Card>
    );
  }

  const { applications, stats } = data;

  const statusConfig: Record<string, { label: string; className: string }> = {
    applied: { label: "Applied", className: "bg-blue-100 text-blue-800" },
    shortlisted: { label: "Shortlisted", className: "bg-purple-100 text-purple-800" },
    interview: { label: "Interview", className: "bg-violet-100 text-violet-800" },
    offer: { label: "Offer", className: "bg-emerald-100 text-emerald-800" },
    rejected: { label: "Rejected", className: "bg-red-100 text-red-700" },
    no_response: { label: "No Response", className: "bg-muted text-muted-foreground" },
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "Total Applied", value: stats.total, color: "text-foreground" },
          { label: "Interviews", value: stats.interviews, color: "text-violet-700" },
          { label: "Offers", value: stats.offers, color: "text-emerald-700" },
          { label: "No Response", value: stats.noResponse, color: "text-muted-foreground" },
        ].map(({ label, value, color }) => (
          <Card key={label} className="p-3 text-center">
            <p className={`text-2xl font-bold ${color}`}>{value}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
          </Card>
        ))}
      </div>

      {applications.length === 0 ? (
        <Card className="p-8 text-center">
          <ClipboardList className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No applications tracked yet.</p>
          <p className="text-xs text-muted-foreground mt-1">Use &quot;Mark Applied&quot; on eligible roles to track your journey.</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {applications.map((app) => {
            const config = statusConfig[app.status] ?? statusConfig.applied;
            return (
              <Card key={app.id} className="p-4 flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">Role #{app.roleId}</p>
                  <p className="text-xs text-muted-foreground">
                    Applied {new Date(app.appliedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                  </p>
                </div>
                <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${config.className}`}>
                  {config.label}
                </span>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SelfPromotionCard() {
  const [budget, setBudget] = useState("");
  return (
    <Card className="p-5 border-dashed border-2 border-primary/20 bg-gradient-to-br from-primary/3 to-accent/3">
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
          <Megaphone className="w-5 h-5 text-primary" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-sm font-semibold text-foreground">Boost Your Profile</h3>
            <span className="px-1.5 py-0.5 text-xs rounded bg-primary/10 text-primary font-medium">Coming Soon</span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed mb-3">
            Premium candidates can promote their profile to NHS trusts and academic institutions actively recruiting in their specialty.
          </p>
          <div className="flex items-center gap-2">
            <div className="relative flex-1 max-w-[160px]">
              <DollarSign className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="number"
                min="0"
                step="10"
                placeholder="Monthly budget"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                disabled
                className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-border bg-background/50 text-muted-foreground cursor-not-allowed"
              />
            </div>
            <Button size="sm" className="text-xs" disabled>
              Set Budget &amp; Go Live
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

export default function OpportunitiesPage() {
  const [, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState<Tab>("board");
  const [selectedRole, setSelectedRole] = useState<MatchedRole | null>(null);
  const [employerSearch, setEmployerSearch] = useState("");

  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useListMatchedRoles();
  const { data: applicationsData } = useListMyApplications();
  const markApplicationMutation = useMarkApplication();
  const { toast } = useToast();

  const roles = data?.roles ?? [];
  const appliedRoleIds = data?.appliedRoleIds ?? [];
  const eligibilityOutcome = data?.eligibilityOutcome;

  const eligibleRoles = roles.filter((r) => r.isEligible).sort((a, b) => b.matchScore - a.matchScore);
  const notYetEligibleRoles = roles.filter((r) => !r.isEligible).sort((a, b) => b.matchScore - a.matchScore);

  const employerGroups = Object.entries(
    roles.reduce<Record<string, MatchedRole[]>>((acc, r) => {
      const key = r.role.employer;
      acc[key] ??= [];
      acc[key].push(r);
      return acc;
    }, {}),
  ).filter(([emp]) => emp.toLowerCase().includes(employerSearch.toLowerCase()));

  function handleApply(roleId: number) {
    if (appliedRoleIds.includes(roleId)) return;
    markApplicationMutation.mutate(
      { data: { roleId } },
      {
        onSuccess: () => {
          void queryClient.invalidateQueries({ queryKey: getListMyApplicationsQueryKey() });
          void queryClient.invalidateQueries({ queryKey: getListMatchedRolesQueryKey() });
          toast({ title: "Application tracked", description: "Role marked as applied. Check 'My Applications' for tracking." });
        },
        onError: () => {
          toast({ title: "Error", description: "Could not track application. Please try again.", variant: "destructive" });
        },
      },
    );
  }

  const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: "board", label: "Job Board", icon: Briefcase },
    { id: "employers", label: "Employer Discovery", icon: Building2 },
    { id: "applications", label: "My Applications", icon: ClipboardList },
  ];

  return (
    <AppLayout>
      <PageTransition className="max-w-4xl mx-auto p-6 space-y-6">
        <DisclaimerBanner />

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-display font-bold text-foreground">Opportunities</h1>
            <p className="text-muted-foreground mt-1 text-sm">
              {data
                ? `${eligibleRoles.length} eligible now · ${notYetEligibleRoles.length} to work towards`
                : "Roles matched to your regulatory eligibility."}
            </p>
          </div>
          {eligibilityOutcome && (
            <div className={`px-3 py-1.5 rounded-full text-xs font-semibold flex items-center gap-1.5 ${
              eligibilityOutcome === "eligible"
                ? "bg-emerald-100 text-emerald-800"
                : "bg-amber-100 text-amber-800"
            }`}>
              {eligibilityOutcome === "eligible" ? (
                <><BadgeCheck className="w-3.5 h-3.5" /> Eligible</>
              ) : (
                <><Clock className="w-3.5 h-3.5" /> Building eligibility</>
              )}
            </div>
          )}
        </div>

        {/* Tab navigation */}
        <div className="flex gap-1 p-1 bg-muted rounded-xl">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === id
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="w-4 h-4" />
              <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </div>

        {/* Loading / error states */}
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
            <p className="text-xs text-muted-foreground mt-1">Complete your profile and run an eligibility check to see matched roles.</p>
            <Button size="sm" className="mt-4" onClick={() => setLocation("/eligibility")}>
              Run Eligibility Check <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </Card>
        )}

        {/* Job Board tab */}
        {!isLoading && !isError && activeTab === "board" && (
          <div className="space-y-8">
            {roles.length === 0 ? (
              <Card className="p-8 text-center">
                <Briefcase className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
                <h2 className="text-lg font-semibold mb-2">No roles in catalogue yet</h2>
                <p className="text-sm text-muted-foreground mb-4">
                  {!data
                    ? "Complete your eligibility assessment first."
                    : "No roles have been imported for your profession yet. Check back soon."}
                </p>
                <Button onClick={() => setLocation("/eligibility")}>
                  Run Eligibility Check <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </Card>
            ) : (
              <>
                {/* Eligible Now section */}
                {eligibleRoles.length > 0 && (
                  <section>
                    <div className="flex items-center gap-2 mb-4">
                      <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                      <h2 className="text-base font-semibold text-foreground">
                        Eligible Now
                        <span className="ml-2 text-xs font-normal text-muted-foreground">({eligibleRoles.length})</span>
                      </h2>
                    </div>
                    <div className="space-y-4">
                      {eligibleRoles.map((item) => (
                        <motion.div
                          key={item.role.id}
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                        >
                          <RoleCard
                            item={item}
                            appliedRoleIds={appliedRoleIds}
                            onApply={handleApply}
                            onViewDetail={setSelectedRole}
                          />
                        </motion.div>
                      ))}
                    </div>
                  </section>
                )}

                {/* Not Yet Eligible section */}
                {notYetEligibleRoles.length > 0 && (
                  <section>
                    <div className="flex items-center gap-2 mb-4">
                      <div className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                      <h2 className="text-base font-semibold text-foreground">
                        Not Yet Eligible — Work Towards These
                        <span className="ml-2 text-xs font-normal text-muted-foreground">({notYetEligibleRoles.length})</span>
                      </h2>
                    </div>

                    {!eligibilityOutcome && (
                      <Card className="p-4 mb-4 border-amber-200 bg-amber-50">
                        <p className="text-sm text-amber-800 flex items-start gap-2">
                          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                          Run your eligibility assessment to see a personalised match score and gap analysis for each role.
                        </p>
                        <Button size="sm" className="mt-3" onClick={() => setLocation("/eligibility")}>
                          Run Eligibility Check
                        </Button>
                      </Card>
                    )}

                    <div className="space-y-4">
                      {notYetEligibleRoles.map((item) => (
                        <motion.div
                          key={item.role.id}
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                        >
                          <RoleCard
                            item={item}
                            appliedRoleIds={appliedRoleIds}
                            onApply={handleApply}
                            onViewDetail={setSelectedRole}
                          />
                        </motion.div>
                      ))}
                    </div>
                  </section>
                )}

                {eligibleRoles.length === 0 && notYetEligibleRoles.length > 0 && (
                  <Card className="p-5 border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50">
                    <div className="flex items-start gap-3">
                      <TrendingUp className="w-6 h-6 text-amber-600 shrink-0 mt-0.5" />
                      <div>
                        <p className="font-semibold text-amber-900 text-sm">You&apos;re on your way</p>
                        <p className="text-xs text-amber-800 mt-0.5 leading-relaxed">
                          Complete your remediation steps to unlock eligible roles. Your personalised action plan shows exactly what&apos;s needed.
                        </p>
                        <Button
                          size="sm"
                          variant="outline"
                          className="mt-3 border-amber-300 text-amber-800 hover:bg-amber-100"
                          onClick={() => setLocation("/path")}
                        >
                          View My Remediation Plan <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
                        </Button>
                      </div>
                    </div>
                  </Card>
                )}
              </>
            )}
          </div>
        )}

        {/* Employer Discovery tab */}
        {!isLoading && !isError && activeTab === "employers" && (
          <div className="space-y-4">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search employers…"
                value={employerSearch}
                onChange={(e) => setEmployerSearch(e.target.value)}
                className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>

            {employerGroups.length === 0 ? (
              <Card className="p-8 text-center">
                <Building2 className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">
                  {roles.length === 0
                    ? "No employers in catalogue yet. Roles are imported by administrators."
                    : "No employers match your search."}
                </p>
              </Card>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">
                  {employerGroups.length} employer{employerGroups.length !== 1 ? "s" : ""} with roles in your field
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {employerGroups.map(([employer, empRoles]) => (
                    <EmployerCard key={employer} employer={employer} roles={empRoles} />
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* My Applications tab */}
        {activeTab === "applications" && (
          <ApplicationsTab data={applicationsData} />
        )}

        {/* Self-promotion placeholder */}
        {activeTab === "board" && !isLoading && !isError && (
          <SelfPromotionCard />
        )}
      </PageTransition>

      {/* Role detail modal */}
      <AnimatePresence>
        {selectedRole && (
          <RoleDetailModal
            item={selectedRole}
            appliedRoleIds={appliedRoleIds}
            onClose={() => setSelectedRole(null)}
            onApply={(roleId) => { handleApply(roleId); setSelectedRole(null); }}
          />
        )}
      </AnimatePresence>
    </AppLayout>
  );
}
