import { Link, useLocation } from "wouter";
import { useAuth } from "@workspace/auth-web";
import { 
  Home, User, FileText, CheckCircle, 
  Map, ClipboardList, Shield, Users, LogOut, Briefcase,
  Building2, Plus, LayoutDashboard, Sparkles, UserCog, List,
  BarChart2, BookOpen, Search, Bookmark, ShieldAlert,
  TrendingUp, Inbox, CalendarDays, Star, ShieldCheck, RefreshCw,
} from "lucide-react";
import { cn } from "@/components/ui-enhanced";
import { useGetMyAnalytics, useGetMyProgressReport, useGetInboxUnreadCount, getGetInboxUnreadCountQueryKey, useGetMyProfile, getGetMyProfileQueryKey } from "@workspace/api-client-react";
import { motion, useMotionValue, useTransform, animate } from "framer-motion";
import { useEffect } from "react";
import { MARKETING_NAVIGATION } from "@/lib/roleAccess";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type NavItem = {
  name: string;
  href: string;
  icon: React.ElementType;
  roles: string[];
  badge?: number;
};

type NavGroup = {
  label: string;
  items: NavItem[];
};

export function AppSidebar() {
  const [location] = useLocation();
  const { user, logout } = useAuth();

  const role = user?.role || "candidate";

  const { data: inboxData } = useGetInboxUnreadCount({
    query: {
      queryKey: getGetInboxUnreadCountQueryKey(),
      refetchInterval: 30_000,
      enabled: role === "candidate" || role === "reviewer" || role === "admin",
    },
  });
  const inboxUnread = inboxData?.unreadCount ?? 0;

  const { data: myProfile } = useGetMyProfile({ query: { queryKey: getGetMyProfileQueryKey(), enabled: role === "candidate" } });
  const profilePhotoUrl = myProfile?.profilePhotoKey
    ? `${BASE}/api/storage/objects/${myProfile.profilePhotoKey.replace(/^\/objects\//, "")}`
    : null;

  const candidateGroups: NavGroup[] = [
    {
      label: "Jobs & Applications",
      items: [
        { name: "Job Opportunities", href: "/opportunities", icon: Briefcase, roles: ["candidate", "reviewer", "admin"] },
        { name: "Application Tracker", href: "/applications", icon: ClipboardList, roles: ["candidate", "reviewer", "admin"] },
        { name: "Interview Schedule", href: "/calendar", icon: CalendarDays, roles: ["candidate", "reviewer", "admin"] },
        { name: "Messages", href: "/inbox", icon: Inbox, roles: ["candidate", "reviewer", "admin"], badge: inboxUnread },
      ],
    },
    {
      label: "My Journey",
      items: [
        { name: "Progress Hub", href: "/", icon: Home, roles: ["candidate", "reviewer", "admin"] },
        { name: "Career Path", href: "/path", icon: Map, roles: ["candidate", "reviewer", "admin"] },
      ],
    },
    {
      label: "Profile & Compliance",
      items: [
        { name: "Personal & Professional Profile", href: "/profile", icon: User, roles: ["candidate", "reviewer", "admin"] },
        { name: "CV & Supporting Documents", href: "/documents", icon: FileText, roles: ["candidate", "reviewer", "admin"] },
        { name: "ID Verification", href: "/identity", icon: ShieldCheck, roles: ["candidate"] },
        { name: "Eligibility Status", href: "/eligibility", icon: CheckCircle, roles: ["candidate", "reviewer", "admin"] },
      ],
    },
    {
      label: "Opportunity Enablers",
      items: [
        { name: "Visa Sponsoring Employers", href: "/sponsor-licences", icon: List, roles: ["candidate", "reviewer", "admin"] },
        { name: "References", href: "/recommendations", icon: Star, roles: ["candidate"] },
      ],
    },
    {
      label: "Support & Preparation",
      items: [
        { name: "Interview Preparation", href: "/interview-prep", icon: Sparkles, roles: ["candidate", "reviewer", "admin"] },
        { name: "Visa & Legal Guidance", href: "/regulatory-guidance", icon: BookOpen, roles: ["candidate", "reviewer", "admin"] },
      ],
    },
    {
      label: "Insights & Tracking",
      items: [
        { name: "Performance Report", href: "/my-report", icon: BarChart2, roles: ["candidate", "reviewer", "admin"] },
      ],
    },
    {
      label: "Operations",
      items: [
        { name: "Review Queue", href: "/review-queue", icon: ClipboardList, roles: ["reviewer", "admin"] },
        { name: "Employer Dashboard", href: "/employer/dashboard", icon: LayoutDashboard, roles: ["admin"] },
        { name: "Post a Job", href: "/employer/jobs/new", icon: Plus, roles: ["admin"] },
        { name: "Talent Search", href: "/employer/talent-search", icon: Search, roles: ["admin"] },
        { name: "Campaigns", href: "/employer/campaigns", icon: Bookmark, roles: ["admin"] },
        { name: "Organisation Profile", href: "/employer/profile", icon: Building2, roles: ["admin"] },
        { name: "Ruleset Management", href: "/admin/rulesets", icon: Shield, roles: ["admin"] },
        { name: "Role Management", href: "/admin/roles", icon: Users, roles: ["admin"] },
        { name: "Audit Logs", href: "/admin/audit", icon: Shield, roles: ["admin"] },
        { name: "User Management", href: "/admin/users", icon: UserCog, roles: ["admin"] },
        { name: "Waitlist Leads", href: "/admin/leads", icon: Inbox, roles: ["admin"] },
      ],
    },
  ];

  const flatNavForOtherRoles: NavItem[] = [
    { name: "Employer Dashboard", href: "/employer/dashboard", icon: LayoutDashboard, roles: ["employer", "admin"] },
    { name: "Post a Job", href: "/employer/jobs/new", icon: Plus, roles: ["employer", "admin"] },
    { name: "Talent Search", href: "/employer/talent-search", icon: Search, roles: ["employer", "admin"] },
    { name: "Campaigns", href: "/employer/campaigns", icon: Bookmark, roles: ["employer", "admin"] },
    { name: "Organisation Profile", href: "/employer/profile", icon: Building2, roles: ["employer", "admin"] },
    { name: "Review Queue", href: "/review-queue", icon: ClipboardList, roles: ["reviewer", "admin"] },
    { name: "Ruleset Management", href: "/admin/rulesets", icon: Shield, roles: ["admin", "super_admin"] },
    { name: "Role Management", href: "/admin/roles", icon: Users, roles: ["admin", "super_admin"] },
    { name: "Audit Logs", href: "/admin/audit", icon: Shield, roles: ["admin", "super_admin"] },
    { name: "User Management", href: "/admin/users", icon: UserCog, roles: ["admin", "super_admin"] },
    { name: "Waitlist Leads", href: "/admin/leads", icon: Inbox, roles: ["admin", "super_admin"] },
    ...MARKETING_NAVIGATION.map((item) => ({ ...item, icon: Inbox, roles: ["marketing"] })),
    { name: "Super Admin", href: "/admin/super", icon: ShieldAlert, roles: ["super_admin"] },
    { name: "Sync Management", href: "/admin/sync", icon: RefreshCw, roles: ["super_admin"] },
  ];

  const isCandidateLike = role === "candidate" || role === "reviewer" || role === "admin";

  function renderNavItem(item: NavItem) {
    if (!item.roles.includes(role)) return null;
    const isActive = location === item.href;
    const badge = item.badge;
    return (
      <Link key={item.href} href={item.href} className={cn(
        "flex items-center px-3 py-2.5 rounded-xl text-sm font-medium transition-colors hover-elevate",
        isActive
          ? "bg-primary text-primary-foreground shadow-sm"
          : "text-sidebar-foreground hover:bg-sidebar-accent"
      )}>
        <item.icon className={cn("w-4 h-4 mr-3 shrink-0", isActive ? "text-primary-foreground/80" : "text-muted-foreground")} />
        <span className="flex-1 leading-tight">{item.name}</span>
        {badge != null && badge > 0 && (
          <span className={cn(
            "ml-auto inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold",
            isActive ? "bg-primary-foreground text-primary" : "bg-primary text-primary-foreground"
          )}>
            {badge > 99 ? "99+" : badge}
          </span>
        )}
      </Link>
    );
  }

  return (
    <div className="w-64 bg-sidebar border-r border-sidebar-border h-screen flex flex-col shrink-0">
      <div className="h-16 flex items-center px-5 border-b border-sidebar-border shrink-0">
        <img
          src={`${import.meta.env.BASE_URL}logo.png`}
          alt="JOBSAGE"
          className="h-12 w-auto object-contain"
        />
      </div>

      <div className="flex-1 overflow-y-auto py-3 px-3">
        {isCandidateLike ? (
          candidateGroups.map((group) => {
            const visibleItems = group.items.filter(item => item.roles.includes(role));
            if (visibleItems.length === 0) return null;
            return (
              <div key={group.label} className="mb-4">
                <p className="px-3 mb-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 select-none">
                  {group.label}
                </p>
                <div className="space-y-0.5">
                  {visibleItems.map(renderNavItem)}
                </div>
              </div>
            );
          })
        ) : (
          <div className="space-y-0.5">
            {flatNavForOtherRoles.filter(item => item.roles.includes(role)).map(renderNavItem)}
          </div>
        )}
        {role === "candidate" && <AnalyticsMiniWidget />}
      </div>

      <div className="p-4 border-t border-sidebar-border shrink-0">
        <div className="flex items-center mb-4 px-2">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold overflow-hidden shrink-0">
            {profilePhotoUrl ? (
              <img src={profilePhotoUrl} alt="Avatar" className="w-full h-full object-cover" />
            ) : user?.profileImageUrl ? (
              <img src={user.profileImageUrl} alt="Avatar" className="w-full h-full object-cover" />
            ) : (
              (user?.firstName?.[0] || user?.email?.[0] || "U").toUpperCase()
            )}
          </div>
          <div className="ml-3 overflow-hidden">
            <p className="text-sm font-semibold truncate text-foreground">
              {user?.firstName ? `${user.firstName} ${user.lastName || ''}` : user?.email}
            </p>
            <p className="text-xs text-muted-foreground capitalize">{role}</p>
          </div>
        </div>
        <button
          onClick={logout}
          className="w-full flex items-center px-3 py-2.5 rounded-xl text-sm font-medium text-destructive hover:bg-destructive/10 transition-colors"
        >
          <LogOut className="w-5 h-5 mr-3 opacity-80" />
          Log out
        </button>
      </div>
    </div>
  );
}

