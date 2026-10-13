import { describe, expect, it } from "vitest";
import {
  employerRoleCan,
  employerRoleCanAccessRoute,
  type EmployerStaffRole,
} from "../lib/employerPermissions";

describe("employer staff permission matrix", () => {
  const roles: EmployerStaffRole[] = [
    "employer_owner",
    "employer_admin",
    "recruiter",
    "hiring_manager",
    "employer_viewer",
  ];

  it("keeps billing, ownership transfer, and organisation deletion owner-only", () => {
    for (const role of roles) {
      expect(employerRoleCan(role, "view_billing")).toBe(role === "employer_owner");
      expect(employerRoleCan(role, "transfer_ownership")).toBe(role === "employer_owner");
      expect(employerRoleCan(role, "delete_organization")).toBe(role === "employer_owner");
    }
  });

  it("allows admins to manage staff and campaigns but not billing or ownership", () => {
    expect(employerRoleCan("employer_admin", "manage_staff")).toBe(true);
    expect(employerRoleCan("employer_admin", "change_staff_roles")).toBe(true);
    expect(employerRoleCan("employer_admin", "manage_campaigns")).toBe(true);
    expect(employerRoleCan("employer_admin", "view_billing")).toBe(false);
    expect(employerRoleCan("employer_admin", "transfer_ownership")).toBe(false);
  });

  it("limits recruiters to assigned-role work and blocks broad candidate search", () => {
    expect(employerRoleCanAccessRoute("recruiter", "GET", "/employer/jobs")).toBe(true);
    expect(employerRoleCanAccessRoute("recruiter", "PUT", "/employer/jobs/17")).toBe(true);
    expect(employerRoleCanAccessRoute("recruiter", "PUT", "/employer/jobs/17/publish")).toBe(true);
    expect(employerRoleCanAccessRoute("recruiter", "POST", "/employer/jobs")).toBe(false);
    expect(employerRoleCanAccessRoute("recruiter", "DELETE", "/employer/jobs/17")).toBe(false);
    expect(employerRoleCanAccessRoute("recruiter", "GET", "/employer/talent-search")).toBe(false);
    expect(employerRoleCanAccessRoute("recruiter", "GET", "/employer/campaigns")).toBe(false);
  });

  it("lets hiring managers review assigned applicants and submit feedback without publishing", () => {
    expect(employerRoleCanAccessRoute("hiring_manager", "GET", "/employer/jobs/17/applicants")).toBe(true);
    expect(employerRoleCanAccessRoute("hiring_manager", "POST", "/employer/jobs/17/applicants/8/feedback")).toBe(true);
    expect(employerRoleCanAccessRoute("hiring_manager", "POST", "/employer/jobs/17/applicants/8/interview")).toBe(true);
    expect(employerRoleCanAccessRoute("hiring_manager", "PUT", "/employer/jobs/17/publish")).toBe(false);
    expect(employerRoleCanAccessRoute("hiring_manager", "PUT", "/employer/jobs/17/applicants/8/stage")).toBe(false);
    expect(employerRoleCanAccessRoute("hiring_manager", "GET", "/employer/profile")).toBe(false);
  });

  it("keeps viewers read-only and denies unassigned candidate search and messaging", () => {
    expect(employerRoleCanAccessRoute("employer_viewer", "GET", "/employer/jobs")).toBe(true);
    expect(employerRoleCanAccessRoute("employer_viewer", "GET", "/employer/jobs/17/applicants")).toBe(true);
    expect(employerRoleCanAccessRoute("employer_viewer", "PUT", "/employer/jobs/17")).toBe(false);
    expect(employerRoleCanAccessRoute("employer_viewer", "POST", "/employer/contact-candidate")).toBe(false);
    expect(employerRoleCanAccessRoute("employer_viewer", "GET", "/employer/talent-search")).toBe(false);
  });

  it("enforces every staff-management operation at the route capability layer", () => {
    const operations = [
      { method: "GET", path: "/employer/staff", owner: true, admin: true },
      { method: "POST", path: "/employer/staff/invitations", owner: true, admin: true },
      { method: "PUT", path: "/employer/staff/member-1/role", owner: true, admin: true },
      { method: "DELETE", path: "/employer/staff/member-1", owner: true, admin: true },
      { method: "PUT", path: "/employer/staff/assignments", owner: true, admin: true },
      { method: "POST", path: "/employer/staff/transfer-ownership", owner: true, admin: false },
      { method: "POST", path: "/employer/staff/delete-organization", owner: true, admin: false },
    ];
    for (const operation of operations) {
      expect(employerRoleCanAccessRoute("employer_owner", operation.method, operation.path))
        .toBe(operation.owner);
      expect(employerRoleCanAccessRoute("employer_admin", operation.method, operation.path))
        .toBe(operation.admin);
      for (const role of ["recruiter", "hiring_manager", "employer_viewer"] as const) {
        expect(employerRoleCanAccessRoute(role, operation.method, operation.path)).toBe(false);
      }
    }
  });
});
