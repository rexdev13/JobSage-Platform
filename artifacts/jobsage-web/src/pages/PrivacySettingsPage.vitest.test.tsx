import React from "react";
import { Router } from "wouter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => {
  const mutation = () => ({
    mutate: vi.fn(),
    reset: vi.fn(),
    isPending: false,
    isSuccess: false,
    isError: false,
    data: undefined,
  });
  return {
    auth: { user: { id: "fixture-passwordless-account", email: "verified@privacy.invalid" }, isLoading: false, isAuthenticated: true },
    settingsQuery: {
      data: {
        userId: "fixture-passwordless-account",
        policyVersion: "fixture-policy",
        marketing: false,
        optionalAnalytics: false,
        notifications: { jobAlerts: true },
        deletionEnabled: false,
        deletionPolicy: {},
        reauthenticationMethod: "email_code",
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    },
    invalidateQueries: vi.fn(),
    update: mutation(),
    request: mutation(),
    download: mutation(),
    clear: mutation(),
    revoke: mutation(),
    start: mutation(),
    verify: mutation(),
  };
});

vi.mock("@workspace/auth-web", () => ({ useAuth: () => mocks.auth }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }) }));
vi.mock("@workspace/api-client-react", () => ({
  getGetPrivacySettingsQueryKey: () => ["privacy-settings"],
  useGetPrivacySettings: () => mocks.settingsQuery,
  useUpdatePrivacySettings: () => mocks.update,
  useRequestPersonalData: () => mocks.request,
  useDownloadPersonalData: () => mocks.download,
  useClearSmartApplyDrafts: () => mocks.clear,
  useRevokePushDevices: () => mocks.revoke,
  useStartPrivacyReauthentication: () => mocks.start,
  useVerifyPrivacyReauthentication: () => mocks.verify,
}));
vi.mock("@/lib/nativeWorkspace", () => ({ nativeWorkspaceAvailable: () => false, notifyNative: vi.fn() }));

import PrivacySettingsPage from "./PrivacySettingsPage";

function renderPage() {
  return render(<Router><PrivacySettingsPage /></Router>);
}

describe("PrivacySettingsPage passwordless personal-data requests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verify.mutate.mockImplementation((...args: any[]) => {
      args[1]?.onSuccess?.({ verified: true, proofToken: "privacy-proof-fixture-token-value-1234567890abcdef", expiresInSeconds: 300 });
    });
  });

  afterEach(() => {
    cleanup();
    window.history.replaceState(null, "", "/");
  });

  it("requires a verified one-time email proof before submitting a data request", async () => {
    renderPage();

    const requestButton = screen.getByTestId("button-request-export");
    expect(requestButton).toHaveProperty("disabled", true);
    expect(screen.getByTestId("button-download-export")).toHaveProperty("disabled", true);

    fireEvent.click(screen.getByTestId("button-send-privacy-code"));
    expect(mocks.start.mutate).toHaveBeenCalledWith({
      data: { expectedAccountId: "fixture-passwordless-account", purpose: "personal_data" },
    });

    const codeInput = screen.getByTestId("input-privacy-code");
    fireEvent.change(codeInput, { target: { value: "12a34567" } });
    expect(codeInput).toHaveProperty("value", "123456");
    fireEvent.click(screen.getByTestId("button-verify-privacy-code"));
    await screen.findByTestId("status-privacy-code-verified");
    expect(mocks.verify.mutate).toHaveBeenCalledWith({
      data: { expectedAccountId: "fixture-passwordless-account", purpose: "personal_data", code: "123456" },
    }, expect.any(Object));
    expect(requestButton).toHaveProperty("disabled", false);

    fireEvent.click(screen.getByTestId("checkbox-confirm-export"));
    fireEvent.click(requestButton);
    await waitFor(() => expect(mocks.request.mutate).toHaveBeenCalledWith({
      data: {
        expectedAccountId: "fixture-passwordless-account",
        emailCodeProof: "privacy-proof-fixture-token-value-1234567890abcdef",
        confirmed: true,
      },
    }, expect.any(Object)));
  });
});
