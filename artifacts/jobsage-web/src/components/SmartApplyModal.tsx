import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui-enhanced";
import {
  useSmartApplyPrefill,
  useMarkApplication,
  useSaveSmartApplyDraft,
  useDeleteSmartApplyDraft,
  useGetSmartApplyDraft,
  useGetSmartApplyCandidatePrefill,
  useListMyDocuments,
  useSendSpeculativeApplication,
  getListMyApplicationsQueryKey,
  getListSpeculativeApplicationsQueryKey,
  type ApplicationQuestion,
  type SmartApplyPrefill,
  type SmartApplyPrefillResponse,
  type SmartApplyVacancyContext,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import {
  X,
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  Send,
  Loader2,
  Building2,
  MapPin,
  FileText,
  Copy,
  Download,
  MessageCircle,
  ArrowRight,
  Zap,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { SmartApplyAssistant } from "./SmartApplyAssistant";
import { isExtensionInstalled, ExtensionRequiredModal } from "./SmartApplyExtensionPrompt";
import { compileSmartApplyOutreach, SEND_CV_QUESTION_IDS } from "@/lib/smartApplyOutreach";

function useCoverLetterStream() {
  const [text, setText] = useState("");
  const [disclaimer, setDisclaimer] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() { setText(""); setDisclaimer(""); setStreaming(false); setDone(false); setError(null); }

  async function generate(payload: { jobTitle: string; employer?: string; location?: string | null; regulator?: string | null; roleId?: number }) {
    reset();
    setStreaming(true);
    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    try {
      const resp = await fetch(`${base}/api/cover-letter/generate-stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ...payload, employer: payload.employer ?? "NHS Trust" }),
      });
      if (!resp.ok || !resp.body) { setError("Failed to generate. Please try again."); setStreaming(false); return; }
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done: rdDone, value } = await reader.read();
        if (rdDone) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const p = JSON.parse(line.slice(6)) as { text?: string; done?: boolean; disclaimer?: string; error?: string };
            if (p.error) { setError(p.error); setStreaming(false); return; }
            if (p.text) setText((prev) => prev + p.text);
            if (p.done) { setDisclaimer(p.disclaimer ?? ""); setDone(true); setStreaming(false); }
          } catch { /* ignore */ }
        }
      }
    } catch { setError("Network error. Please try again."); setStreaming(false); }
  }

  return { text, setText, disclaimer, streaming, done, error, generate, reset };
}

export interface SmartApplySendCvContext extends SmartApplyVacancyContext {
  companyName: string;
  sponsorLicenceId?: number | null;
  vacancyId?: number | null;
  sourceType?: "job_board" | "company_site" | null;
  boardName?: string | null;
}

interface SmartApplyModalProps {
  roleId: number;
  roleTitle: string;
  vacancyContext?: SmartApplyVacancyContext;
  sendCvContext?: SmartApplySendCvContext;
  onClose: () => void;
  onSuccess: () => void;
}

function draftKey(roleId: number) {
  return `smart-apply-draft-${roleId}`;
}

function loadDraft(roleId: number): Record<string, string> | null {
  try {
    const raw = localStorage.getItem(draftKey(roleId));
    if (!raw) return null;
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return null;
  }
}

function saveDraft(roleId: number, answers: Record<string, string>) {
  try {
    localStorage.setItem(draftKey(roleId), JSON.stringify(answers));
  } catch {
    // storage quota exceeded — silently ignore
  }
}

function clearDraft(roleId: number) {
  try {
    localStorage.removeItem(draftKey(roleId));
  } catch {
    // silently ignore
  }
}

const CONFIDENCE_CONFIG = {
  high: { color: "text-emerald-600", bg: "bg-emerald-50 border-emerald-200", label: "High confidence" },
  medium: { color: "text-amber-600", bg: "bg-amber-50 border-amber-200", label: "Medium confidence — review suggested" },
  low: { color: "text-rose-500", bg: "bg-rose-50 border-rose-200", label: "Low confidence — please edit" },
  none: { color: "text-muted-foreground", bg: "bg-muted/50 border-border", label: "Could not answer — please complete" },
};

interface NextMatchRole {
  id: number;
  title: string;
  employer: string;
  location: string | null;
  matchScore: number;
  isEligible: boolean;
  matchReason?: string | null;
}

export function SmartApplyModal({
  roleId,
  roleTitle,
  vacancyContext,
  sendCvContext,
  onClose,
  onSuccess,
}: SmartApplyModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  // Applying requires the Smart Apply extension so every outbound application
  // is tracked. Pages gate before opening this modal, but guard here too in
  // case the modal is opened directly.
  const isSendCv = sendCvContext != null;
  const effectiveVacancyContext = sendCvContext ?? vacancyContext ?? { title: roleTitle };
  const [extensionOk, setExtensionOk] = useState(() => isSendCv || isExtensionInstalled());
  const [step, setStep] = useState<"loading" | "error" | "review" | "submitting" | "coverLetter" | "nextMatches">("loading");
  const [nextMatchRoles, setNextMatchRoles] = useState<NextMatchRole[]>([]);
  const coverLetter = useCoverLetterStream();
  const [clEditable, setClEditable] = useState("");
  const [clCopied, setClCopied] = useState(false);
  const [triggerQuestion, setTriggerQuestion] = useState<{ id: string; question: string } | null>(null);

  if (coverLetter.streaming && coverLetter.text !== clEditable) {
    setClEditable(coverLetter.text);
  }
  const [prefillData, setPrefillData] = useState<SmartApplyPrefillResponse | null>(null);
  const [prefillError, setPrefillError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [currentQuestion, setCurrentQuestion] = useState(0);

  const prefillMutation = useSmartApplyPrefill();
  const markApplicationMutation = useMarkApplication();
  const sendCvMutation = useSendSpeculativeApplication();
  const saveDraftMutation = useSaveSmartApplyDraft();
  const deleteDraftMutation = useDeleteSmartApplyDraft();
  const serverDraftQuery = useGetSmartApplyDraft(roleId);
  const candidatePrefillQuery = useGetSmartApplyCandidatePrefill();
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: documentsData } = useListMyDocuments();
  const cvDocuments = (documentsData?.documents ?? []).filter(
    (d) => (d as { documentType?: string | null }).documentType === "cv",
  );
  const [selectedCvId, setSelectedCvId] = useState<number | null>(null);
  useEffect(() => {
    if (!documentsData) return;
    setSelectedCvId((prev) => {
      if (prev !== null) return prev;
      const cvDocs = (documentsData.documents ?? []).filter(
        (d) => (d as { documentType?: string | null }).documentType === "cv",
      );
      const primary = cvDocs.find((d) => (d as { isPrimary?: boolean }).isPrimary);
      return primary?.id ?? cvDocs[0]?.id ?? null;
    });
  }, [documentsData]);

  const updateAnswers = useCallback(
    (updater: (prev: Record<string, string>) => Record<string, string>) => {
      setAnswers((prev) => {
        const next = updater(prev);
        saveDraft(roleId, next);
        if (debounceTimer.current) clearTimeout(debounceTimer.current);
        debounceTimer.current = setTimeout(() => {
          saveDraftMutation.mutate({ roleId, data: { answers: next } });
        }, 800);
        return next;
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [roleId]
  );

  const [hasDraft, setHasDraft] = useState(false);

  useEffect(() => {
    if (!extensionOk) return;
    prefillMutation.mutate(
      { id: roleId, data: effectiveVacancyContext },
      {
        onSuccess: (data) => {
          setPrefillError(null);
          setPrefillData(data);
          const aiAnswers: Record<string, string> = {};
          for (const pf of data.prefills) {
            aiAnswers[pf.questionId] = pf.aiAnswer;
          }
          const serverDraft = serverDraftQuery.data?.answers;
          const localDraft = loadDraft(roleId);
          const bestDraft =
            serverDraft && Object.keys(serverDraft).length > 0
              ? serverDraft
              : localDraft && Object.keys(localDraft).length > 0
              ? localDraft
              : null;
          if (bestDraft) {
            setHasDraft(true);
            setAnswers({ ...aiAnswers, ...bestDraft });
          } else {
            setAnswers(aiAnswers);
          }
          setStep("review");
        },
        onError: (error) => {
          setPrefillError(error instanceof Error ? error.message : "Please try again.");
          setStep("error");
        },
      }
    );
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roleId, extensionOk]);

  const questions: ApplicationQuestion[] = prefillData?.questions ?? [];
  const prefills: SmartApplyPrefill[] = prefillData?.prefills ?? [];
  const roleContext = prefillData?.roleContext;

  const getPrefill = (questionId: string): SmartApplyPrefill | undefined =>
    prefills.find((p) => p.questionId === questionId);

  const totalQuestions = questions.length;
  const currentQ = questions[currentQuestion];
  const currentPrefill = currentQ ? getPrefill(currentQ.id) : undefined;

  const isLastQuestion = currentQuestion === totalQuestions - 1;
  const isFirstQuestion = currentQuestion === 0;

  async function handleSubmit() {
    if (
      isSendCv &&
      SEND_CV_QUESTION_IDS.some((questionId) => !answers[questionId]?.trim())
    ) {
      const firstMissingIndex = questions.findIndex(
        (question) => !answers[question.id]?.trim(),
      );
      if (firstMissingIndex >= 0) setCurrentQuestion(firstMissingIndex);
      toast({
        title: "Complete all six answers",
        description: "Please review and complete every Smart Apply answer before sending your CV.",
        variant: "destructive",
      });
      return;
    }

    setStep("submitting");
    try {
      if (sendCvContext) {
        if (selectedCvId == null) {
          throw new Error("A CV is required.");
        }
        const compiledOutreach = compileSmartApplyOutreach({
          answers,
          employerName: sendCvContext.companyName,
          jobTitle: roleTitle,
          candidateName: candidatePrefillQuery.data?.fullName ?? "",
        });
        const result = await sendCvMutation.mutateAsync({
          data: {
            companyName: sendCvContext.companyName,
            sponsorLicenceId: sendCvContext.sponsorLicenceId ?? undefined,
            vacancyTitle: roleTitle,
            vacancyRef: sendCvContext.vacancyId != null
              ? `sponsor-vacancy:${sendCvContext.vacancyId}`
              : `role:${roleId}`,
            roleId,
            vacancyUrl: sendCvContext.externalUrl ?? undefined,
            sourceType: sendCvContext.sourceType ?? undefined,
            boardName: sendCvContext.boardName ?? undefined,
            notes: compiledOutreach,
            cvDocumentId: selectedCvId,
            requireDirectContact: true,
            includeCoverLetter: false,
            coverLetterText: compiledOutreach,
          },
        });

        clearDraft(roleId);
        deleteDraftMutation.mutate({ roleId });
        void queryClient.invalidateQueries({ queryKey: getListSpeculativeApplicationsQueryKey() });
        void queryClient.invalidateQueries({ queryKey: getListMyApplicationsQueryKey() });
        const pending = result.application.deliveryStatus === "pending";
        toast({
          title: pending ? "Send CV saved" : "CV sent successfully",
          description: pending
            ? `Your outreach for ${roleTitle} is in your Application Tracker and awaits a verified employer contact.`
            : `Your CV and Smart Apply responses were sent to ${sendCvContext.companyName}.`,
        });
        onSuccess();
        return;
      }

      const answersJson = JSON.stringify({
        answers,
        summary: `Application for ${roleTitle} — ${totalQuestions} questions answered`,
      });

      await markApplicationMutation.mutateAsync({
        data: { roleId, notes: answersJson, smartApply: true, cvDocumentId: selectedCvId },
      });

      clearDraft(roleId);
      deleteDraftMutation.mutate({ roleId });
      queryClient.invalidateQueries({ queryKey: getListMyApplicationsQueryKey() });
      toast({
        title: "Application submitted!",
        description: `Your application for ${roleTitle} has been sent.`,
      });

      // Fetch next 3 best matches (excluding the role just applied for)
      try {
        const base = import.meta.env.BASE_URL.replace(/\/$/, "");
        const res = await fetch(`${base}/api/opportunities/recommended?limit=4`, { credentials: "include" });
        if (res.ok) {
          const data = await (res.json() as Promise<{ roles: NextMatchRole[] }>);
          const filtered = (data.roles ?? []).filter((r) => r.id !== roleId).slice(0, 3);
          if (filtered.length > 0) {
            setNextMatchRoles(filtered);
            setStep("nextMatches");
            return;
          }
        }
      } catch {
        // If fetch fails, fall through to onSuccess normally
      }

      onSuccess();
    } catch (error) {
      toast({
        title: isSendCv ? "Send CV failed" : "Submission failed",
        description: error instanceof Error && error.message === "A CV is required."
          ? "Please upload or select a CV before continuing."
          : "Please try again.",
        variant: "destructive",
      });
      setStep("review");
    }
  }

  if (!extensionOk) {
    return (
      <ExtensionRequiredModal
        open
        onClose={onClose}
        onProceed={() => setExtensionOk(true)}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <SmartApplyAssistant
        roleId={roleId}
        roleTitle={roleTitle}
        jobTitle={roleTitle}
        employer={sendCvContext?.companyName ?? effectiveVacancyContext.employer ?? undefined}
        jobDescription={effectiveVacancyContext.description ?? undefined}
        currentQuestion={currentQ ? { id: currentQ.id, question: currentQ.question } : undefined}
        onUseAnswer={(text) => {
          if (currentQ) {
            updateAnswers((prev) => ({ ...prev, [currentQ.id]: text }));
          }
        }}
        triggerQuestion={triggerQuestion}
        onTriggerConsumed={() => setTriggerQuestion(null)}
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="flex max-h-[95vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border border-border bg-background shadow-2xl sm:max-h-[90vh] sm:rounded-2xl"
      >
        <div className="flex items-start justify-between border-b border-border p-4 pb-3 sm:p-6 sm:pb-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Sparkles className="w-5 h-5 text-primary" />
              <h2 className="text-lg font-bold text-foreground">Smart Apply</h2>
            </div>
            <div className="flex items-center gap-2">
              <p className="text-sm text-muted-foreground font-medium truncate max-w-md">
                {roleTitle}
              </p>
              {hasDraft && step === "review" && (
                <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
                  Draft restored
                </span>
              )}
            </div>
            {(roleContext || sendCvContext) && (
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {(sendCvContext?.companyName ?? effectiveVacancyContext.employer) && (
                  <span className="flex min-w-0 items-center gap-1">
                    <Building2 className="w-3 h-3 shrink-0" />
                    <span className="truncate">
                      {sendCvContext?.companyName ?? effectiveVacancyContext.employer}
                    </span>
                  </span>
                )}
                <span className="flex items-center gap-1">
                  <MapPin className="w-3 h-3" />
                  {effectiveVacancyContext.location ?? roleContext?.location ?? "UK"}
                </span>
                <span className="rounded bg-primary/10 px-1.5 py-0.5 font-medium text-primary">
                  {effectiveVacancyContext.regulator ?? roleContext?.regulator ?? "Professional"}
                </span>
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          {step === "loading" && (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="w-10 h-10 text-primary animate-spin mb-4" />
              <p className="text-sm font-medium text-foreground">AI is preparing your answers…</p>
              <p className="text-xs text-muted-foreground mt-1">
                Analysing your profile and the role requirements
              </p>
            </div>
          )}

          {step === "error" && (
            <div className="flex flex-col items-center justify-center py-12">
              <AlertTriangle className="w-10 h-10 text-destructive mb-4" />
              <p className="text-sm font-medium text-foreground">Could not generate answers</p>
              <p className="text-xs text-muted-foreground mt-1 text-center max-w-xs">
                {prefillError ?? "Please ensure your candidate profile is complete, then try again."}
              </p>
              <Button className="mt-4" variant="outline" onClick={onClose}>
                Close
              </Button>
            </div>
          )}

          {step === "review" && currentQ && (
            <AnimatePresence mode="wait">
              <motion.div
                key={currentQuestion}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.2 }}
                className="space-y-4"
              >
                <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
                  <span>
                    Question {currentQuestion + 1} of {totalQuestions}
                  </span>
                  <div className="flex gap-1">
                    {questions.map((_, i) => (
                      <button
                        key={i}
                        onClick={() => setCurrentQuestion(i)}
                        className={`w-2 h-2 rounded-full transition-colors ${
                          i === currentQuestion
                            ? "bg-primary"
                            : i < currentQuestion
                            ? "bg-primary/40"
                            : "bg-muted-foreground/20"
                        }`}
                      />
                    ))}
                  </div>
                </div>

                <div>
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <h3 className="text-base font-semibold text-foreground leading-snug">
                      {currentQ.question}
                    </h3>
                    <button
                      onClick={() => setTriggerQuestion({ id: currentQ.id, question: currentQ.question })}
                      className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium text-primary bg-primary/5 hover:bg-primary/10 border border-primary/20 transition-colors"
                      title="Ask AI to help with this question"
                    >
                      <MessageCircle className="w-3 h-3" />
                      Ask AI
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground">{currentQ.hint}</p>
                </div>

                {currentPrefill && (
                  <div
                    className={`flex items-start gap-2 px-3 py-2 rounded-lg border text-xs ${
                      CONFIDENCE_CONFIG[currentPrefill.confidence].bg
                    }`}
                  >
                    {currentPrefill.confidence === "high" || currentPrefill.confidence === "medium" ? (
                      <CheckCircle2
                        className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${
                          CONFIDENCE_CONFIG[currentPrefill.confidence].color
                        }`}
                      />
                    ) : (
                      <AlertTriangle
                        className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${
                          CONFIDENCE_CONFIG[currentPrefill.confidence].color
                        }`}
                      />
                    )}
                    <span className={CONFIDENCE_CONFIG[currentPrefill.confidence].color}>
                      AI: <span className="font-medium">{CONFIDENCE_CONFIG[currentPrefill.confidence].label}</span>
                    </span>
                  </div>
                )}

                <textarea
                  className="w-full h-40 p-3 text-sm rounded-xl border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
                  placeholder={currentQ.hint}
                  value={answers[currentQ.id] ?? ""}
                  onChange={(e) => {
                    const val = e.target.value;
                    updateAnswers((prev) => ({ ...prev, [currentQ.id]: val }));
                  }}
                />
              </motion.div>
            </AnimatePresence>
          )}

          {step === "submitting" && (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="w-10 h-10 text-primary animate-spin mb-4" />
              <p className="text-sm font-medium text-foreground">
                {isSendCv ? "Sending your CV and responses…" : "Submitting your application…"}
              </p>
            </div>
          )}

          {step === "nextMatches" && (
            <div className="space-y-4">
              <div className="flex flex-col items-center text-center pt-4 pb-2">
                <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center mb-3">
                  <CheckCircle2 className="w-8 h-8 text-emerald-600" />
                </div>
                <h4 className="text-base font-bold text-foreground">Application submitted!</h4>
                <p className="text-sm text-muted-foreground mt-1 max-w-sm">
                  Great work. Keep the momentum going — here are your next 3 best matches:
                </p>
              </div>
              <div className="space-y-2">
                {nextMatchRoles.map((r, i) => (
                  <div key={r.id}
                    className="flex items-center gap-3 p-3 rounded-xl border border-border hover:border-primary/20 hover:bg-muted/20 transition-all"
                  >
                    <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <span className="text-xs font-bold text-primary">{i + 1}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-foreground leading-tight truncate">{r.title}</p>
                      <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1 truncate"><Building2 className="w-3 h-3 shrink-0" />{r.employer}</span>
                        {r.location && <span className="flex items-center gap-1 truncate"><MapPin className="w-3 h-3 shrink-0" />{r.location}</span>}
                      </div>
                      {r.matchReason && (
                        <p className="text-[10px] text-primary/70 italic mt-0.5 leading-snug line-clamp-1">{r.matchReason}</p>
                      )}
                    </div>
                    <div className="shrink-0 flex flex-col items-end gap-1">
                      <span className={`text-xs font-bold flex items-center gap-1 px-2 py-0.5 rounded-full ${
                        r.matchScore >= 75 ? "bg-emerald-100 text-emerald-800" :
                        r.matchScore >= 50 ? "bg-blue-100 text-blue-800" :
                        "bg-muted text-muted-foreground"
                      }`}>
                        <Zap className="w-3 h-3" />{r.matchScore}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {step === "coverLetter" && (
            <div className="space-y-3">
              {isSendCv && (
                <div className="space-y-3">
                  <div>
                    <h4 className="text-sm font-semibold text-foreground">Compiled outreach message</h4>
                    <p className="mt-1 text-xs text-muted-foreground">
                      This message is built from your six reviewed answers and will accompany your selected CV.
                    </p>
                  </div>
                  <textarea
                    className="w-full min-h-[320px] p-3 text-sm text-foreground leading-relaxed bg-muted/40 rounded-xl border border-border resize-y focus:outline-none focus:ring-2 focus:ring-primary/30 font-sans"
                    value={clEditable}
                    readOnly
                  />
                </div>
              )}
              {!isSendCv && (
                <>
              {!coverLetter.text && !coverLetter.streaming && !coverLetter.error && (
                <div className="text-center py-8">
                  <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
                    <FileText className="w-7 h-7 text-primary" />
                  </div>
                  <h4 className="text-sm font-semibold text-foreground mb-1">Generate a tailored cover letter</h4>
                  <p className="text-xs text-muted-foreground mb-5 max-w-sm mx-auto">
                    AI will write a personalised cover letter for <strong>{roleTitle}</strong> based on your profile and uploaded CV.
                  </p>
                  <Button
                    size="sm"
                    onClick={() =>
                      void coverLetter.generate({ jobTitle: roleTitle, roleId })
                    }
                    className="gap-2"
                  >
                    <Sparkles className="w-4 h-4" /> Generate Cover Letter
                  </Button>
                </div>
              )}
              {coverLetter.error && (
                <div className="text-center py-6">
                  <AlertTriangle className="w-8 h-8 text-destructive mx-auto mb-2" />
                  <p className="text-sm text-destructive mb-3">{coverLetter.error}</p>
                  <Button size="sm" variant="outline" onClick={() => void coverLetter.generate({ jobTitle: roleTitle, roleId })}>
                    Try Again
                  </Button>
                </div>
              )}
              {(coverLetter.text || coverLetter.streaming) && (
                <div className="space-y-2">
                  {coverLetter.streaming && (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" /> Writing cover letter…
                    </div>
                  )}
                  <textarea
                    className="w-full min-h-[280px] p-3 text-sm text-foreground leading-relaxed bg-muted/40 rounded-xl border border-border resize-y focus:outline-none focus:ring-2 focus:ring-primary/30 font-sans"
                    value={coverLetter.streaming ? coverLetter.text : clEditable}
                    onChange={(e) => setClEditable(e.target.value)}
                    readOnly={coverLetter.streaming}
                    placeholder="Your cover letter will appear here…"
                  />
                  {coverLetter.done && coverLetter.disclaimer && (
                    <p className="text-[10px] text-muted-foreground border-l-2 border-primary/20 pl-2">
                      {coverLetter.disclaimer}
                    </p>
                  )}
                </div>
              )}
                </>
              )}
            </div>
          )}
        </div>

        {step === "review" && (
          <div className="flex flex-col border-t border-border bg-muted/30">
            {!isSendCv && (
              <div className="flex items-center justify-center px-4 pt-3 sm:px-6">
                <button
                  onClick={handleSubmit}
                  className="flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  Accept all AI answers &amp; submit now
                </button>
              </div>
            )}
            {cvDocuments.length >= 1 && (
              <div className="px-6 pt-3 flex items-center gap-2">
                <span className="text-xs text-muted-foreground shrink-0">CV to record:</span>
                {cvDocuments.length >= 2 ? (
                  <div className="relative flex-1">
                    <select
                      value={selectedCvId ?? ""}
                      onChange={(e) => setSelectedCvId(e.target.value ? parseInt(e.target.value, 10) : null)}
                      className="w-full appearance-none text-xs rounded-lg border border-border bg-muted/40 px-2 py-1.5 pr-6 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                    >
                      {cvDocuments.map((cv) => {
                        const cvExtra = cv as typeof cv & { label?: string | null; isPrimary?: boolean };
                        return (
                          <option key={cv.id} value={cv.id}>
                            {cvExtra.label ?? cv.filename}{cvExtra.isPrimary ? " ★" : ""}
                          </option>
                        );
                      })}
                    </select>
                    <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
                  </div>
                ) : (() => {
                  const cv = cvDocuments[0];
                  const cvExtra = cv as typeof cv & { label?: string | null; isPrimary?: boolean };
                  return (
                    <div className="flex items-center gap-1.5 flex-1 px-2 py-1.5 rounded-lg border border-border bg-muted/40 text-xs text-foreground">
                      <FileText className="w-3 h-3 text-primary shrink-0" />
                      <span className="truncate flex-1">{cvExtra.label ?? cv.filename}</span>
                      {cvExtra.isPrimary && <span className="text-amber-500 shrink-0">★</span>}
                    </div>
                  );
                })()}
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-4 sm:px-6">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setCurrentQuestion((p) => p - 1)}
                disabled={isFirstQuestion}
                className="text-sm"
              >
                <ChevronLeft className="w-4 h-4 mr-1" /> Back
              </Button>

              <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
                {!isSendCv && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 text-xs"
                    onClick={() => setStep("coverLetter")}
                  >
                    <FileText className="w-3.5 h-3.5" /> Cover Letter
                  </Button>
                )}

                {isLastQuestion ? (
                  <Button onClick={handleSubmit} size="sm" className="gap-1.5">
                    <Send className="w-4 h-4" /> {isSendCv ? "Send CV" : "Submit Application"}
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentQuestion((p) => p + 1)}
                    className="text-sm"
                  >
                    Next <ChevronRight className="w-4 h-4 ml-1" />
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}

        {step === "coverLetter" && (
          <div className="flex items-center justify-between border-t border-border bg-muted/30 px-4 py-4 flex-wrap gap-2 sm:px-6">
            <Button variant="ghost" size="sm" onClick={() => setStep("review")} className="gap-1 text-sm">
              <ChevronLeft className="w-4 h-4" /> Back to Questions
            </Button>
            <div className="flex items-center gap-2">
               {!isSendCv && (coverLetter.text || clEditable) && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={coverLetter.streaming}
                    className="gap-1.5 text-xs"
                    onClick={() => {
                      const content = coverLetter.done ? clEditable : coverLetter.text;
                      const blob = new Blob([content], { type: "text/plain" });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `cover-letter-${roleTitle.replace(/\s+/g, "-").toLowerCase()}.txt`;
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                  >
                    <Download className="w-3.5 h-3.5" /> .txt
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={coverLetter.streaming}
                    className="gap-1.5 text-xs"
                    onClick={() => {
                      const content = coverLetter.done ? clEditable : coverLetter.text;
                      void navigator.clipboard.writeText(content).then(() => {
                        setClCopied(true);
                        setTimeout(() => setClCopied(false), 2000);
                      });
                    }}
                  >
                    {clCopied ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    {clCopied ? "Copied!" : "Copy"}
                  </Button>
                </>
              )}
              <Button onClick={handleSubmit} size="sm" className="gap-1.5">
                <Send className="w-4 h-4" /> {isSendCv ? "Send CV" : "Submit Application"}
              </Button>
            </div>
          </div>
        )}

        {step === "nextMatches" && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-border bg-muted/30 flex-wrap gap-2">
            <a href="/opportunities">
              <Button variant="outline" size="sm" className="gap-1.5 text-xs">
                <ArrowRight className="w-3.5 h-3.5" /> Browse All Opportunities
              </Button>
            </a>
            <Button size="sm" onClick={onSuccess} className="gap-1.5">
              <CheckCircle2 className="w-4 h-4" /> Done
            </Button>
          </div>
        )}
      </motion.div>
    </div>
  );
}
