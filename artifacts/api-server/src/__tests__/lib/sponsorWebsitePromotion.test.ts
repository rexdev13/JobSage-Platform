import { describe, expect, it } from "vitest";
import {
  classifySponsorWebsitePromotion,
  scoreSponsorWebsiteDomainMatch,
  type SponsorWebsitePromotionInput,
} from "../../lib/sponsorWebsitePromotion";

function candidate(
  overrides: Partial<SponsorWebsitePromotionInput> = {},
): SponsorWebsitePromotionInput {
  return {
    organisationName: "Ashburton House Care Home Ltd",
    townCity: "Ashburton",
    candidateWebsite: "https://www.ashburton-house.co.uk/",
    evidenceUrl: "https://www.ashburton-house.co.uk/",
    originalConfidence: "high",
    sourceType: "official_site",
    fetched: true,
    pageUrl: "https://www.ashburton-house.co.uk/",
    pageTitle: "Ashburton House Care Home",
    pageExcerpt: "Ashburton House Care Home, Ashburton, England",
    candidateSnippet: null,
    identityVerified: true,
    geographyMismatch: false,
    existingWebsiteUrls: [],
    existingCareersUrls: [],
    existingAtsMappingStatuses: [],
    atsLeadUnverified: false,
    sponsorLicenceIds: [123],
    ...overrides,
  };
}

describe("sponsor website promotion classifier", () => {
  it("auto-promotes a high-confidence, strongly brand-matched same-site result", () => {
    expect(classifySponsorWebsitePromotion(candidate()).promotionDecision).toBe("auto_promote");
  });

  it("blocks a high-confidence employer profile on a directory platform", () => {
    const result = classifySponsorWebsitePromotion(candidate({
      organisationName: "Telth Healthcare PVT Ltd",
      candidateWebsite: "https://cutshort.io/",
      evidenceUrl: "https://cutshort.io/company/telth",
      pageUrl: "https://cutshort.io/company/telth",
      sourceType: "official_site",
      pageTitle: "Telth Healthcare jobs",
      pageExcerpt: "Telth Healthcare employer profile",
      townCity: null,
    }));
    expect(result.promotionDecision).toBe("reject");
    expect(result.blockedHostCheck).toContain("cutshort.io");
  });

  it("requires review when the page confirms identity but the brand match is weak", () => {
    expect(classifySponsorWebsitePromotion(candidate({
      candidateWebsite: "https://carrickcare.co.uk/",
      evidenceUrl: "https://carrickcare.co.uk/carrick-house/",
      pageUrl: "https://carrickcare.co.uk/carrick-house/",
      organisationName: "CARRICK HOUSE NURSING HOME",
      pageTitle: "Carrick House | Carrick Care",
      pageExcerpt: "Carrick House nursing home in Ayr, Scotland",
      townCity: "AYR",
    })).promotionDecision).toBe("review_required");
  });

  it("rejects conflicting geography and reviews missing location evidence", () => {
    expect(classifySponsorWebsitePromotion(candidate({
      geographyMismatch: true,
    })).promotionDecision).toBe("reject");
    expect(classifySponsorWebsitePromotion(candidate({
      pageExcerpt: "Ashburton House Care Home",
      townCity: "Darlington",
    })).promotionDecision).toBe("review_required");
  });

  it("does not auto-promote an existing conflicting website or unverified ATS lead", () => {
    expect(classifySponsorWebsitePromotion(candidate({
      existingWebsiteUrls: ["https://different-company.example/"],
    })).promotionDecision).toBe("review_required");
    expect(classifySponsorWebsitePromotion(candidate({
      atsLeadUnverified: true,
    })).promotionDecision).toBe("review_required");
  });

  it("requires an HTTPS same-site evidence path and a matching sponsor row", () => {
    expect(classifySponsorWebsitePromotion(candidate({
      pageUrl: "http://www.ashburton-house.co.uk/",
    })).promotionDecision).toBe("review_required");
    expect(classifySponsorWebsitePromotion(candidate({
      sponsorLicenceIds: [],
    })).promotionDecision).toBe("review_required");
  });

  it("scores explicit trading names and strips generic legal/sector words", () => {
    expect(scoreSponsorWebsiteDomainMatch(
      "OTTERSHAW CHERTSEY LTD T/A 3 Rooms Indian Restaurant",
      "https://www.3roomsrestaurant.co.uk/",
    )).toBe(100);
    expect(scoreSponsorWebsiteDomainMatch(
      "Aldbourne Nursing Home Ltd",
      "https://aldbournenursinghome.com/",
    )).toBe(100);
    expect(scoreSponsorWebsiteDomainMatch(
      "B and A Precision Engineering Limited",
      "https://www.precisionengineeringlondon.co.uk/",
    )).toBe(0);
    expect(scoreSponsorWebsiteDomainMatch(
      "B&B Singh Construction Ltd",
      "https://bbsingh.co.uk/",
    )).toBe(90);
  });
});