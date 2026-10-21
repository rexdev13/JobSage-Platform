import { afterEach, describe, expect, it, vi } from "vitest";
import { uploadIdentityFile } from "./identityUpload";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("uploadIdentityFile", () => {
  it("sends the metadata required to request a private upload URL, then uploads the file", async () => {
    const file = new File(["passport image"], "passport.jpg", { type: "image/jpeg" });
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        uploadURL: "https://storage.example.test/upload?signature=test",
        storageKey: "/objects/uploads/verification-file",
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(uploadIdentityFile(file, "")).resolves.toBe("/objects/uploads/verification-file");

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/storage/uploads/request-url", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "passport.jpg",
        size: file.size,
        contentType: "image/jpeg",
      }),
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, "https://storage.example.test/upload?signature=test", {
      method: "PUT",
      body: file,
      headers: { "Content-Type": "image/jpeg" },
    });
  });

  it("shows the server's upload-URL error instead of masking it", async () => {
    const file = new File(["passport image"], "passport.jpg", { type: "image/jpeg" });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(
      JSON.stringify({ error: "File exceeds maximum size of 5 MB." }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);

    await expect(uploadIdentityFile(file, "/jobsage-web")).rejects.toThrow(
      "File exceeds maximum size of 5 MB.",
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
