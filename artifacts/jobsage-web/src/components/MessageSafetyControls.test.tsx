import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CandidateMessage } from "@workspace/api-client-react";

const fixture = vi.hoisted(() => ({ user: { id: "candidate-fixture" }, block: vi.fn(), remove: vi.fn(), list: vi.fn() }));
vi.mock("@workspace/auth-web", () => ({ useAuth: () => ({ user: fixture.user }) }));
vi.mock("./AIContentReport", () => ({ AIContentReport: () => <button>Report message fixture</button> }));
vi.mock("@workspace/api-client-react", () => ({
  blockMessageSender: fixture.block, removeMessageSenderBlock: fixture.remove,
  useListMessageSenderBlocks: fixture.list,
  getListMessageSenderBlocksQueryKey: () => ["/candidate/message-sender-blocks"],
  getGetCandidateMessagesQueryKey: () => ["/candidate/messages"],
  getGetInboxUnreadCountQueryKey: () => ["/candidate/messages/unread-count"],
}));
import { ManageBlockedSenders, MessageSafetyActions } from "./MessageSafetyControls";
const message = { id: 70, messageType: "employer", senderEmployerProfileId: 12, messageText: "Fixture message", subject: "Fixture subject" } as CandidateMessage;
function wrap(element: React.ReactNode) {
  return <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{element}</QueryClientProvider>;
}
beforeEach(() => {
  fixture.user = { id: "candidate-fixture" };
  fixture.block.mockReset().mockResolvedValue({ ok: true });
  fixture.remove.mockReset().mockResolvedValue({ ok: true });
  fixture.list.mockReset().mockReturnValue({ data: [{ id: 90, senderLabel: "Fixture employer" }], isLoading: false, isError: false });
});
afterEach(cleanup);
describe("Inbox sender safety controls", () => {
  it("requires confirmation and pins the blocking request to the initiating account", async () => {
    render(wrap(<MessageSafetyActions message={message} />));
    fireEvent.click(screen.getByRole("button", { name: "Block sender" }));
    expect(fixture.block).not.toHaveBeenCalled();
    expect(screen.getByText(/hidden, not deleted/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Confirm block" }));
    await waitFor(() => expect(fixture.block).toHaveBeenCalledOnce());
    expect(fixture.block.mock.calls[0]).toEqual([70, expect.objectContaining({ headers: { "X-Jobsage-Expected-Account": "candidate-fixture" } })]);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
  it("reports an unconfirmed block instead of claiming success on request failure", async () => {
    fixture.block.mockRejectedValue(new Error("Fixture network failure"));
    render(wrap(<MessageSafetyActions message={message} />));
    fireEvent.click(screen.getByRole("button", { name: "Block sender" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm block" }));
    await screen.findByText(/Action not confirmed/);
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
  it("offers reporting, but no block action, for platform support", () => {
    render(wrap(<MessageSafetyActions message={{ ...message, messageType: "support" }} />));
    expect(screen.getByRole("button", { name: "Report message fixture" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Block sender" })).toBeNull();
  });
  it("shows a real blocked list and submits an owned unblock request", async () => {
    render(wrap(<ManageBlockedSenders />));
    fireEvent.click(screen.getByRole("button", { name: "Blocked senders" }));
    expect(screen.getByText("Fixture employer")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Unblock" }));
    await waitFor(() => expect(fixture.remove).toHaveBeenCalledOnce());
    expect(fixture.remove.mock.calls[0]).toEqual([90, expect.objectContaining({ headers: { "X-Jobsage-Expected-Account": "candidate-fixture" } })]);
    expect(fixture.list.mock.calls.at(-1)?.[0].query.queryKey.at(-1)).toBe("candidate-fixture");
  });
  it("closes a confirmation and aborts its request when the account changes", async () => {
    let finish!: (value: { ok: boolean }) => void;
    fixture.block.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const view = render(wrap(<MessageSafetyActions message={message} />));
    fireEvent.click(screen.getByRole("button", { name: "Block sender" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm block" }));
    const signal = fixture.block.mock.calls[0][1].signal;
    fixture.user = { id: "different-account-fixture" };
    view.rerender(wrap(<MessageSafetyActions message={message} />));
    expect(signal.aborted).toBe(true);
    finish({ ok: true });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
