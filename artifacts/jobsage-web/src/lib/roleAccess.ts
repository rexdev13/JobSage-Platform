export type WebAppRole = "candidate" | "admin" | "reviewer" | "moderator" | "employer" | "super_admin" | "marketing";

export const ADMIN_ROLES: readonly WebAppRole[] = ["admin", "super_admin"];
export const LEADS_ROLES: readonly WebAppRole[] = ["admin", "super_admin", "marketing"];

export const MARKETING_NAVIGATION = [
  { name: "Waitlist Leads", href: "/admin/leads" },
  { name: "Calendar", href: "/admin/calendar" },
] as const;

export function isAdminRole(role: unknown): boolean {
  return typeof role === "string" && ADMIN_ROLES.includes(role as WebAppRole);
}

export function canAccessLeads(role: unknown): boolean {
  return typeof role === "string" && LEADS_ROLES.includes(role as WebAppRole);
}

export function canDeleteLeads(role: unknown): boolean {
  return isAdminRole(role);
}

export function isMarketingRole(role: unknown): boolean {
  return role === "marketing";
}

export function requiresCandidateProfile(role: unknown): boolean {
  return role === "candidate";
}

export function getPlatformOperatorHomePath(role: unknown): string | null {
  if (role === "moderator") return "/moderation/reports";
  if (role === "admin") return "/admin/roles";
  if (role === "super_admin") return "/admin/super";
  return null;
}
