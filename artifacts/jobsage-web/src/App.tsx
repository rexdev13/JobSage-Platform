import { MobileAssistedWorkspaceHost } from "@/components/MobileAssistedWorkspaceHost";
import { lazy, Suspense, useEffect } from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { useAuth } from "@workspace/auth-web";
import {
  useGetMyProfile,
  useGetMyConsent,
  getGetMyConsentQueryKey,
  getGetMyProfileQueryKey,
} from "@workspace/api-client-react";

import { AuthGuard } from "@/components/layout/AuthGuard";
import { canAccessLeads, isAdminRole } from "@/lib/roleAccess";
import { QuickHelpMenu } from "@/components/QuickHelpMenu";

// --- Lazy page imports (code-split per route) ---
// Everything below is loaded on-demand when the user navigates to that route.
// Keep AuthGuard, guards, LoadingScreen, Redirect, SmartHome as static — they
// are always needed and are tiny.

const ReleaseNotesPage      = lazy(() => import("@/pages/ReleaseNotesPage"));
const SuperAdminPage        = lazy(() => import("@/pages/admin/SuperAdminPage"));
const SuperAdminUsersPage  = lazy(() => import("@/pages/admin/SuperAdminPage").then((module) => ({ default: module.SuperAdminUsersPage })));
const AdminSyncPage         = lazy(() => import("@/pages/admin/AdminSyncPage"));
const SponsorWebsiteImportPage = lazy(() => import("@/pages/admin/SponsorWebsiteImportPage"));
const AdminLeadsPage        = lazy(() => import("@/pages/admin/AdminLeadsPage"));
const AdminCalendarPage     = lazy(() => import("@/pages/admin/AdminCalendarPage"));
const AdminLoginPage        = lazy(() => import("@/pages/admin/AdminLoginPage"));
const ImpersonatePage       = lazy(() => import("@/pages/ImpersonatePage"));
const EmployerOnboardingPage = lazy(() => import("@/pages/employer/EmployerOnboardingPage"));
const EmployerRegisterPage  = lazy(() => import("@/pages/employer/EmployerRegisterPage"));
const EmployerDashboardPage = lazy(() => import("@/pages/employer/EmployerDashboardPage"));
const EmployerJobFormPage   = lazy(() => import("@/pages/employer/EmployerJobFormPage"));
const EmployerJobDetailPage = lazy(() => import("@/pages/employer/EmployerJobDetailPage"));
const TalentSearchPage      = lazy(() => import("@/pages/employer/TalentSearchPage"));
const CampaignsPage         = lazy(() => import("@/pages/employer/CampaignsPage"));

