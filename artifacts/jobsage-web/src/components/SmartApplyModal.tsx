import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui-enhanced";
import {
  useSmartApplyPrefill,
  useMarkApplication,
  useSaveSmartApplyDraft,
  useDeleteSmartApplyDraft,
  useGetSmartApplyDraft,
  getListMyApplicationsQueryKey,
  type ApplicationQuestion,
  type SmartApplyPrefill,
  type SmartApplyPrefillResponse,
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
  Send,
  Loader2,
  Building2,
  MapPin,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface SmartApplyModalProps {
  roleId: number;
  roleTitle: string;
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

export function SmartApplyModal({
  roleId,
  roleTitle,
  onClose,
  onSuccess,
}: SmartApplyModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<"loading" | "error" | "review" | "submitting">("loading");
  const [prefillData, setPrefillData] = useState<SmartApplyPrefillResponse | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [currentQuestion, setCurrentQuestion] = useState(0);

  const prefillMutation = useSmartApplyPrefill();
  const markApplicationMutation = useMarkApplication();
  const saveDraftMutation = useSaveSmartApplyDraft();
  const deleteDraftMutation = useDeleteSmartApplyDraft();
  const serverDraftQuery = useGetSmartApplyDraft(roleId);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    prefillMutation.mutate(
      { id: roleId },
      {
        onSuccess: (data) => {
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
        onError: () => {
          setStep("error");
        },
      }
    );
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roleId]);

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
    setStep("submitting");
    try {
      const answersJson = JSON.stringify({
        answers,
        summary: `Application for ${roleTitle} — ${totalQuestions} questions answered`,
      });

      await markApplicationMutation.mutateAsync({
        data: { roleId, notes: answersJson },
      });

      clearDraft(roleId);
      deleteDraftMutation.mutate({ roleId });
      queryClient.invalidateQueries({ queryKey: getListMyApplicationsQueryKey() });
      toast({
        title: "Application submitted!",
        description: `Your application for ${roleTitle} has been sent.`,
      });
      onSuccess();
    } catch {
      toast({
        title: "Submission failed",
        description: "Please try again.",
        variant: "destructive",
      });
      setStep("review");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="w-full max-w-2xl bg-background rounded-2xl shadow-2xl border border-border overflow-hidden"
      >
        <div className="flex items-start justify-between p-6 pb-4 border-b border-border">
          <div>
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
            {roleContext && (
              <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <MapPin className="w-3 h-3" /> {roleContext.location}
                </span>
                <span className="flex items-center gap-1">
                  <Building2 className="w-3 h-3" /> {roleContext.regulator}
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

        <div className="p-6 max-h-[60vh] overflow-y-auto">
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
                Please ensure your candidate profile is complete, then try again.
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
                  <h3 className="text-base font-semibold text-foreground mb-1">
                    {currentQ.question}
                  </h3>
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
              <p className="text-sm font-medium text-foreground">Submitting your application…</p>
            </div>
          )}
        </div>

        {step === "review" && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-border bg-muted/30">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCurrentQuestion((p) => p - 1)}
              disabled={isFirstQuestion}
              className="text-sm"
            >
              <ChevronLeft className="w-4 h-4 mr-1" /> Back
            </Button>

            {isLastQuestion ? (
              <Button onClick={handleSubmit} size="sm" className="gap-1.5">
                <Send className="w-4 h-4" /> Submit Application
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
        )}
      </motion.div>
    </div>
  );
}
