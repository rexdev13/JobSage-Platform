import { AppLayout } from "@/components/layout/AppLayout";
import { Card, Button, PageTransition } from "@/components/ui-enhanced";
import { useGetMyProgressReport } from "@workspace/api-client-react";
import { motion } from "framer-motion";
import {
  BarChart2,
  TrendingUp,
  ClipboardList,
  FileText,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  Target,
  Users,
  RefreshCw,
  Megaphone,
} from "lucide-react";
import { Link } from "wouter";

function StatTile({ label, value, sub, icon: Icon, color }: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ElementType;
  color: string;
}) {
  return (
    <Card className="p-5 flex items-center gap-4">
      <div className={`w-11 h-11 rounded-xl ${color} flex items-center justify-center shrink-0`}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-2xl font-bold text-foreground leading-tight">{value}</p>
        {sub && <p className="text-xs text-muted-foreground truncate">{sub}</p>}
      </div>
    </Card>
  );
}

function ProgressBar({ pct, color = "bg-primary" }: { pct: number; color?: string }) {
  return (
    <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
      <div
        className={`${color} h-full rounded-full transition-all duration-700`}
        style={{ width: `${Math.min(100, pct)}%` }}
      />
    </div>
  );
}

export default function MyProgressReportPage() {
  const { data, isLoading, isError, refetch, isFetching } = useGetMyProgressReport();

  if (isLoading) {
    return (
      <AppLayout>
        <div className="p-6 max-w-4xl mx-auto space-y-4">
          <div className="h-8 bg-muted rounded-xl w-1/3 animate-pulse" />
          <div className="grid grid-cols-2 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-24 bg-muted rounded-xl animate-pulse" />
            ))}
          </div>
          <div className="h-48 bg-muted rounded-xl animate-pulse" />
        </div>
      </AppLayout>
    );
  }

  if (isError) {
    return (
      <AppLayout>
        <div className="p-6 max-w-4xl mx-auto">
          <Card className="p-12 text-center">
            <AlertCircle className="w-12 h-12 text-destructive/40 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-foreground mb-2">Failed to load your report</h3>
            <p className="text-sm text-muted-foreground mb-4">Please check your profile is complete and try again.</p>
            <Button onClick={() => refetch()} size="sm">Retry</Button>
          </Card>
        </div>
      </AppLayout>
    );
  }

  const stats = data!.stats;
  const plan = data!.plan;
  const eligibility = data!.eligibility;
  const period = data!.period;
  const recommendations = data!.recommendations;
  const disclaimer = data!.disclaimer;

  const responseRate = stats.responseRate;

  return (
    <AppLayout>
      <PageTransition>
        <div className="p-6 max-w-4xl mx-auto space-y-6">
          {/* Header */}
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                  <BarChart2 className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h1 className="text-2xl font-display font-bold text-foreground">My Progress Report</h1>
                  <p className="text-sm text-muted-foreground">
                    {period.month} {period.year} · Your UK healthcare journey at a glance
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetch()}
                disabled={isFetching}
                className="gap-2"
              >
                <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </div>
          </motion.div>

          {/* Application stats grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
              <StatTile
                label="Applications This Month"
                value={stats.applicationsThisMonth}
                sub={`${stats.total} total`}
                icon={ClipboardList}
                color="bg-primary/10 text-primary"
              />
            </motion.div>
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
              <StatTile
                label="Interviews"
                value={stats.interviews}
                sub={stats.offers > 0 ? `${stats.offers} offer${stats.offers > 1 ? "s" : ""}` : "Keep applying!"}
                icon={Users}
                color="bg-violet-500/10 text-violet-600"
              />
            </motion.div>
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.13 }}>
              <StatTile
                label="Response Rate"
                value={`${responseRate}%`}
                sub={stats.noResponse > 0 ? `${stats.noResponse} no response` : "Great engagement!"}
                icon={TrendingUp}
                color="bg-emerald-500/10 text-emerald-600"
              />
            </motion.div>
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.16 }}>
              <StatTile
                label="Documents"
                value={data!.documentCount}
                sub="uploaded to your profile"
                icon={FileText}
                color="bg-sky-500/10 text-sky-600"
              />
            </motion.div>
          </div>

          {/* Progress rows */}
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
            <Card className="p-6 space-y-6">
              <h2 className="text-base font-semibold text-foreground">Journey Progress</h2>

              {/* Remediation plan */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-foreground flex items-center gap-2">
                    <Target className="w-4 h-4 text-primary" />
                    Remediation Plan
                  </span>
                  <span className="text-sm font-bold text-foreground">
                    {plan.stepsDone}/{plan.stepsTotal} steps · {plan.progressPct}%
                  </span>
                </div>
                <ProgressBar
                  pct={plan.progressPct}
                  color={plan.progressPct === 100 ? "bg-emerald-500" : "bg-primary"}
                />
                {plan.stepsTotal === 0 && (
                  <p className="text-xs text-muted-foreground mt-1">
                    No plan yet —{" "}
                    <Link href="/eligibility" className="text-primary hover:underline">run your eligibility check</Link>{" "}
                    to generate one.
                  </p>
                )}
              </div>

              {/* Eligibility */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-foreground flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-primary" />
                    Eligibility
                  </span>
                  <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${
                    eligibility.outcome === "eligible"
                      ? "bg-emerald-100 text-emerald-800"
                      : eligibility.outcome === "not_eligible"
                        ? "bg-amber-100 text-amber-800"
                        : "bg-muted text-muted-foreground"
                  }`}>
                    {eligibility.outcome === "eligible"
                      ? "Eligible"
                      : eligibility.outcome === "not_eligible"
                        ? "Not Yet Eligible"
                        : eligibility.checkedAt
                          ? "Checked"
                          : "Not Checked"}
                  </span>
                </div>
                {eligibility.checkedAt ? (
                  <p className="text-xs text-muted-foreground">
                    Last checked:{" "}
                    {new Date(eligibility.checkedAt).toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    <Link href="/eligibility" className="text-primary hover:underline">
                      Run your eligibility check
                    </Link>{" "}
                    to see your status.
                  </p>
                )}
              </div>

              {/* Profile boost status */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-foreground flex items-center gap-2">
                    <Megaphone className="w-4 h-4 text-primary" />
                    Profile Boost
                  </span>
                  <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${
                    data!.boostProfile
                      ? "bg-emerald-100 text-emerald-800"
                      : "bg-muted text-muted-foreground"
                  }`}>
                    {data!.boostProfile ? "Active" : "Inactive"}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {data!.boostProfile
                    ? "Your profile is visible to headhunting NHS employers."
                    : "Enable profile boost on your Dashboard to be visible to employers."}
                </p>
              </div>
            </Card>
          </motion.div>

          {/* AI Recommendations */}
          {recommendations && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}>
              <Card className="p-6 border-primary/20 bg-gradient-to-br from-primary/5 to-accent/5">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
                    <Sparkles className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold text-foreground">AI Recommended Next Steps</h2>
                    <p className="text-xs text-muted-foreground">Personalised to your current journey stage</p>
                  </div>
                </div>

                <div className="space-y-3">
                  {recommendations
                    .split("\n")
                    .filter((line) => line.trim())
                    .map((line, i) => (
                      <div key={i} className="flex items-start gap-3 text-sm text-foreground leading-relaxed">
                        <span className="text-primary shrink-0 mt-0.5 font-bold text-base">•</span>
                        <span>{line.replace(/^•\s*/, "")}</span>
                      </div>
                    ))}
                </div>

                {disclaimer && (
                  <p className="text-xs text-muted-foreground mt-4 pt-4 border-t border-border/50">
                    {disclaimer}
                  </p>
                )}
              </Card>
            </motion.div>
          )}

          {/* Quick links */}
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Link href="/path">
                <Card className="p-4 hover:shadow-md hover:border-primary/20 transition-all cursor-pointer group flex items-center gap-3">
                  <Target className="w-5 h-5 text-primary group-hover:scale-110 transition-transform" />
                  <div>
                    <p className="text-sm font-semibold text-foreground">My Path</p>
                    <p className="text-xs text-muted-foreground">View remediation steps</p>
                  </div>
                </Card>
              </Link>
              <Link href="/applications">
                <Card className="p-4 hover:shadow-md hover:border-primary/20 transition-all cursor-pointer group flex items-center gap-3">
                  <ClipboardList className="w-5 h-5 text-primary group-hover:scale-110 transition-transform" />
                  <div>
                    <p className="text-sm font-semibold text-foreground">My Applications</p>
                    <p className="text-xs text-muted-foreground">Track job applications</p>
                  </div>
                </Card>
              </Link>
              <Link href="/regulatory-guidance">
                <Card className="p-4 hover:shadow-md hover:border-primary/20 transition-all cursor-pointer group flex items-center gap-3">
                  <CheckCircle2 className="w-5 h-5 text-primary group-hover:scale-110 transition-transform" />
                  <div>
                    <p className="text-sm font-semibold text-foreground">Regulatory Guidance</p>
                    <p className="text-xs text-muted-foreground">Registration pathways</p>
                  </div>
                </Card>
              </Link>
            </div>
          </motion.div>
        </div>
      </PageTransition>
    </AppLayout>
  );
}