const LandingPage               = lazy(() => import("@/pages/LandingPage"));
const LoginPage                 = lazy(() => import("@/pages/LoginPage"));
const RegisterPage              = lazy(() => import("@/pages/RegisterPage"));
const ForgotPasswordPage        = lazy(() => import("@/pages/ForgotPasswordPage"));
const ResetPasswordPage         = lazy(() => import("@/pages/ResetPasswordPage"));
const ConsentPage               = lazy(() => import("@/pages/ConsentPage"));
const OnboardingPage            = lazy(() => import("@/pages/OnboardingPage"));
const DashboardPage             = lazy(() => import("@/pages/DashboardPage"));
const ProfilePage               = lazy(() => import("@/pages/ProfilePage"));
const DocumentsPage             = lazy(() => import("@/pages/DocumentsPage"));
const EligibilityPage           = lazy(() => import("@/pages/EligibilityPage"));
const AdminRulesetsPage         = lazy(() => import("@/pages/AdminRulesetsPage"));
const OpportunitiesPage         = lazy(() => import("@/pages/OpportunitiesPage"));
const ApplicationsPage          = lazy(() => import("@/pages/ApplicationsPage"));
const InboxPage                 = lazy(() => import("@/pages/InboxPage"));
const PathPage                  = lazy(() => import("@/pages/PathPage"));
const InterviewPrepPage         = lazy(() => import("@/pages/InterviewPrepPage"));
const AdminRolesPage            = lazy(() => import("@/pages/AdminRolesPage"));
const ReviewQueuePage           = lazy(() => import("@/pages/ReviewQueuePage"));
const AdminAuditPage            = lazy(() => import("@/pages/AdminAuditPage"));
const AdminUsersPage            = lazy(() => import("@/pages/AdminUsersPage"));
const SponsorLicencesPage       = lazy(() => import("@/pages/SponsorLicencesPage"));
const MyProgressReportPage      = lazy(() => import("@/pages/MyProgressReportPage"));
const RegulatoryGuidancePage    = lazy(() => import("@/pages/RegulatoryGuidancePage"));
const InterviewCalendarPage     = lazy(() => import("@/pages/InterviewCalendarPage"));
const RecommendationLettersPage = lazy(() => import("@/pages/RecommendationLettersPage"));
const IdentityVerificationPage  = lazy(() => import("@/pages/IdentityVerificationPage"));
const NotFound                  = lazy(() => import("@/pages/not-found"));
const ExtensionPrivacyPage      = lazy(() => import("@/pages/ExtensionPrivacyPage"));
const PrivacyPolicyPage         = lazy(() => import("@/pages/PrivacyPolicyPage"));
const TermsOfServicePage        = lazy(() => import("@/pages/TermsOfServicePage"));
const GetStartedPage            = lazy(() => import("@/pages/GetStartedPage"));
const HelpSupportPage           = lazy(() => import("@/pages/HelpSupportPage"));
const FeedbackPage              = lazy(() => import("@/pages/FeedbackPage"));
const MarketerBookingPage       = lazy(() => import("@/pages/MarketerBookingPage"));

// Shared QueryClient — single instance for the whole app.
const queryClient = new QueryClient();

function LoadingScreen() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background">
      <div className="w-12 h-12 rounded-full border-4 border-primary/20 border-t-primary animate-spin mb-4" />
      <p className="text-muted-foreground font-medium animate-pulse">Loading JOBSAGE...</p>
    </div>
  );
}

function Redirect({ to }: { to: string }) {
  const [, setLocation] = useLocation();
  useEffect(() => {
    setLocation(to);
  }, [to, setLocation]);
  return <LoadingScreen />;
}

// ProfileGate — decides what to show at "/" for authenticated users.
// useGetMyConsent / useGetMyProfile here share queryKeys with AuthGuard, so
// React Query deduplicates the network requests — only one /api/consent/me and
// one /api/profiles/me fire per load, regardless of both components subscribing.
function ProfileGate() {
  const { user } = useAuth();
  const [location] = useLocation();

  const { data: consentData, isLoading: consentLoading } = useGetMyConsent({
    query: {
      queryKey: getGetMyConsentQueryKey(),
      // refetchOnMount/refetchOnWindowFocus:false — AuthGuard (our parent) already
      // fetched this. A second observer re-triggering the request sets
      // profileLoading=true on AuthGuard too, causing AuthGuard to show its spinner
      // and unmount us — creating an infinite abort/remount loop on mount OR on
      // window focus events.
      refetchOnMount: false,
      refetchOnWindowFocus: false,
      retry: false,
    },
  });

  const hasConsented = consentData?.hasConsented === true;

  const { data: profile, isLoading: profileLoading, isError: profileError } = useGetMyProfile({
    query: {
      queryKey: getGetMyProfileQueryKey(),
      enabled: hasConsented,
      // Same reason — read the cached error/data from AuthGuard's fetch, never
      // trigger a fresh fetch from this observer (on mount or window focus).
      refetchOnMount: false,
      refetchOnWindowFocus: false,
      retry: false,
    },
  });

  // Only block on consentLoading. AuthGuard already waited for the profile query
  // before rendering ProfileGate. If profileLoading is somehow still true here
  // (e.g. an aborted fetch left the cache empty), treat it as "no profile" and
  // fall through to the redirect logic below rather than spinning forever.
  const isLoading = consentLoading;

  if (isLoading) return <LoadingScreen />;
  if ((user?.role as string) === "employer") {
    return <Redirect to="/employer/dashboard" />;
  }
  if (consentData && !consentData.hasConsented) {
    return <Redirect to="/consent" />;
  }
  if (hasConsented && (profileError || !profile?.profession)) {
    return <Redirect to="/onboarding" />;
  }

  return <DashboardPage />;
}

