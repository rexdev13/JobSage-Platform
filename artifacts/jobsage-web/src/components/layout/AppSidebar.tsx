import { Link, useLocation } from "wouter";
import { useAuth } from "@workspace/auth-web";
import { 
  Home, User, FileText, CheckCircle, 
  Map, ClipboardList, Shield, Users, LogOut, Briefcase,
  Building2, Plus, LayoutDashboard, Sparkles, UserCog, List
} from "lucide-react";
import { cn } from "@/components/ui-enhanced";

export function AppSidebar() {
  const [location] = useLocation();
  const { user, logout } = useAuth();

  const role = user?.role || "candidate";

  const navigation = [
    // Candidate + Reviewer + Admin
    { name: "My Dashboard", href: "/", icon: Home, roles: ["candidate", "reviewer", "admin"] },
    { name: "My Profile", href: "/profile", icon: User, roles: ["candidate", "reviewer", "admin"] },
    { name: "My Documents", href: "/documents", icon: FileText, roles: ["candidate", "reviewer", "admin"] },
    { name: "My Eligibility", href: "/eligibility", icon: CheckCircle, roles: ["candidate", "reviewer", "admin"] },
    { name: "Opportunities", href: "/opportunities", icon: Briefcase, roles: ["candidate", "reviewer", "admin"] },
    { name: "My Applications", href: "/applications", icon: ClipboardList, roles: ["candidate", "reviewer", "admin"] },
    { name: "My Path", href: "/path", icon: Map, roles: ["candidate", "reviewer", "admin"] },
    { name: "Interview Prep", href: "/interview-prep", icon: Sparkles, roles: ["candidate", "reviewer", "admin"] },
    { name: "Sponsor Licences", href: "/sponsor-licences", icon: List, roles: ["candidate", "reviewer", "admin"] },

    // Employer
    { name: "Employer Dashboard", href: "/employer/dashboard", icon: LayoutDashboard, roles: ["employer", "admin"] },
    { name: "Post a Job", href: "/employer/jobs/new", icon: Plus, roles: ["employer", "admin"] },
    { name: "Organisation Profile", href: "/employer/profile", icon: Building2, roles: ["employer", "admin"] },
    
    // Reviewer + Admin
    { name: "Review Queue", href: "/review-queue", icon: ClipboardList, roles: ["reviewer", "admin"] },
    
    // Admin Only
    { name: "Ruleset Management", href: "/admin/rulesets", icon: Shield, roles: ["admin"] },
    { name: "Role Management", href: "/admin/roles", icon: Users, roles: ["admin"] },
    { name: "Audit Logs", href: "/admin/audit", icon: Shield, roles: ["admin"] },
    { name: "User Management", href: "/admin/users", icon: UserCog, roles: ["admin"] },
  ];

  const visibleNav = navigation.filter(item => item.roles.includes(role));

  return (
    <div className="w-64 bg-sidebar border-r border-sidebar-border h-screen flex flex-col shrink-0">
      <div className="h-16 flex items-center px-6 border-b border-sidebar-border shrink-0">
        <h1 className="text-xl font-display font-bold text-primary tracking-tight">JOBSAGE</h1>
      </div>
      
      <div className="flex-1 overflow-y-auto py-6 px-4 space-y-1">
        {visibleNav.map((item) => {
          const isActive = location === item.href;
          return (
            <Link key={item.name} href={item.href} className={cn(
              "flex items-center px-3 py-2.5 rounded-xl text-sm font-medium transition-colors hover-elevate",
              isActive 
                ? "bg-primary text-primary-foreground shadow-sm" 
                : "text-sidebar-foreground hover:bg-sidebar-accent"
            )}>
              <item.icon className={cn("w-5 h-5 mr-3", isActive ? "text-primary-foreground/80" : "text-muted-foreground")} />
              {item.name}
            </Link>
          );
        })}
      </div>

      <div className="p-4 border-t border-sidebar-border shrink-0">
        <div className="flex items-center mb-4 px-2">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold overflow-hidden shrink-0">
            {user?.profileImageUrl ? (
              <img src={user.profileImageUrl} alt="Avatar" className="w-full h-full object-cover" />
            ) : (
              (user?.firstName?.[0] || user?.email?.[0] || "U").toUpperCase()
            )}
          </div>
          <div className="ml-3 overflow-hidden">
            <p className="text-sm font-semibold truncate text-foreground">
              {user?.firstName ? `${user.firstName} ${user.lastName || ''}` : user?.email}
            </p>
            <p className="text-xs text-muted-foreground capitalize">{role}</p>
          </div>
        </div>
        <button 
          onClick={logout}
          className="w-full flex items-center px-3 py-2.5 rounded-xl text-sm font-medium text-destructive hover:bg-destructive/10 transition-colors"
        >
          <LogOut className="w-5 h-5 mr-3 opacity-80" />
          Log out
        </button>
      </div>
    </div>
  );
}
