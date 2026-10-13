export type EmployerStaffRole =
  | "employer_owner"
  | "employer_admin"
  | "recruiter"
  | "hiring_manager"
  | "employer_viewer";
export type EmployerCapability =
  | "view_jobs"
  | "manage_jobs"
  | "publish_jobs"
  | "delete_jobs"
  | "view_candidates"
  | "manage_applicants"
  | "send_messages"
  | "schedule_interviews"
  | "submit_feedback"
  | "manage_campaigns"
  | "manage_staff"
  | "change_staff_roles"
  | "view_billing"
  | "transfer_ownership"
  | "delete_organization";

const allCapabilities: readonly EmployerCapability[] = [
  "view_jobs", "manage_jobs", "publish_jobs", "delete_jobs", "view_candidates",
  "manage_applicants", "send_messages", "schedule_interviews", "submit_feedback",
  "manage_campaigns", "manage_staff", "change_staff_roles", "view_billing",
  "transfer_ownership", "delete_organization",
];

const capabilities: Record<EmployerStaffRole, readonly EmployerCapability[]> = {
  employer_owner: allCapabilities,
  employer_admin: [
    "view_jobs", "manage_jobs", "publish_jobs", "delete_jobs", "view_candidates",
    "manage_applicants", "send_messages", "schedule_interviews", "submit_feedback",
    "manage_campaigns", "manage_staff", "change_staff_roles",
  ],
  recruiter: [
    "view_jobs", "manage_jobs", "publish_jobs", "view_candidates",
    "manage_applicants", "send_messages", "schedule_interviews",
  ],
  hiring_manager: ["view_jobs", "view_candidates", "schedule_interviews", "submit_feedback"],
  employer_viewer: ["view_jobs", "view_candidates"],
};

export function employerRoleCan(role: EmployerStaffRole, capability: EmployerCapability): boolean {
  return capabilities[role].includes(capability);
}

export function employerRoleCanAccessRoute(role: EmployerStaffRole, method: string, path: string): boolean {
  if (path === "/employer/profile") return role === "employer_owner" || role === "employer_admin";
  if (path === "/employer/staff/transfer-ownership" || path === "/employer/staff/delete-organization") {
    return role === "employer_owner";
  }
  if (path === "/employer/staff" || path.startsWith("/employer/staff/")) {
    return role === "employer_owner" || role === "employer_admin";
  }
  if (role === "employer_owner" || role === "employer_admin") return true;
  if (path === "/employer/jobs" && method === "POST" || path === "/employer/jobs/generate-description") return false;
  if (path === "/employer/candidates" || path === "/employer/talent-search"
    || path.startsWith("/employer/candidates/")) return false;
  const capability = employerRouteCapability(method, path);
  return capability !== null && employerRoleCan(role, capability);
}

export function employerRouteCapability(
  method: string,
  path: string,
): EmployerCapability | null {
  if (path === "/employer/profile") return method === "GET" ? "view_jobs" : "manage_staff";
  if (path.startsWith("/employer/campaigns")) return method === "GET" ? "manage_campaigns" : "manage_campaigns";
  if (path === "/employer/jobs" && method === "GET") return "view_jobs";
  if (path === "/employer/jobs" && method === "POST") return "manage_jobs";
  if (path === "/employer/jobs/generate-description" || /^\/employer\/jobs\/\d+\/generate-description$/.test(path)) return "manage_jobs";
  if (path === "/employer/contact-candidate") return "send_messages";
  if (path === "/employer/candidates" || path === "/employer/talent-search") return "view_candidates";
  if (/^\/employer\/candidates\/[^/]+\/viewed$/.test(path)) return "view_candidates";
  if (/^\/employer\/jobs\/\d+\/applicants\/\d+\/feedback$/.test(path)) {
    return method === "GET" ? "view_candidates" : "submit_feedback";
  }
  if (/^\/employer\/jobs\/\d+\/applicants\/\d+\/interview(?:\/participants|\/respond)?$/.test(path)) return "schedule_interviews";
  if (/^\/employer\/jobs\/\d+\/applicants\/\d+\/stage$/.test(path)) return "manage_applicants";
  if (/^\/employer\/jobs\/\d+\/applicants$/.test(path)) return method === "GET" ? "view_candidates" : "manage_applicants";
  if (/^\/employer\/jobs\/\d+\/publish$/.test(path) || /^\/employer\/jobs\/\d+\/close$/.test(path)) return "publish_jobs";
  if (/^\/employer\/jobs\/\d+$/.test(path) && method === "DELETE") return "delete_jobs";
  if (/^\/employer\/jobs\/\d+$/.test(path) && method === "GET") return "view_jobs";
  if (/^\/employer\/jobs\/\d+$/.test(path) && method === "PUT") return "manage_jobs";
  return null;
}

export function employerPathJobId(path: string): number | null {
  const jobPath = path.match(/^\/employer\/jobs\/(\d+)(?:\/|$)/);
  if (jobPath) return Number(jobPath[1]);
  const applicantPath = path.match(/^\/employer\/jobs\/(\d+)\/applicants/);
  return applicantPath ? Number(applicantPath[1]) : null;
}
