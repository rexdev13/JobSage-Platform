import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("@workspace/auth-web", () => ({
  useAuth: () => ({ user: { id: "candidate-1", email: "candidate@example.com" } }),
}));

vi.mock("@/components/layout/AppLayout", () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/FeedbackWidget", () => ({
  FeedbackForm: ({ onSubmitted }: { onSubmitted?: () => void }) => (
    <button type="button" data-testid="test-submit-feedback" onClick={() => onSubmitted?.()}>
      Submit feedback
    </button>
  ),
}));

vi.mock("wouter", () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

import FeedbackPage from "./FeedbackPage";

describe("FeedbackPage", () => {
  it("is a dedicated feedback section with a separate path to support", () => {
    render(<FeedbackPage />);

    expect(screen.getByRole("heading", { name: "Help improve JOBSAGE" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Go to Help & Support" }).getAttribute("href")).toBe("/help");

    fireEvent.click(screen.getByTestId("test-submit-feedback"));
    expect(screen.getByTestId("feedback-page-success").textContent).toContain("your feedback has been sent");
  });
});