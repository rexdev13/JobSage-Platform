import { describe, expect, it, vi } from "vitest";
import { CANDIDATE_NAVIGATION, getUnreadBadgeText, isNavigationItemActive } from "./candidateNavigation";
import { CAREER_JOURNEY_STAGES, deriveCareerJourney, getCareerJourneyOverview } from "./candidateJourney";

describe("candidate navigation configuration", () => {
  it("uses the required section order", () => {
    expect(CANDIDATE_NAVIGATION.map((section) => section.label)).toEqual([
      "My Profile", "My UK Opportunities", "UK Career Journey",
      "Career Readiness", "Insights", "Support",
    ]);
  });

  it("maps all requested destinations and actions", () => {
    const all = CANDIDATE_NAVIGATION.flatMap((section) => section.items);
    for (const [label, href] of [
      ["CV and Supporting Documents", "/documents"],
      ["Personal & Professional Details", "/profile"],
      ["ID Verification", "/identity"],
      ["Visa Sponsoring Employers", "/sponsor-licences"],
      ["Matched Jobs", "/opportunities"],
      ["Application Tracker", "/applications"],
      ["Interviews", "/calendar"],
      ["Messages", "/inbox"],
      ["Eligibility Check", "/eligibility"],
      ["Interview Preparation", "/interview-prep"],
      ["Monthly Reports", "/my-report"],
      ["Next Steps", "/"],
      ["Help Center", "/help"],
      ["Feedback", "/feedback"],
      ["References", "/recommendations"],
      ["Visa & Legal Guidance", "/regulatory-guidance"],
    ]) {
      expect(all.find((item) => item.label === label)).toMatchObject({ href, kind: "route" });
    }
    expect(all.find((item) => item.label === "CV Enhancement")).toMatchObject({
      kind: "action", action: "enhance-cv",
    });
    expect(all.every((item) => item.kind === "route" || item.kind === "action")).toBe(true);
  });

  it("handles root and nested active routes", () => {
    expect(isNavigationItemActive("/", "/")).toBe(true);
    expect(isNavigationItemActive("/applications/24", "/applications")).toBe(true);
    expect(isNavigationItemActive("/profile/edit", "/profile")).toBe(true);
    expect(isNavigationItemActive("/applications", "/")).toBe(false);
  });

  it("preserves a readable live unread message badge", () => {
    expect(CANDIDATE_NAVIGATION.flatMap((section) => section.items)
       .find((item) => item.label === "Messages")).toMatchObject({ href: "/inbox", kind: "route", badge: "unread-messages" });
    expect(getUnreadBadgeText(3)).toBe("3");
    expect(getUnreadBadgeText(108)).toBe("99+");
    expect(getUnreadBadgeText(0)).toBeNull();
  });

  it("invokes the available action callback", () => {
    const onEnhance = vi.fn();
    const enhancement = CANDIDATE_NAVIGATION.flatMap((section) => section.items)
      .find((item) => item.kind === "action");
    if (enhancement?.kind === "action") onEnhance();
    expect(onEnhance).toHaveBeenCalledOnce();
  });
});

describe("candidate career journey evidence", () => {
  const empty = { documents: [], matchedRoleCount: 0, applications: [] };
  it("has nine ordered labels and current/upcoming defaults", () => {
    expect(CAREER_JOURNEY_STAGES).toEqual([
      "Upload", "Enhance", "Match", "Apply", "Interview", "Offer", "Visa", "Relocate",
      "Start Your New Career in the UK",
    ]);
    expect(deriveCareerJourney(empty).map((step) => step.status))
      .toEqual(["current", ...Array(8).fill("upcoming")]);
  });
  it("requires an original CV, not supporting documents or an enhanced CV, for Upload", () => {
    expect(deriveCareerJourney({ ...empty, documents: [{ documentType: "passport" }] })[0].status).toBe("current");
    expect(deriveCareerJourney({ ...empty, documents: [{ documentType: "cv", label: "AI Enhanced CV" }] })[0].status).toBe("current");
  });
  it("recognizes actual evidence and applies strict-prefix progression", () => {
    const stages = deriveCareerJourney({
      documents: [
        { documentType: "cv", label: "Uploaded CV" },
        { documentType: "cv", label: "AI Enhanced CV" },
      ],
      matchedRoleCount: 2,
      applications: [{ status: "applied" }, { status: "interview", interviewDate: null }, { status: "offer" }],
    });
    expect(stages.map((step) => step.status)).toEqual([
      "complete", "complete", "complete", "complete", "complete", "complete",
      "current", "upcoming", "upcoming",
    ]);
  });
  it("does not treat clicks, in-progress drafts, eligibility, or offers as visa/relocation evidence", () => {
    const stages = deriveCareerJourney({
      ...empty,
      applications: [{ status: "link_clicked" }, { status: "in_progress" }, { status: "offer" }],
    });
    expect(stages.map((step) => step.status)).toEqual([
      "current", "upcoming", "upcoming", "upcoming", "upcoming", "upcoming",
      "upcoming", "upcoming", "upcoming",
    ]);
  });
  it("does not accept an invalid date as interview evidence", () => {
    const stages = deriveCareerJourney({
      documents: [{ documentType: "cv" }, { documentType: "cv", label: "AI Enhanced CV" }],
      matchedRoleCount: 1,
      applications: [{ status: "applied", interviewDate: "not-a-date" }],
    });
    expect(stages[4].status).toBe("current");
    expect(stages[5].status).toBe("upcoming");
  });
  it("derives the dashboard percentage and next step from completed evidence", () => {
    expect(getCareerJourneyOverview(empty)).toEqual({
      completeCount: 0,
      totalStages: 9,
      progressPercent: 0,
      nextStep: { label: "Upload your CV", href: "/documents" },
    });
    const overview = getCareerJourneyOverview({
      documents: [
        { documentType: "cv", label: "Original CV" },
        { documentType: "cv", label: "AI Enhanced CV" },
      ],
      matchedRoleCount: 2,
      applications: [{ status: "applied" }],
    });
    expect(overview.completeCount).toBe(4);
    expect(overview.progressPercent).toBe(44);
    expect(overview.nextStep).toEqual({ label: "Prepare for interviews", href: "/interview-prep" });
  });
});
