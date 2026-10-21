import { lazy, Suspense } from "react";
import { Link, useLocation } from "wouter";
import { FileText, Loader2, Star } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { cn } from "@/lib/utils";

const Documents = lazy(() => import("./DocumentsPage"));
const References = lazy(() => import("./RecommendationLettersPage"));

const sections = [
  { label: "Documents", href: "/documents", icon: FileText },
  { label: "References", href: "/documents/references", icon: Star },
] as const;

export default function DocumentsWorkspacePage() {
  const [location] = useLocation();
  const referencesActive = location === "/documents/references";

  return (
    <AppLayout>
      <header className="mb-6">
        <h1 className="flex items-start gap-3 text-2xl sm:text-3xl font-display font-bold text-foreground">
          <FileText aria-hidden="true" className="mt-0.5 h-7 w-7 shrink-0 text-primary sm:h-8 sm:w-8" />
          CV &amp; Supporting Documents
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Manage your CV, qualifications, supporting documents and professional references in one place.
        </p>
      </header>

      <nav aria-label="CV and supporting documents sections" className="mb-6 flex flex-wrap gap-2 border-b border-border pb-3">
        {sections.map(({ label, href, icon: Icon }) => {
          const active = location === href;
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
              {label}
            </Link>
          );
        })}
      </nav>

      <Suspense fallback={
        <div role="status" className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 aria-hidden="true" className="h-5 w-5 animate-spin" />
          Loading {referencesActive ? "references" : "documents"}…
        </div>
      }>
        {referencesActive ? <References /> : <Documents />}
      </Suspense>
    </AppLayout>
  );
}
