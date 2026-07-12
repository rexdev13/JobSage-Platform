export interface JourneyStep {
  number: number;
  id: string;
  name: string;
  shortName: string;
  description: string;
  route: string;
  ctaLabel: string;
}

export const JOURNEY_STEPS: JourneyStep[] = [
  {
    number: 1,
    id: "profile",
    name: "Build your profile",
    shortName: "Profile",
    description: "Tell us about your profession, qualifications and experience.",
    route: "/onboarding",
    ctaLabel: "Build profile",
  },
  {
    number: 2,
    id: "cv",
    name: "Upload your CV",
    shortName: "CV",
    description: "Upload your CV so we can match you to the best UK roles.",
    route: "/documents",
    ctaLabel: "Upload CV",
  },
  {
    number: 3,
    id: "eligibility",
    name: "Check eligibility",
    shortName: "Eligibility",
    description: "Run your profile against the latest UK regulatory criteria.",
    route: "/eligibility",
    ctaLabel: "Run check",
  },
  {
    number: 4,
    id: "apply",
    name: "Apply to roles",
    shortName: "Apply",
    description: "Apply to matched NHS and healthcare vacancies.",
    route: "/opportunities",
    ctaLabel: "Browse roles",
  },
  {
    number: 5,
    id: "dream",
    name: "Dream Job",
    shortName: "Dream Job",
    description: "Land your UK healthcare role — and keep growing with JOBSAGE.",
    route: "/opportunities",
    ctaLabel: "You're there!",
  },
];

export type IslandStatus = "complete" | "active" | "locked";

export interface IslandState {
  step: JourneyStep;
  status: IslandStatus;
}

export function deriveIslandStates(params: {
  hasProfile: boolean;
  hasCv: boolean;
  hasEligibilityDecision: boolean;
  hasApplications: boolean;
}): IslandState[] {
  const completions = [
    params.hasProfile,
    params.hasCv,
    params.hasEligibilityDecision,
    params.hasApplications,
  ];

  // Walk forward in strict order: the active step is the first one not yet complete.
  // Data inconsistencies (e.g. hasCv=true but hasProfile=false) are ignored —
  // a step cannot be active/complete unless all prior steps are complete.
  let activeIdx = completions.length; // default: all 4 done → dream island (idx 4) is active
  for (let i = 0; i < completions.length; i++) {
    if (!completions[i]) {
      activeIdx = i;
      break;
    }
  }

  return JOURNEY_STEPS.map((step, i) => ({
    step,
    status: (i < activeIdx ? "complete" : i === activeIdx ? "active" : "locked") as IslandStatus,
  }));
}

export function activeStepNumber(islands: IslandState[]): number {
  const activeIdx = islands.findIndex((s) => s.status === "active");
  return activeIdx === -1 ? 5 : activeIdx + 1;
}
