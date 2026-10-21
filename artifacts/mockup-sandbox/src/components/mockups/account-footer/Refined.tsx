import "./_group.css";
import { ChevronRight, LogOut, ShieldCheck } from "lucide-react";

/** Refined account footer: identity is informational; account access is the primary action. */
export function Refined() {
  const user = {
    firstName: "Dev",
    lastName: "Ife",
    email: "dev@example.com",
    profileImageUrl: null as string | null,
  };
  const role = "candidate";
  const profilePhotoUrl: string | null = null;

  return (
    <aside className="flex min-h-screen flex-col bg-sidebar font-sans text-sidebar-foreground">
      <div className="min-h-0 flex-1" aria-hidden="true" />
      <footer className="shrink-0 border-t border-sidebar-border px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4">
        <div className="mb-3 flex min-w-0 items-center gap-3 rounded-2xl bg-background/70 px-3 py-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/10 text-sm font-semibold tracking-wide text-primary ring-1 ring-primary/10">
            {profilePhotoUrl ? (
              <img src={profilePhotoUrl} alt="Dev Ife profile" className="h-full w-full object-cover" />
            ) : user.profileImageUrl ? (
              <img src={user.profileImageUrl} alt="Dev Ife profile" className="h-full w-full object-cover" />
            ) : (
              `${user.firstName?.[0] || user.email?.[0] || "U"}${user.lastName?.[0] || ""}`.toUpperCase()
            )}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold leading-5 text-foreground">
              {user.firstName ? `${user.firstName} ${user.lastName || ""}` : user.email}
            </p>
            <p className="mt-0.5 text-xs capitalize leading-4 text-muted-foreground">{role}</p>
          </div>
          <span className="ml-auto shrink-0 self-center text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
            Account
          </span>
        </div>

        <a
          href="/privacy-settings"
          className="group flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-sm font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/8 text-primary">
            <ShieldCheck className="h-[17px] w-[17px]" strokeWidth={1.8} />
          </span>
          <span className="flex-1">Privacy &amp; account</span>
          <ChevronRight className="h-4 w-4 text-muted-foreground/65 transition-transform group-hover:translate-x-0.5" />
        </a>

        <div className="mt-2 border-t border-sidebar-border/80 pt-2">
          <button
            type="button"
            className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <LogOut className="ml-1 h-[17px] w-[17px]" strokeWidth={1.8} />
            Log out
          </button>
        </div>
      </footer>
    </aside>
  );
}
