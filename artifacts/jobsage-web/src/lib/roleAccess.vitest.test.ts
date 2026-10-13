import { describe, expect, it } from "vitest";
import {
  canAccessLeads,
  canDeleteLeads,
  getPlatformOperatorHomePath,
  isAdminRole,
  MARKETING_NAVIGATION,
  requiresCandidateProfile,
} from "./roleAccess";

describe("marketing role access", () => {
  it("keeps AdminGuard's role policy exclusive to admin and super-admin", () => {
    expect(isAdminRole("admin")).toBe(true);
    expect(isAdminRole("super_admin")).toBe(true);
    expect(isAdminRole("marketing")).toBe(false);
  });

  it("exposes leads and calendar to marketing navigation", () => {
    expect(canAccessLeads("marketing")).toBe(true);
    expect(canDeleteLeads("marketing")).toBe(false);
    expect(MARKETING_NAVIGATION).toEqual([
      { name: "Waitlist Leads", href: "/admin/leads" },
      { name: "Calendar", href: "/admin/calendar" },
    ]);
  });

  it("requires candidate profiles only for candidate accounts", () => {
    expect(requiresCandidateProfile("candidate")).toBe(true);
    expect(requiresCandidateProfile("employer")).toBe(false);
    expect(requiresCandidateProfile("moderator")).toBe(false);
    expect(requiresCandidateProfile("admin")).toBe(false);
    expect(requiresCandidateProfile("super_admin")).toBe(false);
    expect(requiresCandidateProfile("marketing")).toBe(false);
  });

  it("sends platform operators to their role-specific home", () => {
    expect(getPlatformOperatorHomePath("moderator")).toBe("/moderation/reports");
    expect(getPlatformOperatorHomePath("admin")).toBe("/admin/roles");
    expect(getPlatformOperatorHomePath("super_admin")).toBe("/admin/super");
    expect(getPlatformOperatorHomePath("candidate")).toBeNull();
  });
});
