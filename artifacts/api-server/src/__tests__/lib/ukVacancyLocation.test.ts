import { describe, expect, it } from "vitest";
import { classifyUkVacancyLocation } from "../../lib/ukVacancyLocation";

describe("classifyUkVacancyLocation", () => {
  it.each([
    "London, UK",
    "London, England",
    "Remote - UK",
    "Manchester",
    "Manchester, Greater Manchester",
    "Edinburgh, Scotland",
    "Cardiff, Wales",
    "Belfast, Northern Ireland",
    "Northern Ireland",
    "SW1A 1AA",
  ])("confirms UK location: %s", (location) => {
    expect(classifyUkVacancyLocation({ location })).toBe("confirmed_uk");
  });

  it.each([
    "San Francisco, CA",
    "New York, NY",
    "Austin, TX",
    "Toronto, ON",
    "Montréal, Quebec, Canada",
    "London, Ontario",
    "Cambridge, MA",
    "Manchester, NH",
    "Birmingham, Alabama",
    "York, PA",
  ])("rejects foreign location: %s", (location) => {
    expect(classifyUkVacancyLocation({ location })).toBe("confirmed_non_uk");
  });

  it.each(["Remote", "Worldwide", "Multiple locations", "", null])(
    "keeps unqualified location unknown: %s",
    (location) => {
      expect(classifyUkVacancyLocation({ location })).toBe("unknown");
    },
  );

  it("uses source country codes and country values as structured evidence", () => {
    expect(classifyUkVacancyLocation({
      location: "Remote",
      sourceMetadata: { countryCode: "GBR" },
    })).toBe("confirmed_uk");
    expect(classifyUkVacancyLocation({
      location: "London",
      targetRegions: ["London"],
      sourceMetadata: { jobLocation: { address: { addressCountry: "CA" } } },
    })).toBe("confirmed_non_uk");
    expect(classifyUkVacancyLocation({
      location: null,
      sourceMetadata: { country_code: "FR" },
    })).toBe("confirmed_non_uk");
  });

  it("does not treat the national/multiple-regions bucket as UK evidence", () => {
    expect(classifyUkVacancyLocation({
      location: "Remote",
      targetRegions: ["National / Multiple Regions"],
    })).toBe("unknown");
  });

  it("honors a newer persisted suppression when old stored text still says UK", () => {
    expect(classifyUkVacancyLocation({
      location: "London, UK",
      sourceMetadata: {
        jobsageLocationEligibility: {
          status: "unknown",
          recordedAt: "2026-10-11T00:00:00.000Z",
        },
      },
    })).toBe("unknown");
  });

  it("requires explicit UK availability when UK and foreign locations are mixed", () => {
    expect(classifyUkVacancyLocation({
      location: "United Kingdom and New York",
    })).toBe("confirmed_non_uk");
    expect(classifyUkVacancyLocation({
      location: "Role available in the UK and New York",
    })).toBe("confirmed_uk");
    expect(classifyUkVacancyLocation({
      location: "New York, NY",
      targetRegions: ["London"],
    })).toBe("confirmed_non_uk");
  });
});
