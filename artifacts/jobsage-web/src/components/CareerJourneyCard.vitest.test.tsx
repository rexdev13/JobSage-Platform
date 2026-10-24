import { render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import { CareerJourneyCard } from "./CareerJourneyCard";
import {
  CAREER_JOURNEY_STAGES,
  type CareerJourneyStage,
} from "@/lib/candidateJourney";

vi.mock("wouter", () => ({
  Link: ({ children, ...props }: React.ComponentProps<"a">) => <a {...props}>{children}</a>,
}));

const stages: CareerJourneyStage[] = CAREER_JOURNEY_STAGES.map((label, index) => ({
  label,
  status: index < 3 ? "complete" : index === 3 ? "current" : "upcoming",
}));

describe("CareerJourneyCard grid layout", () => {
  it("renders all nine numbered stages on an accessible progress path", () => {
    render(<CareerJourneyCard stages={stages} layout="grid" />);

    expect(screen.getByText("3 of 9 stages complete")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "UK Career Journey progress" })).toHaveAttribute(
      "aria-valuetext",
      "3 of 9 stages complete",
    );
    expect(screen.getAllByTestId(/career-journey-stage-/)).toHaveLength(9);

    stages.forEach((stage, index) => {
      const node = screen.getByTestId(`career-journey-stage-${index + 1}`);
      expect(within(node).getByText(String(index + 1))).toBeInTheDocument();
      expect(node).toHaveAttribute(
        "aria-label",
        `Stage ${index + 1}: ${stage.label}, ${stage.status}`,
      );
    });

    expect(screen.getByTestId("career-journey-stage-4")).toHaveAttribute("aria-current", "step");
    expect(screen.getByText("Start Your New Career in the UK")).toBeInTheDocument();
  });
});
