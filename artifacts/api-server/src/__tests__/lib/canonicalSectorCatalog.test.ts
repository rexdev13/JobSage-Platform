import { describe, expect, it } from "vitest";
import {
  canonicalSectorForCategory,
  canonicalSectorForProfession,
  OPPORTUNITY_CATEGORIES,
  PROFESSION_CATALOG,
  professionRequiresUkRegistration,
} from "@workspace/api-zod/profession-catalog";
import { UpsertMyProfileBody } from "@workspace/api-zod";
import {
  CANONICAL_SECTORS,
  CANONICAL_SECTOR_OPTIONS,
  canonicalSectorSchema,
} from "@workspace/api-zod/sector-catalog";
import { STRICT_ROLE_PAGE_SECTORS } from "../../lib/companySiteRoleSectors";

describe("canonical sector catalog", () => {
  it("has the exact eight ordered IDs and display labels", () => {
    expect(CANONICAL_SECTORS).toEqual([
      "healthcare",
      "education",
      "engineering",
      "it",
      "legal",
      "accounting",
      "architecture",
      "business_development",
    ]);
    expect(CANONICAL_SECTOR_OPTIONS.map(({ label }) => label)).toEqual([
      "Healthcare",
      "Education",
      "Engineering",
      "IT",
      "Legal",
      "Accounting",
      "Architecture",
      "Business Development",
    ]);
    expect(STRICT_ROLE_PAGE_SECTORS).toBe(CANONICAL_SECTORS);
  });

  it("maps every supported profession and vacancy category to one canonical sector", () => {
    expect(PROFESSION_CATALOG.length).toBeGreaterThan(0);
    for (const profession of PROFESSION_CATALOG) {
      expect(CANONICAL_SECTORS).toContain(profession.sector);
      expect(canonicalSectorForProfession(profession.label)).toBe(profession.sector);
    }
    for (const category of OPPORTUNITY_CATEGORIES) {
      expect(CANONICAL_SECTORS).toContain(canonicalSectorForCategory(category));
    }
    expect(canonicalSectorForProfession("accountant")).toBe("accounting");
    expect(canonicalSectorForProfession("software developer")).toBe("it");
    expect(canonicalSectorForProfession("unmapped title")).toBeNull();
  });

  it("rejects unsupported sector values", () => {
    expect(canonicalSectorSchema.safeParse("healthcare").success).toBe(true);
    expect(canonicalSectorSchema.safeParse("Healthcare").success).toBe(false);
    expect(canonicalSectorSchema.safeParse("finance").success).toBe(false);
  });

  it("keeps profile API validation aligned and preserves legacy sector omission", () => {
    const baseProfile = {
      profession: "Nurse",
      specialty: "ICU",
      qualificationCountry: "Nigeria",
      qualificationType: "bachelor",
      qualificationYear: 2015,
      experienceYears: 5,
      registrationStatus: "registered",
      residencyStatus: "visa_required",
      requiresSponsorship: true,
    };

    for (const sector of CANONICAL_SECTORS) {
      expect(UpsertMyProfileBody.safeParse({ ...baseProfile, sector }).success).toBe(true);
    }
    expect(UpsertMyProfileBody.safeParse(baseProfile).success).toBe(true);
    expect(UpsertMyProfileBody.safeParse({ ...baseProfile, sector: "finance" }).success).toBe(false);
  });

  it("only asks for statutory registration for professions that require it", () => {
    expect(professionRequiresUkRegistration("Nurse")).toBe(true);
    expect(professionRequiresUkRegistration("Dentist / Dental Professional")).toBe(true);
    expect(professionRequiresUkRegistration("Healthcare Support")).toBe(false);
    expect(professionRequiresUkRegistration("Teacher / Lecturer")).toBe(false);
  });
});
