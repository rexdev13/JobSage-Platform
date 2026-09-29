import { describe, expect, it } from "vitest";
import {
  parseStrictRolePageSector,
  STRICT_ROLE_PAGE_SECTORS,
  socForRoleTitle,
  sponsorIndustriesForSector,
} from "../../lib/companySiteRoleSectors";
import { isSpecificRoleTitle } from "../../lib/healthcareRoleEvidence";
import { namedSponsorIndustryAllowed, scheduledApplyBlockReason } from "../../lib/namedCompanySiteBatchPolicy";

describe("named company-site role sectors", () => {
  it("defaults omitted sector to healthcare and rejects unknown values", () => {
    expect(parseStrictRolePageSector(undefined)).toBe("healthcare");
    expect(parseStrictRolePageSector("")).toBe("healthcare");
    expect(parseStrictRolePageSector("it")).toBe("it");
    expect(() => parseStrictRolePageSector("hospitality")).toThrow(/sector must be one of/);
  });

  it("keeps a specific title in its own sector and out of the others", () => {
    expect(isSpecificRoleTitle("Staff Nurse", "healthcare")).toBe(true);
    expect(isSpecificRoleTitle("Staff Nurse", "education")).toBe(false);
    expect(isSpecificRoleTitle("Secondary Teacher of Mathematics", "education")).toBe(true);
    expect(isSpecificRoleTitle("Software Engineer", "it")).toBe(true);
    expect(isSpecificRoleTitle("Software Engineer", "engineering")).toBe(false);
    expect(isSpecificRoleTitle("Civil Engineer", "engineering")).toBe(true);
    expect(isSpecificRoleTitle("Solicitor", "legal")).toBe(true);
    expect(isSpecificRoleTitle("Chartered Accountant", "accounting")).toBe(true);
    expect(isSpecificRoleTitle("Project Architect", "architecture")).toBe(true);
    expect(isSpecificRoleTitle("Business Development Manager", "business_development")).toBe(true);
    expect(isSpecificRoleTitle("Our benefits", "healthcare")).toBe(false);
    expect(isSpecificRoleTitle("Careers", "it")).toBe(false);
  });

  it("allows an unclassified named sponsor and refuses a different sector", () => {
    expect(namedSponsorIndustryAllowed(null, ["Healthcare", "Social Care"])).toBe(true);
    expect(namedSponsorIndustryAllowed("  ", ["Healthcare", "Social Care"])).toBe(true);
    expect(namedSponsorIndustryAllowed("Healthcare", ["Healthcare", "Social Care"])).toBe(true);
    expect(namedSponsorIndustryAllowed("Technology", ["Healthcare", "Social Care"])).toBe(false);
  });

  it("maps sponsor industries and SOC codes without mixing sectors", () => {
    expect(sponsorIndustriesForSector("healthcare")).toEqual(["Healthcare", "Social Care"]);
    expect(sponsorIndustriesForSector("it")).toEqual(["Technology"]);
    expect(socForRoleTitle("Staff Nurse", "healthcare")).toBe("2231");
    expect(socForRoleTitle("Secondary Teacher", "education")).toBe("2314");
    expect(STRICT_ROLE_PAGE_SECTORS).toHaveLength(8);
  });
});

describe("scheduled named company-site apply gates", () => {
  const accepted = [{
    applicationUrl: "https://careers.example.co.uk/vacancies/role-1/apply",
    contactEmail: null,
  }];

  it("refuses empty, paced, or route-less discoveries", () => {
    expect(scheduledApplyBlockReason({
      found: 0,
      accepted: 0,
      budgetExhausted: false,
      employersChecked: [{ error: "hostname is paced or in backoff" }],
      acceptedRows: [],
    })).toBe("discovery_paced");
    expect(scheduledApplyBlockReason({
      found: 0,
      accepted: 0,
      budgetExhausted: false,
      employersChecked: [{ error: null }],
      acceptedRows: [],
    })).toBe("found_zero");
    expect(scheduledApplyBlockReason({
      found: 12,
      accepted: 0,
      budgetExhausted: false,
      employersChecked: [{ error: null }],
      acceptedRows: [],
    })).toBe("accepted_zero");
    expect(scheduledApplyBlockReason({
      found: 12,
      accepted: 1,
      budgetExhausted: false,
      employersChecked: [{ error: null }],
      acceptedRows: [{ applicationUrl: "http://insecure.example/apply", contactEmail: null }],
    })).toBe("missing_https_apply_route");
  });

  it("allows a paced look that still accepted https apply routes", () => {
    expect(scheduledApplyBlockReason({
      found: 12,
      accepted: 1,
      budgetExhausted: false,
      employersChecked: [{ error: "hostname is paced or in backoff" }],
      acceptedRows: accepted,
    })).toBeNull();
    expect(scheduledApplyBlockReason({
      found: 12,
      accepted: 1,
      budgetExhausted: true,
      employersChecked: [{ error: null }],
      acceptedRows: [{ applicationUrl: null, contactEmail: "careers@example.co.uk" }],
    })).toBeNull();
  });
});
