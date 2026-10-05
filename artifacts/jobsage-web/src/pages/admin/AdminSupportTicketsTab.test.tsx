import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { supportTicket, supportDetail, useListMock, useDetailMock, updateMutationMock, replyMutationMock } = vi.hoisted(() => ({
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
  supportDetail: {
    ticket: {
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
    replies: [],
  },
  useListMock: vi.fn(),
  useDetailMock: vi.fn(),
  updateMutationMock: vi.fn(),
  replyMutationMock: vi.fn(),
}));

vi.mock("@workspace/api-client-react", () => ({
  getListAdminSupportTicketsQueryKey: (params?: unknown) => ["admin-support-tickets", params],
  getGetAdminSupportTicketQueryKey: (id: number) => ["admin-support-ticket", id],
  useListAdminSupportTickets: (...args: unknown[]) => useListMock(...args),
  useGetAdminSupportTicket: (...args: unknown[]) => useDetailMock(...args),
  useUpdateAdminSupportTicket: () => ({ mutate: updateMutationMock }),
  useReplyToAdminSupportTicket: () => ({ mutate: replyMutationMock }),
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
    useDetailMock.mockReturnValue({
      data: supportDetail,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    updateMutationMock.mockReset();
    replyMutationMock.mockReset();
  });

  afterEach(() => cleanup());

  it("defaults to Needs Attention and lets admins change a ticket status", () => {
    renderTab();

    expect(screen.getByRole("tab", { name: "Needs Attention" }).getAttribute("aria-selected")).toBe("true");
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

  it("shows the delivery channel and submits a reply with the displayed ticket version", () => {
    renderTab();

    fireEvent.click(screen.getByTestId("button-support-ticket-details-41"));
    expect(screen.getByText("Will be sent via email")).toBeTruthy();

    fireEvent.change(screen.getByTestId("input-support-ticket-reply"), {
      target: { value: "We have sent a replacement link." },
    });
    fireEvent.click(screen.getByTestId("button-send-reply-resolved"));

    expect(replyMutationMock).toHaveBeenCalledWith(
      {
        id: 41,
        data: {
          replyText: "We have sent a replacement link.",
          status: "resolved",
          expectedUpdatedAt: supportTicket.updatedAt,
        },
      },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });
});