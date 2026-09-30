import * as React from "react";
import { AppSidebar } from "./AppSidebar";
import { useAuth } from "@workspace/auth-web";
import { Menu, X } from "lucide-react";
import { Button } from "@/components/ui-enhanced";
import { Link } from "wouter";
import { HelpCircle, Sparkles } from "lucide-react";
import { ReadinessQuotaModal } from "@/components/ReadinessQuotaModal";
import { FeedbackWidget } from "@/components/FeedbackWidget";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api";

interface ImpersonationState {
  displayName: string;
  email: string;
  role: string;
}

interface AuthUserResponse {
  user: { id: string; email?: string | null; firstName?: string | null; lastName?: string | null; role?: string | null } | null;
  isImpersonating?: boolean;
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);
  const [impersonation, setImpersonation] = React.useState<ImpersonationState | null>(null);
  const [quotaOpen, setQuotaOpen] = React.useState(false);
  const [quickHelpOpen, setQuickHelpOpen] = React.useState(false);

  function fetchImpersonationState() {
    fetch(`${API_BASE}/auth/user`, { credentials: "include" })
      .then((r) => r.json() as Promise<AuthUserResponse>)
      .then((data) => {
        if (data.isImpersonating && data.user) {
          const displayName =
            [data.user.firstName, data.user.lastName].filter(Boolean).join(" ") ||
            data.user.email ||
            data.user.id;
          setImpersonation({ displayName, email: data.user.email ?? "", role: data.user.role ?? "" });
        } else {
          setImpersonation(null);
        }
      })
      .catch(() => {});
  }

  React.useEffect(() => {
    fetchImpersonationState();
  }, []);

  React.useEffect(() => {
    const openQuota = () => setQuotaOpen(true);
    window.addEventListener("jobsage:readiness-limit-reached", openQuota);
    window.addEventListener("jobsage:open-readiness-quota", openQuota);
    return () => {
      window.removeEventListener("jobsage:readiness-limit-reached", openQuota);
      window.removeEventListener("jobsage:open-readiness-quota", openQuota);
    };
  }, []);

  async function stopImpersonating() {
    await fetch(`${API_BASE}/admin/super/impersonate/stop`, { method: "POST", credentials: "include" }).catch(() => {});
    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    window.location.href = base + "/admin/super";
  }

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden">
      {impersonation && (
        <div className="fixed top-0 left-0 right-0 z-[100] bg-amber-500 text-amber-950 px-4 py-2 flex items-center justify-between shadow-md text-sm">
          <div className="flex items-center gap-2.5">
            <div className="w-2 h-2 rounded-full bg-amber-900 animate-pulse" />
            <span className="font-semibold">
              Impersonating: <strong>{impersonation.displayName}</strong>
              {impersonation.email && impersonation.email !== impersonation.displayName && (
                <span className="font-normal"> ({impersonation.email})</span>
              )}
            </span>
            <span className="text-xs bg-amber-900/20 px-2 py-0.5 rounded-full capitalize">
              {impersonation.role.replace(/_/g, " ")}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium hidden sm:block">Read-only — all writes blocked</span>
            <button
              onClick={stopImpersonating}
              className="text-xs bg-amber-900/20 hover:bg-amber-900/30 px-3 py-1 rounded-lg font-medium transition-colors"
            >
              Stop Impersonating
            </button>
          </div>
        </div>
      )}

      {/* Mobile Sidebar overlay */}
      {mobileMenuOpen && (
        <div className={`fixed inset-0 z-40 flex md:hidden ${impersonation ? "top-10" : ""}`}>
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setMobileMenuOpen(false)} />
          <div className="relative z-50 h-full max-h-[100dvh] overflow-y-auto">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(false)}
              aria-label="Close navigation menu"
              className="absolute right-2 top-2 z-10 inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-sidebar-foreground hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
            >
              <X className="h-5 w-5" />
            </button>
            <AppSidebar onNavigate={() => setMobileMenuOpen(false)} />
          </div>
        </div>
      )}

      {/* Desktop Sidebar */}
      <div className={`hidden md:flex ${impersonation ? "mt-10" : ""}`}>
        <AppSidebar />
      </div>

      {/* Main Content */}
      <div className={`flex min-w-0 flex-col flex-1 w-full overflow-hidden ${impersonation ? "mt-10" : ""}`}>
        <header className="h-16 flex items-center justify-between px-4 border-b border-border bg-background/80 backdrop-blur-md md:hidden shrink-0 z-30">
          <img src="/logo.png" alt="JOBSAGE" className="h-9 w-auto object-contain" />
          <Button variant="ghost" size="icon" onClick={() => setMobileMenuOpen(true)}>
            <Menu className="w-6 h-6" />
          </Button>
        </header>
        <main className="flex-1 overflow-y-auto relative z-0 bg-gray-50/30">
          {children}
        </main>
        <div className="fixed bottom-5 right-5 z-40 flex flex-col items-end gap-2">
          {quickHelpOpen && (
            <div className="w-56 rounded-2xl border border-border bg-background p-2 shadow-xl" role="menu">
              <Link href="/help" data-testid="link-quick-help-center" onClick={() => setQuickHelpOpen(false)} className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold hover:bg-muted"><HelpCircle className="h-4 w-4 text-primary" /> Help &amp; Support</Link>
              {user?.role === "candidate" && <button type="button" data-testid="button-quick-readiness" onClick={() => { setQuickHelpOpen(false); setQuotaOpen(true); }} className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm font-semibold hover:bg-muted"><Sparkles className="h-4 w-4 text-primary" /> Readiness quota</button>}
            </div>
          )}
          <button type="button" data-testid="button-floating-help" aria-expanded={quickHelpOpen} aria-label="Open quick help" onClick={() => setQuickHelpOpen((value) => !value)} className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"><HelpCircle className="h-5 w-5" /></button>
        </div>
      </div>
      <ReadinessQuotaModal open={quotaOpen} onClose={() => setQuotaOpen(false)} />
      <FeedbackWidget forceVisible />
    </div>
  );
}
