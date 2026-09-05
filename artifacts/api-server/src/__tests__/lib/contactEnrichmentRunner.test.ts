import { describe, expect, it } from "vitest";
import {
  citedWebsiteFromResponse,
  corroboratesEmployer,
  extractPublishedContactEmails,
  getContactWebSearchDailyCap,
} from "../../lib/contactEnrichmentRunner";

describe("extractPublishedContactEmails", () => {
  it("uses published mailto/plain-text addresses and prioritises recruitment", () => {
    const emails = extractPublishedContactEmails(
      '<a href="mailto:info@acme.co.uk">Contact</a> Careers: careers@acme.co.uk',
      "https://acme.co.uk/",
    );
    expect(emails).toEqual(["info@acme.co.uk", "careers@acme.co.uk"]);
  });

  it("rejects free-provider and no-reply addresses rather than guessing", () => {
    expect(extractPublishedContactEmails(
      "Email jane@gmail.com, noreply@acme.co.uk, or no-reply@acme.co.uk",
      "https://acme.co.uk/",
    )).toEqual([]);
  });

  it("accepts a third-party address only when visibly published on the official page", () => {
    expect(extractPublishedContactEmails(
      '<p>Recruitment enquiries: <a href="mailto:jobs@managed-service.co.uk">jobs@managed-service.co.uk</a></p>',
      "https://acme.co.uk/",
    )).toEqual(["jobs@managed-service.co.uk"]);
  });

  it("rejects third-party vendor footer emails but accepts recruitment mailto", () => {
    expect(extractPublishedContactEmails(
      'Site by support@agency.example <a href="mailto:jobs@agency.example">recruitment</a>',
      "https://acme.co.uk/",
    )).toEqual(["jobs@agency.example"]);
  });
});

describe("official website lookup guards", () => {
  it("requires the URL written in output_text to have an exact-host URL citation", () => {
    const response = { output: [{ content: [{ annotations: [{ type: "url_citation", url: "https://www.acme.co.uk/about" }] }] }] };
    expect(citedWebsiteFromResponse("https://www.acme.co.uk", response)).toBe("https://www.acme.co.uk/");
    expect(citedWebsiteFromResponse("https://acme.co.uk", response)).toBeNull();
  });

  it("does not select an arbitrary citation and blocks directory/ATS URLs", () => {
    const response = { output: [{ content: [{ annotations: [{ type: "url_citation", url: "https://linkedin.com/company/acme" }] }] }] };
    expect(citedWebsiteFromResponse("https://acme.co.uk", response)).toBeNull();
    expect(citedWebsiteFromResponse("https://linkedin.com/company/acme", response)).toBeNull();
    const ats = { output: [{ content: [{ annotations: [{ type: "url_citation", url: "https://acme.greenhouse.io/jobs" }] }] }] };
    expect(citedWebsiteFromResponse("https://acme.greenhouse.io/jobs", ats)).toBeNull();
  });

  it("rejects weak generic identity matches and accepts a distinctive brand", () => {
    expect(corroboratesEmployer("<title>Care Limited</title><p>Care services</p>", "Acme Care Limited")).toBe(false);
    expect(corroboratesEmployer("<title>Welcome to Acme Care</title><h1>Acme Care</h1>", "Acme Care Limited")).toBe(true);
  });

  it("keeps contact web search independently and conservatively capped", () => {
    expect(getContactWebSearchDailyCap(undefined)).toBe(50);
    expect(getContactWebSearchDailyCap("500")).toBe(100);
    expect(getContactWebSearchDailyCap("0")).toBe(0);
    expect(getContactWebSearchDailyCap("invalid")).toBe(0);
  });
});