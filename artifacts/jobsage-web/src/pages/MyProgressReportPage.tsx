import { useEffect } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, Button, PageTransition } from "@/components/ui-enhanced";
import { useGetMyProgressReport, useGetMyAnalytics } from "@workspace/api-client-react";
import { motion, useMotionValue, useTransform, animate } from "framer-motion";
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
  Activity,
  Zap,
  Building2,
  MapPin,
} from "lucide-react";
import { Link } from "wouter";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  BarChart,
  Bar,
  Cell,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  Radar,
} from "recharts";

const RING_R = 44;
const RING_CIRC = 2 * Math.PI * RING_R;

function ringStroke(score: number) {
  if (score >= 90) return "#22c55e";
  if (score >= 70) return "hsl(var(--primary))";
  if (score >= 40) return "#f59e0b";
  return "hsl(var(--destructive))";
}

function scoreLabel(score: number) {
  if (score >= 80) return { text: "Strong Progress", cls: "bg-emerald-500/20 text-emerald-300" };
  if (score >= 60) return { text: "Good Momentum", cls: "bg-sky-500/20 text-sky-300" };
  if (score >= 40) return { text: "Building Up", cls: "bg-amber-500/20 text-amber-300" };
  return { text: "Getting Started", cls: "bg-rose-500/20 text-rose-300" };
}

function AnimatedNumber({ value, suffix = "" }: { value: number; suffix?: string }) {
  const mv = useMotionValue(0);
  const display = useTransform(mv, (v) => `${Math.round(v)}${suffix}`);
  useEffect(() => {
    const ctrl = animate(mv, value, { duration: 1.4, ease: "easeOut" });
    return ctrl.stop;
  }, [value, mv]);
  return <motion.span>{display}</motion.span>;
}

const BREAKDOWN_LABELS: Record<string, string> = {
  eligibility: "Eligibility",
  planProgress: "Plan",
  documents: "Docs",
  applications: "Apps",
  profileComplete: "Profile",
};

const BREAKDOWN_MAX: Record<string, number> = {
  eligibility: 30,
  planProgress: 25,
  documents: 20,
  applications: 15,
  profileComplete: 10,
};

const STATUS_COLORS: Record<string, string> = {
  applied: "hsl(var(--primary))",
  shortlisted: "#0ea5e9",
  interview: "#8b5cf6",
  offer: "#22c55e",
  rejected: "#f43f5e",
  no_response: "#6b7280",
};

const STATUS_LABELS: Record<string, string> = {
  applied: "Applied",
  shortlisted: "Shortlisted",
  interview: "Interview",
  offer: "Offer",
  rejected: "Rejected",
  no_response: "No Response",
};

