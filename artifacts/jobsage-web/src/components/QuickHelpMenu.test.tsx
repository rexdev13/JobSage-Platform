import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Router } from "wouter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { authState, submitFeedbackMock } = vi.hoisted(() => ({
  authState: {
    isAuthenticated: false,
    isLoading: false,
    user: null as { role?: string } | null,
  },
  submitFeedbackMock: vi.fn(),
}));

vi.mock("@workspace/auth-web", () => ({
  useAuth: () => authState,
}));

vi.mock("@workspace/api-client-react", () => ({
  useSubmitFeedback: () => ({ mutate: submitFeedbackMock, isPending: false }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import { QuickHelpMenu } from "./QuickHelpMenu";

function renderMenu(props: React.ComponentProps<typeof QuickHelpMenu> = {}) {
  return render(
    <Router>
      <QuickHelpMenu {...props} />
    </Router>,
  );
}

describe("QuickHelpMenu", () => {
  beforeEach(() => {
    authState.isAuthenticated = false;
    authState.isLoading = false;
    authState.user = null;
    submitFeedbackMock.mockReset();
  });

  afterEach(() => cleanup());

  it("opens the feedback dialog from the help menu and closes the popover", async () => {
    renderMenu({ guestOnly: true });

    expect(screen.queryByTestId("button-open-feedback")).toBeNull();
    fireEvent.click(screen.getByTestId("button-floating-help"));

    expect(screen.getByRole("menu")).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Help & Support/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitem", { name: /Share Feedback/ }));

    expect(await screen.findByRole("dialog", { name: /Help us make JOBSAGE better/ })).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId("menu-quick-help")).toBeNull());
    expect(screen.getByTestId("input-feedback-message")).toBeTruthy();
    expect(screen.getByTestId("input-feedback-email")).toBeTruthy();
  });

  it("does not show the readiness quota shortcut in the help menu", () => {
    authState.isAuthenticated = true;
    authState.user = { role: "candidate" };
    renderMenu();

    fireEvent.click(screen.getByTestId("button-floating-help"));

    expect(screen.getByRole("menu")).toBeTruthy();
    expect(screen.queryByTestId("button-quick-readiness")).toBeNull();
    expect(screen.getAllByRole("menuitem")).toHaveLength(2);
  });
});