import * as React from "react";
import { AppSidebar } from "./AppSidebar";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui-enhanced";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden">
      {/* Mobile Sidebar overlay */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-40 flex md:hidden">
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setMobileMenuOpen(false)} />
          <div className="relative z-50">
            <AppSidebar />
          </div>
        </div>
      )}

      {/* Desktop Sidebar */}
      <div className="hidden md:flex">
        <AppSidebar />
      </div>

      {/* Main Content */}
      <div className="flex flex-col flex-1 w-full overflow-hidden">
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