export default function MyProgressReportPage() {
  const {
    data: report,
    isLoading: loadingReport,
    isError: errorReport,
    refetch: refetchReport,
    isFetching: fetchingReport,
  } = useGetMyProgressReport();

  const {
    data: analytics,
    isLoading: loadingAnalytics,
    isError: errorAnalytics,
    refetch: refetchAnalytics,
    isFetching: fetchingAnalytics,
  } = useGetMyAnalytics();

  const isLoading = loadingReport || loadingAnalytics;
  const isError = errorReport || errorAnalytics;
  const isFetching = fetchingReport || fetchingAnalytics;

  function refetchAll() {
    void refetchReport();
    void refetchAnalytics();
  }

  if (isLoading) {
    return (
      <AppLayout>
        <div className="p-6 max-w-4xl mx-auto space-y-4">
          <div className="h-48 bg-muted rounded-2xl animate-pulse" />
          <div className="grid grid-cols-2 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-48 bg-muted rounded-xl animate-pulse" />
            ))}
          </div>
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
            <h3 className="text-lg font-semibold text-foreground mb-2">Failed to load analytics</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Please complete your profile and try again.
            </p>
            <Button onClick={refetchAll} size="sm">
              Retry
            </Button>
          </Card>
        </div>
      </AppLayout>
    );
  }

  const score = analytics!.readinessScore;
  const breakdown = analytics!.readinessBreakdown;
  const monthly = analytics!.monthlyApplications;
  const statusBreakdown = analytics!.statusBreakdown;
  const predictiveInsight = analytics!.predictiveInsight;
  const disclaimer = analytics!.disclaimer;

  const ringOffset = RING_CIRC * (1 - score / 100);
  const stroke = ringStroke(score);
  const label = scoreLabel(score);

  const plan = report!.plan;
  const stats = report!.stats;
  const eligibility = report!.eligibility;

  // Radar chart data
  const radarData = Object.entries(breakdown).map(([key, val]) => ({
    subject: BREAKDOWN_LABELS[key] ?? key,
    A: val as number,
    fullMark: BREAKDOWN_MAX[key] ?? 10,
  }));

  // Funnel data — ordered applied → shortlisted → interview → offer
  const funnelKeys = ["applied", "shortlisted", "interview", "offer", "rejected", "no_response"] as const;
  const funnelData = funnelKeys
    .map((k) => ({ status: STATUS_LABELS[k], count: (statusBreakdown as Record<string, number>)[k] ?? 0, key: k }))
    .filter((d) => d.count > 0);

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
                  <h1 className="text-2xl font-display font-bold text-foreground">My Analytics</h1>
                  <p className="text-sm text-muted-foreground">
                    {report!.period.month} {report!.period.year} · Your UK healthcare journey in data
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={refetchAll}
                disabled={isFetching}
                className="gap-2"
              >
                <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </div>
          </motion.div>

          {/* Hero readiness card */}
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
            <div className="rounded-2xl bg-gradient-to-br from-slate-900 via-slate-800 to-primary/60 text-white p-6 overflow-hidden relative">
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_hsl(var(--primary)/0.3),_transparent_60%)]" />
              <div className="relative flex flex-col sm:flex-row items-center gap-6">
                {/* Ring */}
                <div className="relative shrink-0">
                  <svg width="112" height="112" viewBox="0 0 112 112">
                    <defs>
                      <filter id="glow">
                        <feGaussianBlur stdDeviation="3" result="coloredBlur" />
                        <feMerge>
                          <feMergeNode in="coloredBlur" />
                          <feMergeNode in="SourceGraphic" />
                        </feMerge>
                      </filter>
                    </defs>
                    <circle cx="56" cy="56" r={RING_R} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="7" />
                    <motion.circle
                      cx="56" cy="56" r={RING_R}
                      fill="none"
                      stroke={stroke}
                      strokeWidth="7"
                      strokeLinecap="round"
                      strokeDasharray={RING_CIRC}
                      initial={{ strokeDashoffset: RING_CIRC }}
                      animate={{ strokeDashoffset: ringOffset }}
                      transition={{ duration: 1.4, ease: "easeOut" }}
                      style={{ transform: "rotate(-90deg)", transformOrigin: "56px 56px" }}
                      filter="url(#glow)"
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-3xl font-bold text-white leading-none">
                      <AnimatedNumber value={score} />
                    </span>
                    <span className="text-[10px] text-white/60 uppercase tracking-wider mt-0.5">/ 100</span>
                  </div>
                </div>

                {/* Score info */}
                <div className="flex-1 text-center sm:text-left">
                  <span className={`inline-block text-xs font-semibold px-2.5 py-1 rounded-full mb-2 ${label.cls}`}>
                    {label.text}
                  </span>
                  <h2 className="text-xl font-bold text-white mb-1">Journey Readiness Score</h2>
                  <p className="text-sm text-white/60 mb-4">
                    Computed from eligibility, plan progress, documents, applications, and profile.
                  </p>

                  {/* Breakdown pills */}
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(breakdown).map(([key, val]) => {
                      const max = BREAKDOWN_MAX[key] ?? 10;
                      const pct = Math.round(((val as number) / max) * 100);
                      return (
                        <div key={key} className="flex items-center gap-1.5 bg-white/10 rounded-lg px-2.5 py-1">
                          <div className="w-1.5 h-1.5 rounded-full bg-white/60" />
                          <span className="text-xs text-white/80">{BREAKDOWN_LABELS[key]}</span>
                          <span className="text-xs font-bold text-white">{val as number}/{max}</span>
                          <span className="text-[10px] text-white/50">({pct}%)</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </motion.div>

          {/* Charts grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

            {/* Monthly applications area chart */}
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
              <Card className="p-5">
                <div className="flex items-center gap-2 mb-4">
                  <Activity className="w-4 h-4 text-primary" />
                  <h3 className="text-sm font-semibold text-foreground">Application Activity</h3>
                  <span className="ml-auto text-xs text-muted-foreground">Last 6 months</span>
                </div>
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={monthly} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis
                      dataKey="month"
                      tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                      axisLine={false}
                      tickLine={false}
                      allowDecimals={false}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "8px",
                        fontSize: 11,
                      }}
                      formatter={(v: number, name: string) => [v, STATUS_LABELS[name] ?? name]}
                    />
                    <Area
                      type="monotone"
                      dataKey="total"
                      stroke="hsl(var(--primary))"
                      strokeWidth={2}
                      fill="url(#areaGrad)"
                      dot={{ r: 3, fill: "hsl(var(--primary))" }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </Card>
            </motion.div>

            {/* Radar chart */}
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }}>
              <Card className="p-5">
                <div className="flex items-center gap-2 mb-4">
                  <Zap className="w-4 h-4 text-violet-500" />
                  <h3 className="text-sm font-semibold text-foreground">Readiness Profile</h3>
                  <span className="ml-auto text-xs text-muted-foreground">5 dimensions</span>
                </div>
                <ResponsiveContainer width="100%" height={200}>
                  <RadarChart data={radarData} margin={{ top: 0, right: 20, left: 20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="radarGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.5} />
                        <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.1} />
                      </linearGradient>
                    </defs>
                    <PolarGrid stroke="hsl(var(--border))" />
                    <PolarAngleAxis
                      dataKey="subject"
                      tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                    />
                    <Radar
                      name="Max"
                      dataKey="fullMark"
                      stroke="hsl(var(--border))"
                      fill="hsl(var(--muted))"
                      fillOpacity={0.2}
                    />
                    <Radar
                      name="You"
                      dataKey="A"
                      stroke="hsl(var(--primary))"
                      fill="url(#radarGrad)"
                      fillOpacity={0.8}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "8px",
                        fontSize: 11,
                      }}
                    />
                  </RadarChart>
                </ResponsiveContainer>
              </Card>
            </motion.div>

            {/* Application funnel */}
            {funnelData.length > 0 && (
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.14 }}>
                <Card className="p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <TrendingUp className="w-4 h-4 text-emerald-500" />
                    <h3 className="text-sm font-semibold text-foreground">Application Funnel</h3>
                    <span className="ml-auto text-xs text-muted-foreground">All time</span>
                  </div>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart
                      data={funnelData}
                      layout="vertical"
                      margin={{ top: 4, right: 20, left: 20, bottom: 0 }}
                    >
                      <XAxis
                        type="number"
                        tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                        axisLine={false}
                        tickLine={false}
                        allowDecimals={false}
                      />
                      <YAxis
                        type="category"
                        dataKey="status"
                        tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                        axisLine={false}
                        tickLine={false}
                        width={70}
                      />
                      <Tooltip
                        contentStyle={{
                          background: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "8px",
                          fontSize: 11,
                        }}
                      />
                      <Bar dataKey="count" radius={[0, 6, 6, 0]}>
                        {funnelData.map((d) => (
                          <Cell key={d.key} fill={STATUS_COLORS[d.key] ?? "hsl(var(--primary))"} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </Card>
              </motion.div>
            )}

            {/* Journey progress card */}
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.16 }}>
              <Card className="p-5 space-y-4">
                <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <Target className="w-4 h-4 text-primary" />
                  Journey Progress
                </h3>

                {/* Plan */}
                <div>
                  <div className="flex justify-between mb-1.5">
                    <span className="text-xs text-muted-foreground">Remediation Plan</span>
                    <span className="text-xs font-semibold text-foreground">
                      {plan.stepsDone}/{plan.stepsTotal} · {plan.progressPct}%
                    </span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <motion.div
                      className={plan.progressPct === 100 ? "bg-emerald-500 h-full rounded-full" : "bg-primary h-full rounded-full"}
                      initial={{ width: 0 }}
                      animate={{ width: `${plan.progressPct}%` }}
                      transition={{ duration: 1, ease: "easeOut" }}
                    />
                  </div>
                </div>

                {/* Eligibility */}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-primary" />
                    Eligibility
                  </span>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                    eligibility.outcome === "eligible"
                      ? "bg-emerald-100 text-emerald-800"
                      : eligibility.outcome
                        ? "bg-amber-100 text-amber-800"
                        : "bg-muted text-muted-foreground"
                  }`}>
                    {eligibility.outcome === "eligible"
                      ? "Eligible"
                      : eligibility.outcome === "not_eligible"
                        ? "Not Yet"
                        : "Not Checked"}
                  </span>
                </div>

                {/* Docs + boost */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-muted/50 rounded-xl p-3 text-center">
                    <FileText className="w-4 h-4 text-sky-600 mx-auto mb-1" />
                    <p className="text-xl font-bold text-foreground">{report!.documentCount}</p>
                    <p className="text-[10px] text-muted-foreground">Documents</p>
                  </div>
                  <div className="bg-muted/50 rounded-xl p-3 text-center">
                    <Users className="w-4 h-4 text-violet-600 mx-auto mb-1" />
                    <p className="text-xl font-bold text-foreground">{stats.interviews}</p>
                    <p className="text-[10px] text-muted-foreground">Interviews</p>
                  </div>
                </div>

                {/* Profile boost */}
                <div className="flex items-center justify-between pt-1">
                  <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <Megaphone className="w-3.5 h-3.5 text-primary" />
                    Profile Boost
                  </span>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                    report!.boostProfile
                      ? "bg-emerald-100 text-emerald-800"
                      : "bg-muted text-muted-foreground"
                  }`}>
                    {report!.boostProfile ? "Active" : "Inactive"}
                  </span>
                </div>
              </Card>
            </motion.div>
          </div>

          {/* AI Predictive insight */}
          {predictiveInsight && (
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
              <Card className="p-6 bg-gradient-to-r from-primary/8 to-violet-500/8 border-primary/20">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                    <Sparkles className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                      AI Forward Insight
                    </p>
                    <p className="text-sm text-foreground leading-relaxed">{predictiveInsight}</p>
                    {disclaimer && (
                      <p className="text-xs text-muted-foreground mt-3 pt-3 border-t border-border/50">
                        {disclaimer}
                      </p>
                    )}
                  </div>
                </div>
              </Card>
            </motion.div>
          )}

          {/* AI recommendations from progress report */}
          {report!.recommendations && (
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.22 }}>
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
                  {report!.recommendations
                    .split("\n")
                    .filter((line: string) => line.trim())
                    .map((line: string, i: number) => (
                      <div key={i} className="flex items-start gap-3 text-sm text-foreground leading-relaxed">
                        <span className="text-primary shrink-0 mt-0.5 font-bold text-base">•</span>
                        <span>{line.replace(/^•\s*/, "")}</span>
                      </div>
                    ))}
                </div>
              </Card>
            </motion.div>
          )}

          {/* Top 10 Companies */}
          {report!.topCompanies && report!.topCompanies.length > 0 && (
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.24 }}>
              <Card className="p-6">
                <div className="flex items-center gap-3 mb-5">
                  <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
                    <Building2 className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold text-foreground">Top 10 Employers to Target</h2>
                    <p className="text-xs text-muted-foreground">AI-matched to your profession, specialty and location</p>
                  </div>
                </div>
                <div className="space-y-3">
                  {report!.topCompanies.map((co, i) => (
                    <div key={i} className="flex items-start gap-3 p-3 rounded-xl border border-border hover:border-primary/20 hover:bg-muted/30 transition-all">
                      <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                        <span className="text-xs font-bold text-primary">{i + 1}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2 flex-wrap">
                          <div>
                            <p className="text-sm font-semibold text-foreground leading-tight">{co.name}</p>
                            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                              <span className="text-xs text-muted-foreground">{co.type}</span>
                              {co.location && (
                                <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
                                  <MapPin className="w-3 h-3" />
                                  {co.location}
                                </span>
                              )}
                            </div>
                          </div>
                          <span className={`shrink-0 text-xs font-bold px-2.5 py-1 rounded-full ${
                            co.matchPct >= 85 ? "bg-emerald-100 text-emerald-800" :
                            co.matchPct >= 70 ? "bg-sky-100 text-sky-800" :
                            "bg-amber-100 text-amber-800"
                          }`}>
                            {co.matchPct}% match
                          </span>
                        </div>
                        <div className="mt-2">
                          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${
                                co.matchPct >= 85 ? "bg-emerald-500" :
                                co.matchPct >= 70 ? "bg-sky-500" :
                                "bg-amber-500"
                              }`}
                              style={{ width: `${co.matchPct}%` }}
                            />
                          </div>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">{co.reason}</p>
                        <div className="mt-2">
                          <Link href={`/opportunities?tab=employers&q=${encodeURIComponent(co.name)}`}>
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                              View &amp; Apply <Zap className="w-3 h-3" />
                            </span>
                          </Link>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground mt-4 pt-4 border-t border-border/50">
                  AI-generated recommendations for guidance only. Research each employer and verify current vacancies before applying.
                </p>
              </Card>
            </motion.div>
          )}

          {/* Quick action cards */}
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.26 }}>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Link href="/path">
                <Card className="p-4 hover:shadow-md hover:border-primary/20 transition-all cursor-pointer group flex items-center gap-3">
                  <Target className="w-5 h-5 text-primary group-hover:scale-110 transition-transform" />
                  <div>
                    <p className="text-sm font-semibold text-foreground">Career Path</p>
                    <p className="text-xs text-muted-foreground">View remediation steps</p>
                  </div>
                </Card>
              </Link>
              <Link href="/applications">
                <Card className="p-4 hover:shadow-md hover:border-primary/20 transition-all cursor-pointer group flex items-center gap-3">
                  <ClipboardList className="w-5 h-5 text-primary group-hover:scale-110 transition-transform" />
                  <div>
                    <p className="text-sm font-semibold text-foreground">Application Tracker</p>
                    <p className="text-xs text-muted-foreground">Track job applications</p>
                  </div>
                </Card>
              </Link>
              <Link href="/regulatory-guidance">
                <Card className="p-4 hover:shadow-md hover:border-primary/20 transition-all cursor-pointer group flex items-center gap-3">
                  <CheckCircle2 className="w-5 h-5 text-primary group-hover:scale-110 transition-transform" />
                  <div>
                    <p className="text-sm font-semibold text-foreground">Visa & Legal Guidance</p>
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
