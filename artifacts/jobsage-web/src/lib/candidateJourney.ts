export const CAREER_JOURNEY_STAGES = [
  "Upload",
  "Enhance",
  "Match",
  "Apply",
  "Interview",
  "Offer",
  "Visa",
  "Relocate",
  "Start Your New Career in the UK",
] as const;

export type JourneyStageStatus = "complete" | "current" | "upcoming";
export interface JourneyEvidence {
  documents: Array<{ documentType?: string | null; label?: string | null }>;
  matchedRoleCount: number;
  applications: Array<{ status?: string | null; interviewDate?: string | null }>;
}
export interface CareerJourneyStage {
  label: (typeof CAREER_JOURNEY_STAGES)[number];
  status: JourneyStageStatus;
}

export function deriveCareerJourney(evidence: JourneyEvidence): CareerJourneyStage[] {
  const originalCv = evidence.documents.some(
    (document) =>
      document.documentType === "cv" &&
      document.label !== "AI Enhanced CV",
  );
  const hasEnhancedCv = evidence.documents.some(
    (document) =>
      document.documentType === "cv" && document.label === "AI Enhanced CV",
  );
  const hasSubmittedApplication = evidence.applications.some((application) =>
    ["applied", "shortlisted", "interview", "offer"].includes(application.status ?? ""),
  );
  const hasInterview = evidence.applications.some(
    (application) =>
      application.status === "interview" ||
       (typeof application.interviewDate === "string" &&
         Number.isFinite(Date.parse(application.interviewDate))),
  );
  const hasOffer = evidence.applications.some((application) => application.status === "offer");
  const evidenceByStage = [
    originalCv,
    hasEnhancedCv,
    evidence.matchedRoleCount > 0,
    hasSubmittedApplication,
    hasInterview,
    hasOffer,
    false,
    false,
    false,
  ];

  // Progress is deliberately a contiguous prefix. Later evidence never implies
  // completion of an earlier stage that has not itself been evidenced.
  const firstIncomplete = evidenceByStage.findIndex((isComplete) => !isComplete);
  const completeCount = firstIncomplete === -1 ? evidenceByStage.length : firstIncomplete;
  return CAREER_JOURNEY_STAGES.map((label, index) => ({
    label,
    status: index < completeCount ? "complete" : index === completeCount ? "current" : "upcoming",
  }));
}
