import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { afterAll, afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { AppState, Platform } from "react-native";

interface FixtureStagedDocument {
  filename: string;
  mimeType: string;
  size: number;
  file: Blob;
  stagingDirectoryUri: string | null;
}

interface DownloadOptions {
  url: string;
  filename: string;
  token: string;
  share?: boolean;
}

const mockDocumentQuery = {
  data: { documents: [] as Array<Record<string, unknown>> },
  isError: false,
  isFetching: false,
  isLoading: false,
  refetch: jest.fn(async () => undefined),
};
const mockUseListMyDocuments = jest.fn<(options?: unknown) => typeof mockDocumentQuery>(
  () => mockDocumentQuery,
);
const mockInvalidateQueries = jest.fn<(options: { queryKey: string[] }) => Promise<void>>(
  async () => undefined,
);
const mockDeleteMutation = jest.fn<(variables: { id: number }) => Promise<void>>(
  async () => undefined,
);
const mockPickDocument = jest.fn<() => Promise<FixtureStagedDocument | null>>();
const mockUploadDocument = jest.fn<
  (
    document: FixtureStagedDocument,
    signal: AbortSignal,
    onProgress?: (progress: { loaded: number; total: number; percent: number }) => void,
  ) => Promise<void>
>();
const mockCleanupStagedDocument = jest.fn();
const mockCleanupInterruptedUploads = jest.fn();
const mockCleanupTempDownload = jest.fn();
const mockDownloadAndShare = jest.fn<
  (options: DownloadOptions) => Promise<{ uri: string; filename: string; mimeType: string }>
>(async () => ({ uri: "file:///fixture/CV.pdf", filename: "CV.pdf", mimeType: "application/pdf" }));
const mockRouterBack = jest.fn();
const mockRouterReplace = jest.fn();
const mockUser = { id: "candidate-fixture", role: "candidate" };
const mockColors = {
  background: "#ffffff",
  border: "#dddddd",
  foreground: "#111111",
  mutedForeground: "#555555",
  muted: "#f5f5f5",
  accent: "#a51d1d",
  card: "#ffffff",
  primary: "#a51d1d",
  primaryForeground: "#ffffff",
  secondary: "#f5f5f5",
  destructive: "#b42318",
  radius: 12,
};

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("react-native-webview", () => ({ WebView: () => null }));
jest.mock("expo-router", () => ({
  router: {
    canGoBack: () => true,
    back: mockRouterBack,
    replace: mockRouterReplace,
  },
}));
jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
}));
jest.mock("@workspace/api-client-react", () => ({
  getListMyDocumentsQueryKey: () => ["/api/documents"],
  useListMyDocuments: (options: unknown) => mockUseListMyDocuments(options),
  useDeleteDocument: () => ({ mutateAsync: mockDeleteMutation }),
}));
jest.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: mockUser }),
  getNativeSessionToken: () => "candidate-fixture-token",
  getNativeSessionUserId: () => "candidate-fixture",
}));
jest.mock("@/hooks/useColors", () => ({ useColors: () => mockColors }));
jest.mock("@/lib/native-download", () => ({
  downloadAndShare: (options: DownloadOptions) => mockDownloadAndShare(options),
  cleanupTempDownload: (...args: unknown[]) => mockCleanupTempDownload(...args),
}));
jest.mock("@/lib/document-upload", () => ({
  DocumentUploadError: class DocumentUploadError extends Error {},
  cleanupInterruptedDocumentUploads: (...args: unknown[]) => mockCleanupInterruptedUploads(...args),
  cleanupStagedDocument: (...args: unknown[]) => mockCleanupStagedDocument(...args),
  pickAndStageDocument: () => mockPickDocument(),
  uploadStagedDocument: (
    document: FixtureStagedDocument,
    signal: AbortSignal,
    onProgress?: (progress: { loaded: number; total: number; percent: number }) => void,
  ) => mockUploadDocument(document, signal, onProgress),
}));

const DocumentsScreen = require("../app/companion/documents").default as typeof import("../app/companion/documents").default;

function stagedFixture() {
  return {
    filename: "Candidate-CV.pdf",
    mimeType: "application/pdf",
    size: 256,
    file: new Blob(["synthetic CV"], { type: "application/pdf" }),
    stagingDirectoryUri: "file:///fixture-cache/staged-upload",
  } satisfies FixtureStagedDocument;
}

const documentFixture = {
  id: 17,
  userId: "candidate-fixture",
  filename: "Candidate-CV.pdf",
  mimeType: "application/pdf",
  storageKey: "/objects/uploads/fixture-object",
  fileSize: 256,
  documentType: "cv",
  label: null,
  isPrimary: true,
  disclaimerText: "fixture",
  uploadedAt: "2026-10-14T00:00:00.000Z",
};

const originalPlatform = Platform.OS;

