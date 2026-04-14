import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, Button, PageTransition } from "@/components/ui-enhanced";
import {
  useListJobApplicants,
  useGetJobListing,
  useUpdateApplicantStage,
  getListJobApplicantsQueryKey,
  type JobApplicant,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft,
  Users,
  Star,
  CheckCircle2,
  XCircle,
  Clock,
  Briefcase,
  MapPin,
  BadgeCheck,
  ChevronDown,
  Globe,
  Building2,
  AlertCircle,
  StickyNote,
} from "lucide-react";
import { motion } from "framer-motion";

const PIPELINE_STAGES = [
  { value: "applied", label: "Applied", color: "bg-blue-100 text-blue-800" },
  { value: "shortlisted", label: "Shortlisted", color: "bg-purple-100 text-purple-800" },
  { value: "interview", label: "Interviewing", color: "bg-violet-100 text-violet-800" },
  { value: "offer", label: "Offer Made", color: "bg-emerald-100 text-emerald-800" },
  { value: "rejected", label: "Rejected", color: "bg-red-100 text-red-700" },
  { value: "no_response", label: "No Response", color: "bg-muted text-muted-foreground" },
] as const;

type PipelineStage = typeof PIPELINE_STAGES[number]["value"];

function ConfidenceBadge({ confidence }: { confidence: string }) {
  const config: Record<string, { label: string; className: string }> = {
    high: { label: "High confidence", className: "bg-emerald-100 text-emerald-800" },
    medium: { label: "Medium confidence", className: "bg-amber-100 text-amber-800" },
    low: { label: "Low confidence", className: "bg-red-100 text-red-700" },
  };
  const c = config[confidence] ?? config.low;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${c.className}`}>
      {c.label}
    </span>
  );
}

function ApplicantCard({ applicant, jobId, onStageChange }: {
  applicant: JobApplicant;
  jobId: number;
  onStageChange: (applicationId: number, stage: PipelineStage, notes?: string) => void;
}) {
  const [showNotes, setShowNotes] = useState(false);
  const [notes, setNotes] = useState(applicant.notes ?? "");
  const [stageMenuOpen, setStageMenuOpen] = useState(false);

  const stageConfig = PIPELINE_STAGES.find((s) => s.value === applicant.stage) ?? PIPELINE_STAGES[0];

  const scoreColor =
    applicant.matchScore >= 80 ? "text-emerald-700 bg-emerald-100"
    : applicant.matchScore >= 50 ? "text-blue-700 bg-blue-100"
    : "text-muted-foreground bg-muted";

  return (
    <Card className="p-5 hover:shadow-sm transition-all">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold ${scoreColor}`}>
              <Star className="w-3 h-3" /> {applicant.matchScore}% match
            </span>
            {applicant.isEligible ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">
                <CheckCircle2 className="w-3 h-3" /> Eligible
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800">
                <Clock className="w-3 h-3" /> Not yet eligible
              </span>
            )}
            <ConfidenceBadge confidence={applicant.complianceConfidence} />
          </div>

          <h3 className="text-base font-semibold text-foreground">{applicant.candidateName}</h3>
          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
            {applicant.profession && (
              <span className="capitalize">{applicant.profession.replace(/_/g, " ")}</span>
            )}
            {applicant.registrationStatus && (
              <span className="capitalize">{applicant.registrationStatus.replace(/_/g, " ")}</span>
            )}
            {applicant.qualificationCountry && (
              <span className="flex items-center gap-1"><Globe className="w-3 h-3" /> Qualified in {applicant.qualificationCountry}</span>
            )}
            {applicant.experienceYears != null && (
              <span>{applicant.experienceYears} yr{applicant.experienceYears !== 1 ? "s" : ""} exp.</span>
            )}
            {applicant.requiresSponsorship && (
              <span className="flex items-center gap-1 text-blue-700"><BadgeCheck className="w-3 h-3" /> Needs sponsorship</span>
            )}
          </div>

          <p className="text-xs text-muted-foreground mt-1">
            Applied {new Date(applicant.appliedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
          </p>
        </div>

        {/* Stage selector */}
        <div className="relative shrink-0">
          <button
            onClick={() => setStageMenuOpen((v) => !v)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold ${stageConfig.color} cursor-pointer hover:opacity-90 transition-opacity`}
          >
            {stageConfig.label} <ChevronDown className="w-3 h-3" />
          </button>
          {stageMenuOpen && (
            <div className="absolute right-0 top-full mt-1 bg-background border border-border rounded-xl shadow-lg z-10 min-w-[160px] py-1">
              {PIPELINE_STAGES.map((s) => (
                <button
                  key={s.value}
                  onClick={() => {
                    onStageChange(applicant.applicationId, s.value);
                    setStageMenuOpen(false);
                  }}
                  className={`w-full text-left px-3 py-2 text-xs hover:bg-muted transition-colors ${applicant.stage === s.value ? "font-semibold" : ""}`}
                >
                  <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full ${s.color}`}>
                    {s.label}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Internal notes */}
      <div className="mt-3">
        <button
          onClick={() => setShowNotes((v) => !v)}
          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
        >
          <StickyNote className="w-3 h-3" />
          {showNotes ? "Hide notes" : (applicant.notes ? "View notes" : "Add internal note")}
        </button>
        {showNotes && (
          <div className="mt-2">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Internal notes (not visible to candidate)…"
              rows={2}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-xs focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
            />
            <Button
              size="sm"
              className="mt-1.5 text-xs h-7"
              onClick={() => { onStageChange(applicant.applicationId, applicant.stage as PipelineStage, notes); setShowNotes(false); }}
            >
              Save Note
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

export default function EmployerJobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const jobId = parseInt(id, 10);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useListJobApplicants(jobId);
  const { data: job } = useGetJobListing(jobId);
  const stageMutation = useUpdateApplicantStage();

  const [filterStage, setFilterStage] = useState<PipelineStage | "all">("all");

  const applicants = data?.applicants ?? [];
  const filteredApplicants = filterStage === "all" ? applicants : applicants.filter((a) => a.stage === filterStage);

  const stageCounts = PIPELINE_STAGES.reduce<Record<string, number>>((acc, s) => {
    acc[s.value] = applicants.filter((a) => a.stage === s.value).length;
    return acc;
  }, {});

  function handleStageChange(applicationId: number, stage: PipelineStage, notes?: string) {
    stageMutation.mutate(
      { jobId, applicationId, data: { stage, notes } },
      {
        onSuccess: () => {
          void queryClient.invalidateQueries({ queryKey: getListJobApplicantsQueryKey(jobId) });
          toast({ title: "Stage updated." });
        },
        onError: () => toast({ title: "Error", description: "Could not update stage.", variant: "destructive" }),
      },
    );
  }

  return (
    <AppLayout>
      <PageTransition className="max-w-4xl mx-auto p-6 space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setLocation("/employer/dashboard")}>
            <ArrowLeft className="w-4 h-4 mr-1" /> Dashboard
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold text-foreground truncate">{data?.job?.title ?? job?.title ?? "Job Applicants"}</h1>
            {(data?.job ?? job) && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                <MapPin className="w-3 h-3" /> {(data?.job ?? job)!.location}
                <span>·</span>
                <span className="font-mono">{(data?.job ?? job)!.regulator}</span>
              </div>
            )}
          </div>
        </div>

        {/* Pipeline stage summary */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          {PIPELINE_STAGES.map((s) => (
            <button
              key={s.value}
              onClick={() => setFilterStage(filterStage === s.value ? "all" : s.value)}
              className={`p-2.5 rounded-xl border text-center transition-all ${filterStage === s.value ? "border-primary shadow-sm bg-primary/5" : "border-border hover:border-primary/30"}`}
            >
              <p className={`text-lg font-bold leading-none ${stageCounts[s.value] === 0 ? "text-muted-foreground/40" : "text-foreground"}`}>
                {stageCounts[s.value] ?? 0}
              </p>
              <p className="text-xs text-muted-foreground mt-1 leading-tight">{s.label}</p>
            </button>
          ))}
        </div>

        {/* Applicant list */}
        {isLoading ? (
          <Card className="p-8 text-center">
            <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">Loading applicants…</p>
          </Card>
        ) : isError ? (
          <Card className="p-8 text-center border-destructive/20">
            <AlertCircle className="w-8 h-8 text-destructive mx-auto mb-2" />
            <p className="text-sm text-destructive">Could not load applicants.</p>
          </Card>
        ) : filteredApplicants.length === 0 ? (
          <Card className="p-10 text-center">
            <Users className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
            <h3 className="text-base font-semibold mb-1">
              {filterStage === "all" ? "No applicants yet" : `No ${PIPELINE_STAGES.find((s) => s.value === filterStage)?.label.toLowerCase()} candidates`}
            </h3>
            <p className="text-sm text-muted-foreground">
              {filterStage === "all"
                ? "Once candidates apply, they'll appear here ranked by eligibility match."
                : "Move candidates into this stage from the full list."}
            </p>
            {filterStage !== "all" && (
              <Button size="sm" variant="outline" className="mt-3" onClick={() => setFilterStage("all")}>
                View all applicants
              </Button>
            )}
          </Card>
        ) : (
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              {filteredApplicants.length} candidate{filteredApplicants.length !== 1 ? "s" : ""} · sorted by match score
            </p>
            {filteredApplicants.map((applicant) => (
              <motion.div key={applicant.applicationId} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                <ApplicantCard
                  applicant={applicant}
                  jobId={jobId}
                  onStageChange={handleStageChange}
                />
              </motion.div>
            ))}
          </div>
        )}
      </PageTransition>
    </AppLayout>
  );
}
