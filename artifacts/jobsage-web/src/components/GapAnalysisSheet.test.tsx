import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

vi.mock("@/lib/trackedOutbound", () => ({
  openTrackedSponsorVacancy: vi.fn(),
  openTrackedOutbound: vi.fn(),
}));

vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <div>{children}</div> : null,
  SheetContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  SheetDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
}));

import { GapAnalysisSheet } from "./GapAnalysisSheet";

const analysis = {
  matchedRequirements: ["Three years of ward experience"],
  gaps: ["Venepuncture experience", "Enhanced DBS is not shown"],
  optimizationSteps: ["Add recent clinical examples"],
  generatedAt: "2026-08-29T08:00:00.000Z",
  fromCache: true,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function renderSheet(queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
})) {
  const view = render(
    <QueryClientProvider client={queryClient}>
      <GapAnalysisSheet
        open
        onOpenChange={vi.fn()}
        vacancyId={42}
        vacancyTitle="Staff Nurse"
        companyName="Example Trust"
        vacancyUrl={null}
        hasCvUploaded
        analysisEndpoint="/opportunities/roles/42/gap-analysis"
        analysisSource="role"
        onApply={vi.fn()}
      />
    </QueryClientProvider>,
  );
  return { ...view, queryClient };
}

describe("GapAnalysisSheet readiness claims", () => {
  beforeEach(() => {
    toastMock.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("acknowledges an ordinary gap, persists it, and routes structured gaps to the profile", async () => {
    let claimSaved = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/readiness/claims") && init?.method === "POST") {
        claimSaved = true;
        return jsonResponse({
          created: true,
          claim: { claimKey: "venepuncture experience", claimText: "Venepuncture experience" },
        }, 201);
      }
      if (url.endsWith("/readiness/claims")) {
        return jsonResponse({
          claims: claimSaved
            ? [{ claimKey: "venepuncture experience", claimText: "Venepuncture experience" }]
            : [],
        });
      }
      if (url.endsWith("/gap-analyses/usage")) return jsonResponse({ used: 1, limit: 10 });
      if (url.endsWith("/opportunities/roles/42/gap-analysis")) return jsonResponse(analysis);
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const first = renderSheet();
    const acknowledge = await screen.findByRole("button", {
      name: "I already have this: Venepuncture experience",
    });
    expect(screen.getByRole("link", { name: "Review this in my profile" }).getAttribute("href")).toBe("/profile");

    fireEvent.click(acknowledge);
    await screen.findByText(/is now treated as a self-declared claim/i);
    expect(screen.queryByText("Venepuncture experience")).toBeNull();
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
      title: "Gap acknowledged",
      description: expect.stringMatching(/not verified/i),
    }));

    first.unmount();
    first.queryClient.clear();
    renderSheet();
    await screen.findByText("Enhanced DBS is not shown");
    expect(screen.queryByRole("button", {
      name: "I already have this: Venepuncture experience",
    })).toBeNull();
  });

  it("restores an optimistically hidden gap when saving fails", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/readiness/claims") && init?.method === "POST") {
        return jsonResponse({ error: "Temporary failure" }, 500);
      }
      if (url.endsWith("/readiness/claims")) return jsonResponse({ claims: [] });
      if (url.endsWith("/gap-analyses/usage")) return jsonResponse({ used: 1, limit: 10 });
      if (url.endsWith("/opportunities/roles/42/gap-analysis")) return jsonResponse(analysis);
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderSheet();
    fireEvent.click(await screen.findByRole("button", {
      name: "I already have this: Venepuncture experience",
    }));

    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
      title: "Could not save acknowledgement",
      description: expect.stringMatching(/not recorded/i),
      variant: "destructive",
    })));
    expect(screen.getByText("Venepuncture experience")).toBeTruthy();
  });

  it("hides a rephrased gap when reopening with a legacy saved claim", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/readiness/claims")) {
        return jsonResponse({
          claims: [{
            claimKey: "No evidence of venepuncture experience",
            claimText: "No evidence of venepuncture experience",
          }],
        });
      }
      if (url.endsWith("/gap-analyses/usage")) return jsonResponse({ used: 1, limit: 10 });
      if (url.endsWith("/opportunities/roles/42/gap-analysis")) {
        return jsonResponse({
          ...analysis,
          gaps: ["Venipuncture experience is not shown", "Enhanced DBS is not shown"],
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderSheet();

    await screen.findByText("Enhanced DBS is not shown");
    expect(screen.queryByText("Venipuncture experience is not shown")).toBeNull();
    expect(screen.queryByRole("button", {
      name: "I already have this: Venipuncture experience is not shown",
    })).toBeNull();
  });
});