beforeEach(() => {
  Object.defineProperty(Platform, "OS", { configurable: true, value: "ios" });
  mockDocumentQuery.data = { documents: [] };
  mockDocumentQuery.isError = false;
  mockDocumentQuery.isFetching = false;
  mockDocumentQuery.isLoading = false;
  mockDocumentQuery.refetch.mockClear();
  mockUseListMyDocuments.mockClear();
  mockUseListMyDocuments.mockReturnValue(mockDocumentQuery);
  mockInvalidateQueries.mockClear();
  mockDeleteMutation.mockReset();
  mockDeleteMutation.mockResolvedValue(undefined);
  mockPickDocument.mockReset();
  mockPickDocument.mockResolvedValue(stagedFixture());
  mockUploadDocument.mockReset();
  mockUploadDocument.mockResolvedValue(undefined);
  mockCleanupStagedDocument.mockClear();
  mockCleanupInterruptedUploads.mockClear();
  mockDownloadAndShare.mockClear();
  mockRouterBack.mockClear();
  mockRouterReplace.mockClear();
  mockCleanupTempDownload.mockClear();
});

afterAll(() => {
  Object.defineProperty(Platform, "OS", { configurable: true, value: originalPlatform });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("native CV and document screen", () => {
  it("selects a private file, uploads it, and refreshes the candidate document list", async () => {
    const selected = stagedFixture();
    mockPickDocument.mockResolvedValue(selected);
    const screen = await render(<DocumentsScreen />);

    fireEvent.press(screen.getByLabelText("Choose a document"));
    await waitFor(() => expect(screen.getByText("Candidate-CV.pdf")).toBeTruthy());
    expect(mockPickDocument).toHaveBeenCalledTimes(1);
    expect(mockUseListMyDocuments).toHaveBeenCalledWith(expect.objectContaining({
      query: expect.objectContaining({
        enabled: true,
        queryKey: ["/api/documents", "candidate-fixture"],
      }),
    }));

    fireEvent.press(screen.getByLabelText("Upload document"));
    await waitFor(() => expect(mockUploadDocument).toHaveBeenCalledWith(
      selected,
      expect.any(AbortSignal),
      expect.any(Function),
    ));
    await waitFor(() => expect(screen.getByText("Candidate-CV.pdf was uploaded.")).toBeTruthy());
    expect(mockCleanupStagedDocument).toHaveBeenCalledWith(selected);
    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ["/api/documents"] });
  });

  it("keeps a failed file available and retries the same upload", async () => {
    const selected = stagedFixture();
    mockPickDocument.mockResolvedValue(selected);
    mockUploadDocument
      .mockRejectedValueOnce(new Error("fixture network timeout"))
      .mockResolvedValueOnce(undefined);
    const screen = await render(<DocumentsScreen />);

    fireEvent.press(screen.getByLabelText("Choose a document"));
    await waitFor(() => expect(screen.getByText("Candidate-CV.pdf")).toBeTruthy());
    fireEvent.press(screen.getByLabelText("Upload document"));
    await waitFor(() => expect(screen.getByText("fixture network timeout")).toBeTruthy());

    fireEvent.press(screen.getByLabelText("Retry upload"));
    await waitFor(() => expect(mockUploadDocument).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText("Candidate-CV.pdf was uploaded.")).toBeTruthy());
    expect(mockUploadDocument.mock.calls[0]?.[0]).toBe(selected);
    expect(mockUploadDocument.mock.calls[1]?.[0]).toBe(selected);
  });

  it("shows real transfer progress while the upload is still in flight", async () => {
    const selected = stagedFixture();
    let finishUpload: (() => void) | null = null;
    mockPickDocument.mockResolvedValue(selected);
    mockUploadDocument.mockImplementation((_document, _signal, onProgress) => new Promise<void>((resolve) => {
      onProgress?.({ loaded: 512, total: 1024, percent: 50 });
      finishUpload = resolve;
    }));
    const screen = await render(<DocumentsScreen />);

    fireEvent.press(screen.getByLabelText("Choose a document"));
    await waitFor(() => expect(screen.getByText("Candidate-CV.pdf")).toBeTruthy());
    fireEvent.press(screen.getByLabelText("Upload document"));

    expect(await screen.findByLabelText("Upload progress")).toBeTruthy();
    expect(screen.getByText("50% sent · 512 B of 1 KB")).toBeTruthy();
    expect(mockUploadDocument).toHaveBeenCalledWith(
      selected,
      expect.any(AbortSignal),
      expect.any(Function),
    );

    await act(async () => {
      finishUpload?.();
    });
    await waitFor(() => expect(screen.getByText("Candidate-CV.pdf was uploaded.")).toBeTruthy());
  });

  it("aborts an in-flight upload when the candidate cancels it", async () => {
    const selected = stagedFixture();
    mockPickDocument.mockResolvedValue(selected);
    mockUploadDocument.mockImplementation((_document, signal) => new Promise<void>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("synthetic abort")));
    }));
    const screen = await render(<DocumentsScreen />);

    fireEvent.press(screen.getByLabelText("Choose a document"));
    await waitFor(() => expect(screen.getByText("Candidate-CV.pdf")).toBeTruthy());
    fireEvent.press(screen.getByLabelText("Upload document"));
    await waitFor(() => expect(screen.getByLabelText("Cancel upload")).toBeTruthy());
    const signal = mockUploadDocument.mock.calls[0]?.[1] as AbortSignal;

    fireEvent.press(screen.getByLabelText("Cancel upload"));
    await waitFor(() => expect(screen.getByText("Upload cancelled and its temporary copy was cleared.")).toBeTruthy());
    expect(signal.aborted).toBe(true);
    expect(mockCleanupStagedDocument).toHaveBeenCalledWith(selected);
  });

  it("pauses on background and keeps the selected file ready after returning", async () => {
    const selected = stagedFixture();
    let appStateListener: ((state: string) => void) | null = null;
    let attempts = 0;
    jest.spyOn(AppState, "addEventListener").mockImplementation((type, listener) => {
      if (type === "change") {
        appStateListener = listener as (state: string) => void;
      }
      return { remove: jest.fn() };
    });
    mockPickDocument.mockResolvedValue(selected);
    mockUploadDocument.mockImplementation((_document, signal) => {
      attempts += 1;
      if (attempts > 1) return Promise.resolve();
      return new Promise<void>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("fixture background abort")));
      });
    });
    const screen = await render(<DocumentsScreen />);

    fireEvent.press(screen.getByLabelText("Choose a document"));
    await waitFor(() => expect(screen.getByText("Candidate-CV.pdf")).toBeTruthy());
    fireEvent.press(screen.getByLabelText("Upload document"));
    await waitFor(() => expect(screen.getByLabelText("Cancel upload")).toBeTruthy());
    const signal = mockUploadDocument.mock.calls[0]?.[1] as AbortSignal;

    await act(async () => {
      appStateListener?.("background");
    });
    await waitFor(() => expect(screen.getByText(
      "Upload paused when JOBSAGE left the foreground. Return here and retry.",
    )).toBeTruthy());
    expect(signal.aborted).toBe(true);
    expect(screen.getByText("Candidate-CV.pdf")).toBeTruthy();

    await act(async () => {
      appStateListener?.("active");
    });
    fireEvent.press(screen.getByLabelText("Retry upload"));
    await waitFor(() => expect(mockUploadDocument).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText("Candidate-CV.pdf was uploaded.")).toBeTruthy());
    expect(mockUploadDocument.mock.calls[1]?.[0]).toBe(selected);
  });

  it("downloads/shares a listed private file and requires a second confirmation before deleting", async () => {
    mockDocumentQuery.data = { documents: [documentFixture] };
    const screen = await render(<DocumentsScreen />);
    expect(screen.getByText("Candidate-CV.pdf")).toBeTruthy();
    expect(screen.getByText("Primary CV · 1 KB")).toBeTruthy();

    fireEvent.press(screen.getByLabelText("Open or share"));
    await waitFor(() => expect(mockDownloadAndShare).toHaveBeenCalledWith({
      url: "/api/storage/objects/uploads/fixture-object",
      filename: "Candidate-CV.pdf",
      token: "candidate-fixture-token",
    }));

    await act(async () => {
      fireEvent.press(screen.getByLabelText("Delete"));
    });
    await waitFor(() => expect(screen.getByLabelText("Confirm delete")).toBeTruthy());
    expect(mockDeleteMutation).not.toHaveBeenCalled();
    fireEvent.press(screen.getByLabelText("Confirm delete"));
    await waitFor(() => expect(mockDeleteMutation).toHaveBeenCalledWith({ id: 17 }));
    await waitFor(() => expect(screen.getByText("Document deleted.")).toBeTruthy());
  });

  it("previews PDFs in the iOS viewer and clears only that temporary download when closed", async () => {
    mockDocumentQuery.data = { documents: [documentFixture] };
    const screen = await render(<DocumentsScreen />);

    fireEvent.press(screen.getByLabelText("View PDF"));
    await waitFor(() => expect(mockDownloadAndShare).toHaveBeenCalledWith({
      url: "/api/storage/objects/uploads/fixture-object",
      filename: "Candidate-CV.pdf",
      token: "candidate-fixture-token",
      share: false,
    }));
    expect(await screen.findByText("Private document preview")).toBeTruthy();

    fireEvent.press(screen.getByLabelText("Close PDF preview"));
    expect(mockCleanupTempDownload).toHaveBeenCalledWith("file:///fixture/CV.pdf", "candidate-fixture");
  });

  it("shows an error and retry action when the list cannot load", async () => {
    mockDocumentQuery.isError = true;
    const screen = await render(<DocumentsScreen />);
    expect(screen.getByText("Your documents could not be loaded.")).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByLabelText("Try again"));
    });
    expect(mockDocumentQuery.refetch).toHaveBeenCalledTimes(1);
  });
});
