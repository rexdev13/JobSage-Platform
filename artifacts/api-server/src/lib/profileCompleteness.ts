import { profilesTable } from "@workspace/db";

type ProfileRow = typeof profilesTable.$inferSelect;

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
  const filled = scored.filter((f) => {
    if (f == null) return false;
    if (typeof f === "number") return f > 0;
    if (typeof f === "string") return f !== "";
    if (Array.isArray(f)) return f.length > 0;
    return true;
  }).length;
  return Math.min(100, Math.round((filled / scored.length) * 100));
}

export const SMART_APPLY_THRESHOLD = 80;
