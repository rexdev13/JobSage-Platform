const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  applyUniversalLinkConfig,
  buildAssociationDocuments,
  parseFingerprints,
  resolveUniversalLinkConfig,
} = require("../scripts/deep-link-config.cjs");
const { removeGeneratedFiles, writeAssociationFiles } = require("../scripts/generate-associations.cjs");

const fingerprint = `01:${"02:".repeat(30)}03`;
const completeEnv = {
  JOBSAGE_PUBLIC_DOMAIN: "jobsage.example",
  JOBSAGE_IOS_BUNDLE_ID: "com.example.jobsage",
  JOBSAGE_IOS_TEAM_ID: "A1B2C3D4E5",
  JOBSAGE_ANDROID_APPLICATION_ID: "com.example.jobsage",
  JOBSAGE_ANDROID_SHA256_CERT_FINGERPRINTS: fingerprint,
};

describe("native Universal/App Links configuration", () => {
  it("omits links in non-production configurations until owner values exist", () => {
    const base = { name: "JOBSAGE", scheme: "jobsage-mobile", ios: {}, android: {} };
    expect(applyUniversalLinkConfig(base, {})).toBe(base);
  });

  it("fails production configuration with a precise list of missing owner values", () => {
    expect(() => applyUniversalLinkConfig({ name: "JOBSAGE" }, { EAS_BUILD_PROFILE: "production" }))
      .toThrow(/JOBSAGE_PUBLIC_DOMAIN.*JOBSAGE_IOS_BUNDLE_ID.*JOBSAGE_ANDROID_SHA256_CERT_FINGERPRINTS/);
  });

  it("adds matching iOS and Android domain associations when all owner values are present", () => {
    const config = applyUniversalLinkConfig(
      { name: "JOBSAGE", ios: { supportsTablet: false }, android: { versionCode: 1 } },
      { ...completeEnv, EAS_BUILD_PROFILE: "production" },
    );
    expect(config.ios.bundleIdentifier).toBe("com.example.jobsage");
    expect(config.ios.appleTeamId).toBe("A1B2C3D4E5");
    expect(config.ios.associatedDomains).toEqual(["applinks:jobsage.example"]);
    expect(config.android.package).toBe("com.example.jobsage");
    expect(config.android.intentFilters).toEqual([{
      action: "VIEW",
      autoVerify: true,
      category: ["BROWSABLE", "DEFAULT"],
      data: [{ scheme: "https", host: "jobsage.example", pathPrefix: "/" }],
    }]);
  });

  it("rejects partial, malformed and duplicate certificate configuration", () => {
    expect(() => resolveUniversalLinkConfig({ ...completeEnv, JOBSAGE_IOS_TEAM_ID: "" }))
      .toThrow(/JOBSAGE_IOS_TEAM_ID/);
    expect(() => resolveUniversalLinkConfig({ ...completeEnv, JOBSAGE_PUBLIC_DOMAIN: "https://jobsage.example/path" }))
      .toThrow(/hostname only/);
    expect(parseFingerprints(`${fingerprint},${fingerprint}`)).toEqual([fingerprint]);
    expect(() => parseFingerprints("not-a-certificate")).toThrow(/SHA-256/);
  });

  it("renders owner values into the association documents without unresolved placeholders", () => {
    const links = resolveUniversalLinkConfig(completeEnv, { required: true });
    const documents = buildAssociationDocuments(links);
    const apple = JSON.parse(documents["apple-app-site-association"]);
    const android = JSON.parse(documents["assetlinks.json"]);
    expect(apple.applinks.details[0].appID).toBe("A1B2C3D4E5.com.example.jobsage");
    expect(android[0].target.package_name).toBe("com.example.jobsage");
    expect(android[0].target.sha256_cert_fingerprints).toEqual([fingerprint]);
    expect(JSON.stringify(documents)).not.toContain("{{");
  });

  it("removes only untouched generated files when configuration is withdrawn", () => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "jobsage-links-"));
    const outputDirectory = path.join(temporaryRoot, "public", ".well-known");
    const manifestPath = path.join(temporaryRoot, "generated-manifest.json");
    try {
      const links = resolveUniversalLinkConfig(completeEnv, { required: true });
      writeAssociationFiles(links, outputDirectory, manifestPath);
      fs.writeFileSync(path.join(outputDirectory, "assetlinks.json"), "owner-edited", "utf8");
      removeGeneratedFiles(outputDirectory, manifestPath);
      expect(fs.existsSync(path.join(outputDirectory, "apple-app-site-association"))).toBe(false);
      expect(fs.readFileSync(path.join(outputDirectory, "assetlinks.json"), "utf8")).toBe("owner-edited");
      expect(fs.existsSync(manifestPath)).toBe(false);
    } finally {
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });
});
