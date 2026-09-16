import { describe, expect, it } from "vitest";
import {
  extractAdvertContactEmail,
  validatePublishedContactEmail,
} from "../../lib/publishedContactEmail";

describe("scrape-time published contact extraction", () => {
  it("prefers recruitment over a random visible footer address", () => {
    expect(extractAdvertContactEmail(
      'Site support: web@example.org <a href="mailto:recruitment@example.org">Recruitment</a>',
      "https://example.org/jobs/123",
    )).toBe("recruitment@example.org");
  });

  it("rejects free, no-reply, and ATS/platform inboxes", () => {
    expect(validatePublishedContactEmail("person@gmail.com")).toBeNull();
    expect(validatePublishedContactEmail("noreply@example.org")).toBeNull();
    expect(validatePublishedContactEmail("jobs@greenhouse.io")).toBeNull();
    expect(validatePublishedContactEmail("nhsbsa.nhsjobs@nhsbsa.nhs.uk")).toBeNull();
  });

  it("rejects LinkedIn and Indeed evidence even when the email is otherwise valid", () => {
    expect(extractAdvertContactEmail(
      "recruitment@example.org",
      "https://www.linkedin.com/jobs/view/123",
    )).toBeNull();
    expect(extractAdvertContactEmail(
      "recruitment@example.org",
      "https://indeed.com/viewjob?id=123",
    )).toBeNull();
  });
});