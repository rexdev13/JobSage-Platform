import React from "react";
import { Router } from "wouter";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { createSupportTicket } = vi.hoisted(() => ({
  createSupportTicket: vi.fn(),
}));

vi.mock("@workspace/auth-web", () => ({
  useAuth: () => ({ user: null }),
}));

vi.mock("@workspace/api-client-react", () => ({
  useCreateSupportTicket: () => ({
    mutateAsync: createSupportTicket,
    isPending: false,
  }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import HelpSupportPage from "./HelpSupportPage";

function renderHelpPage() {
  return render(
    <Router>
      <HelpSupportPage />
    </Router>,
  );
}

describe("HelpSupportPage", () => {
  afterEach(() => {
    cleanup();
    window.history.replaceState(null, "", "/");
    vi.clearAllMocks();
  });

  it("puts the contact headline before its subtitle and gives each footer link a real anchor target", async () => {
    renderHelpPage();

    const headline = screen.getByRole("heading", { level: 2, name: "Still need a hand?" });
    const subtitle = screen.getByText("Talk to a person");
    expect(headline.compareDocumentPosition(subtitle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const links = [
      ["link-footer-help", "#help-top", "help-top"],
      ["link-footer-visa", "#visa", "visa"],
      ["link-footer-contact", "#contact", "contact"],
    ] as const;

    for (const [testId, href, targetId] of links) {
      const link = screen.getByTestId(testId);
      expect(link.tagName).toBe("A");
      expect(link.getAttribute("href")).toBe(href);
      const target = document.getElementById(targetId);
      expect(target).toBeTruthy();
      const scrollIntoView = vi.fn();
      if (target) target.scrollIntoView = scrollIntoView;
      fireEvent.click(link);
      expect(window.location.hash).toBe(href);
      await waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" }));
    }
  });

  it("sends a completed support form and shows the ticket confirmation", async () => {
    createSupportTicket.mockResolvedValue({ success: true, ticketId: "JSG-123" });
    renderHelpPage();

    fireEvent.change(screen.getByTestId("input-support-name"), { target: { value: "Jordan Test" } });
    fireEvent.change(screen.getByTestId("input-support-email"), { target: { value: "jordan@example.com" } });
    fireEvent.change(screen.getByTestId("input-support-subject"), { target: { value: "Help with my account" } });
    fireEvent.change(screen.getByTestId("textarea-support-message"), { target: { value: "Please help me update my account details." } });
    fireEvent.click(screen.getByTestId("button-submit-support"));

    await waitFor(() => expect(createSupportTicket).toHaveBeenCalledWith({
      data: {
        name: "Jordan Test",
        email: "jordan@example.com",
        category: "Visa Sponsorship",
        subject: "Help with my account",
        message: "Please help me update my account details.",
      },
    }));
    expect((await screen.findByTestId("status-support-success")).textContent).toContain("JSG-123");
  });
});
