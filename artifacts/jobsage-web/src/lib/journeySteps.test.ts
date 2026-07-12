import { deriveIslandStates, activeStepNumber } from "./journeySteps";

type Case = {
  label: string;
  input: Parameters<typeof deriveIslandStates>[0];
  expectedStatuses: string[];
  expectedActiveStep: number;
};

const cases: Case[] = [
  {
    label: "all false — step 1 active, rest locked",
    input: { hasProfile: false, hasCv: false, hasEligibilityDecision: false, hasApplications: false },
    expectedStatuses: ["active", "locked", "locked", "locked", "locked"],
    expectedActiveStep: 1,
  },
  {
    label: "profile only — step 2 active, rest locked",
    input: { hasProfile: true, hasCv: false, hasEligibilityDecision: false, hasApplications: false },
    expectedStatuses: ["complete", "active", "locked", "locked", "locked"],
    expectedActiveStep: 2,
  },
  {
    label: "profile + cv — step 3 active",
    input: { hasProfile: true, hasCv: true, hasEligibilityDecision: false, hasApplications: false },
    expectedStatuses: ["complete", "complete", "active", "locked", "locked"],
    expectedActiveStep: 3,
  },
  {
    label: "profile + cv + eligibility — step 4 active",
    input: { hasProfile: true, hasCv: true, hasEligibilityDecision: true, hasApplications: false },
    expectedStatuses: ["complete", "complete", "complete", "active", "locked"],
    expectedActiveStep: 4,
  },
  {
    label: "all four done — dream island active",
    input: { hasProfile: true, hasCv: true, hasEligibilityDecision: true, hasApplications: true },
    expectedStatuses: ["complete", "complete", "complete", "complete", "active"],
    expectedActiveStep: 5,
  },
  {
    label: "cv=true but profile=false — still step 1 active (strict ordering)",
    input: { hasProfile: false, hasCv: true, hasEligibilityDecision: false, hasApplications: false },
    expectedStatuses: ["active", "locked", "locked", "locked", "locked"],
    expectedActiveStep: 1,
  },
  {
    label: "eligibility=true but no profile or cv — still step 1 active",
    input: { hasProfile: false, hasCv: false, hasEligibilityDecision: true, hasApplications: false },
    expectedStatuses: ["active", "locked", "locked", "locked", "locked"],
    expectedActiveStep: 1,
  },
  {
    label: "applications=true but profile=false — still step 1 active",
    input: { hasProfile: false, hasCv: false, hasEligibilityDecision: false, hasApplications: true },
    expectedStatuses: ["active", "locked", "locked", "locked", "locked"],
    expectedActiveStep: 1,
  },
  {
    label: "profile + eligibility=true but cv=false — step 2 active (cv blocks 3+)",
    input: { hasProfile: true, hasCv: false, hasEligibilityDecision: true, hasApplications: false },
    expectedStatuses: ["complete", "active", "locked", "locked", "locked"],
    expectedActiveStep: 2,
  },
];

let passed = 0;
let failed = 0;

for (const c of cases) {
  const islands = deriveIslandStates(c.input);
  const statuses = islands.map((i) => i.status);
  const activeStep = activeStepNumber(islands);

  const statusOk = JSON.stringify(statuses) === JSON.stringify(c.expectedStatuses);
  const stepOk = activeStep === c.expectedActiveStep;

  if (statusOk && stepOk) {
    console.log(`  ✓ ${c.label}`);
    passed++;
  } else {
    console.error(`  ✗ ${c.label}`);
    if (!statusOk) console.error(`    statuses: expected ${JSON.stringify(c.expectedStatuses)}, got ${JSON.stringify(statuses)}`);
    if (!stepOk) console.error(`    activeStep: expected ${c.expectedActiveStep}, got ${activeStep}`);
    failed++;
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
