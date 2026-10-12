import { Link, useLocation } from "wouter";
import { useAuth } from "@workspace/auth-web";
import { AccountDeletionDisclosure } from "@/components/AccountDeletionDisclosure";
import {
  ArrowRight, BarChart2, BookOpen, Briefcase, Building2, CalendarDays,
  CheckCircle2, ChevronRight, ClipboardList, FileText, GraduationCap, HelpCircle,
  Home, Inbox, LayoutDashboard, List, LogOut, Map, MessageSquareText, Plus,
  Search, Shield, ShieldAlert, ShieldCheck, Sparkles, Star, User, UserCog,
  Users, RefreshCw, Bookmark,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  getGetInboxUnreadCountQueryKey, getGetMyProfileQueryKey,
  getListMatchedRolesQueryKey, getListMyApplicationsQueryKey, getListMyDocumentsQueryKey,
  useGetInboxUnreadCount, useGetMyProfile, useListMatchedRoles, useListMyApplications,
  useListMyDocuments,
} from "@workspace/api-client-react";
import { cn } from "@/components/ui-enhanced";
import { CareerJourneyCard } from "@/components/CareerJourneyCard";
import { CANDIDATE_NAVIGATION, getUnreadBadgeText, isNavigationItemActive } from "@/lib/candidateNavigation";
import { deriveCareerJourney } from "@/lib/candidateJourney";
import { MARKETING_NAVIGATION } from "@/lib/roleAccess";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type Props = { onNavigate?: () => void; onEnhance?: () => void };
type OtherNavItem = { name: string; href: string; icon: LucideIcon; roles: string[] };

const otherRoleNavigation: OtherNavItem[] = [
  { name: "Help & Support", href: "/help", icon: HelpCircle, roles: ["employer", "marketing", "super_admin"] },
  { name: "Feedback", href: "/feedback", icon: MessageSquareText, roles: ["employer", "super_admin"] },
  { name: "Employer Dashboard", href: "/employer/dashboard", icon: LayoutDashboard, roles: ["employer", "admin"] },
  { name: "Post a Job", href: "/employer/jobs/new", icon: Plus, roles: ["employer", "admin"] },
  { name: "Talent Search", href: "/employer/talent-search", icon: Search, roles: ["employer", "admin"] },
  { name: "Campaigns", href: "/employer/campaigns", icon: Bookmark, roles: ["employer", "admin"] },
  { name: "Organisation Profile", href: "/employer/profile", icon: Building2, roles: ["employer", "admin"] },
  { name: "Review Queue", href: "/review-queue", icon: ClipboardList, roles: ["reviewer", "admin"] },
  { name: "Learning Library", href: "/admin/learning-videos", icon: BookOpen, roles: ["admin", "super_admin"] },
  { name: "Ruleset Management", href: "/admin/rulesets", icon: Shield, roles: ["admin", "super_admin"] },
  { name: "Role Management", href: "/admin/roles", icon: Users, roles: ["admin", "super_admin"] },
  { name: "Audit Logs", href: "/admin/audit", icon: Shield, roles: ["admin", "super_admin"] },
  { name: "User Management", href: "/admin/users", icon: UserCog, roles: ["admin", "super_admin"] },
  { name: "Waitlist Leads", href: "/admin/leads", icon: Inbox, roles: ["admin", "super_admin"] },
  { name: "Calendar", href: "/admin/calendar", icon: CalendarDays, roles: ["admin", "super_admin"] },
  ...MARKETING_NAVIGATION.map((item) => ({
    ...item,
    icon: item.href === "/admin/calendar" ? CalendarDays : Inbox,
    roles: ["marketing"],
  })),
  { name: "Super Admin", href: "/admin/super", icon: ShieldAlert, roles: ["super_admin"] },
  { name: "Sync Management", href: "/admin/sync", icon: RefreshCw, roles: ["super_admin"] },
  { name: "Sponsor Data Import", href: "/admin/sponsor-import", icon: Shield, roles: ["super_admin"] },
];

