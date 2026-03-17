import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";

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
import { 
  PathPage, 
  ReviewQueuePage, 
  AdminRolesPage, 
  AdminAuditPage 
} from "@/pages/Placeholders";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient();

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
            <Route path="/admin/rulesets" component={AdminRulesetsPage} />
            
            {/* Placeholders for next milestones */}
            <Route path="/path" component={PathPage} />
            <Route path="/review-queue" component={ReviewQueuePage} />
            <Route path="/admin/roles" component={AdminRolesPage} />
            <Route path="/admin/audit" component={AdminAuditPage} />
            
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
