import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("@workspace/auth-web", () => ({
  useAuth: () => ({ user: { id: "super-admin-1", role: "super_admin" } }),
}));

vi.mock("@/components/layout/AppLayout", () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/pages/admin/AdminFeedbackTab", () => ({
  ProductFeedbackInbox: () => <div data-testid="admin-product-feedback">Product feedback entries</div>,
}));

vi.mock("@/pages/admin/AdminSupportTicketsTab", () => ({
  default: () => <div data-testid="admin-support-requests">Support requests</div>,
}));

vi.mock("@/pages/admin/AdminDescriptionFeedbackTab", () => ({
  default: () => <div data-testid="admin-ai-ratings">AI rating entries</div>,
}));

import FeedbackPage from "./FeedbackPage";

describe("FeedbackPage admin view", () => {
  it("shows incoming feedback, support requests, and AI ratings as separate tabs", () => {
    render(<FeedbackPage />);

    expect(screen.getByRole("heading", { name: "Feedback & support inbox" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Product feedback" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Contact support" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "AI ratings" })).toBeTruthy();
    expect(screen.queryByText("Help improve JOBSAGE")).toBeNull();

    expect(screen.getByTestId("admin-product-feedback").closest('[role="tabpanel"]')?.hasAttribute("hidden")).toBe(false);
    expect(screen.getByTestId("admin-support-requests").closest('[role="tabpanel"]')?.hasAttribute("hidden")).toBe(true);

    fireEvent.click(screen.getByRole("tab", { name: "Contact support" }));
    expect(screen.getByTestId("admin-support-requests").closest('[role="tabpanel"]')?.hasAttribute("hidden")).toBe(false);

    fireEvent.click(screen.getByRole("tab", { name: "AI ratings" }));
    expect(screen.getByTestId("admin-ai-ratings").closest('[role="tabpanel"]')?.hasAttribute("hidden")).toBe(false);
  });
});