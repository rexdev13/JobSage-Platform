import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({ db: { execute: vi.fn() } }));

const { extractSponsorshipSentences } = await import("../../lib/nhsSponsorshipEvidence");

describe("extractSponsorshipSentences", () => {
  it("keeps sponsorship statements and drops boilerplate about criminal records", () => {
    const html = `<p>Join our team.</p><h3>Certificate of Sponsorship</h3>
      <p>Applications from job seekers who require current Skilled worker sponsorship to work in the UK are welcome and will be considered alongside all other applications.</p>
      <p>From 6 April 2017, skilled worker applicants, applying for entry clearance into the UK, have had to present a criminal record certificate from each country.</p>`;
    const sentences = extractSponsorshipSentences(html);
    expect(sentences).toHaveLength(1);
    expect(sentences[0]).toMatch(/are welcome/);
  });

  it("returns nothing when the advert never mentions sponsorship", () => {
    expect(extractSponsorshipSentences("<p>Band 5 staff nurse on a busy ward.</p>")).toEqual([]);
  });
});
