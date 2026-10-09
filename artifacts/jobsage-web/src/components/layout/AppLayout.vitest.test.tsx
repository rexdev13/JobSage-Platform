import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { AppLayout } from "./AppLayout";

vi.mock("./AppSidebar", () => ({
  AppSidebar: ({ onNavigate, onEnhance }: { onNavigate?: () => void; onEnhance?: () => void }) => (
    <nav aria-label="Main navigation">
      <button type="button" onClick={onNavigate} data-testid="mock-navigation-link">Go to profile</button>
      <button type="button" onClick={onEnhance} data-testid="mock-enhance">CV Enhancement</button>
    </nav>
  ),
}));
vi.mock("@/components/ReadinessQuotaModal", () => ({ ReadinessQuotaModal: () => null }));
vi.mock("@/components/QuickHelpMenu", () => ({ QuickHelpMenu: () => null }));
vi.mock("@/components/CvEnhancementSheet", () => ({
  CvEnhancementSheet: ({ open }: { open: boolean }) =>
    open ? <div role="dialog" aria-label="CV enhancement flow" /> : null,
}));

describe("mobile navigation drawer", () => {
  afterEach(() => {
    document.body.style.pointerEvents = "";
    document.body.style.removeProperty("overflow");
  });

  it("opens from the menu button and closes using the visible close control", async () => {
    render(<AppLayout><div>Page content</div></AppLayout>);
    const trigger = screen.getByRole("button", { name: "Open navigation menu" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);
    expect(await screen.findByRole("dialog", { name: "JOBSAGE navigation" })).toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByRole("button", { name: "Close navigation menu" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "JOBSAGE navigation" })).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("closes from Escape and backdrop, restoring focus to the hamburger", async () => {
    render(<AppLayout><div>Page content</div></AppLayout>);
    const trigger = screen.getByRole("button", { name: "Open navigation menu" });
    fireEvent.click(trigger);
    await screen.findByRole("dialog", { name: "JOBSAGE navigation" });
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "JOBSAGE navigation" })).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());

    fireEvent.click(trigger);
    await screen.findByRole("dialog", { name: "JOBSAGE navigation" });
    const overlay = Array.from(document.querySelectorAll("[data-state='open']"))
      .find((element) => element.className.toString().includes("bg-black/80"));
    expect(overlay).toBeTruthy();
    fireEvent.pointerDown(overlay as Element, { button: 0, pointerType: "mouse" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "JOBSAGE navigation" })).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("closes after navigation and waits for the drawer exit before opening CV Enhancement", async () => {
    render(<AppLayout><div>Page content</div></AppLayout>);
    const trigger = screen.getByRole("button", { name: "Open navigation menu" });
    fireEvent.click(trigger);
    await screen.findByRole("dialog", { name: "JOBSAGE navigation" });
    fireEvent.click(screen.getByTestId("mock-navigation-link"));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "JOBSAGE navigation" })).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());

    fireEvent.click(trigger);
    await screen.findByRole("dialog", { name: "Candidate navigation" });
    fireEvent.click(screen.getByTestId("mock-enhance"));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Candidate navigation" })).not.toBeInTheDocument());
    expect(screen.queryByRole("dialog", { name: "CV enhancement flow" })).not.toBeInTheDocument();
    expect(await screen.findByRole("dialog", { name: "CV enhancement flow" }, { timeout: 1000 })).toBeInTheDocument();
  });
});
