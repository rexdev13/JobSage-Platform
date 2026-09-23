const PROFILE_COMPLETENESS_FIELDS: Record<string, { target: string; section: string }> = {
  Profession: { target: "profile-field-profession", section: "Professional Information" },
  Specialty: { target: "profile-field-specialty", section: "Professional Information" },
  "Qualification country": { target: "profile-field-qualificationCountry", section: "Qualifications" },
  "Qualification type": { target: "profile-field-qualificationType", section: "Qualifications" },
  "Qualification year": { target: "profile-field-qualificationYear", section: "Qualifications" },
  "Years of experience": { target: "profile-field-experienceYears", section: "Professional Information" },
  "Registration status": { target: "profile-field-registrationStatus", section: "Professional Information" },
  "Residency status": { target: "profile-field-residencyStatus", section: "Immigration & Location" },
  "Preferred region": { target: "profile-field-preferredRegion", section: "Immigration & Location" },
  "Preferred start date": { target: "profile-field-preferredStartDate", section: "Additional Details" },
  "Profile photo": { target: "profile-photo-upload", section: "Profile photo" },
  Languages: { target: "profile-field-languages", section: "Additional Details" },
  "Additional notes": { target: "profile-field-additionalNotes", section: "Additional Details" },
};

export function getProfileCompletenessTarget(label: string): string | null {
  return PROFILE_COMPLETENESS_FIELDS[label]?.target ?? null;
}

export function getProfileCompletenessSectionLabel(label: string): string {
  return PROFILE_COMPLETENESS_FIELDS[label]?.section ?? "Profile";
}

export function getRemainingCompletenessPct(completionPct: number): number {
  return Math.max(0, Math.min(100, 100 - Math.round(completionPct)));
}

export const PROFILE_COMPLETENESS_FIELD_LABELS = Object.keys(PROFILE_COMPLETENESS_FIELDS);