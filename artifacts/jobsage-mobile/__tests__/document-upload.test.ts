import { afterAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { Platform } from "react-native";
import type { DocumentPickerResult } from "expo-document-picker";

const mockFiles = new Map<string, boolean>();
const mockDirectories = new Set<string>();
const mockGetDocumentAsync = jest.fn<(...args: unknown[]) => Promise<DocumentPickerResult>>();
let mockNetworkState = { isConnected: true, isInternetReachable: true };
let mockUuid = 0;
let mockXhrStatus = 201;
let mockXhrResponseText = "{}";
let mockXhrProgress = { lengthComputable: true, loaded: 90, total: 300 };
const mockXhrInstances: MockXMLHttpRequest[] = [];

class MockXMLHttpRequest {
  method = "";
  url = "";
  async = false;
  timeout = 0;
  status = 0;
  statusText = "";
  responseText = "";
  requestBody: unknown;
  aborted = false;
  readonly requestHeaders = new Map<string, string>();
  readonly upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };
  onload: ((event: ProgressEvent) => void) | null = null;
  onerror: ((event: ProgressEvent) => void) | null = null;
  onabort: ((event: ProgressEvent) => void) | null = null;
  ontimeout: ((event: ProgressEvent) => void) | null = null;

  constructor() {
    mockXhrInstances.push(this);
  }

  open(method: string, url: string, async: boolean) {
    this.method = method;
    this.url = url;
    this.async = async;
  }

  setRequestHeader(name: string, value: string) {
    this.requestHeaders.set(name.toLowerCase(), value);
  }

  send(body: unknown) {
    this.requestBody = body;
    this.upload.onprogress?.(mockXhrProgress as ProgressEvent);
    queueMicrotask(() => {
      if (this.aborted) return;
      this.status = mockXhrStatus;
      this.statusText = mockXhrStatus === 201 ? "Created" : "Error";
      this.responseText = mockXhrResponseText;
      this.onload?.({} as ProgressEvent);
    });
  }

  abort() {
    this.aborted = true;
    this.onabort?.({} as ProgressEvent);
  }

  getAllResponseHeaders() {
    return "content-type: application/json\r\n";
  }
}

const originalXhr = globalThis.XMLHttpRequest;

jest.mock("expo-file-system", () => {
  class Directory {
    uri: string;
    constructor(...parts: Array<string | { uri: string }>) {
      this.uri = parts.map((part) => typeof part === "string" ? part : part.uri).join("/");
    }
    get exists() {
      return [...mockDirectories].some((path) => path === this.uri || path.startsWith(`${this.uri}/`))
        || [...mockFiles.keys()].some((path) => path.startsWith(`${this.uri}/`));
    }
    create() {
      mockDirectories.add(this.uri);
    }
    delete() {
      for (const path of mockFiles.keys()) {
        if (path.startsWith(`${this.uri}/`)) mockFiles.delete(path);
      }
      for (const path of mockDirectories) {
        if (path === this.uri || path.startsWith(`${this.uri}/`)) mockDirectories.delete(path);
      }
    }
  }

  class File extends Blob {
    uri: string;
    name: string;
    constructor(...parts: Array<string | { uri: string }>) {
      super(["synthetic document bytes"], { type: "application/pdf" });
      this.uri = parts.map((part) => typeof part === "string" ? part : part.uri).join("/");
      this.name = this.uri.split("/").pop() ?? "fixture.pdf";
    }
    get exists() {
      return mockFiles.has(this.uri);
    }
    copy(destination: File) {
      mockFiles.set(destination.uri, true);
    }
  }

  return { Directory, File, Paths: { cache: "file:///fixture-cache" } };
});

jest.mock("expo-document-picker", () => ({
  getDocumentAsync: (...args: unknown[]) => mockGetDocumentAsync(...args),
}));

jest.mock("expo-crypto", () => ({
  randomUUID: () => `upload-fixture-${++mockUuid}`,
}));