const RING_R = 26;
const RING_CIRC = 2 * Math.PI * RING_R;

function ringColor(score: number) {
  if (score >= 90) return "#22c55e";
  if (score >= 70) return "hsl(var(--primary))";
  if (score >= 40) return "#f59e0b";
  return "hsl(var(--destructive))";
}

function AnimatedScore({ value }: { value: number }) {
  const mv = useMotionValue(0);
  const display = useTransform(mv, (v) => Math.round(v).toString());
  useEffect(() => {
    const ctrl = animate(mv, value, { duration: 1.2, ease: "easeOut" });
    return ctrl.stop;
  }, [value, mv]);
  return <motion.span>{display}</motion.span>;
}

function AnalyticsMiniWidget() {
  const { data: analytics, isLoading: loadingA } = useGetMyAnalytics();
  const { data: report, isLoading: loadingR } = useGetMyProgressReport();

  if (loadingA || loadingR) {
    return (
      <div className="mx-4 mb-3 rounded-xl border border-border bg-muted/40 p-3 animate-pulse" style={{ height: 118 }} />
    );
  }

  const score = analytics?.readinessScore ?? 0;
  const totalApps =
    analytics
      ? Object.values(analytics.statusBreakdown).reduce((s: number, v) => s + (v as number), 0)
      : 0;
  const responseRate = report?.stats.responseRate ?? 0;
  const planPct = report?.plan.progressPct ?? 0;

  const offset = RING_CIRC * (1 - score / 100);
  const color = ringColor(score);

  return (
    <div className="mx-4 mb-3">
      <div className="rounded-xl border border-border bg-gradient-to-br from-sidebar-accent/60 to-background p-3">
        <div className="flex items-center gap-3 mb-2.5">
          <div className="relative shrink-0">
            <svg width="60" height="60" viewBox="0 0 60 60">
              <circle
                cx="30" cy="30" r={RING_R}
                fill="none"
                stroke="currentColor"
                strokeWidth="4"
                className="text-muted/40"
              />
              <motion.circle
                cx="30" cy="30" r={RING_R}
                fill="none"
                stroke={color}
                strokeWidth="4"
                strokeLinecap="round"
                strokeDasharray={RING_CIRC}
                initial={{ strokeDashoffset: RING_CIRC }}
                animate={{ strokeDashoffset: offset }}
                transition={{ duration: 1.2, ease: "easeOut" }}
                style={{ transform: "rotate(-90deg)", transformOrigin: "50% 50%" }}
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-xs font-bold text-foreground leading-none">
                <AnimatedScore value={score} />
              </span>
            </div>
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-foreground leading-tight">Journey Readiness</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {score >= 70 ? "Strong progress" : score >= 40 ? "Building momentum" : "Getting started"}
            </p>
            <div className="flex items-center gap-1 mt-1">
              <TrendingUp className="w-2.5 h-2.5 text-muted-foreground" />
              <span className="text-[10px] text-muted-foreground">{score}/100</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-1.5 mb-2">
          {[
            { label: "Apps", value: totalApps },
            { label: "Response", value: `${responseRate}%` },
            { label: "Plan", value: `${planPct}%` },
          ].map((s) => (
            <div key={s.label} className="bg-background/70 rounded-lg px-1.5 py-1 text-center">
              <p className="text-[11px] font-bold text-foreground leading-none">{String(s.value)}</p>
              <p className="text-[9px] text-muted-foreground mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>

        <Link
          href="/my-report"
          className="flex items-center justify-center gap-1 text-[10px] font-medium text-primary hover:underline"
        >
          View full analytics →
        </Link>
      </div>
    </div>
  );
}
