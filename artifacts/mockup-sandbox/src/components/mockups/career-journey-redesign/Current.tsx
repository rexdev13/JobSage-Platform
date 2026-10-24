import "./_group.css";
import { CareerJourneyCard, type CareerJourneyStage } from "./_shared/CareerJourneyCard";

const stages: CareerJourneyStage[] = [
  { label: "Upload", status: "complete" },
  { label: "Enhance", status: "complete" },
  { label: "Match", status: "complete" },
  { label: "Apply", status: "current" },
  { label: "Interview", status: "upcoming" },
  { label: "Offer", status: "upcoming" },
  { label: "Visa", status: "upcoming" },
  { label: "Relocate", status: "upcoming" },
  { label: "Start Your New Career in the UK", status: "upcoming" },
];

export function Current() {
  return (
    <main className="min-h-screen w-full bg-background p-6 font-sans text-foreground">
      <section className="mx-auto w-full max-w-[920px]">
        <CareerJourneyCard
          title="UK Career Journey"
          stages={stages}
          layout="grid"
          className="w-full"
        />
      </section>
    </main>
  );
}
