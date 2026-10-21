import "./_group.css";
import { ChevronRight, LogOut } from "lucide-react";

/** Isolated preview of the exact account-footer markup from AppSidebar.tsx. */
export function Current() {
  const user = { firstName: "Dev", lastName: "Ife", email: "dev@example.com", profileImageUrl: null };
  const role = "candidate";
  const profilePhotoUrl = null;

  return (
    <aside className="flex min-h-screen flex-col bg-sidebar font-sans text-sidebar-foreground">
      <div className="min-h-0 flex-1" aria-hidden="true" />
      <div className="shrink-0 border-t border-sidebar-border p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <div className="mb-4 flex min-w-0 items-center px-2">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/10 font-bold text-primary">
            {profilePhotoUrl ? <img src={profilePhotoUrl} alt="Profile" className="h-full w-full object-cover" /> :
              user.profileImageUrl ? <img src={user.profileImageUrl} alt="Profile" className="h-full w-full object-cover" /> :
                (user.firstName?.[0] || user.email?.[0] || "U").toUpperCase()}
          </div>
          <div className="ml-3 min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">{user.firstName ? `${user.firstName} ${user.lastName || ""}` : user.email}</p>
            <p className="text-xs capitalize text-muted-foreground">{role}</p>
          </div>
        </div>
        <a href="#" className="flex min-h-11 w-full items-center rounded-xl px-3 py-2.5 text-sm font-medium text-sidebar-foreground">
          Privacy &amp; account
        </a>
        <div className="mt-2 border-t border-sidebar-border pt-2">
          <button type="button" className="flex min-h-11 w-full items-center rounded-xl px-3 py-2.5 text-sm font-medium text-destructive">
            <LogOut className="mr-3 h-5 w-5 opacity-80" />Log out
          </button>
        </div>
      </div>
    </aside>
  );
}
