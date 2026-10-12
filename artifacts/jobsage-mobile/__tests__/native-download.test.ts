import { afterAll, beforeEach, describe, expect, it, jest } from "@jest/globals";

const mockFiles = new Map<string, Uint8Array>();
const mockDirectories = new Set<string>();
let mockOwner = "candidate-a";
let mockToken = "fixture-token-a";
const fixtureUrl = "https://fixture.jobsage.example/api/document";

jest.mock("expo-file-system", () => ({
  Paths: { cache: "file:///fixture-cache" },
  Directory: class {
    uri: string;
    constructor(...parts: Array<string | { uri: string }>) {
      this.uri = parts.map(p => typeof p === "string" ? p : p.uri).join("/");
    }
    get exists() { return mockDirectories.has(this.uri); }
    create() { mockDirectories.add(this.uri); }
    delete() {
      for (const path of mockFiles.keys()) if (path.startsWith(this.uri + "/")) mockFiles.delete(path);
      mockDirectories.delete(this.uri);
    }
  },
  File: class {
    uri: string;
    constructor(...parts: Array<string | { uri: string }>) {
      this.uri = parts.map(p => typeof p === "string" ? p : p.uri).join("/");
    }
    get exists() { return mockFiles.has(this.uri); }
    create() { mockFiles.set(this.uri, new Uint8Array()); }
    write(bytes: Uint8Array) { mockFiles.set(this.uri, bytes); }
    delete() { mockFiles.delete(this.uri); }
  },
}));
jest.mock("expo-crypto", () => {
  let counter = 0;
  return {
    getRandomBytesAsync: jest.fn(async () => new Uint8Array(32)),
    digestStringAsync: jest.fn(async () => "a".repeat(64)),
    CryptoDigestAlgorithm: { SHA256: "SHA256" },
    randomUUID: () => `fixture-${++counter}`,
  };
});
jest.mock("expo-sharing", () => ({
  isAvailableAsync: jest.fn(async () => true), shareAsync: jest.fn(async () => undefined),
}));
jest.mock("@workspace/api-client-react", () => ({
  createMobileSessionGrant: jest.fn(async () => ({ code: "b".repeat(64) })),
}));
jest.mock("@/context/AuthContext", () => ({
  getNativeSessionToken: () => mockToken,
  getNativeSessionUserId: () => mockOwner,
}));
jest.mock("@/lib/workspace-config", () => ({
  resolveFirstPartyUrl: (url: string) => url.startsWith("https://fixture.jobsage.example/") ? url : null,
  isFirstPartyUrl: (url: string) => url.startsWith("https://fixture.jobsage.example/"),
}));

import { cleanupTempDownloads, cleanupPrivateExportFiles, downloadAndShare, safeFilename } from "@/lib/native-download";
import { createMobileSessionGrant } from "@workspace/api-client-react";
import { shareAsync } from "expo-sharing";

const originalFetch = global.fetch;
function responseFixture(contentType = "application/pdf"): Response {
  return {
    url: fixtureUrl, ok: true, status: 200,
    headers: { get: (name: string) => name === "content-type" ? contentType : null },
    arrayBuffer: async () => new Uint8Array([37, 80, 68, 70]).buffer,
  } as unknown as Response;
}
beforeEach(() => {
  cleanupTempDownloads();
  mockFiles.clear();
  mockDirectories.clear();
  cleanupPrivateExportFiles();
  mockOwner = "candidate-a";
  mockToken = "fixture-token-a";
  jest.clearAllMocks();
  global.fetch = jest.fn(async () => responseFixture()) as typeof fetch;
});
afterAll(() => { cleanupTempDownloads(); global.fetch = originalFetch; });

