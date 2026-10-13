import { describe, expect, it } from "vitest";
import { canVisitEmployerRoute } from "./employerRouteAccess";

describe("employer organization route access", () => {
  it("allows every organization role to open the shared dashboard", () => {
    for (const role of [
      "employer_owner",
      "employer_admin",
      "recruiter",
      "hiring_manager",
      "employer_viewer",
    ] as const) {
      expect(canVisitEmployerRoute(role, "/employer/dashboard")).toBe(true);
    }
  });

  it("keeps organization-wide routes limited to owners and admins", () => {
    for (const role of ["employer_owner", "employer_admin"] as const) {
      expect(canVisitEmployerRoute(role, "/employer/staff")).toBe(true);
      expect(canVisitEmployerRoute(role, "/employer/talent-search")).toBe(true);
      expect(canVisitEmployerRoute(role, "/employer/jobs/new")).toBe(true);
    }
    for (const role of ["recruiter", "hiring_manager", "employer_viewer"] as const) {
      expect(canVisitEmployerRoute(role, "/employer/staff")).toBe(false);
      expect(canVisitEmployerRoute(role, "/employer/talent-search")).toBe(false);
      expect(canVisitEmployerRoute(role, "/employer/jobs/new")).toBe(false);
    }
  });

  it("limits job detail access to active organization members", () => {
    for (const role of [
      "employer_owner",
      "employer_admin",
      "recruiter",
      "hiring_manager",
      "employer_viewer",
    ] as const) {
      expect(canVisitEmployerRoute(role, "/employer/jobs/17")).toBe(true);
    }
    expect(canVisitEmployerRoute(null, "/employer/jobs/17")).toBe(false);
    expect(canVisitEmployerRoute(undefined, "/employer/jobs/17")).toBe(false);
  });

  it("allows assigned-role recruiters to edit jobs but not hiring managers or viewers", () => {
    expect(canVisitEmployerRoute("recruiter", "/employer/jobs/17/edit")).toBe(true);
    expect(canVisitEmployerRoute("hiring_manager", "/employer/jobs/17/edit")).toBe(false);
    expect(canVisitEmployerRoute("employer_viewer", "/employer/jobs/17/edit")).toBe(false);
  });
});