function SmartHome() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) return <LoadingScreen />;
  if (!isAuthenticated) return <LandingPage />;

  return (
    <AuthGuard>
      <ProfileGate />
    </AuthGuard>
  );
}

function AdminGuard({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!isLoading && user && !isAdminRole(user.role)) {
      setLocation("/");
    }
  }, [isLoading, user, setLocation]);

  if (isLoading) return null;
  if (!user || !isAdminRole(user.role)) return null;
  return <>{children}</>;
}

function LeadsGuard({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!isLoading && user && !canAccessLeads(user.role)) {
      setLocation("/");
    }
  }, [isLoading, user, setLocation]);

  if (isLoading) return null;
  if (!user || !canAccessLeads(user.role)) return null;
  return <>{children}</>;
}

function SuperAdminGuard({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!isLoading && user && (user.role as string) !== "super_admin") {
      setLocation("/");
    }
  }, [isLoading, user, setLocation]);

  if (isLoading) return null;
  if (!user || (user.role as string) !== "super_admin") return null;
  return <>{children}</>;
}

function AdminUsersRoute() {
  const { user } = useAuth();
  return (user?.role as string) === "super_admin" ? <SuperAdminUsersPage /> : <AdminUsersPage />;
}

function EmployerGuard({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!isLoading && user && (user.role as string) !== "employer" && (user.role as string) !== "admin") {
      setLocation("/employer/onboarding");
    }
  }, [isLoading, user, setLocation]);

  if (isLoading) return null;
  if (!user || ((user.role as string) !== "employer" && (user.role as string) !== "admin")) return null;
  return <>{children}</>;
}

function ReviewerGuard({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!isLoading && user && user.role !== "admin" && user.role !== "reviewer") {
      setLocation("/");
    }
  }, [isLoading, user, setLocation]);

  if (isLoading) return null;
  if (!user || (user.role !== "admin" && user.role !== "reviewer")) return null;
  return <>{children}</>;
}

