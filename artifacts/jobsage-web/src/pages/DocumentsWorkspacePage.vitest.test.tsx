import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import DocumentsWorkspacePage from "./DocumentsWorkspacePage";

vi.mock("@/components/layout/AppLayout", () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
vi.mock("./DocumentsPage", () => ({
  default: () => <section aria-label="Existing document tools">Uploaded files</section>,
}));
vi.mock("./RecommendationLettersPage", () => ({
  default: () => <section aria-label="Existing reference tools">Reference records</section>,
}));

afterEach(cleanup);

function renderWorkspace(path = "/documents") {
  const location = memoryLocation({ path, record: true });
  render(<Router hook={location.hook}><DocumentsWorkspacePage /></Router>);
  return location;
}

describe("CV and supporting documents workspace", () => {
  it("defaults to existing document tools and makes references discoverable", async () => {
    renderWorkspace();
    await screen.findByRole("region", { name: "Existing document tools" });
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    const nav = screen.getByRole("navigation", { name: "CV and supporting documents sections" });
    expect(within(nav).getByRole("link", { name: "Documents" }).getAttribute("aria-current")).toBe("page");
    expect(within(nav).getByRole("link", { name: "References" }).getAttribute("href")).toBe("/documents/references");
    expect(screen.queryByRole("region", { name: "Existing reference tools" })).toBeNull();
  });

  it("switches to references using a real bookmarkable URL", async () => {
    const location = renderWorkspace();
    await screen.findByRole("region", { name: "Existing document tools" });
    fireEvent.click(screen.getByRole("link", { name: "References" }));
    await screen.findByRole("region", { name: "Existing reference tools" });
    expect(location.history).toEqual(["/documents", "/documents/references"]);
    expect(screen.getByRole("link", { name: "References" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Documents" }).hasAttribute("aria-current")).toBe(false);
    expect(screen.queryByRole("region", { name: "Existing document tools" })).toBeNull();
  });

  it("opens references directly after a refresh or bookmarked visit", async () => {
    renderWorkspace("/documents/references");
    await screen.findByRole("region", { name: "Existing reference tools" });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("CV & Supporting Documents");
    expect(screen.queryByRole("region", { name: "Existing document tools" })).toBeNull();
  });

  it("returns to documents while keeping the same parent section", async () => {
    const location = renderWorkspace("/documents/references");
    await screen.findByRole("region", { name: "Existing reference tools" });
    fireEvent.click(screen.getByRole("link", { name: "Documents" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Existing document tools" })).not.toBeNull());
    expect(location.history).toEqual(["/documents/references", "/documents"]);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });
});