describe("native download cache isolation", () => {
  it("posts private export verification only to the first-party export endpoint and removes the temporary archive after sharing", async () => {
    global.fetch = jest.fn(async () => responseFixture("application/zip")) as typeof fetch;
    const result = await downloadAndShare({
      url: "https://fixture.jobsage.example/api/privacy/export", filename: "JOBSAGE-personal-data.zip", token: mockToken,
      privateExport: { expectedAccountId: "candidate-a", password: "fixture-password", confirmed: true },
    });
    expect(createMobileSessionGrant).toHaveBeenCalledWith(expect.objectContaining({ nextPath: "/privacy-settings" }), expect.any(Object));
    expect(global.fetch).toHaveBeenLastCalledWith("https://fixture.jobsage.example/api/privacy/export", expect.objectContaining({
      method: "POST", redirect: "error", credentials: "include",
      headers: expect.objectContaining({ "x-jobsage-privacy-account": "candidate-a", "Origin": "https://fixture.jobsage.example" }),
      body: JSON.stringify({ expectedAccountId: "candidate-a", password: "fixture-password", confirmed: true }),
    }));
    expect(result.filename).toBe("JOBSAGE-personal-data.zip");
    expect(mockFiles.has(result.uri)).toBe(false);
  });
  it("blocks a different-account or non-export password request before creating a grant", async () => {
    await expect(downloadAndShare({
      url: fixtureUrl, token: mockToken,
      privateExport: { expectedAccountId: "candidate-b", password: "fixture-password", confirmed: true },
    })).rejects.toThrow("signed-in account");
    expect(createMobileSessionGrant).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });
  it("never shares a successful non-ZIP response as a private export", async () => {
    await expect(downloadAndShare({
      url: "https://fixture.jobsage.example/api/privacy/export", token: mockToken,
      privateExport: { expectedAccountId: "candidate-a", password: "fixture-password", confirmed: true },
    })).rejects.toThrow("not a ZIP archive");
    expect(mockFiles.size).toBe(0);
  });
  it("clears its private archive when the share operation fails or is interrupted", async () => {
    global.fetch = jest.fn(async () => responseFixture("application/zip")) as typeof fetch;
    jest.mocked(shareAsync).mockRejectedValueOnce(new Error("fixture share interruption"));
    await expect(downloadAndShare({
      url: "https://fixture.jobsage.example/api/privacy/export", token: mockToken,
      privateExport: { expectedAccountId: "candidate-a", password: "fixture-password", confirmed: true },
    })).rejects.toThrow("fixture share interruption");
    expect(mockFiles.size).toBe(0);
  });
  it("keeps concurrent documents with the same friendly name separate", async () => {
    const options = { url: fixtureUrl, token: mockToken, filename: "CV.pdf", share: false };
    const [first, second] = await Promise.all([downloadAndShare(options), downloadAndShare(options)]);
    expect(first.filename).toBe("CV.pdf");
    expect(second.filename).toBe("CV.pdf");
    expect(first.uri).not.toBe(second.uri);
    expect(mockFiles.has(first.uri)).toBe(true);
    expect(mockFiles.has(second.uri)).toBe(true);
  });

  it("does not delete the new account's files when the previous account is cleaned", async () => {
    const first = await downloadAndShare({ url: fixtureUrl, token: mockToken, share: false });
    mockOwner = "candidate-b";
    mockToken = "fixture-token-b";
    const second = await downloadAndShare({ url: fixtureUrl, token: mockToken, share: false });
    cleanupTempDownloads("candidate-a");
    expect(mockFiles.has(first.uri)).toBe(false);
    expect(mockFiles.has(second.uri)).toBe(true);
    cleanupTempDownloads("candidate-b");
    expect(mockFiles.has(second.uri)).toBe(false);
  });

  it("blocks stale credentials before requesting a grant", async () => {
    await expect(downloadAndShare({ url: fixtureUrl, token: "previous-fixture-token", share: false }))
      .rejects.toThrow("sign in again");
    expect(createMobileSessionGrant).not.toHaveBeenCalled();
  });

  it("uses the captured bearer only on the first-party grant, not the file request", async () => {
    await downloadAndShare({ url: fixtureUrl, token: mockToken, share: false });
    expect(createMobileSessionGrant).toHaveBeenCalledWith(expect.any(Object),
      expect.objectContaining({ headers: { Authorization: "Bearer fixture-token-a" } }));
    expect(global.fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    }));
  });

  it("does not save a response after the account changes", async () => {
    global.fetch = jest.fn(async () => ({
      ...responseFixture(),
      arrayBuffer: async () => {
        mockOwner = "candidate-b"; mockToken = "fixture-token-b";
        return new Uint8Array([37, 80, 68, 70]).buffer;
      },
    })) as typeof fetch;
    await expect(downloadAndShare({ url: fixtureUrl, token: mockToken, share: false }))
      .rejects.toThrow("account changed");
    expect(mockFiles.size).toBe(0);
  });
});

describe("native filenames", () => {
  it.each(["../CV.pdf", "..\\CV.pdf", "CV%23.pdf", "CV#name.pdf", "CV\u202ename.pdf"])(
    "removes path, encoded-URI and direction-control hazards: %s", filename => {
      expect(safeFilename(filename)).not.toMatch(/[%#\\/\u202a-\u202e\u2066-\u2069]/);
      expect(safeFilename(filename)).toMatch(/\.pdf$/);
    },
  );
  it("falls back for unsupported executable extensions", () => {
    expect(safeFilename("application.exe")).toBe("JOBSAGE-download.pdf");
  });
});