function Router() {
  return (
    // Single Suspense boundary — shows LoadingScreen while any lazy chunk loads.
    <Suspense fallback={<LoadingScreen />}>
      <Switch>
        {/* Public home — LandingPage for guests, ProfileGate for signed-in users */}
        <Route path="/" component={SmartHome} />

        {/* Public auth routes */}
        <Route path="/login" component={LoginPage} />
        <Route path="/admin/login" component={AdminLoginPage} />
        <Route path="/register" component={RegisterPage} />
        <Route path="/employer/register" component={EmployerRegisterPage} />
        <Route path="/forgot-password" component={ForgotPasswordPage} />
        <Route path="/reset-password" component={ResetPasswordPage} />

        {/* Public privacy policy for the Smart Apply Chrome extension (required by the Chrome Web Store) */}
        <Route path="/extension-privacy" component={ExtensionPrivacyPage} />

        {/* Core legal and privacy pages */}
        <Route path="/privacy" component={PrivacyPolicyPage} />
        <Route path="/terms" component={TermsOfServicePage} />

        {/* Sprint release notes — public, print-ready */}
        <Route path="/release-notes" component={ReleaseNotesPage} />

        {/* Social media lead capture — traffic from Facebook, Instagram, LinkedIn */}
        <Route path="/get-started" component={GetStartedPage} />
        <Route path="/help" component={HelpSupportPage} />
        <Route path="/support" component={HelpSupportPage} />
        <Route path="/book/:slug" component={MarketerBookingPage} />

        {/* Protected routes inside AuthGuard */}
        <Route path="*">
          <AuthGuard>
            <Suspense fallback={<LoadingScreen />}>
              <Switch>
                <Route path="/consent" component={ConsentPage} />
                <Route path="/onboarding" component={OnboardingPage} />
                <Route path="/profile" component={ProfilePage} />
                <Route path="/documents" component={DocumentsPage} />

                <Route path="/eligibility" component={EligibilityPage} />
                <Route path="/opportunities" component={OpportunitiesPage} />
                <Route path="/applications" component={ApplicationsPage} />
                <Route path="/inbox" component={InboxPage} />
                <Route path="/path" component={PathPage} />
                <Route path="/interview-prep" component={InterviewPrepPage} />
                <Route path="/sponsor-licences" component={SponsorLicencesPage} />
                <Route path="/my-report" component={MyProgressReportPage} />
                <Route path="/regulatory-guidance" component={RegulatoryGuidancePage} />
                <Route path="/calendar" component={InterviewCalendarPage} />
                <Route path="/recommendations" component={RecommendationLettersPage} />
                <Route path="/identity" component={IdentityVerificationPage} />
                <Route path="/feedback" component={FeedbackPage} />

                <Route path="/admin/rulesets">
                  <AdminGuard><AdminRulesetsPage /></AdminGuard>
                </Route>
                <Route path="/review-queue">
                  <ReviewerGuard><ReviewQueuePage /></ReviewerGuard>
                </Route>
                <Route path="/admin/roles">
                  <AdminGuard><AdminRolesPage /></AdminGuard>
                </Route>
                <Route path="/admin/audit">
                  <AdminGuard><AdminAuditPage /></AdminGuard>
                </Route>
                <Route path="/admin/users">
                  <AdminGuard><AdminUsersRoute /></AdminGuard>
                </Route>
                <Route path="/admin/leads">
                  <LeadsGuard><AdminLeadsPage /></LeadsGuard>
                </Route>
                <Route path="/admin/calendar">
                  <LeadsGuard><AdminCalendarPage /></LeadsGuard>
                </Route>
                <Route path="/admin/super">
                  <SuperAdminGuard><SuperAdminPage /></SuperAdminGuard>
                </Route>
                <Route path="/admin/sync">
                  <SuperAdminGuard><AdminSyncPage /></SuperAdminGuard>
                </Route>
                <Route path="/admin/sponsor-import">
                  <SuperAdminGuard><SponsorWebsiteImportPage /></SuperAdminGuard>
                </Route>

                <Route path="/impersonate" component={ImpersonatePage} />

                {/* Employer Portal */}
                <Route path="/employer/onboarding" component={EmployerOnboardingPage} />
                <Route path="/employer/dashboard">
                  <EmployerGuard><EmployerDashboardPage /></EmployerGuard>
                </Route>
                <Route path="/employer/profile">
                  <EmployerGuard><EmployerOnboardingPage /></EmployerGuard>
                </Route>
                <Route path="/employer/jobs/new">
                  <EmployerGuard><EmployerJobFormPage /></EmployerGuard>
                </Route>
                <Route path="/employer/jobs/:id/edit">
                  <EmployerGuard><EmployerJobFormPage /></EmployerGuard>
                </Route>
                <Route path="/employer/jobs/:id">
                  <EmployerGuard><EmployerJobDetailPage /></EmployerGuard>
                </Route>
                <Route path="/employer/talent-search">
                  <EmployerGuard><TalentSearchPage /></EmployerGuard>
                </Route>
                <Route path="/employer/campaigns">
                  <EmployerGuard><CampaignsPage /></EmployerGuard>
                </Route>

                <Route component={NotFound} />
              </Switch>
            </Suspense>
          </AuthGuard>
        </Route>
      </Switch>
    </Suspense>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
        <Router />
        <MobileAssistedWorkspaceHost />
        <QuickHelpMenu guestOnly />
      </WouterRouter>
      <Toaster />
    </QueryClientProvider>
  );
}

export default App;