jest.mock("expo-network", () => ({
  getNetworkStateAsync: async () => mockNetworkState,
}));

import { setAuthTokenGetter, setBaseUrl } from "@workspace/api-client-react";
import {
  cleanupInterruptedDocumentUploads,
  cleanupStagedDocument,
  MAX_DOCUMENT_UPLOAD_BYTES,
  pickAndStageDocument,
  uploadStagedDocument,
  type StagedDocument,
} from "@/lib/document-upload";

const originalFetch = global.fetch;
const originalPlatform = Platform.OS;

function setPlatform(os: string) {
  Object.defineProperty(Platform, "OS", { configurable: true, value: os });
}

function nativePickerResult(
  overrides: Partial<{ name: string; mimeType: string; size: number; uri: string }> = {},
) : DocumentPickerResult {
  return {
    canceled: false,
    assets: [{
      name: overrides.name ?? "Candidate-CV.pdf",
      mimeType: overrides.mimeType ?? "application/pdf",
      size: overrides.size ?? 128,
      uri: overrides.uri ?? "content://picker/candidate-cv.pdf",
    }],
  } as DocumentPickerResult;
}

function stagedFixture(file = new Blob(["synthetic CV"], { type: "application/pdf" })): StagedDocument {
  return {
    filename: "Candidate-CV.pdf",
    mimeType: "application/pdf",
    size: file.size,
    file,
    stagingDirectoryUri: null,
  };
}

beforeEach(() => {
  mockFiles.clear();
  mockDirectories.clear();
  mockGetDocumentAsync.mockReset();
  mockNetworkState = { isConnected: true, isInternetReachable: true };
  mockUuid = 0;
  mockXhrStatus = 201;
  mockXhrResponseText = "{}";
  mockXhrProgress = { lengthComputable: true, loaded: 90, total: 300 };
  mockXhrInstances.length = 0;
  Object.defineProperty(globalThis, "XMLHttpRequest", {
    configurable: true,
    writable: true,
    value: MockXMLHttpRequest as unknown as typeof XMLHttpRequest,
  });
  setPlatform("ios");
  setBaseUrl("https://fixture.jobsage.example");
  setAuthTokenGetter(() => "fixture-candidate-token");
  global.fetch = jest.fn() as unknown as typeof fetch;
});

afterAll(() => {
  cleanupInterruptedDocumentUploads();
  setBaseUrl("");
  setAuthTokenGetter(() => null);
  setPlatform(originalPlatform);
  global.fetch = originalFetch;
  Object.defineProperty(globalThis, "XMLHttpRequest", {
    configurable: true,
    writable: true,
    value: originalXhr,
  });
});

