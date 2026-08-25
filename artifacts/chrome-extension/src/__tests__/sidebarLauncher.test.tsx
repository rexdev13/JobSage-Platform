// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { Sidebar } from "../components/Sidebar";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let mount: HTMLDivElement | null = null;

afterEach(() => {
  mount?.remove();
  mount = null;
});

describe("Smart Apply launcher", () => {
  it("keeps a minimized launcher visible and reopens it when clicked", async () => {
    mount = document.createElement("div");
    document.body.append(mount);
    const root = createRoot(mount);

    await act(async () => {
      root.render(
        <Sidebar
          minimal
          jobContext={{ jobTitle: "Care Assistant", companyName: "Example Care", jobDescription: "", pageUrl: "https://example.test/apply" }}
          onLogApplication={async () => undefined}
          onDismiss={() => undefined}
        />,
      );
    });

    const pill = document.querySelector<HTMLButtonElement>("[aria-label='Open JOBSAGE']");
    expect(pill).not.toBeNull();

    await act(async () => {
      pill?.click();
    });
    expect(document.querySelector("[role='dialog']")).not.toBeNull();

    const minimize = document.querySelector<HTMLButtonElement>("[aria-label='Close']");
    await act(async () => {
      minimize?.click();
    });
    expect(document.querySelector("[role='dialog']")).toBeNull();

    const reopenedPill = document.querySelector<HTMLButtonElement>("[aria-label='Open JOBSAGE']");
    await act(async () => {
      reopenedPill?.click();
    });
    expect(document.querySelector("[role='dialog']")).not.toBeNull();

    await act(async () => root.unmount());
  });
});