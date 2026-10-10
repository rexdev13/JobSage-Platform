import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { afterEach, describe, expect, it, vi } from "vitest";

const { profileState, videoState } = vi.hoisted(() => ({
  profileState: { profession: "Doctor" as string | null },
  videoState: {
    data: {
      videos: [{
        id: 1,
        title: "PLAB preparation",
        description: "A reviewed guide.",
        category: "professional_registration",
        applicability: "Doctors preparing for PLAB",
        durationSeconds: 120,
        videoEmbedUrl: "https://www.youtube-nocookie.com/embed/example",
        mediaUrl: null,
        sourceUrl: "https://www.gmc-uk.org/",
        reviewedAt: "2026-10-10T00:00:00.000Z",
      }] as any[],
    },
  },
}));

vi.mock("@workspace/api-client-react", () => ({
  getListLearningVideosQueryKey: () => ["/api/learning-videos"],
  useGetMyProfile: () => ({ data: { profession: profileState.profession }, isLoading: false }),
  useListLearningVideos: () => ({ data: videoState.data, isLoading: false, isError: false }),
}));

import { ExamPrepSupportCard } from "./ExamPrepSupportCard";

function renderCard(onGuidancePage = false) {
  return render(
    <Router>
      <ExamPrepSupportCard onGuidancePage={onGuidancePage} />
    </Router>,
  );
}

describe("ExamPrepSupportCard", () => {
  afterEach(() => cleanup());

  it("advertises optional exam preparation and shows profession-matched resources", () => {
    profileState.profession = "Doctor";
    renderCard();

    expect(screen.getByText("Prepare for your professional exams")).toBeTruthy();
    expect(screen.getByText("PLAB preparation")).toBeTruthy();
    expect(screen.getByText(/will not hold up your next steps/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /See exam and registration steps/ }).getAttribute("href"))
      .toBe("/regulatory-guidance");
  });

  it("opens official link resources directly and shows their applicability and review date", () => {
    profileState.profession = "Nurse";
    videoState.data.videos = [{
      id: -1003,
      title: "NMC CBT preparation",
      description: "Official CBT guidance.",
      category: "professional_registration",
      applicability: "Nurses · NMC Test of Competence · CBT",
      durationSeconds: null,
      videoEmbedUrl: null,
      mediaUrl: null,
      sourceUrl: "https://www.nmc.org.uk/registration/joining-the-register/toc/toc-nursing-and-midwifery/cbt/",
      reviewedAt: "2026-10-10T00:00:00.000Z",
    }];

    renderCard();

    const resourceLink = screen.getByRole("link", { name: /NMC CBT preparation/ });
    expect(resourceLink.getAttribute("href")).toContain("nmc.org.uk");
    expect(resourceLink.getAttribute("target")).toBe("_blank");
    expect(screen.getByText(/Nurses · NMC Test of Competence · CBT · Reviewed 10 Oct 2026/)).toBeTruthy();
  });

  it("does not expose the learning function to unsupported professions", () => {
    profileState.profession = "Pharmacist";
    renderCard();

    expect(screen.queryByText("Prepare for your professional exams")).toBeNull();
    expect(screen.queryByText("PLAB preparation")).toBeNull();
  });

  it("jumps to the registration pathway instead of linking back to itself", () => {
    profileState.profession = "Nurse";
    renderCard(true);

    const guidanceLink = screen.getByRole("link", { name: /Jump to exam and registration steps/ });
    expect(guidanceLink.getAttribute("href")).toBe("#registration-pathway");
  });
});