describe("native document picking and private staging", () => {
  it("returns null on picker cancellation without creating a staged file", async () => {
    mockGetDocumentAsync.mockResolvedValue({ canceled: true, assets: null } as DocumentPickerResult);
    await expect(pickAndStageDocument()).resolves.toBeNull();
    expect(mockFiles.size).toBe(0);
  });

  it("copies a valid native file into app-owned cache and removes it on cleanup", async () => {
    mockGetDocumentAsync.mockResolvedValue(nativePickerResult());
    const selected = await pickAndStageDocument();

    expect(selected).not.toBeNull();
    expect(selected?.filename).toBe("Candidate-CV.pdf");
    expect(selected?.mimeType).toBe("application/pdf");
    expect(selected?.stagingDirectoryUri).toContain("jobsage-document-uploads");
    expect(mockFiles.has((selected?.file as Blob & { uri: string }).uri)).toBe(true);

    cleanupStagedDocument(selected!);
    expect(mockFiles.size).toBe(0);
  });

  it("removes interrupted staged files at startup", async () => {
    mockGetDocumentAsync.mockResolvedValue(nativePickerResult());
    await pickAndStageDocument();
    expect(mockFiles.size).toBe(1);

    cleanupInterruptedDocumentUploads();
    expect(mockFiles.size).toBe(0);
    expect(mockDirectories.size).toBe(0);
  });

  it("rejects unsupported extensions and oversize files before staging", async () => {
    mockGetDocumentAsync.mockResolvedValue(nativePickerResult({ name: "payload.exe" }));
    await expect(pickAndStageDocument()).rejects.toThrow("Choose a PDF");
    expect(mockFiles.size).toBe(0);

    mockGetDocumentAsync.mockResolvedValue(
      nativePickerResult({ size: MAX_DOCUMENT_UPLOAD_BYTES + 1 }),
    );
    await expect(pickAndStageDocument()).rejects.toThrow("smaller than 5 MB");
    expect(mockFiles.size).toBe(0);
  });

  it("uses the browser-picked File without creating a native cache copy on web", async () => {
    setPlatform("web");
    const browserFile = new Blob(["browser CV"], { type: "application/pdf" });
    mockGetDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{
        name: "browser-cv.pdf",
        mimeType: "application/pdf",
        size: browserFile.size,
        uri: "blob:fixture",
        file: browserFile,
      }],
    } as DocumentPickerResult);

    const selected = await pickAndStageDocument();
    expect(selected?.file).toBe(browserFile);
    expect(selected?.stagingDirectoryUri).toBeNull();
    expect(mockFiles.size).toBe(0);
  });
});

describe("generated multipart API upload transport", () => {
  it("uses XHR for real transfer progress while retaining generated endpoint and bearer auth", async () => {
    const savedDocument = {
      id: 7,
      userId: "fixture-candidate",
      filename: "Candidate-CV.pdf",
      mimeType: "application/pdf",
      storageKey: "/objects/uploads/fixture-object",
      fileSize: 13,
      documentType: "cv",
      label: null,
      isPrimary: false,
      disclaimerText: "fixture",
      uploadedAt: "2026-10-14T00:00:00.000Z",
    };
    mockXhrResponseText = JSON.stringify(savedDocument);
    const reportedProgress: Array<{ loaded: number; total: number; percent: number }> = [];

    await expect(
      uploadStagedDocument(
        stagedFixture(),
        new AbortController().signal,
        (progress) => reportedProgress.push(progress),
      ),
    ).resolves.toMatchObject({ id: 7, filename: "Candidate-CV.pdf" });

    expect(mockXhrInstances).toHaveLength(1);
    const request = mockXhrInstances[0]!;
    expect(request.url).toBe("https://fixture.jobsage.example/api/documents/upload");
    expect(request.method).toBe("POST");
    expect(request.requestHeaders.get("authorization")).toBe("Bearer fixture-candidate-token");
    expect(request.requestHeaders.has("content-type")).toBe(false);
    expect(request.requestBody).toBeInstanceOf(FormData);
    expect((request.requestBody as FormData).get("file")).toBeInstanceOf(Blob);
    expect(reportedProgress).toEqual([{ loaded: 90, total: 300, percent: 30 }]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("blocks offline uploads before transport and allows the same staged file to retry", async () => {
    const selected = stagedFixture();
    mockNetworkState = { isConnected: false, isInternetReachable: false };

    await expect(uploadStagedDocument(selected, new AbortController().signal))
      .rejects.toThrow("offline");
    expect(mockXhrInstances).toHaveLength(0);

    mockNetworkState = { isConnected: true, isInternetReachable: true };
    mockXhrResponseText = "{}";
    await expect(uploadStagedDocument(selected, new AbortController().signal)).resolves.toEqual({});
    expect(selected.size).toBeGreaterThan(0);
  });

  it("does not make a request when the user has already cancelled", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(uploadStagedDocument(stagedFixture(), controller.signal))
      .rejects.toThrow("Upload cancelled");
    expect(mockXhrInstances).toHaveLength(0);
  });
});
