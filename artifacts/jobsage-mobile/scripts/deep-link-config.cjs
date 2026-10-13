const fs = require("node:fs");
const path = require("node:path");

const TEMPLATE_DIR = path.resolve(__dirname, "../links");
const REQUIRED_VARIABLES = [
  "JOBSAGE_PUBLIC_DOMAIN",
  "JOBSAGE_IOS_BUNDLE_ID",
  "JOBSAGE_IOS_TEAM_ID",
  "JOBSAGE_ANDROID_APPLICATION_ID",
  "JOBSAGE_ANDROID_SHA256_CERT_FINGERPRINTS",
];

function missingVariables(env) {
  return REQUIRED_VARIABLES.filter((name) => !String(env[name] || "").trim());
}

function validateDomain(value) {
  const domain = String(value || "").trim().toLowerCase();
  if (!domain || domain.includes("://") || /[/?#:@\s\\]/.test(domain)) {
    throw new Error("JOBSAGE_PUBLIC_DOMAIN must be a hostname only, without a protocol, port, path, or credentials.");
  }
  let parsed;
  try {
    parsed = new URL(`https://${domain}`);
  } catch {
    throw new Error("JOBSAGE_PUBLIC_DOMAIN is not a valid public hostname.");
  }
  if (parsed.hostname !== domain || parsed.origin !== `https://${domain}` || domain === "localhost") {
    throw new Error("JOBSAGE_PUBLIC_DOMAIN must be a public HTTPS hostname without a port.");
  }
  return domain;
}

function validatePackageId(value, variableName) {
  const packageId = String(value || "").trim();
  if (!/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+$/.test(packageId)) {
    throw new Error(`${variableName} must be a fully qualified application identifier, for example com.example.app.`);
  }
  return packageId;
}

function validateTeamId(value) {
  const teamId = String(value || "").trim().toUpperCase();
  if (!/^[A-Z0-9]{10}$/.test(teamId)) {
    throw new Error("JOBSAGE_IOS_TEAM_ID must be the 10-character Apple Developer Team ID.");
  }
  return teamId;
}

function parseFingerprints(value) {
  const fingerprints = String(value || "")
    .split(",")
    .map((fingerprint) => fingerprint.trim().toUpperCase())
    .filter(Boolean);
  if (fingerprints.length === 0 || fingerprints.some((fingerprint) => !/^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$/.test(fingerprint))) {
    throw new Error("JOBSAGE_ANDROID_SHA256_CERT_FINGERPRINTS must contain one or more colon-separated SHA-256 certificate fingerprints.");
  }
  return [...new Set(fingerprints)];
}

function resolveUniversalLinkConfig(env = process.env, options = {}) {
  const missing = missingVariables(env);
  if (missing.length === REQUIRED_VARIABLES.length) {
    if (options.required) {
      throw new Error(`Universal/App Links are not configured. Set: ${REQUIRED_VARIABLES.join(", ")}.`);
    }
    return null;
  }
  if (missing.length > 0) {
    throw new Error(`Universal/App Links configuration is incomplete. Missing: ${missing.join(", ")}.`);
  }

  return {
    domain: validateDomain(env.JOBSAGE_PUBLIC_DOMAIN),
    iosBundleId: validatePackageId(env.JOBSAGE_IOS_BUNDLE_ID, "JOBSAGE_IOS_BUNDLE_ID"),
    iosTeamId: validateTeamId(env.JOBSAGE_IOS_TEAM_ID),
    androidApplicationId: validatePackageId(env.JOBSAGE_ANDROID_APPLICATION_ID, "JOBSAGE_ANDROID_APPLICATION_ID"),
    androidFingerprints: parseFingerprints(env.JOBSAGE_ANDROID_SHA256_CERT_FINGERPRINTS),
  };
}

function applyUniversalLinkConfig(config, env = process.env) {
  const profile = String(env.EAS_BUILD_PROFILE || "").trim().toLowerCase();
  const links = resolveUniversalLinkConfig(env, { required: profile === "production" });
  if (!links) return config;

  return {
    ...config,
    ios: {
      ...config.ios,
      bundleIdentifier: links.iosBundleId,
      appleTeamId: links.iosTeamId,
      associatedDomains: [
        ...(config.ios?.associatedDomains || []).filter((entry) => entry !== `applinks:${links.domain}`),
        `applinks:${links.domain}`,
      ],
    },
    android: {
      ...config.android,
      package: links.androidApplicationId,
      intentFilters: [
        ...(config.android?.intentFilters || []).filter((filter) =>
          !(filter.autoVerify && filter.data?.some((item) => item.host === links.domain)),
        ),
        {
          action: "VIEW",
          autoVerify: true,
          category: ["BROWSABLE", "DEFAULT"],
          data: [{ scheme: "https", host: links.domain, pathPrefix: "/" }],
        },
      ],
    },
  };
}

function renderTemplate(filename, substitutions) {
  let text = fs.readFileSync(path.join(TEMPLATE_DIR, filename), "utf8");
  for (const [key, value] of Object.entries(substitutions)) {
    text = text.replaceAll(`{{${key}}}`, value);
  }
  if (/\{\{[^}]+\}\}/.test(text)) throw new Error(`Unresolved placeholder in ${filename}.`);
  return `${JSON.stringify(JSON.parse(text), null, 2)}\n`;
}

function buildAssociationDocuments(links) {
  const apple = renderTemplate("apple-app-site-association.template.json", {
    IOS_APP_ID: `${links.iosTeamId}.${links.iosBundleId}`,
  });
  const android = renderTemplate("assetlinks.template.json", {
    ANDROID_APPLICATION_ID: links.androidApplicationId,
    ANDROID_FINGERPRINTS_JSON: JSON.stringify(links.androidFingerprints),
  });
  return {
    "apple-app-site-association": apple,
    "assetlinks.json": android,
  };
}

module.exports = {
  REQUIRED_VARIABLES,
  applyUniversalLinkConfig,
  buildAssociationDocuments,
  parseFingerprints,
  resolveUniversalLinkConfig,
};
