import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { useAuth } from "@workspace/auth-web";
import { useEffect } from "react";
import {
  useGetMyProfile,
  useGetMyConsent,
  getGetMyConsentQueryKey,
  getGetMyProfileQueryKey,
} from "@workspace/api-client-react";

import SuperAdminPage from "@/pages/admin/SuperAdminPage";
import ImpersonatePage from "@/pages/ImpersonatePage";
import EmployerOnboardingPage from "@/pages/employer/EmployerOnboardingPage";
import EmployerRegisterPage from "@/pages/employer/EmployerRegisterPage";
import EmployerDashboardPage from "@/pages/employer/EmployerDashboardPage";
import EmployerJobFormPage from "@/pages/employer/EmployerJobFormPage";
import EmployerJobDetailPage from "@/pages/employer/EmployerJobDetailPage";
import TalentSearchPage from "@/pages/employer/TalentSearchPage";
import CampaignsPage from "@/pages/employer/CampaignsPage";

import { AuthGuard } from "@/components/layout/AuthGuard";

import LandingPage from "@/pages/LandingPage";
import LoginPage from "@/pages/LoginPage";
import AdminLoginPage from "@/pages/admin/AdminLoginPage";
import RegisterPage from "@/pages/RegisterPage";
import ForgotPasswordPage from "@/pages/ForgotPasswordPage";
import ResetPasswordPage from "@/pages/ResetPasswordPage";
import ConsentPage from "@/pages/ConsentPage";
import OnboardingPage from "@/pages/OnboardingPage";
import DashboardPage from "@/pages/DashboardPage";
import ProfilePage from "@/pages/ProfilePage";
import DocumentsPage from "@/pages/DocumentsPage";
import EligibilityPage from "@/pages/EligibilityPage";
import AdminRulesetsPage from "@/pages/AdminRulesetsPage";
import OpportunitiesPage from "@/pages/OpportunitiesPage";
import ApplicationsPage from "@/pages/ApplicationsPage";
import InboxPage from "@/pages/InboxPage";
import PathPage from "@/pages/PathPage";
import InterviewPrepPage from "@/pages/InterviewPrepPage";
import AdminRolesPage from "@/pages/AdminRolesPage";
import ReviewQueuePage from "@/pages/ReviewQueuePage";
import AdminAuditPage from "@/pages/AdminAuditPage";
import AdminUsersPage from "@/pages/AdminUsersPage";
import SponsorLicencesPage from "@/pages/SponsorLicencesPage";
import MyProgressReportPage from "@/pages/MyProgressReportPage";
import RegulatoryGuidancePage from "@/pages/RegulatoryGuidancePage";
import InterviewCalendarPage from "@/pages/InterviewCalendarPage";
import RecommendationLettersPage from "@/pages/RecommendationLettersPage";
import IdentityVerificationPage from "@/pages/IdentityVerificationPage";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient();

function LoadingScreen() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background">
      <div className="w-12 h-12 rounded-full border-4 border-primary/20 border-t-primary animate-spin mb-4" />
      <p className="text-muted-foreground font-medium animate-pulse">Loading JOBSAGE...</p>
    </div>
  );
}

function ProfileGate() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();

  const { data: consentData, isLoading: consentLoading } = useGetMyConsent({
    query: { queryKey: getGetMyConsentQueryKey(), retry: false },
  });

  const hasConsented = consentData?.hasConsented === true;

  const { data: profile, isLoading: profileLoading, isError: profileError } = useGetMyProfile({
    query: {
      queryKey: getGetMyProfileQueryKey(),
      enabled: hasConsented,
      retry: false,
    },
  });

  const isLoading = consentLoading || (hasConsented && profileLoading);

  useEffect(() => {
    if (isLoading) return;
    if ((user?.role as string) === "employer") {
      setLocation("/employer/dashboard");
      return;
    }
    if (consentData && !consentData.hasConsented) {
      setLocation("/consent");
      return;
    }
    if (hasConsented && !profileError && !profile?.profession) {
      setLocation("/onboarding");
    }
  }, [isLoading, consentData, hasConsented, profileError, profile, setLocation, user]);

  if (isLoading) return <LoadingScreen />;
  if ((user?.role as string) === "employer") return null;
  if (consentData && !consentData.hasConsented) return null;
  if (profileError) return <DashboardPage />;
  if (!profile?.profession) return null;

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
    if (!isLoading && user && (user.role as string) !== "admin" && (user.role as string) !== "super_admin") {
      setLocation("/");
    }
  }, [isLoading, user, setLocation]);

  if (isLoading) return null;
  if (!user || ((user.role as string) !== "admin" && (user.role as string) !== "super_admin")) return null;
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
    <Switch>
      {/* Public home — LandingPage for guests, DashboardPage for signed-in users */}
      <Route path="/" component={SmartHome} />

      {/* Public auth routes */}
      <Route path="/login" component={LoginPage} />
      <Route path="/admin/login" component={AdminLoginPage} />
      <Route path="/register" component={RegisterPage} />
      <Route path="/employer/register" component={EmployerRegisterPage} />
      <Route path="/forgot-password" component={ForgotPasswordPage} />
      <Route path="/reset-password" component={ResetPasswordPage} />

      {/* Protected Routes inside AuthGuard */}
      <Route path="*">
        <AuthGuard>
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
            <Route path="/admin/rulesets">
              <AdminGuard>
                <AdminRulesetsPage />
              </AdminGuard>
            </Route>
            <Route path="/review-queue">
              <ReviewerGuard>
                <ReviewQueuePage />
              </ReviewerGuard>
            </Route>
            <Route path="/admin/roles">
              <AdminGuard>
                <AdminRolesPage />
              </AdminGuard>
            </Route>
            <Route path="/admin/audit">
              <AdminGuard>
                <AdminAuditPage />
              </AdminGuard>
            </Route>
            <Route path="/admin/users">
              <AdminGuard>
                <AdminUsersPage />
              </AdminGuard>
            </Route>
            <Route path="/admin/super">
              <SuperAdminGuard>
                <SuperAdminPage />
              </SuperAdminGuard>
            </Route>

            {/* Impersonation — opened in new tab by super admin */}
            <Route path="/impersonate" component={ImpersonatePage} />

            {/* Employer Portal Routes */}
            <Route path="/employer/onboarding" component={EmployerOnboardingPage} />
            <Route path="/employer/dashboard">
              <EmployerGuard>
                <EmployerDashboardPage />
              </EmployerGuard>
            </Route>
            <Route path="/employer/profile">
              <EmployerGuard>
                <EmployerOnboardingPage />
              </EmployerGuard>
            </Route>
            <Route path="/employer/jobs/new">
              <EmployerGuard>
                <EmployerJobFormPage />
              </EmployerGuard>
            </Route>
            <Route path="/employer/jobs/:id/edit">
              <EmployerGuard>
                <EmployerJobFormPage />
              </EmployerGuard>
            </Route>
            <Route path="/employer/jobs/:id">
              <EmployerGuard>
                <EmployerJobDetailPage />
              </EmployerGuard>
            </Route>
            <Route path="/employer/talent-search">
              <EmployerGuard>
                <TalentSearchPage />
              </EmployerGuard>
            </Route>
            <Route path="/employer/campaigns">
              <EmployerGuard>
                <CampaignsPage />
              </EmployerGuard>
            </Route>

            <Route component={NotFound} />
          </Switch>
        </AuthGuard>
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
        <Router />
      </WouterRouter>
      <Toaster />
    </QueryClientProvider>
  );
}

export default App;
