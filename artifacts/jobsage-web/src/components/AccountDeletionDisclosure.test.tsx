import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ user: { id: "fixture-candidate", role: "candidate" } as { id: string; role: string } | null }));
vi.mock("@workspace/auth-web", () => ({ useAuth: () => ({ user: fixture.user }) }));
import { AccountDeletionDisclosure } from "./AccountDeletionDisclosure";
describe("approved account-deletion disclosure", () => {
  beforeEach(() => { fixture.user = { id: "fixture-candidate", role: "candidate" }; });
  it("shows all policy periods, ownership/copy limits, retention and subscription instructions", () => {
    render(<AccountDeletionDisclosure />);
    fireEvent.click(screen.getByRole("button", { name: /account deletion/i }));
    expect(screen.getByText(/not accepting permanent deletion requests/i)).toBeTruthy();
    expect(screen.getByText(/30 calendar days/i)).toBeTruthy();
    expect(screen.getByText(/90 days/i)).toBeTruthy();
    expect(screen.getByText(/six years/i)).toBeTruthy();
    expect(screen.getByText(/12 months.*24 months/i)).toBeTruthy();
    expect(screen.getByText(/cannot recall material/i)).toBeTruthy();
    expect(screen.getByText(/employer-owned organisations/i)).toBeTruthy();
    expect(screen.getByText(/Apple: Settings/i)).toBeTruthy();
    expect(screen.getByText(/Google Play: profile/i)).toBeTruthy();
    expect(screen.queryByLabelText(/password/i)).toBeNull();
  });
  it.each(["employer", "admin", "super_admin", "marketing", "reviewer"])("is available to the %s role without changing navigation", role => {
    fixture.user = { id: `fixture-${role}`, role };
    render(<AccountDeletionDisclosure />);
    expect(screen.getByRole("button", { name: /account deletion/i })).toBeTruthy();
  });
  it("closes an old account's disclosure on account change", async () => {
    const { rerender } = render(<AccountDeletionDisclosure />);
    fireEvent.click(screen.getByRole("button", { name: /account deletion/i }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    fixture.user = { id: "fixture-other", role: "candidate" };
    await act(async () => { rerender(<AccountDeletionDisclosure />); });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("does not render account controls for a signed-out visitor", () => {
    fixture.user = null;
    render(<AccountDeletionDisclosure />);
    expect(screen.queryByRole("button", { name: /account deletion/i })).toBeNull();
  });
});
