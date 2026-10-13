import type { EmployerStaffRole } from "@/hooks/useEmployerOrganizations";

export function canVisitEmployerRoute(
  role: EmployerStaffRole | null | undefined,
  path: string,
): boolean {
  if (role === "employer_owner" || role === "employer_admin") return true;
  if (path === "/employer/dashboard") return true;

  if (role === "recruiter" || role === "hiring_manager" || role === "employer_viewer") {
    if (/^\/employer\/jobs\/\d+$/.test(path)) return true;
  }

  return role === "recruiter" && /^\/employer\/jobs\/\d+\/edit$/.test(path);
}
