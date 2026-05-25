import * as React from "react";
import { AppSidebar } from "./AppSidebar";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui-enhanced";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api";

interface ImpersonationContext {
  displayName: string;
  email: string;
  role: string;
  adminId: string | null;
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);
  const [impersonation, setImpersonation] = React.useState<ImpersonationContext | null>(null);

  React.useEffect(() => {
    const stored = sessionStorage.getItem("impersonation");
    if (stored) {
      try {
        setImpersonation(JSON.parse(stored) as ImpersonationContext);
      } catch {
        sessionStorage.removeItem("impersonation");
      }
    }
  }, []);

  async function stopImpersonating() {
    sessionStorage.removeItem("impersonation");
    setImpersonation(null);
    await fetch(`${API_BASE}/auth/logout`, { method: "POST", credentials: "include" }).catch(() => {});
    window.close();
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
          <div className="relative z-50">
            <AppSidebar />
          </div>
        </div>
      )}

      {/* Desktop Sidebar */}
      <div className={`hidden md:flex ${impersonation ? "mt-10" : ""}`}>
        <AppSidebar />
      </div>

      {/* Main Content */}
      <div className={`flex flex-col flex-1 w-full overflow-hidden ${impersonation ? "mt-10" : ""}`}>
        <header className="h-16 flex items-center justify-between px-4 border-b border-border bg-background/80 backdrop-blur-md md:hidden shrink-0 z-30">
          <h1 className="text-xl font-display font-bold text-primary tracking-tight">JOBSAGE</h1>
          <Button variant="ghost" size="icon" onClick={() => setMobileMenuOpen(true)}>
            <Menu className="w-6 h-6" />
          </Button>
        </header>
        <main className="flex-1 overflow-y-auto relative z-0 bg-gray-50/30">
          {children}
        </main>
      </div>
    </div>
  );
}
