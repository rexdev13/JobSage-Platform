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
        sourceUrl: null,
      }],
    },
  },
}));

vi.mock("@workspace/api-client-react", () => ({
  getListLearningVideosQueryKey: () => ["/api/learning-videos"],
  useGetMyProfile: () => ({ data: { profession: profileState.profession }, isLoading: false }),
  useListLearningVideos: () => ({ data: videoState.data, isLoading: false, isError: false }),
}));

import { ExamPrepSupportCard } from "./ExamPrepSupportCard";

function renderCard() {
  return render(
    <Router>
      <ExamPrepSupportCard />
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
  });

  it("does not expose the learning function to unsupported professions", () => {
    profileState.profession = "Pharmacist";
    renderCard();

    expect(screen.queryByText("Prepare for your professional exams")).toBeNull();
    expect(screen.queryByText("PLAB preparation")).toBeNull();
  });
});
