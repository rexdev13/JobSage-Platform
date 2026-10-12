import { describe, expect, it } from "vitest";
import { validateRegistryConfiguration } from "../../lib/accountDeletion/registryConfiguration";

const fixture = { appBucket: "fixture-app", registryBucket: "fixture-registry" };

describe("independent deletion registry configuration", () => {
  it("accepts a separate bucket outside normal serving and upload paths", () => {
    expect(validateRegistryConfiguration({
      ...fixture,
      publicSearchPaths: "/fixture-app/public,/fixture-assets/public",
      privateObjectDir: "/fixture-app/private",
    })).toEqual(fixture);
  });
  it.each([
    { appBucket: "", registryBucket: "fixture-registry" },
    { appBucket: "fixture-app", registryBucket: "" },
    { appBucket: "fixture-app", registryBucket: "fixture-app" },
    { appBucket: "fixture-app", registryBucket: "fixture-registry/private" },
  ])("rejects missing, shared or invalid buckets", config => {
    expect(() => validateRegistryConfiguration(config)).toThrow("independent_registry_not_configured");
  });
  it.each([
    "/fixture-registry/public",
    " /fixture-app/public, /fixture-registry/public ",
    "fixture-registry/public",
    "gs://fixture-registry/public",
    "/fixture-registry",
  ])("rejects a registry routed through public paths: %s", publicSearchPaths => {
    expect(() => validateRegistryConfiguration({ ...fixture, publicSearchPaths }))
      .toThrow("registry_in_application_storage_paths");
  });
  it("rejects a registry used for ordinary account uploads", () => {
    expect(() => validateRegistryConfiguration({ ...fixture, privateObjectDir: "/fixture-registry/private" }))
      .toThrow("registry_in_application_storage_paths");
  });
  it("uses exact bucket identities, not prefix matching", () => {
    expect(validateRegistryConfiguration({
      ...fixture,
      publicSearchPaths: "/fixture-registry-other/public",
    })).toEqual(fixture);
  });
});
