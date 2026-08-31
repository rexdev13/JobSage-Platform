import { profilesTable } from "@workspace/db";

type ProfileRow = typeof profilesTable.$inferSelect;

function isFilled(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === "number") return true;
  if (typeof v === "string") return v !== "";
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

export function computeCompletionPct(p: ProfileRow): number {
  const scored: unknown[] = [
    p.profession,
    p.specialty,
    p.qualificationCountry,
    p.qualificationType,
    p.qualificationYear,
    p.experienceYears,
    p.registrationStatus,
    p.residencyStatus,
    p.preferredRegion,
    p.preferredStartDate,
    p.profilePhotoKey,
    p.languages,
    p.additionalNotes,
  ];
  const filled = scored.filter(isFilled).length;
  return Math.min(100, Math.round((filled / scored.length) * 100));
}

export function computeMissingFields(p: ProfileRow): string[] {
  const allFields: Array<{ label: string; value: unknown }> = [
    { label: "Profession", value: p.profession },
    { label: "Specialty", value: p.specialty },
    { label: "Qualification country", value: p.qualificationCountry },
    { label: "Qualification type", value: p.qualificationType },
    { label: "Qualification year", value: p.qualificationYear },
    { label: "Years of experience", value: p.experienceYears },
    { label: "Registration status", value: p.registrationStatus },
    { label: "Residency status", value: p.residencyStatus },
    { label: "Preferred region", value: p.preferredRegion },
    { label: "Preferred start date", value: p.preferredStartDate },
    { label: "Profile photo", value: p.profilePhotoKey },
    { label: "Languages", value: p.languages },
    { label: "Additional notes", value: p.additionalNotes },
  ];
  return allFields.filter((f) => !isFilled(f.value)).map((f) => f.label);
}

export function computeSmartApplyReady(p: ProfileRow): { ready: boolean; missingFields: string[] } {
  const keyFields: Array<{ label: string; value: unknown }> = [
    { label: "Profession", value: p.profession },
    { label: "Specialty", value: p.specialty },
    { label: "Qualification country", value: p.qualificationCountry },
    { label: "Qualification type", value: p.qualificationType },
    { label: "Qualification year", value: p.qualificationYear },
    { label: "Years of experience", value: p.experienceYears },
    { label: "Registration status", value: p.registrationStatus },
    { label: "Residency status", value: p.residencyStatus },
    { label: "Preferred start date", value: p.preferredStartDate },
    { label: "Languages", value: p.languages },
  ];
  const missingFields = keyFields.filter((f) => !isFilled(f.value)).map((f) => f.label);
  return { ready: missingFields.length === 0, missingFields };
}
