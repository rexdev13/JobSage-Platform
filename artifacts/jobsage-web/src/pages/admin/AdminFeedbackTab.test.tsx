import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  feedbackItem,
  useListMock,
  updateMutationMock,
  replyMutationMock,
  toastMock,
} = vi.hoisted(() => ({
  feedbackItem: {
    id: 17,
    category: "issue",
    message: "The profile form did not save.",
    email: "candidate@example.com",
    pageUrl: "https://jobsage.co.uk/profile",
    screenResolution: "1440x900",
    userId: "candidate-1",
    userAgent: null,
    status: "new",
    adminNotes: null,
    reviewedBy: null,
    reviewedAt: null,
    createdAt: "2026-10-05T08:00:00.000Z",
    updatedAt: "2026-10-05T09:00:00.000Z",
    replies: [],
  },
  useListMock: vi.fn(),
  updateMutationMock: vi.fn(),
  replyMutationMock: vi.fn(),
  toastMock: vi.fn(),
}));

vi.mock("@workspace/api-client-react", () => ({
  getListAdminFeedbackQueryKey: (params?: unknown) => ["admin-feedback", params],
  useListAdminFeedback: (...args: unknown[]) => useListMock(...args),
  useUpdateAdminFeedback: () => ({ mutate: updateMutationMock }),
  useReplyToAdminFeedback: () => ({ mutate: replyMutationMock }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

import { ProductFeedbackInbox } from "./AdminFeedbackTab";

function renderInbox() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ProductFeedbackInbox />
    </QueryClientProvider>,
  );
}

describe("ProductFeedbackInbox replies", () => {
  beforeEach(() => {
    useListMock.mockReturnValue({
      data: {
        items: [feedbackItem],
        summary: { total: 1, issues: 1, ideas: 0, general: 0, unresolved: 1 },
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    updateMutationMock.mockReset();
    replyMutationMock.mockReset();
    toastMock.mockReset();
  });

  afterEach(() => cleanup());

  it("sends a signed-in user's reply to their JOBSAGE inbox", () => {
    renderInbox();

    fireEvent.click(screen.getByTestId("button-open-feedback-reply-17"));
    expect(screen.getByText("Will be sent to the candidate's JOBSAGE inbox.")).toBeTruthy();
    fireEvent.change(screen.getByTestId("input-feedback-reply-17"), {
      target: { value: "We have fixed this issue." },
    });
    fireEvent.click(screen.getByTestId("button-send-feedback-reply-17"));

    expect(replyMutationMock).toHaveBeenCalledWith(
      {
        id: 17,
        data: {
          replyText: "We have fixed this issue.",
          expectedUpdatedAt: feedbackItem.updatedAt,
        },
      },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it("sends a guest's reply to their email address", () => {
    useListMock.mockReturnValue({
      data: {
        items: [{ ...feedbackItem, userId: null, email: "guest@example.com" }],
        summary: { total: 1, issues: 1, ideas: 0, general: 0, unresolved: 1 },
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    renderInbox();

    fireEvent.click(screen.getByTestId("button-open-feedback-reply-17"));
    expect(screen.getByText("Will be sent via email.")).toBeTruthy();
    fireEvent.change(screen.getByTestId("input-feedback-reply-17"), {
      target: { value: "Thanks for sharing this." },
    });
    fireEvent.click(screen.getByTestId("button-send-feedback-reply-17"));

    expect(replyMutationMock).toHaveBeenCalledWith(
      {
        id: 17,
        data: {
          replyText: "Thanks for sharing this.",
          expectedUpdatedAt: feedbackItem.updatedAt,
        },
      },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });
});
