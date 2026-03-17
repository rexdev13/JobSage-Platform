import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { useAuth } from "@workspace/replit-auth-web";
import { useEffect } from "react";

// Layouts & Guards
import { AuthGuard } from "@/components/layout/AuthGuard";

// Pages
import LandingPage from "@/pages/LandingPage";
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
      <Route path="/login" component={LandingPage} />
      
      {/* Protected Routes inside AuthGuard */}
      <Route path="*">
        <AuthGuard>
          <Switch>
            <Route path="/consent" component={ConsentPage} />
            <Route path="/onboarding" component={OnboardingPage} />
            <Route path="/" component={DashboardPage} />
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
