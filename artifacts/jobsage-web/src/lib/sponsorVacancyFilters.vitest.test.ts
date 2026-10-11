import { describe, expect, it } from "vitest";
import { filterSponsorPanelVacancies } from "./sponsorVacancyFilters";

const vacancies = [
  { title: "Staff Nurse", location: "London", targetRegions: ["London"] },
  { title: "Senior Radiographer", location: "Leeds", targetRegions: ["Yorkshire and the Humber"] },
  { title: "National Pharmacist", location: "Multiple sites", targetRegions: ["National / Multiple Regions"] },
  { title: "Clinical Fellow", location: null, targetRegions: null },
];

describe("filterSponsorPanelVacancies", () => {
  it("hides vacancies without confirmed UK location status", () => {
    expect(filterSponsorPanelVacancies([
      { title: "UK Nurse", location: "London", targetRegions: ["London"], ukLocationStatus: "confirmed_uk" },
      { title: "US Nurse", location: "Boston", targetRegions: ["London"], ukLocationStatus: "confirmed_non_uk" },
      { title: "Remote Nurse", location: "Remote", targetRegions: ["London"], ukLocationStatus: "unknown" },
    ], {
      search: "",
      preferredRegions: ["London"],
      preferredRegionOnly: false,
    }).map((vacancy) => vacancy.title)).toEqual(["UK Nurse"]);
  });

  it("searches vacancy titles and locations", () => {
    expect(filterSponsorPanelVacancies(vacancies, {
      search: "leeds",
      preferredRegions: [],
      preferredRegionOnly: false,
    }).map((vacancy) => vacancy.title)).toEqual(["Senior Radiographer"]);
  });

  it("applies preferred vacancy regions without changing register-region filtering", () => {
    expect(filterSponsorPanelVacancies(vacancies, {
      search: "",
      preferredRegions: ["London"],
      preferredRegionOnly: true,
    }).map((vacancy) => vacancy.title)).toEqual([
      "Staff Nurse",
      "National Pharmacist",
      "Clinical Fellow",
    ]);
  });

  it("combines preferred-region and text filters", () => {
    expect(filterSponsorPanelVacancies(vacancies, {
      search: "nurse",
      preferredRegions: ["London"],
      preferredRegionOnly: true,
    }).map((vacancy) => vacancy.title)).toEqual(["Staff Nurse"]);
  });
});