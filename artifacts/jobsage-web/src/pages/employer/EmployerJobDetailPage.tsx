import { useEffect, useState } from "react";
import { useParams, useLocation } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, Button, PageTransition } from "@/components/ui-enhanced";
import {
  useListJobApplicants,
  useGetJobListing,
  useUpdateApplicantStage,
  getListJobApplicantsQueryKey,
  getGetEmployerCandidateFeedbackQueryKey,
  getListEmployerInterviewParticipantsQueryKey,
  useGetEmployerCandidateFeedback,
  useUpsertEmployerCandidateFeedback,
  useScheduleEmployerInterview,
  useListEmployerInterviewParticipants,
  useUpdateEmployerInterviewParticipants,
  useRespondToEmployerInterviewInvitation,
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
  Mail,
} from "lucide-react";
import { motion } from "framer-motion";
import { useAuth } from "@workspace/auth-web";
import { useEmployerOrganizations, type EmployerStaffRole } from "@/hooks/useEmployerOrganizations";
import { ContentReportDialog } from "@/components/ContentReportDialog";

const PIPELINE_STAGES = [
  { value: "applied", label: "Applied", color: "bg-blue-100 text-blue-800" },
  { value: "shortlisted", label: "Shortlisted", color: "bg-purple-100 text-purple-800" },
  { value: "interview", label: "Interviewing", color: "bg-violet-100 text-violet-800" },
  { value: "offer", label: "Offer Made", color: "bg-emerald-100 text-emerald-800" },
  { value: "rejected", label: "Rejected", color: "bg-red-100 text-red-700" },
  { value: "no_response", label: "No Response", color: "bg-muted text-muted-foreground" },
] as const;

type PipelineStage = typeof PIPELINE_STAGES[number]["value"];

