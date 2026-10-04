import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MobileAssistedWorkspaceHost } from "./MobileAssistedWorkspaceHost";

vi.mock("@workspace/auth-web", () => ({ useAuth: () => ({ user: { id: "desktop-test-user" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@workspace/api-client-react", () => ({
  useGetMyProfile: () => ({ data: undefined, isLoading: false, isError: false, refetch: vi.fn() }),
  useGetSmartApplyCandidatePrefill: () => ({ data: undefined, isLoading: false, isError: false, refetch: vi.fn() }),
  getGetMyProfileQueryKey: () => ["/api/profile"],
  getGetSmartApplyCandidatePrefillQueryKey: () => ["/api/smart-apply/candidate-prefill"],
  getListMyApplicationsQueryKey: () => ["/api/applications"],
  getGetMyAnalyticsQueryKey: () => ["/api/analytics"],
  getListMatchedRolesQueryKey: () => ["/api/matched-roles"],
  getGetMyMatchesQueryKey: () => ["/api/matches"],
}));

const applicationUrl = "https://jobs.example/apply/42?ref=jobsage";

function response(applications: unknown[]) {
  return new Response(JSON.stringify({ applications }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function mountHost(applications: unknown[], extensionPresent = true) {
  document.body.innerHTML = extensionPresent ? '<div id="jobsage-extension-root"></div>' : "";
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  const request = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
    if (url === "/api/applications" && options?.method === "POST") {
      return Promise.resolve(new Response(JSON.stringify({ application: { status: "applied" }, updated: true }), { status: 200 }));
    }
    return Promise.resolve(response(applications));
  });
  vi.stubGlobal("fetch", request);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  render(<QueryClientProvider client={queryClient}><MobileAssistedWorkspaceHost /></QueryClientProvider>);
  return { request, invalidate };
}

function clickOutboundAndReturn() {
  window.dispatchEvent(new CustomEvent("jobsage:outbound-application", {
    detail: {
      applicationUrl,
      roleId: 41,
      jobTitle: "Staff Nurse",
      employer: "Example NHS Trust",
    },
  }));
  window.dispatchEvent(new Event("blur"));
  window.dispatchEvent(new Event("focus"));
}

describe("desktop outbound return prompt", () => {
  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("stays silent and refreshes the tracker when the extension already marked the exact URL applied", async () => {
    const { request, invalidate } = mountHost([
      { applicationType: "website", applicationUrl, status: "applied" },
    ]);
    await act(async () => clickOutboundAndReturn());
    await waitFor(() => expect(request).toHaveBeenCalledWith("/api/applications", expect.objectContaining({
      credentials: "include",
      cache: "no-store",
    })));
    expect(screen.queryByTestId("dialog-confirm-submitted")).toBeNull();
    expect(invalidate).toHaveBeenCalled();
  });

  it("asks for confirmation when extension tracking left this exact desktop application pending", async () => {
    const { request, invalidate } = mountHost([
      { applicationType: "website", applicationUrl, status: "link_clicked" },
    ]);
    await act(async () => clickOutboundAndReturn());
    expect(await screen.findByRole("alertdialog", undefined, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByText("Did you submit your application for Staff Nurse at Example NHS Trust?")).toBeTruthy();
    expect(screen.getByTestId("button-still-in-progress").textContent).toBe("Still Applying");
    expect(screen.queryByTestId("button-remind-later")).toBeNull();
    await act(async () => { fireEvent.click(screen.getByTestId("button-yes-applied")); });
    await waitFor(() => expect(request).toHaveBeenCalledWith("/api/applications/confirm-submission", expect.objectContaining({
      method: "POST",
      credentials: "include",
      body: JSON.stringify({ applicationUrl }),
    })));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["/api/applications"] }));
  });

  it("uses the same prompt with desktop wording when a desktop has no extension", async () => {
    mountHost([], false);
    const vacancy = { title: "Care Assistant", employer: "Example Care Ltd", roleId: 27 };
    await act(async () => {
      window.dispatchEvent(new CustomEvent("jobsage:assisted-application", {
        detail: { source: "desktop-assisted", applicationUrl, vacancy, phase: "saving" },
      }));
      window.dispatchEvent(new CustomEvent("jobsage:assisted-application", {
        detail: {
          source: "desktop-assisted", applicationUrl, vacancy, phase: "ready",
          application: { id: 9, status: "in_progress", appliedAt: new Date().toISOString() },
        },
      }));
    });
    await act(async () => {
      window.dispatchEvent(new Event("blur"));
      window.dispatchEvent(new Event("focus"));
    });
    expect(await screen.findByRole("alertdialog")).toBeTruthy();
    expect(screen.getByText("Did you submit your application for Care Assistant at Example Care Ltd?")).toBeTruthy();
    expect(screen.getByTestId("button-still-in-progress").textContent).toBe("Still Applying");
    fireEvent.click(screen.getByTestId("button-still-in-progress"));
    await waitFor(() => expect(screen.queryByTestId("dialog-confirm-submitted")).toBeNull());
  });
});