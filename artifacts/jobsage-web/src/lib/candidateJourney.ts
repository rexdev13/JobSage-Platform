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
  documents: Array<{
    documentType?: string | null;
    label?: string | null;
    parsedData?: Record<string, unknown> | null;
  }>;
  matchedRoleCount: number;
  applications: Array<{ status?: string | null; interviewDate?: string | null }>;
}
export interface CareerJourneyStage {
  label: (typeof CAREER_JOURNEY_STAGES)[number];
  status: JourneyStageStatus;
}

export interface CareerJourneyNextStep {
  label: string;
  href: string;
}

const nextStepForStage: Record<(typeof CAREER_JOURNEY_STAGES)[number], CareerJourneyNextStep> = {
  Upload: { label: "Upload your CV", href: "/documents" },
  Enhance: { label: "Enhance your CV", href: "/documents" },
  Match: { label: "Review matched jobs", href: "/opportunities" },
  Apply: { label: "Apply to a suitable role", href: "/opportunities" },
  Interview: { label: "Prepare for interviews", href: "/interview-prep" },
  Offer: { label: "Track your applications", href: "/applications" },
  Visa: { label: "Review your UK visa guidance", href: "/regulatory-guidance" },
  Relocate: { label: "Review relocation guidance", href: "/regulatory-guidance" },
  "Start Your New Career in the UK": { label: "View your full UK career journey", href: "/path" },
};

export function deriveCareerJourney(evidence: JourneyEvidence): CareerJourneyStage[] {
  const isAiEnhancedCv = (document: JourneyEvidence["documents"][number]) =>
    document.documentType === "cv" &&
    (document.label === "AI Enhanced CV" || document.parsedData?.aiGenerated === true);
  const originalCv = evidence.documents.some(
    (document) =>
      document.documentType === "cv" &&
      !isAiEnhancedCv(document),
  );
  const hasEnhancedCv = evidence.documents.some(
    isAiEnhancedCv,
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

export function getCareerJourneyOverview(evidence: JourneyEvidence): {
  completeCount: number;
  totalStages: number;
  progressPercent: number;
  nextStep: CareerJourneyNextStep | null;
} {
  const stages = deriveCareerJourney(evidence);
  const completeCount = stages.filter((stage) => stage.status === "complete").length;
  const currentStage = stages.find((stage) => stage.status === "current");
  return {
    completeCount,
    totalStages: stages.length,
    progressPercent: Math.round((completeCount / stages.length) * 100),
    nextStep: currentStage ? nextStepForStage[currentStage.label] : null,
  };
}
