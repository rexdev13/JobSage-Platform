import { describe, expect, it } from "vitest";
import {
  citedWebsiteFromResponse,
  chooseStoredContactCandidate,
  corroboratesEmployer,
  extractPublishedContactEmails,
  getContactWebSearchDailyCap,
  shouldRunPaidContactEnrichment,
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

describe("stored contact harvest", () => {
  it("prefers an explicit vacancy contact field on a current vacancy", () => {
    expect(chooseStoredContactCandidate([{
      contactEmail: "jobs@acme.example",
      description: "Email info@acme.example",
      url: "https://acme.example/jobs/1",
      liveness: "live",
    }], null)).toEqual({
      email: "jobs@acme.example",
      source: "vacancy_field",
      evidenceUrl: "https://acme.example/jobs/1",
    });
  });

  it("extracts a stored description mailto without constructing an address", () => {
    expect(chooseStoredContactCandidate([{
      description: '<a href="mailto:careers@acme.example">Apply by email</a>',
      url: "https://acme.example/jobs/1",
      liveness: "unverified",
    }], null)).toEqual({
      email: "careers@acme.example",
      source: "vacancy_text",
      evidenceUrl: "https://acme.example/jobs/1",
    });
  });

  it("rejects free-provider contacts and Indeed-only evidence", () => {
    expect(chooseStoredContactCandidate([{
      contactEmail: "person@gmail.com",
      description: "Email jobs@acme.example",
      url: "https://indeed.com/viewjob?id=1",
      liveness: "live",
    }], null)).toBeNull();
  });

  it("skips dead vacancies", () => {
    expect(chooseStoredContactCandidate([{
      contactEmail: "jobs@acme.example",
      description: "jobs@acme.example",
      url: "https://acme.example/jobs/closed",
      liveness: "dead",
    }], null)).toBeNull();
  });

  it("falls back to a persisted employer-profile contact", () => {
    expect(chooseStoredContactCandidate([], "HR@Acme.example", "https://acme.example")).toEqual({
      email: "hr@acme.example",
      source: "sponsor_record",
      evidenceUrl: "https://acme.example",
    });
  });

  it("does not permit paid enrichment until the stored-data pass is drained", () => {
    expect(shouldRunPaidContactEnrichment(1)).toBe(false);
    expect(shouldRunPaidContactEnrichment(845)).toBe(false);
    expect(shouldRunPaidContactEnrichment(0)).toBe(true);
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