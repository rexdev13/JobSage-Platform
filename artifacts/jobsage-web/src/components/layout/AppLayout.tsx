import * as React from "react";
import { AppSidebar } from "./AppSidebar";
import { Menu, X } from "lucide-react";
import { Button } from "@/components/ui-enhanced";
import { ReadinessQuotaModal } from "@/components/ReadinessQuotaModal";
import { QuickHelpMenu } from "@/components/QuickHelpMenu";
import { CvEnhancementSheet } from "@/components/CvEnhancementSheet";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";

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
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);
  const [enhanceOpen, setEnhanceOpen] = React.useState(false);
  const [impersonation, setImpersonation] = React.useState<ImpersonationState | null>(null);
  const [quotaOpen, setQuotaOpen] = React.useState(false);
  const menuButtonRef = React.useRef<HTMLButtonElement>(null);
  const drawerWasOpenRef = React.useRef(false);

  React.useEffect(() => {
    if (drawerWasOpenRef.current && !mobileMenuOpen) menuButtonRef.current?.focus();
    drawerWasOpenRef.current = mobileMenuOpen;
  }, [mobileMenuOpen]);

  function openEnhancement() {
    if (mobileMenuOpen) {
      setMobileMenuOpen(false);
      window.setTimeout(() => setEnhanceOpen(true), 320);
      return;
    }
    setEnhanceOpen(true);
  }

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

  async function stopImpersonating() {
    await fetch(`${API_BASE}/admin/super/impersonate/stop`, { method: "POST", credentials: "include" }).catch(() => {});
    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    window.location.href = base + "/admin/super";
  }

  return (
    <div className="flex h-[100dvh] w-full overflow-hidden bg-background">
      {impersonation && (
        <div className="fixed left-0 right-0 top-0 z-[100] flex min-h-10 items-center justify-between gap-2 bg-amber-500 px-3 py-2 text-xs text-amber-950 shadow-md sm:px-4 sm:text-sm">
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <div className="w-2 h-2 rounded-full bg-amber-900 animate-pulse" />
            <span className="min-w-0 flex-1 truncate font-semibold">
              Impersonating: <strong>{impersonation.displayName}</strong>
              {impersonation.email && impersonation.email !== impersonation.displayName && (
                <span className="hidden font-normal md:inline"> ({impersonation.email})</span>
              )}
            </span>
            <span className="hidden rounded-full bg-amber-900/20 px-2 py-0.5 capitalize sm:inline">
              {impersonation.role.replace(/_/g, " ")}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <span className="text-xs font-medium hidden sm:block">Read-only — all writes blocked</span>
            <button
              onClick={stopImpersonating}
              className="min-h-8 rounded-lg bg-amber-900/20 px-2 text-[10px] font-medium transition-colors hover:bg-amber-900/30 sm:px-3 sm:text-xs"
            >
              Stop Impersonating
            </button>
          </div>
        </div>
      )}

      <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
        <SheetContent
          side="left"
          id="mobile-navigation-drawer"
          aria-describedby="mobile-navigation-description"
          className={`fixed z-[60] flex h-[100dvh] max-h-[100dvh] w-[min(88vw,320px)] max-w-[320px] sm:max-w-[320px] flex-col overflow-hidden border-r border-sidebar-border bg-sidebar p-0 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] text-sidebar-foreground [&>button:first-of-type]:hidden ${impersonation ? "top-10 h-[calc(100dvh-2.5rem)]" : ""}`}
          data-testid="mobile-navigation-drawer"
        >
          <SheetTitle className="sr-only">JOBSAGE navigation</SheetTitle>
          <SheetDescription id="mobile-navigation-description" className="sr-only">
            Navigate JOBSAGE candidate tools and career resources.
          </SheetDescription>
          <SheetClose asChild>
            <Button variant="ghost" size="icon" aria-label="Close navigation menu" data-testid="button-close-navigation"
              className="absolute right-2 top-2 z-20 min-h-11 min-w-11 text-sidebar-foreground hover:bg-sidebar-accent">
              <X className="h-5 w-5" />
            </Button>
          </SheetClose>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <AppSidebar onNavigate={() => setMobileMenuOpen(false)} onEnhance={openEnhancement} />
          </div>
        </SheetContent>
      </Sheet>

      {/* Desktop Sidebar */}
      <div className={`hidden md:flex ${impersonation ? "mt-10" : ""}`}>
        <AppSidebar onEnhance={openEnhancement} />
      </div>

      {/* Main Content */}
      <div className={`flex min-w-0 flex-col flex-1 w-full overflow-hidden ${impersonation ? "mt-10" : ""}`}>
        <header className="z-30 flex h-16 shrink-0 items-center justify-between border-b border-border bg-background/80 px-4 backdrop-blur-md md:hidden">
          <img src="/logo.png" alt="JOBSAGE" className="h-9 w-auto object-contain" />
          <Button ref={menuButtonRef} variant="ghost" size="icon"
            onClick={() => setMobileMenuOpen(true)}
            aria-label="Open navigation menu"
            aria-haspopup="dialog"
            aria-expanded={mobileMenuOpen}
            aria-controls="mobile-navigation-drawer"
            data-testid="button-open-navigation">
            <Menu className="w-6 h-6" />
          </Button>
        </header>
        <main className="flex-1 overflow-y-auto relative z-0 bg-gray-50/30">
          {children}
        </main>
      </div>
      <ReadinessQuotaModal open={quotaOpen} onClose={() => setQuotaOpen(false)} />
      <QuickHelpMenu onOpenReadiness={() => setQuotaOpen(true)} />
      <CvEnhancementSheet open={enhanceOpen} onOpenChange={setEnhanceOpen} />
    </div>
  );
}
