import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  user: { id: "reporter-fixture" },
  fresh: vi.fn(),
  save: vi.fn(),
}));
vi.mock("@workspace/auth-web", () => ({ useAuth: () => ({ user: state.user }) }));
vi.mock("@workspace/api-client-react", () => ({
  getCurrentAuthUser: state.fresh,
  createSupportTicket: state.save,
}));
import { AIContentReport } from "./AIContentReport";

const props = { content: "Private CV phrase fixture", context: "AI CV Maker fixture", label: "Report draft fixture" };
function openAndDescribe() {
  fireEvent.click(screen.getByRole("button", { name: props.label }));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Please review this inaccurate generated claim." } });
}
beforeEach(() => {
  state.user = { id: "reporter-fixture" };
  state.fresh.mockReset().mockResolvedValue({ user: { id: state.user.id, email: "reporter@example.test", firstName: "Fixture" } });
  state.save.mockReset().mockResolvedValue({ success: true, ticketId: "JS-FIXTURE" });
});
afterEach(cleanup);

describe("AI reporting consent and initiating account", () => {
  it("routes inbox content to message review, with the same consent and actor safeguards", async () => {
    render(<AIContentReport {...props} kind="message" />);
    openAndDescribe();
    fireEvent.click(screen.getByRole("button", { name: "Send report" }));
    await waitFor(() => expect(state.save).toHaveBeenCalledOnce());
    const [body, options] = state.save.mock.calls[0];
    expect(body.subject).toBe("Message content report");
    expect(body.message).toContain("Message content report");
    expect(body.message).not.toContain(props.content);
    expect(options.headers["X-Jobsage-Message-Report"]).toBe("1");
    expect(options.headers["X-Jobsage-Report-User"]).toBe("reporter-fixture");
  });
  it("submits a real ticket request without output text by default", async () => {
    render(<AIContentReport {...props} />);
    openAndDescribe();
    fireEvent.click(screen.getByRole("button", { name: "Send report" }));
    await waitFor(() => expect(state.save).toHaveBeenCalledOnce());
    const [body, options] = state.save.mock.calls[0];
    expect(body.message).not.toContain(props.content);
    expect(body.subject).toBe("AI content report");
    expect(options.headers["X-Jobsage-Report-User"]).toBe("reporter-fixture");
    expect(await screen.findByText(/Saved for staff review/)).toBeTruthy();
  });
  it("shares only the explicitly selected opening snapshot", async () => {
    const page = render(<AIContentReport {...props} />);
    openAndDescribe();
    page.rerender(<AIContentReport {...props} content="Later draft fixture" />);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Send report" }));
    await waitFor(() => expect(state.save).toHaveBeenCalledOnce());
    expect(state.save.mock.calls[0][0].message).toContain(props.content);
    expect(state.save.mock.calls[0][0].message).not.toContain("Later draft fixture");
  });
  it("refuses a changed server account before transmitting the excerpt", async () => {
    render(<AIContentReport {...props} />);
    openAndDescribe();
    fireEvent.click(screen.getByRole("checkbox"));
    state.fresh.mockResolvedValue({ user: { id: "different-account-fixture", email: "different@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Send report" }));
    await screen.findByText(/Report not confirmed/);
    expect(state.save).not.toHaveBeenCalled();
  });
  it("closes the private snapshot when the active account changes", async () => {
    const page = render(<AIContentReport {...props} />);
    openAndDescribe();
    state.user = { id: "different-account-fixture" };
    page.rerender(<AIContentReport {...props} />);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(state.save).not.toHaveBeenCalled();
  });
});
