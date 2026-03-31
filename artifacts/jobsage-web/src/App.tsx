import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { useAuth } from "@workspace/auth-web";
import { useEffect } from "react";
import { useGetMyProfile } from "@workspace/api-client-react";

import { AuthGuard } from "@/components/layout/AuthGuard";

import LandingPage from "@/pages/LandingPage";
import LoginPage from "@/pages/LoginPage";
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
import PathPage from "@/pages/PathPage";
import AdminRolesPage from "@/pages/AdminRolesPage";
import ReviewQueuePage from "@/pages/ReviewQueuePage";
import AdminAuditPage from "@/pages/AdminAuditPage";
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
  const { data: profile, isLoading: profileLoading, isError: profileError } = useGetMyProfile();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!profileLoading && !profileError && !profile?.profession) {
      setLocation("/onboarding");
    }
  }, [profileLoading, profileError, profile, setLocation]);

  if (profileLoading) return <LoadingScreen />;
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
    if (!isLoading && user && user.role !== "admin") {
      setLocation("/");
    }
  }, [isLoading, user, setLocation]);

  if (isLoading) return null;
  if (!user || user.role !== "admin") return null;
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
      <Route path="/register" component={RegisterPage} />
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
            <Route path="/path" component={PathPage} />
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
