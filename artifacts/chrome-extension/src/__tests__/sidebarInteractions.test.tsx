// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { clampSidebarWidth, Sidebar, sidebarWidthBounds } from "../components/Sidebar";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let mount: HTMLDivElement | null = null;

function renderSidebar(startOpen = false) {
  mount = document.createElement("div");
  document.body.append(mount);
  const root = createRoot(mount);
  act(() => {
    root.render(
      <Sidebar
        startOpen={startOpen}
        jobContext={{
          jobTitle: "Care Assistant",
          companyName: "Example Care",
          jobDescription: "",
          pageUrl: "https://example.test/apply",
        }}
        onLogApplication={async () => undefined}
        onDismiss={() => undefined}
      />,
    );
  });
  return root;
}

afterEach(async () => {
  mount?.remove();
  mount = null;
});

describe("Smart Apply panel interactions", () => {
  it("opens from a pointer release on the visible launcher", async () => {
    const root = renderSidebar();
    const pill = document.querySelector<HTMLButtonElement>("[aria-label='Open JOBSAGE']");

    await act(async () => {
      pill?.dispatchEvent(new Event("pointerup", { bubbles: true, composed: true }));
    });

    expect(document.querySelector("[role='dialog']")).not.toBeNull();
    await act(async () => root.unmount());
  });

  it("closes on an outside click without hiding the launcher", async () => {
    const root = renderSidebar(true);
    expect(document.querySelector("[role='dialog']")).not.toBeNull();

    await act(async () => {
      document.body.dispatchEvent(new Event("pointerdown", { bubbles: true, composed: true }));
    });

    expect(document.querySelector("[role='dialog']")).toBeNull();
    expect(document.querySelector("[aria-label='Open JOBSAGE']")).not.toBeNull();
    await act(async () => root.unmount());
  });

  it("closes on Escape and supports keyboard width changes", async () => {
    const root = renderSidebar(true);
    const resizer = document.querySelector<HTMLDivElement>("[aria-label='Resize JOBSAGE sidebar']");
    const startingWidth = Number(resizer?.getAttribute("aria-valuenow"));

    await act(async () => {
      resizer?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    });
    expect(Number(resizer?.getAttribute("aria-valuenow"))).toBeGreaterThan(startingWidth);

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(document.querySelector("[role='dialog']")).toBeNull();
    await act(async () => root.unmount());
  });

  it("keeps the sidebar within a usable responsive width range", () => {
    expect(sidebarWidthBounds(1440)).toEqual({ minimum: 320, maximum: 720 });
    expect(sidebarWidthBounds(320)).toEqual({ minimum: 288, maximum: 288 });
    expect(clampSidebarWidth(1000, 500)).toBe(468);
    expect(clampSidebarWidth(100, 500)).toBe(320);
  });
});