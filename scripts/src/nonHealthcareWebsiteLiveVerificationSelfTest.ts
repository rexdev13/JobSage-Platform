import assert from "node:assert/strict";
import {
  assessLiveWebsiteIdentity,
  extractLinkedVerificationPages,
  isBlockedOrTimeoutError,
  hasTimeoutSignalInNotes,
  isTimeoutError,
  normalizedOrganisationName,
} from "./nonHealthcareWebsiteLiveVerificationLogic";
import type { PageResult } from "./sponsor-contact-discovery/http";

function page(url: string, body: string): PageResult {
  return { url, body, contentType: "text/html" };
}

function testLinkedPagesStayOnSiteAndInAllowedCategories(): void {
  const homepage = page(
    "https://alpha-example.test/",
    `<a href="/about-us">About us</a>
     <a href="/contact">Contact</a>
     <a href="/careers">Careers</a>
     <a href="https://jobs.other.test/alpha">Jobs</a>
     <a href="/news">News</a>
     <a href="mailto:info@alpha-example.test">Email</a>`,
  );
  const links = extractLinkedVerificationPages(homepage, "alpha-example.test");
  assert.deepEqual(
    links.map(({ kind }) => kind),
    ["about", "contact", "careers"],
  );
  assert.ok(links.every((link) => new URL(link.url).hostname === "alpha-example.test"));
}

function testHighEvidenceRequiresIdentityAndCorroboration(): void {
  const result = assessLiveWebsiteIdentity(
    {
      organisation_name: "Alpha Example Ltd",
      town_city: "Leeds",
      county: "West Yorkshire",
      region: "Yorkshire",
    },
    "alpha-example.test",
    "alpha-example.test",
    [
      {
        kind: "homepage",
        page: page(
          "https://alpha-example.test/",
          "<title>Alpha Example</title><h1>Alpha Example Ltd</h1><p>Leeds West Yorkshire</p>",
        ),
      },
    ],
  );
  assert.equal(result.verificationStatus, "upgraded");
  assert.equal(result.newConfidence, "high");
  assert.ok(result.signalsMatched.includes("town_county_or_region_corroborated_on_page"));
}

function testIdentityWithoutHighCorroborationStaysMedium(): void {
  const result = assessLiveWebsiteIdentity(
    {
      organisation_name: "Orion Nimbus Ltd",
      town_city: "Nottingham",
      county: "Nottinghamshire",
      region: "East Midlands",
    },
    "north-site.test",
    "north-site.test",
    [
      {
        kind: "homepage",
        page: page(
          "https://north-site.test/",
          "<title>Orion Nimbus</title><h1>Orion Nimbus Ltd</h1><p>Welcome.</p>",
        ),
      },
    ],
  );
  assert.equal(result.verificationStatus, "kept_medium");
  assert.equal(result.newConfidence, "medium");
}

function testExplicitStructuredIdentityConflictIsRejected(): void {
  const result = assessLiveWebsiteIdentity(
    {
      organisation_name: "Oak House Group",
      town_city: "Leeds",
      county: "West Yorkshire",
      region: "Yorkshire",
    },
    "oak-house.test",
    "oak-house.test",
    [
      {
        kind: "homepage",
        page: page(
          "https://oak-house.test/",
          `<script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Pine Tree Holdings Ltd"}</script><h1>Welcome</h1>`,
        ),
      },
    ],
  );
  assert.equal(result.verificationStatus, "rejected");
  assert.equal(result.newConfidence, "none");
  assert.ok(
    result.conflictsFound.includes(
      "homepage_structured_organization_name_does_not_match_employer",
    ),
  );
}

function testNoEvidenceRemainsInconclusive(): void {
  const result = assessLiveWebsiteIdentity(
    {
      organisation_name: "Silver Oak Ltd",
      town_city: "Leeds",
      county: "",
      region: "",
    },
    "silver-oak.test",
    "silver-oak.test",
    [
      {
        kind: "homepage",
        page: page("https://silver-oak.test/", "<h1>Welcome</h1><p>Our services.</p>"),
      },
    ],
  );
  assert.equal(result.verificationStatus, "inconclusive");
  assert.equal(result.newConfidence, "medium");
}

function testFailureAndNameHelpers(): void {
  assert.equal(isBlockedOrTimeoutError("robots.txt disallows this page"), true);
  assert.equal(isBlockedOrTimeoutError("redirect left the confirmed HTTPS employer domain"), true);
  assert.equal(isBlockedOrTimeoutError("HTTP 404"), false);
  assert.equal(isTimeoutError("HTTP 504"), true);
  assert.equal(isTimeoutError("robots.txt disallows this page"), false);
  assert.equal(hasTimeoutSignalInNotes("blocked_or_timeout=0"), false);
  assert.equal(hasTimeoutSignalInNotes("blocked_or_timeout=1; error: HTTP 403"), false);
  assert.equal(hasTimeoutSignalInNotes("fetch errors: HTTP 504"), true);
  assert.equal(hasTimeoutSignalInNotes("timeout_errors=1"), true);
  assert.equal(normalizedOrganisationName("  Alpha & Example, Ltd. "), "alpha and example ltd");
}

testLinkedPagesStayOnSiteAndInAllowedCategories();
testHighEvidenceRequiresIdentityAndCorroboration();
testIdentityWithoutHighCorroborationStaysMedium();
testExplicitStructuredIdentityConflictIsRejected();
testNoEvidenceRemainsInconclusive();
testFailureAndNameHelpers();
console.log("Non-healthcare live-verification self-tests passed.");