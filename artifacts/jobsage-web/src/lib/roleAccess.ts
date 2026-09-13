export type WebAppRole = "candidate" | "admin" | "reviewer" | "employer" | "super_admin" | "marketing";

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