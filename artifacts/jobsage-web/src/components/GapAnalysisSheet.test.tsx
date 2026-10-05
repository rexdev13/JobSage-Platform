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
import { getGetReadinessQuotaQueryKey } from "@workspace/api-client-react";

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
      if (url.endsWith("/gap-analyses/usage")) return jsonResponse({ used: 1, limit: 3 });
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
      if (url.endsWith("/gap-analyses/usage")) return jsonResponse({ used: 1, limit: 3 });
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
      if (url.endsWith("/gap-analyses/usage")) return jsonResponse({ used: 1, limit: 3 });
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

  it("shows the server quota in the badge, denial toast and limit banner", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/readiness/claims")) return jsonResponse({ claims: [] });
      if (url.endsWith("/gap-analyses/usage")) return jsonResponse({ used: 3, limit: 3 });
      if (url.endsWith("/opportunities/roles/42/gap-analysis")) {
        return jsonResponse({ error: "Readiness Check limit reached." }, 429);
      }
      throw new Error(`Unexpected request: ${url}`);
    }));

    renderSheet();
    expect(await screen.findByTestId("button-toggle-readiness-upgrades")).toBeTruthy();
    await screen.findByText("3/3 this month");
    await screen.findByTestId("readiness-upgrade-options");
    await screen.findByText(/You have used all 3 of your Readiness Checks this month/);
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
      title: "Readiness Check limit reached",
      description: "You have used all 3 of your Readiness Checks.",
    }));
  });

  it("keeps the get-more-checks action available before the monthly quota is exhausted", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/readiness/claims")) return jsonResponse({ claims: [] });
      if (url.endsWith("/gap-analyses/usage")) return jsonResponse({ used: 1, limit: 3 });
      if (url.endsWith("/opportunities/roles/42/gap-analysis")) return jsonResponse(analysis);
      throw new Error(`Unexpected request: ${url}`);
    }));

    renderSheet();
    const count = await screen.findByText("1/3 this month");
    const button = screen.getByTestId("button-toggle-readiness-upgrades");
    expect(count.parentElement?.querySelector('[data-testid="button-toggle-readiness-upgrades"]')).toBe(button);

    fireEvent.click(button);
    expect(await screen.findByText("Check Booster Pack")).toBeTruthy();
    expect(screen.getByText("JobSage Pro")).toBeTruthy();
  });

  it.each(["booster_pack", "pro_subscription"] as const)("unblocks the mounted sheet after a sandbox %s upgrade", async (purchase) => {
    let upgraded = false;
    let analysisRequests = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const usage = {
        used: 3, limit: 3, resetsAt: "2026-11-01T00:00:00.000Z",
        plan: upgraded && purchase === "pro_subscription" ? "pro" : "free",
        bonusRemaining: upgraded && purchase === "booster_pack" ? 20 : 0,
      };
      if (url.endsWith("/checkout/create-session")) {
        expect(JSON.parse(String(init?.body))).toEqual({ type: purchase, currency: "gbp" });
        upgraded = true;
        return jsonResponse({
          success: true, sandboxCompleted: true, checkoutUrl: null,
          currency: "gbp", amount: purchase === "booster_pack" ? 499 : 1599,
          bonusChecks: purchase === "booster_pack" ? 20 : 0, description: "Sandbox offer",
        });
      }
      if (url.endsWith("/readiness/quota") || url.endsWith("/gap-analyses/usage")) return jsonResponse(usage);
      if (url.endsWith("/readiness/claims")) return jsonResponse({ claims: [] });
      if (url.endsWith("/opportunities/roles/42/gap-analysis")) {
        analysisRequests++;
        return upgraded ? jsonResponse(analysis) : jsonResponse({ error: "Limit reached" }, 429);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { queryClient } = renderSheet();
    const invalidations = vi.spyOn(queryClient, "invalidateQueries");
    await screen.findByText(/You have used all 3 of your Readiness Checks this month/);
    expect(screen.getByText("£4.99")).toBeTruthy();
    expect(screen.getByText("£15.99")).toBeTruthy();
    expect(screen.getByText("20 additional checks")).toBeTruthy();
    fireEvent.click(document.querySelector(`[data-testid="${purchase === "booster_pack" ? "button-buy-booster" : "button-buy-pro"}"]`)!);
    await screen.findByText("Enhanced DBS is not shown");
    expect(screen.queryByText(/You have used all 3 of your Readiness Checks this month/)).toBeNull();
    expect(analysisRequests).toBe(2);
    expect(invalidations).toHaveBeenCalledWith({ queryKey: ["gap-analysis-usage"] });
    expect(invalidations).toHaveBeenCalledWith({ queryKey: ["my-profile"] });
  });

  it.each([
    { plan: "pro", bonusRemaining: 0 },
    { plan: "free", bonusRemaining: 20 },
    { plan: "free", bonusRemaining: 0, used: 0 },
  ])("clears a blocked sheet when usage refresh restores access: %j", async (access) => {
    let restored = false;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/readiness/claims")) return jsonResponse({ claims: [] });
      if (url.endsWith("/gap-analyses/usage")) {
        return jsonResponse({
          used: restored && "used" in access ? access.used : 3,
          limit: 3,
          plan: restored ? access.plan : "free",
          bonusRemaining: restored ? access.bonusRemaining : 0,
        });
      }
      if (url.endsWith("/opportunities/roles/42/gap-analysis")) {
        return restored ? jsonResponse(analysis) : jsonResponse({ error: "Limit reached" }, 429);
      }
      throw new Error(`Unexpected request: ${url}`);
    }));
    const { queryClient } = renderSheet();
    await screen.findByText(/You have used all 3 of your Readiness Checks this month/);
    restored = true;
    await queryClient.invalidateQueries({ queryKey: ["gap-analysis-usage"] });
    await screen.findByText("Enhanced DBS is not shown");
    expect(screen.queryByText(/You have used all 3 of your Readiness Checks this month/)).toBeNull();
  });

  it("refreshes both usage views after generating a fresh analysis that consumes a check", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/readiness/claims")) return jsonResponse({ claims: [] });
      if (url.endsWith("/gap-analyses/usage")) return jsonResponse({ used: 3, limit: 3, plan: "free", bonusRemaining: 19 });
      if (url.endsWith("/opportunities/roles/42/gap-analysis")) return jsonResponse({ ...analysis, fromCache: false });
      throw new Error(`Unexpected request: ${url}`);
    }));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidations = vi.spyOn(queryClient, "invalidateQueries");
    renderSheet(queryClient);
    await screen.findByText("Enhanced DBS is not shown");
    await waitFor(() => {
      expect(invalidations).toHaveBeenCalledWith({ queryKey: ["gap-analysis-usage"] });
      expect(invalidations).toHaveBeenCalledWith({ queryKey: getGetReadinessQuotaQueryKey() });
    });
  });
});