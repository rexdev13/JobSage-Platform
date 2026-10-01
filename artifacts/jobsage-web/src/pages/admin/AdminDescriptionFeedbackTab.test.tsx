import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const { mockUseRatings, mockRefetch } = vi.hoisted(() => ({
  mockUseRatings: vi.fn(),
  mockRefetch: vi.fn(),
}));

vi.mock("@workspace/api-client-react", () => ({
  getListAdminDescriptionFeedbackQueryKey: (params: unknown) => ["admin-description-feedback", params],
  useListAdminDescriptionFeedback: (...args: unknown[]) => mockUseRatings(...args),
}));

import AdminDescriptionFeedbackTab from "./AdminDescriptionFeedbackTab";

describe("AdminDescriptionFeedbackTab", () => {
  beforeEach(() => {
    mockRefetch.mockReset();
    mockUseRatings.mockReset();
    mockUseRatings.mockReturnValue({
      data: {
        items: [{
          id: 12,
          sentiment: "down",
          jobTitle: "Staff Nurse",
          specialty: "Intensive Care",
          employerUserId: "employer-12",
          email: "jobs@care.example",
          companyName: "Care Group",
          createdAt: "2026-10-01T09:00:00.000Z",
        }],
        summary: { total: 6, up: 4, down: 2 },
      },
      isLoading: false,
      isError: false,
      refetch: mockRefetch,
    });
  });

  it("shows AI rating counts and employer/job context", () => {
    render(<AdminDescriptionFeedbackTab />);

    expect(screen.getByText("AI job-description ratings")).toBeTruthy();
    expect(screen.getByText("Total ratings")).toBeTruthy();
    expect(screen.getByText("6")).toBeTruthy();
    expect(screen.getByText("Staff Nurse")).toBeTruthy();
    expect(screen.getByText("Intensive Care")).toBeTruthy();
    expect(screen.getByText("Care Group")).toBeTruthy();
    expect(screen.getByText("jobs@care.example")).toBeTruthy();
    expect(screen.getByTestId("card-ai-rating-12").textContent).toContain("Not helpful");
  });

  it("filters to helpful and not-helpful ratings", () => {
    render(<AdminDescriptionFeedbackTab />);

    fireEvent.click(screen.getByRole("tab", { name: "Helpful" }));
    expect(mockUseRatings).toHaveBeenLastCalledWith(
      { sentiment: "up", limit: 100, offset: 0 },
      expect.objectContaining({ query: expect.objectContaining({ refetchOnWindowFocus: false }) }),
    );

    fireEvent.click(screen.getByRole("tab", { name: "Not helpful" }));
    expect(mockUseRatings).toHaveBeenLastCalledWith(
      { sentiment: "down", limit: 100, offset: 0 },
      expect.objectContaining({ query: expect.objectContaining({ refetchOnWindowFocus: false }) }),
    );
  });
});