import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { supportTicket, useListMock, updateMutationMock } = vi.hoisted(() => ({
  supportTicket: {
    id: 41,
    ticketId: "JS-ABCDEF1234",
    name: "Pat Lee",
    email: "candidate@example.com",
    category: "Technical Support",
    subject: "Password reset link",
    message: "The password reset link never arrives.",
    userId: null,
    status: "new",
    adminNotes: null,
    reviewedBy: null,
    reviewedAt: null,
    createdAt: "2026-10-01T10:00:00.000Z",
    updatedAt: "2026-10-01T10:00:00.000Z",
  },
  useListMock: vi.fn(),
  updateMutationMock: vi.fn(),
}));

vi.mock("@workspace/api-client-react", () => ({
  getListAdminSupportTicketsQueryKey: () => ["admin-support-tickets"],
  useListAdminSupportTickets: (...args: unknown[]) => useListMock(...args),
  useUpdateAdminSupportTicket: () => ({ mutate: updateMutationMock }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import AdminSupportTicketsTab from "./AdminSupportTicketsTab";

function renderTab() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AdminSupportTicketsTab />
    </QueryClientProvider>,
  );
}

describe("AdminSupportTicketsTab", () => {
  beforeEach(() => {
    useListMock.mockReturnValue({
      data: [supportTicket],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    updateMutationMock.mockReset();
  });

  afterEach(() => cleanup());

  it("shows submitted ticket details and lets super admins change its status", () => {
    renderTab();

    expect(screen.getByText("JS-ABCDEF1234")).toBeTruthy();
    expect(screen.getByText("The password reset link never arrives.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "candidate@example.com" }).getAttribute("href"))
      .toBe("mailto:candidate@example.com");

    fireEvent.change(screen.getByRole("combobox", { name: "Status for support ticket JS-ABCDEF1234" }), {
      target: { value: "in_review" },
    });
    expect(updateMutationMock).toHaveBeenCalledWith(
      { id: 41, data: { status: "in_review" } },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });
});