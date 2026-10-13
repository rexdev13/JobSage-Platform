import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  user: { id: "employer-fixture" },
  fresh: vi.fn(),
  save: vi.fn(),
  appeal: vi.fn(),
}));

vi.mock("@workspace/auth-web", () => ({ useAuth: () => ({ user: state.user }) }));
vi.mock("@workspace/api-client-react", () => ({
  getCurrentAuthUser: state.fresh,
  createSupportTicket: state.save,
  appealContentReport: state.appeal,
}));

import { ContentReportDialog } from "./ContentReportDialog";

const props = {
  contentType: "candidate_profile" as const,
  contentId: "candidate-fixture",
  contextId: 91,
  context: "Candidate profile shown with the Fixture Role application",
  content: "Visible profile excerpt fixture",
  label: "Report candidate profile",
};

beforeEach(() => {
  state.user = { id: "employer-fixture" };
  state.fresh.mockReset().mockResolvedValue({
    user: { id: state.user.id, email: "employer@example.test", firstName: "Employer" },
  });
  state.save.mockReset().mockResolvedValue({ success: true, ticketId: "JS-REPORTFIXT" });
  state.appeal.mockReset().mockResolvedValue({ success: true, ticketId: "JS-APPEALFIXT" });
});

afterEach(cleanup);

describe("content report dialog", () => {
  it("sends a target and visible application context without sharing an excerpt by default", async () => {
    render(<ContentReportDialog {...props} />);
    fireEvent.click(screen.getByRole("button", { name: props.label }));
    fireEvent.change(screen.getByRole("textbox", { name: /Describe the issue/ }), {
      target: { value: "Please review this profile for inaccurate information." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send report" }));

    await waitFor(() => expect(state.save).toHaveBeenCalledOnce());
    const [body, options] = state.save.mock.calls[0];
    expect(body).toMatchObject({
      reportedContentType: "candidate_profile",
      reportedContentId: "candidate-fixture",
      reportedContextId: 91,
      subject: "Candidate profile report",
    });
    expect(body.message).not.toContain(props.content);
    expect(options.headers["X-Jobsage-Report-User"]).toBe("employer-fixture");
    expect(await screen.findByText(/Saved for staff review/)).toBeTruthy();
  });

  it("includes only the opening visible snapshot after explicit selection", async () => {
    const page = render(<ContentReportDialog {...props} />);
    fireEvent.click(screen.getByRole("button", { name: props.label }));
    fireEvent.change(screen.getByRole("textbox", { name: /Describe the issue/ }), {
      target: { value: "Please review this profile for inaccurate information." },
    });
    page.rerender(<ContentReportDialog {...props} content="Newer profile excerpt fixture" />);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Send report" }));

    await waitFor(() => expect(state.save).toHaveBeenCalledOnce());
    expect(state.save.mock.calls[0][0].message).toContain(props.content);
    expect(state.save.mock.calls[0][0].message).not.toContain("Newer profile excerpt fixture");
  });

  it("does not submit if the server account differs from the account that opened the report", async () => {
    render(<ContentReportDialog {...props} />);
    fireEvent.click(screen.getByRole("button", { name: props.label }));
    fireEvent.change(screen.getByRole("textbox", { name: /Describe the issue/ }), {
      target: { value: "Please review this profile for inaccurate information." },
    });
    state.fresh.mockResolvedValue({ user: { id: "different-account-fixture", email: "other@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Send report" }));

    await screen.findByText(/Sign in with the account that opened this report/);
    expect(state.save).not.toHaveBeenCalled();
  });

  it("creates an appeal separately without resending the original report", async () => {
    render(<ContentReportDialog {...props} />);
    fireEvent.click(screen.getByRole("button", { name: props.label }));
    fireEvent.change(screen.getByRole("textbox", { name: /Describe the issue/ }), {
      target: { value: "Please review this profile for inaccurate information." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send report" }));
    await screen.findByText(/Saved for staff review/);
    fireEvent.change(screen.getByRole("textbox", { name: "Review request details" }), {
      target: { value: "Please reconsider the first review decision." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Request review" }));

    await screen.findByText(/Review request saved/);
    expect(state.appeal).toHaveBeenCalledWith(
      "JS-REPORTFIXT",
      { message: "Please reconsider the first review decision." },
      expect.objectContaining({ headers: { "X-Jobsage-Report-User": "employer-fixture" } }),
    );
    expect(state.save).toHaveBeenCalledOnce();
  });
});
