const PROFILE_COMPLETENESS_TARGETS: Record<string, string> = {
  Profession: "profile-professional-section",
  Specialty: "profile-professional-section",
  "Qualification country": "profile-qualifications-section",
  "Qualification type": "profile-qualifications-section",
  "Qualification year": "profile-qualifications-section",
  "Years of experience": "profile-professional-section",
  "Registration status": "profile-professional-section",
  "Residency status": "profile-immigration-section",
  "Preferred region": "profile-immigration-section",
  "Preferred start date": "profile-additional-section",
  "Profile photo": "profile-photo-section",
  Languages: "profile-additional-section",
  "Additional notes": "profile-additional-section",
};

export function getProfileCompletenessTarget(label: string): string | null {
  return PROFILE_COMPLETENESS_TARGETS[label] ?? null;
}

export function getRemainingCompletenessPct(completionPct: number): number {
  return Math.max(0, Math.min(100, 100 - Math.round(completionPct)));
}

export const PROFILE_COMPLETENESS_FIELD_LABELS = Object.keys(PROFILE_COMPLETENESS_TARGETS);