const legacyCandidateGroups = [
  {
    label: "Jobs & Applications",
    items: [
      { name: "Job Opportunities", href: "/opportunities", icon: Briefcase, roles: ["reviewer", "admin"] },
      { name: "Application Tracker", href: "/applications", icon: ClipboardList, roles: ["reviewer", "admin"] },
      { name: "Interview Schedule", href: "/calendar", icon: CalendarDays, roles: ["reviewer", "admin"] },
      { name: "Messages", href: "/inbox", icon: Inbox, roles: ["reviewer", "admin"] },
    ],
  },
  {
    label: "My Journey",
    items: [
      { name: "Progress Hub", href: "/", icon: Home, roles: ["reviewer", "admin"] },
      { name: "Career Path", href: "/path", icon: Map, roles: ["reviewer", "admin"] },
    ],
  },
  {
    label: "Profile & Compliance",
    items: [
      { name: "Personal & Professional Profile", href: "/profile", icon: User, roles: ["reviewer", "admin"] },
      { name: "CV & Supporting Documents", href: "/documents", icon: FileText, roles: ["reviewer", "admin"] },
      { name: "Eligibility Status", href: "/eligibility", icon: CheckCircle2, roles: ["reviewer", "admin"] },
    ],
  },
  {
    label: "Opportunity Enablers",
    items: [
      { name: "Visa Sponsoring Employers", href: "/sponsor-licences", icon: List, roles: ["reviewer", "admin"] },
      { name: "References", href: "/recommendations", icon: Star, roles: [] },
    ],
  },
  {
    label: "Support & Preparation",
    items: [
      { name: "Help & Support", href: "/help", icon: HelpCircle, roles: ["reviewer", "admin"] },
      { name: "Feedback", href: "/feedback", icon: MessageSquareText, roles: ["reviewer", "admin"] },
      { name: "Interview Preparation", href: "/interview-prep", icon: Sparkles, roles: ["reviewer", "admin"] },
      { name: "Visa & Legal Guidance", href: "/regulatory-guidance", icon: BookOpen, roles: ["reviewer", "admin"] },
    ],
  },
  {
    label: "Insights & Tracking",
    items: [
      { name: "Performance Report", href: "/my-report", icon: BarChart2, roles: ["reviewer", "admin"] },
    ],
  },
  {
    label: "Operations",
    items: [
      "Review Queue", "Learning Library", "Employer Dashboard", "Post a Job",
      "Talent Search", "Campaigns", "Organisation Profile", "Ruleset Management",
      "Role Management", "Audit Logs", "User Management", "Waitlist Leads", "Calendar",
    ].map((name) => otherRoleNavigation.find((item) => item.name === name)!)
      .map((item) => ({ ...item, roles: item.name === "Review Queue" ? ["reviewer", "admin"] : ["admin"] })),
  },
];

const iconForCandidateItem: Record<string, LucideIcon> = {
  "CV and Supporting Documents": FileText,
  "Personal & Professional Details": User,
  "ID Verification": ShieldCheck,
  "CV Enhancement": Sparkles,
  References: Star,
  "Visa Sponsoring Employers": List,
  "Matched Jobs": Briefcase,
  "Application Tracker": ClipboardList,
  Interviews: CalendarDays,
  Messages: Inbox,
  "Career journey": Map,
  "Eligibility Check": CheckCircle2,
  "Interview Preparation": Sparkles,
  "Visa & Legal Guidance": ShieldCheck,
  "Monthly Reports": BarChart2,
  "Next Steps": ArrowRight,
  "Help Center": HelpCircle,
  Feedback: MessageSquareText,
};

