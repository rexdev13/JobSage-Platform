import { describe, expect, it } from "vitest";
import { canAccessLeads, canDeleteLeads, isAdminRole, MARKETING_NAVIGATION } from "./roleAccess";

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
});