import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("@/components/layout/AppLayout", () => ({
  AppLayout: ({ children }: { children: unknown }) => children,
}));

import { AllUsersTab } from "./SuperAdminPage";

const fetchMock = vi.fn();
let root: Root;
let container: HTMLDivElement;
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("Super-admin user directory", () => {
  beforeEach(() => {
    fetchMock.mockReset().mockImplementation((input: string) => {
      if (input.includes("/marketing-accounts")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            message: "Marketing account created.",
            user: { id: "marketing-1", email: "marketing@example.com", role: "marketing", emailVerified: false },
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ users: [], total: 0, page: 1, pageSize: 25 }),
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("shows marketing account creation and filtering controls, then refreshes after inviting", async () => {
    await act(async () => {
      root.render(<AllUsersTab />);
    });

    expect(container.textContent).toContain("Create marketing account");
    expect(Array.from(container.querySelectorAll("option")).some((option) => option.value === "marketing")).toBe(true);

    const inputs = container.querySelectorAll("input");
    await act(async () => {
      setInputValue(inputs[0], "Maya");
      setInputValue(inputs[1], "Green");
      setInputValue(inputs[2], "marketing@example.com");
    });
    await act(async () => {
      container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/admin/super/marketing-accounts"),
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/admin/super/users")).length).toBeGreaterThan(1);
  });
});