export function AppSidebar({ onNavigate, onEnhance }: Props = {}) {
  const [location] = useLocation();
  const { user, logout } = useAuth();
  const role = user?.role;
  const isCandidate = role === "candidate";
  const { data: inboxData } = useGetInboxUnreadCount({
    query: {
      queryKey: getGetInboxUnreadCountQueryKey(),
      refetchInterval: 30_000,
      enabled: !!user && ["candidate", "reviewer", "admin"].includes(role ?? ""),
    },
  });
  const { data: myProfile } = useGetMyProfile({
    query: { queryKey: getGetMyProfileQueryKey(), enabled: !!user && isCandidate },
  });
  const documentsQuery = useListMyDocuments({
    query: { queryKey: getListMyDocumentsQueryKey(), enabled: isCandidate },
  });
  const matchedQuery = useListMatchedRoles(undefined, {
    query: { queryKey: getListMatchedRolesQueryKey(), enabled: isCandidate },
  });
  const applicationsQuery = useListMyApplications({
    query: { queryKey: getListMyApplicationsQueryKey(), enabled: isCandidate },
  });
  const profilePhotoUrl = myProfile?.profilePhotoKey
    ? `${BASE}/api/storage/objects/${myProfile.profilePhotoKey.replace(/^\/objects\//, "")}`
    : null;

  const renderLink = (label: string, href: string, Icon: LucideIcon, badge?: number) => {
    const active = isNavigationItemActive(location, href);
    return (
      <Link
        key={label}
        href={href}
        onClick={onNavigate}
        data-testid={`link-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
          active ? "bg-primary text-primary-foreground shadow-sm" : "text-sidebar-foreground hover:bg-sidebar-accent",
        )}
      >
        <Icon className={cn("h-4 w-4 shrink-0", active ? "text-primary-foreground/80" : "text-muted-foreground")} />
        <span className="min-w-0 flex-1 leading-snug">{label}</span>
        {badge != null && getUnreadBadgeText(badge) && (
          <span aria-label={`${badge} unread messages`} data-testid="badge-unread-messages"
            className={cn("inline-flex h-[20px] min-w-[20px] items-center justify-center rounded-full px-1 text-[10px] font-bold",
              active ? "bg-primary-foreground text-primary" : "bg-primary text-primary-foreground")}>
            {getUnreadBadgeText(badge)}
          </span>
        )}
        {active && <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-65" />}
      </Link>
    );
  };

  const renderCandidateJourney = () => {
    const { data: documents, isLoading: docsLoading, isError: docsError, refetch: refetchDocs } = documentsQuery;
    const { data: matched, isLoading: matchesLoading, isError: matchesError, refetch: refetchMatches } = matchedQuery;
    const { data: applications, isLoading: appsLoading, isError: appsError, refetch: refetchApps } = applicationsQuery;
    const stages = deriveCareerJourney({
      documents: documents?.documents ?? [],
      matchedRoleCount: matched?.roles?.length ?? 0,
      applications: applications?.applications ?? [],
    });
    return (
      <CareerJourneyCard
        className="mx-3 mb-2"
        stages={stages}
        isLoading={docsLoading || matchesLoading || appsLoading}
        isError={docsError || matchesError || appsError}
        onRetry={() => {
          if (docsError) void refetchDocs();
          if (matchesError) void refetchMatches();
          if (appsError) void refetchApps();
        }}
        onNavigate={onNavigate}
      />
    );
  };

  return (
    <aside className="flex h-full min-h-0 w-full flex-col bg-sidebar text-sidebar-foreground md:w-64">
      <div className="flex h-16 shrink-0 items-center border-b border-sidebar-border px-5">
        <img src={`${import.meta.env.BASE_URL}logo.png`} alt="JOBSAGE" className="h-12 w-auto object-contain" />
      </div>
      <nav aria-label="Main navigation" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3">
        {isCandidate ? (
          <div className="space-y-4">
            {CANDIDATE_NAVIGATION.map((section) => (
              <section key={section.label} aria-label={section.label}>
                <h2 className="mb-1 px-3 text-[10px] font-bold uppercase tracking-[0.13em] text-muted-foreground/75">{section.label}</h2>
                {section.label === "UK Career Journey" && renderCandidateJourney()}
                <div className="space-y-0.5">
                  {section.items.map((item) => {
                    if (item.kind === "action") {
                      const Icon = iconForCandidateItem[item.label];
                      return (
                        <button key={item.label} type="button" onClick={() => { onNavigate?.(); onEnhance?.(); }}
                          data-testid="button-enhance-cv"
                          className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent">
                          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <span className="flex-1 leading-snug">{item.label}</span>
                        </button>
                      );
                    }
                    if (item.kind === "coming-soon") {
                      const Icon = iconForCandidateItem[item.label];
                      return (
                        <div key={item.label} aria-disabled="true" aria-label={`${item.label}, Coming soon`}
                          className="flex min-h-11 cursor-not-allowed items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-muted-foreground/75">
                          <Icon className="h-4 w-4 shrink-0" />
                          <span className="min-w-0 flex-1 leading-snug">{item.label}</span>
                          <span className="shrink-0 rounded-full border border-border px-1.5 py-0.5 text-[9px] font-medium">Coming soon</span>
                        </div>
                      );
                    }
                    return renderLink(item.label, item.href, iconForCandidateItem[item.label],
                      item.badge === "unread-messages" ? inboxData?.unreadCount : undefined);
                  })}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            {(role === "reviewer" || role === "admin") && legacyCandidateGroups.map((section) => (
              <section key={section.label}>
                <h2 className="mb-1 px-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">{section.label}</h2>
                <div className="space-y-0.5">{section.items.filter((item) => item.roles.includes(role ?? "")).map((item) =>
                  renderLink(item.name, item.href, item.icon, item.href === "/inbox" ? inboxData?.unreadCount : undefined),
                )}</div>
              </section>
            ))}
            {role !== "reviewer" && role !== "admin" && <div className="space-y-0.5">
              {otherRoleNavigation.filter((item) => !!role && item.roles.includes(role)).map((item) =>
                renderLink(item.name, item.href, item.icon),
              )}
            </div>}
          </div>
        )}
      </nav>
      <div className="shrink-0 border-t border-sidebar-border p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <div className="mb-4 flex min-w-0 items-center px-2">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/10 font-bold text-primary">
            {profilePhotoUrl ? <img src={profilePhotoUrl} alt="Profile" className="h-full w-full object-cover" /> :
              user?.profileImageUrl ? <img src={user.profileImageUrl} alt="Profile" className="h-full w-full object-cover" /> :
                (user?.firstName?.[0] || user?.email?.[0] || "U").toUpperCase()}
          </div>
          <div className="ml-3 min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">{user?.firstName ? `${user.firstName} ${user.lastName || ""}` : user?.email}</p>
            <p className="text-xs capitalize text-muted-foreground">{role ?? ""}</p>
          </div>
        </div>
        <Link href="/privacy-settings" data-testid="link-privacy-settings" onClick={onNavigate}
          className="mb-2 flex min-h-11 w-full items-center rounded-md px-3 py-2 text-sm hover:bg-sidebar-accent">
          Privacy, legal &amp; account
        </Link>
        <AccountDeletionDisclosure />
        <button onClick={logout} data-testid="button-logout"
          className="flex min-h-11 w-full items-center rounded-xl px-3 py-2.5 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10">
          <LogOut className="mr-3 h-5 w-5 opacity-80" />Log out
        </button>
      </div>
    </aside>
  );
}