function toLocalDateTimeInput(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

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

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api";

function ApplicantCard({ applicant, jobId, jobTitle, onStageChange, staffRole, currentUserId }: {
  applicant: JobApplicant;
  jobId: number;
  jobTitle: string;
  onStageChange: (applicationId: number, stage: PipelineStage, notes?: string) => void;
  staffRole: EmployerStaffRole;
  currentUserId: string;
}) {
  const [showNotes, setShowNotes] = useState(false);
  const [notes, setNotes] = useState(applicant.notes ?? "");
  const [stageMenuOpen, setStageMenuOpen] = useState(false);
  const [showMessage, setShowMessage] = useState(false);
  const [messageText, setMessageText] = useState("");
  const [sending, setSending] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  const [interviewDate, setInterviewDate] = useState(() => toLocalDateTimeInput(applicant.interviewDate));
  const [interviewNotes, setInterviewNotes] = useState(applicant.interviewNotes ?? "");
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const isOwnerOrAdmin = staffRole === "employer_owner" || staffRole === "employer_admin";
  const canManagePipeline = isOwnerOrAdmin || staffRole === "recruiter";
  const canContactCandidate = canManagePipeline;
  const canSubmitFeedback = isOwnerOrAdmin || staffRole === "hiring_manager";
  const canScheduleInterview = isOwnerOrAdmin || staffRole === "recruiter" || staffRole === "hiring_manager";
  const feedbackQuery = useGetEmployerCandidateFeedback(jobId, applicant.applicationId, {
    query: {
      queryKey: getGetEmployerCandidateFeedbackQueryKey(jobId, applicant.applicationId),
      enabled: canSubmitFeedback,
      retry: false,
    },
  });
  const participantsQuery = useListEmployerInterviewParticipants(jobId, applicant.applicationId, {
    query: {
      queryKey: getListEmployerInterviewParticipantsQueryKey(jobId, applicant.applicationId),
      enabled: canScheduleInterview,
      retry: false,
    },
  });
  const saveFeedback = useUpsertEmployerCandidateFeedback();
  const scheduleInterview = useScheduleEmployerInterview();
  const updateParticipants = useUpdateEmployerInterviewParticipants();
  const respondToInterview = useRespondToEmployerInterviewInvitation();

  useEffect(() => {
    setInterviewDate(toLocalDateTimeInput(applicant.interviewDate));
    setInterviewNotes(applicant.interviewNotes ?? "");
  }, [applicant.interviewDate, applicant.interviewNotes]);

  async function handleSendMessage() {
    if (!messageText.trim()) return;
    setSending(true);
    try {
      const res = await fetch(`${API_BASE}/employer/contact-candidate`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipientUserId: applicant.userId,
          messageText: messageText.trim(),
          subject: `Message regarding your application for ${jobTitle}`,
          vacancyId: jobId,
          applicationId: applicant.applicationId,
        }),
      });
      if (!res.ok) throw new Error("Send failed");
      toast({ title: "Message sent", description: `${applicant.candidateName ?? "Candidate"} will see it in their inbox.` });
      setMessageText("");
      setShowMessage(false);
    } catch {
      toast({ title: "Failed to send", variant: "destructive" });
    } finally {
      setSending(false);
    }
  }

  const stageConfig = PIPELINE_STAGES.find((s) => s.value === applicant.stage) ?? PIPELINE_STAGES[0];

  const scoreColor =
    applicant.matchScore >= 80 ? "text-emerald-700 bg-emerald-100"
    : applicant.matchScore >= 50 ? "text-blue-700 bg-blue-100"
    : "text-muted-foreground bg-muted";
  const profileReportEvidence = [
    `Candidate: ${applicant.candidateName ?? "Candidate"}`,
    applicant.profession && `Profession: ${applicant.profession}`,
    applicant.registrationStatus && `Registration status: ${applicant.registrationStatus}`,
    applicant.qualificationCountry && `Qualification country: ${applicant.qualificationCountry}`,
    applicant.experienceYears != null && `Experience years: ${applicant.experienceYears}`,
    `Requires sponsorship: ${applicant.requiresSponsorship ? "yes" : "no"}`,
  ].filter(Boolean).join("\n");

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
          <div className="mt-1">
            <ContentReportDialog
              contentType="candidate_profile"
              contentId={applicant.userId}
              contextId={applicant.applicationId}
              context={`Candidate profile shown with the application for ${jobTitle}`}
              content={profileReportEvidence}
              label="Report candidate profile"
            />
          </div>
        </div>

        {/* Stage selector */}
        {canManagePipeline ? (
          <div className="relative shrink-0">
            <button type="button" aria-label={`Change stage for ${applicant.candidateName}`} aria-expanded={stageMenuOpen}
              onClick={() => setStageMenuOpen((v) => !v)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold ${stageConfig.color} cursor-pointer hover:opacity-90 transition-opacity`}>
              {stageConfig.label} <ChevronDown className="w-3 h-3" />
            </button>
            {stageMenuOpen && (
              <div className="absolute right-0 top-full mt-1 bg-background border border-border rounded-xl shadow-lg z-10 min-w-[160px] py-1">
                {PIPELINE_STAGES.map((s) => (
                  <button type="button" key={s.value} data-testid={`button-stage-${applicant.applicationId}-${s.value}`}
                    onClick={() => {
                      onStageChange(applicant.applicationId, s.value);
                      setStageMenuOpen(false);
                    }}
                    className={`w-full text-left px-3 py-2 text-xs hover:bg-muted transition-colors ${applicant.stage === s.value ? "font-semibold" : ""}`}>
                    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full ${s.color}`}>{s.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <span className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${stageConfig.color}`}>{stageConfig.label}</span>
        )}
      </div>

      {/* Internal notes */}
      {canManagePipeline && <div className="mt-3">
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
      </div>}

      {/* Message candidate */}
      {canContactCandidate && <div className="mt-2">
        <button
          onClick={() => setShowMessage((v) => !v)}
          className="text-xs text-primary hover:text-primary/80 flex items-center gap-1 transition-colors"
        >
          <Mail className="w-3 h-3" />
          {showMessage ? "Cancel" : "Message this candidate"}
        </button>
        {showMessage && (
          <div className="mt-2">
            <textarea
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              placeholder={`Write a message to ${applicant.candidateName ?? "this candidate"}…`}
              rows={3}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-xs focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
            />
            <Button
              size="sm"
              className="mt-1.5 text-xs h-7"
              onClick={handleSendMessage}
              disabled={sending || !messageText.trim()}
            >
              {sending ? "Sending…" : "Send message"}
            </Button>
          </div>
        )}
      </div>}

      {canSubmitFeedback && (
        <section className="mt-4 border-t pt-4" aria-label={`Team feedback for ${applicant.candidateName}`}>
          <h4 className="text-sm font-semibold">Team feedback</h4>
          {feedbackQuery.isLoading ? <p className="mt-2 text-xs text-muted-foreground">Loading feedback…</p> : (
            <div className="mt-2 space-y-2">
              {(feedbackQuery.data?.feedback ?? []).map(item => (
                <div key={item.id} className="rounded-lg bg-muted/50 p-3" data-testid={`feedback-entry-${item.id}`}>
                  <p className="whitespace-pre-wrap text-sm">{item.feedback}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {[item.authorFirstName, item.authorLastName].filter(Boolean).join(" ") || "Staff member"} · {new Date(item.updatedAt).toLocaleDateString()}
                  </p>
                  {item.authorUserId !== currentUserId && (
                    <div className="mt-1">
                      <ContentReportDialog
                        contentType="employer_feedback"
                        contentId={String(item.id)}
                        contextId={applicant.applicationId}
                        context={`Team feedback for ${applicant.candidateName} on ${jobTitle}`}
                        content={item.feedback}
                        label="Report this feedback"
                      />
                    </div>
                  )}
                </div>
              ))}
              <label htmlFor={`feedback-${applicant.applicationId}`} className="block text-xs font-medium">Your assessment</label>
              <textarea id={`feedback-${applicant.applicationId}`} value={feedbackText} onChange={event => setFeedbackText(event.target.value)}
                maxLength={4000} rows={3} data-testid={`textarea-feedback-${applicant.applicationId}`}
                placeholder="Add evidence-based notes for the hiring team…"
                className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" />
              <Button type="button" size="sm" disabled={!feedbackText.trim() || saveFeedback.isPending}
                onClick={() => saveFeedback.mutate({ jobId, applicationId: applicant.applicationId, data: { feedback: feedbackText.trim() } }, {
                  onSuccess: () => {
                    setFeedbackText("");
                    void feedbackQuery.refetch();
                    toast({ title: "Feedback saved for the hiring team." });
                  },
                  onError: () => toast({ title: "Feedback not saved", variant: "destructive" }),
                })} data-testid={`button-save-feedback-${applicant.applicationId}`}>Save feedback</Button>
            </div>
          )}
        </section>
      )}

      {canScheduleInterview && (
        <section className="mt-4 border-t pt-4" aria-label={`Interview details for ${applicant.candidateName}`}>
          <h4 className="text-sm font-semibold">Interview</h4>
          {applicant.interviewDate && (
            <div className="mt-2 rounded-lg bg-muted/50 p-3 text-sm" aria-live="polite"
              data-testid={`scheduled-interview-${applicant.applicationId}`}>
              <p className="font-medium">Scheduled for {new Date(applicant.interviewDate).toLocaleString()}</p>
              {applicant.interviewNotes && <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{applicant.interviewNotes}</p>}
            </div>
          )}
          <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <div>
              <label htmlFor={`interview-date-${applicant.applicationId}`} className="mb-1 block text-xs font-medium">Date and time</label>
              <input id={`interview-date-${applicant.applicationId}`} type="datetime-local" value={interviewDate}
                onChange={event => setInterviewDate(event.target.value)} data-testid={`input-interview-date-${applicant.applicationId}`}
                className="min-h-10 w-full rounded-lg border border-border bg-background px-3 text-sm" />
            </div>
            <div>
              <label htmlFor={`interview-notes-${applicant.applicationId}`} className="mb-1 block text-xs font-medium">Notes (optional)</label>
              <input id={`interview-notes-${applicant.applicationId}`} value={interviewNotes} maxLength={2000}
                onChange={event => setInterviewNotes(event.target.value)} data-testid={`input-interview-notes-${applicant.applicationId}`}
                className="min-h-10 w-full rounded-lg border border-border bg-background px-3 text-sm" />
            </div>
            <Button type="button" size="sm" disabled={!interviewDate || scheduleInterview.isPending}
              onClick={() => scheduleInterview.mutate({
                jobId, applicationId: applicant.applicationId,
                data: { interviewDate: new Date(interviewDate).toISOString(), notes: interviewNotes },
              }, {
                onSuccess: () => {
                  toast({ title: "Interview scheduled", description: "The candidate was notified in their inbox." });
                  void Promise.all([
                    participantsQuery.refetch(),
                    queryClient.invalidateQueries({ queryKey: getListJobApplicantsQueryKey(jobId) }),
                  ]);
                },
                onError: () => toast({ title: "Interview not scheduled", variant: "destructive" }),
              })} data-testid={`button-schedule-interview-${applicant.applicationId}`}>
              {applicant.interviewDate ? "Update interview" : "Schedule"}
            </Button>
          </div>
          <div className="mt-3 space-y-2">
            {(participantsQuery.data?.participants ?? []).map(participant => (
              <div key={participant.userId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm"
                data-testid={`interview-participant-${applicant.applicationId}-${participant.userId}`}>
                <span>{[participant.firstName, participant.lastName].filter(Boolean).join(" ") || participant.email}
                  <span className="ml-2 text-xs capitalize text-muted-foreground">{participant.status}</span>
                </span>
                {participant.userId === currentUserId && participant.status === "invited" && (
                  <span className="flex gap-2">
                    <Button type="button" size="sm" onClick={() => respondToInterview.mutate({
                      jobId, applicationId: applicant.applicationId, data: { status: "accepted" },
                    }, { onSuccess: () => void participantsQuery.refetch() })} data-testid={`button-accept-interview-${applicant.applicationId}`}>Join</Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => respondToInterview.mutate({
                      jobId, applicationId: applicant.applicationId, data: { status: "declined" },
                    }, { onSuccess: () => void participantsQuery.refetch() })} data-testid={`button-decline-interview-${applicant.applicationId}`}>Decline</Button>
                  </span>
                )}
              </div>
            ))}
            {participantsQuery.data && !participantsQuery.data.participants.some(participant => participant.userId === currentUserId)
              && currentUserId && (
                <Button type="button" size="sm" variant="outline" disabled={updateParticipants.isPending}
                  onClick={async () => {
                    try {
                      await updateParticipants.mutateAsync({
                        jobId, applicationId: applicant.applicationId,
                        data: { userId: currentUserId, participating: true },
                      });
                      await respondToInterview.mutateAsync({
                        jobId, applicationId: applicant.applicationId, data: { status: "accepted" },
                      });
                      await participantsQuery.refetch();
                    } catch {
                      toast({ title: "You could not join this interview", description: "Confirm that you are assigned to this job.", variant: "destructive" });
                    }
                  }} data-testid={`button-join-interview-${applicant.applicationId}`}>Join interview</Button>
              )}
          </div>
        </section>
      )}
    </Card>
  );
}

export default function EmployerJobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const jobId = parseInt(id, 10);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();
  const { activeOrganization } = useEmployerOrganizations();
  const staffRole = activeOrganization?.role;
  const canManagePipeline = staffRole === "employer_owner" || staffRole === "employer_admin" || staffRole === "recruiter";
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useListJobApplicants(jobId);
  const { data: job } = useGetJobListing(jobId);
  const stageMutation = useUpdateApplicantStage();

  const [filterStage, setFilterStage] = useState<PipelineStage | "all">("all");

  const applicants = data?.applicants ?? [];
  const visibleJob = data?.job ?? job;
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
            {visibleJob && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                <MapPin className="w-3 h-3" /> {visibleJob.location}
                <span>·</span>
                <span className="font-mono">{visibleJob.regulator}</span>
              </div>
            )}
            {visibleJob?.status === "published" && (
              <div className="mt-1">
                <ContentReportDialog
                  contentType="job_listing"
                  contentId={String(jobId)}
                  contextId={jobId}
                  context={`Published job listing “${visibleJob.title}” (${visibleJob.location}; ${visibleJob.regulator})`}
                  content={`Title: ${visibleJob.title}\nLocation: ${visibleJob.location}\nRegulator: ${visibleJob.regulator}`}
                  label="Report this job listing"
                />
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
                  jobTitle={data?.job?.title ?? job?.title ?? "this role"}
                  onStageChange={handleStageChange}
                  staffRole={staffRole ?? "employer_viewer"}
                  currentUserId={user?.id ?? ""}
                />
              </motion.div>
            ))}
          </div>
        )}
      </PageTransition>
    </AppLayout>
  );
}
