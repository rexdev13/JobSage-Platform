import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { AppSidebar } from "./AppSidebar";

const fixture = vi.hoisted(() => ({ role: "candidate", location: "/applications/24" }));
vi.mock("@workspace/auth-web", () => ({
  useAuth: () => ({ user: { role: fixture.role, firstName: "Test" }, logout: vi.fn() }),
}));
vi.mock("../../hooks/useEmployerOrganizations", () => ({
  useEmployerOrganizations: () => {
    const organizations = fixture.role === "employer"
      ? [{ id: 1, companyName: "Fixture Company", role: "employer_owner" as const }]
      : [];
    return {
      organizations,
      activeOrganization: organizations[0] ?? null,
    };
  },
}));
vi.mock("wouter", () => ({
  useLocation: () => [fixture.location],
  Link: ({ children, ...props }: React.ComponentProps<"a">) => <a {...props}>{children}</a>,
}));
vi.mock("@workspace/api-client-react", () => {
  const query = (data: unknown) => ({ data, isLoading: false, isError: false, refetch: vi.fn() });
  const key = () => ["test"];
  return {
    useGetInboxUnreadCount: () => query({ unreadCount: 3 }),
    useGetMyProfile: () => query(undefined),
    useListMyDocuments: () => query({ documents: [{ documentType: "cv", label: "Original CV" }] }),
    useListMatchedRoles: () => query({ roles: [] }),
    useListMyApplications: () => query({ applications: [] }),
    getGetInboxUnreadCountQueryKey: key, getGetMyProfileQueryKey: key,
    getListMyDocumentsQueryKey: key, getListMatchedRolesQueryKey: key,
    getListMyApplicationsQueryKey: key,
  };
});

afterEach(() => { cleanup(); fixture.role = "candidate"; });

describe("rendered candidate navigation", () => {
  it("renders the ordered sections, unread badge, nested active link and evidence summary", () => {
    render(<AppSidebar />);
    expect(screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent)).toEqual([
      "My Profile", "My UK Opportunities", "UK Career Journey", "Career Readiness", "Insights", "Support",
    ]);
    expect(screen.getByRole("link", { name: "Application Tracker" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByLabelText("3 unread messages")).toHaveTextContent("3");
    expect(screen.getByText("Career journey: 1 of 9 stages complete.")).toBeInTheDocument();
  });

  it("launches enhancement without a standalone exam-preparation or learning destination", () => {
    const onEnhance = vi.fn();
    render(<AppSidebar onEnhance={onEnhance} />);
    fireEvent.click(screen.getByRole("button", { name: "CV Enhancement" }));
    expect(onEnhance).toHaveBeenCalledOnce();
    expect(screen.queryByRole("link", { name: /learning hub/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /professional exams/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /exam preparation/i })).not.toBeInTheDocument();
  });
});

describe("other-role navigation", () => {
  it.each([
    ["employer", "Employer Dashboard", "/employer/dashboard"],
    ["reviewer", "Review Queue", "/review-queue"],
    ["admin", "User Management", "/admin/users"],
    ["marketing", "Waitlist Leads", "/admin/leads"],
    ["super_admin", "Super Admin", "/admin/super"],
  ])("keeps %s destinations without candidate-only sections", (role, label, href) => {
    fixture.role = role;
    render(<AppSidebar />);
    expect(screen.getByRole("link", { name: label })).toHaveAttribute("href", href);
    expect(screen.queryByRole("heading", { name: "My Profile" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "CV Enhancement" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "ID Verification" })).not.toBeInTheDocument();
    if (role === "admin" || role === "reviewer") {
      expect(screen.getByRole("heading", { name: "Operations" })).toBeInTheDocument();
    }
  });
});
