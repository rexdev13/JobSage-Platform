import { useState, useEffect } from "react";
import { Button } from "@/components/ui-enhanced";
import { useSendSpeculativeApplication, useListSpeculativeApplications, useListMyDocuments } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import {
  X,
  Sparkles,
  Building2,
  MapPin,
  DollarSign,
  FileText,
  Copy,
  CheckCircle2,
  Send,
  Loader2,
  ExternalLink,
  AlertTriangle,
  CalendarDays,
  ArrowRight,
  Zap,
  ChevronDown,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { SmartApplyAssistant } from "@/components/SmartApplyAssistant";

function useCoverLetterStream() {
  const [text, setText] = useState("");
  const [disclaimer, setDisclaimer] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setText("");
    setDisclaimer("");
    setStreaming(false);
    setDone(false);
    setError(null);
  }

  async function generate(payload: { jobTitle: string; employer?: string; location?: string | null }) {
    reset();
    setStreaming(true);
    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    try {
      const resp = await fetch(`${base}/api/cover-letter/generate-stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ...payload, employer: payload.employer ?? "the organisation" }),
      });
      if (!resp.ok || !resp.body) {
        setError("Failed to generate. Please try again.");
        setStreaming(false);
        return;
      }
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
            const p = JSON.parse(line.slice(6)) as {
              text?: string;
              done?: boolean;
              disclaimer?: string;
              error?: string;
            };
            if (p.error) { setError(p.error); setStreaming(false); return; }
            if (p.text) setText((prev) => prev + p.text);
            if (p.done) { setDisclaimer(p.disclaimer ?? ""); setDone(true); setStreaming(false); }
          } catch { /* ignore */ }
        }
      }
    } catch {
      setError("Network error. Please try again.");
      setStreaming(false);
    }
  }

  return { text, setText, disclaimer, streaming, done, error, generate, reset };
}

export interface SponsorVacancyApplyModalProps {
  vacancyTitle?: string;
  companyName: string;
  companyId: number;
  location?: string | null;
  salary?: string | null;
  postedDate?: string | null;
  description?: string | null;
  externalUrl?: string | null;
  speculative?: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function SponsorVacancyApplyModal({
  vacancyTitle: vacancyTitleProp,
  companyName,
  companyId,
  location,
  salary,
  postedDate,
  description,
  externalUrl,
  speculative = false,
  onClose,
  onSuccess,
}: SponsorVacancyApplyModalProps) {
  const vacancyTitle = vacancyTitleProp ?? "Speculative Application";
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const sendCVMutation = useSendSpeculativeApplication();
  const { data: speculativeData } = useListSpeculativeApplications();
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

  const alreadySent = (speculativeData?.applications ?? []).some(
    (a) => a.companyName === companyName && (a as { vacancyTitle?: string | null }).vacancyTitle === vacancyTitle,
  );

  const coverLetter = useCoverLetterStream();
  const [clEditable, setClEditable] = useState("");
  const [clCopied, setClCopied] = useState(false);
  const [step, setStep] = useState<"details" | "coverletter" | "submitting" | "done" | "nextMatches">("details");
  const [aiAnswer, setAiAnswer] = useState("");
  const [nextMatchRoles, setNextMatchRoles] = useState<Array<{
    id: number; title: string; employer: string; location: string | null;
    matchScore: number; isEligible: boolean; matchReason?: string | null;
  }>>([]);

  useEffect(() => {
    if (coverLetter.done && !clEditable) {
      setClEditable(coverLetter.text);
    }
  }, [coverLetter.done, coverLetter.text, clEditable]);

  async function handleApply() {
    setStep("submitting");
    const notes = clEditable.trim()
      ? `Cover letter for ${vacancyTitle}:\n\n${clEditable}`
      : `Speculative application for the role: ${vacancyTitle}`;

    sendCVMutation.mutate(
      {
        data: {
          companyName,
          sponsorLicenceId: companyId,
          vacancyTitle: speculative ? undefined : vacancyTitle,
          notes,
          cvDocumentId: selectedCvId ?? null,
        },
      },
      {
        onSuccess: async () => {
          void queryClient.invalidateQueries({ queryKey: ["listSpeculativeApplications"] });
          setStep("done");

          // In speculative-only mode skip the next-matches step
          if (speculative) {
            setTimeout(() => { onSuccess(); }, 1500);
            return;
          }

          // Fetch next 3 best unapplied role matches
          try {
            const base = import.meta.env.BASE_URL.replace(/\/$/, "");
            const res = await fetch(`${base}/api/opportunities/recommended?limit=3`, { credentials: "include" });
            if (res.ok) {
              const data = await (res.json() as Promise<{ roles: typeof nextMatchRoles }>);
              if ((data.roles ?? []).length > 0) {
                setNextMatchRoles(data.roles.slice(0, 3));
                setStep("nextMatches");
                return;
              }
            }
          } catch {
            // fall through to done step
          }

          // If no next matches, notify parent after a short delay
          setTimeout(() => { onSuccess(); }, 1500);
        },
        onError: (err: unknown) => {
          const status = (err as { response?: { status?: number }; status?: number })?.response?.status
            ?? (err as { status?: number })?.status;
          if (status === 400) {
            toast({
              title: "Profile incomplete",
              description: "Please visit your Profile page to set up your JOBSAGE email alias before sending a CV.",
              variant: "destructive",
            });
          } else if (status === 422) {
            toast({
              title: "PDF required",
              description: "Your CV must be in PDF format to send a speculative application. Please upload a PDF CV.",
              variant: "destructive",
            });
          } else {
            toast({
              title: "Error",
              description: "Could not submit application. Please try again.",
              variant: "destructive",
            });
          }
          setStep("details");
        },
      },
    );
  }

  function handleCopy() {
    void navigator.clipboard.writeText(clEditable);
    setClCopied(true);
    setTimeout(() => setClCopied(false), 2000);
  }

  function handleUseAiAnswer(text: string) {
    setAiAnswer(text);
    setClEditable((prev) => prev ? prev + "\n\n" + text : text);
    setStep("coverletter");
  }

  return (
    <>
      {/* Floating AI Assistant — visible while modal is open (not in done/submitting state) */}
      {(step === "details" || step === "coverletter") && (
        <SmartApplyAssistant
          roleId={0}
          roleTitle={`${vacancyTitle} at ${companyName}`}
          onUseAnswer={handleUseAiAnswer}
        />
      )}

      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/50 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 40 }}
          transition={{ type: "spring", damping: 28, stiffness: 300 }}
          className="w-full max-w-xl bg-background rounded-t-2xl sm:rounded-2xl shadow-2xl border border-border overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-start justify-between p-5 pb-4 border-b border-border">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                <Sparkles className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h2 className="text-base font-bold text-foreground leading-snug">{vacancyTitle}</h2>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <Building2 className="w-3 h-3 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">{companyName}</span>
                </div>
                <div className="flex items-center gap-3 mt-1 flex-wrap">
                  {location && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <MapPin className="w-3 h-3" /> {location}
                    </span>
                  )}
                  {salary && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <DollarSign className="w-3 h-3" /> {salary}
                    </span>
                  )}
                  {postedDate && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <CalendarDays className="w-3 h-3" /> {postedDate}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Body */}
          <div className="p-5 max-h-[60vh] overflow-y-auto space-y-4">
            {/* Success screen */}
            {step === "done" && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex flex-col items-center justify-center py-10 text-center"
              >
                <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center mb-4">
                  <CheckCircle2 className="w-8 h-8 text-emerald-600" />
                </div>
                <h3 className="text-lg font-bold text-foreground mb-1">
                  {speculative ? "CV sent!" : "Application submitted!"}
                </h3>
                <p className="text-sm text-muted-foreground max-w-xs leading-relaxed">
                  {speculative
                    ? <>Your speculative CV has been sent to <strong>{companyName}</strong>. You can track it in your Application Tracker.</>
                    : <>Your application for <strong>{vacancyTitle}</strong> at <strong>{companyName}</strong> has been recorded. You can track it in your Application Tracker.</>
                  }
                </p>
                <Button className="mt-6 gap-2" onClick={onClose}>
                  Close
                </Button>
              </motion.div>
            )}

            {step === "submitting" && (
              <div className="flex flex-col items-center justify-center py-10">
                <Loader2 className="w-9 h-9 text-primary animate-spin mb-3" />
                <p className="text-sm font-medium text-foreground">Submitting your application…</p>
              </div>
            )}

            {step === "nextMatches" && (
              <div className="space-y-4">
                <div className="flex flex-col items-center text-center pt-3 pb-1">
                  <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center mb-3">
                    <CheckCircle2 className="w-8 h-8 text-emerald-600" />
                  </div>
                  <h4 className="text-base font-bold text-foreground">Application submitted!</h4>
                  <p className="text-sm text-muted-foreground mt-1 max-w-xs">
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
                          <p className="text-[10px] text-primary/70 italic mt-0.5 line-clamp-1">{r.matchReason}</p>
                        )}
                      </div>
                      <span className={`shrink-0 text-xs font-bold flex items-center gap-1 px-2 py-0.5 rounded-full ${
                        r.matchScore >= 75 ? "bg-emerald-100 text-emerald-800" :
                        r.matchScore >= 50 ? "bg-blue-100 text-blue-800" :
                        "bg-muted text-muted-foreground"
                      }`}>
                        <Zap className="w-3 h-3" />{r.matchScore}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(step === "details" || step === "coverletter") && (
              <>
                {/* Vacancy description */}
                {description && (
                  <div className="rounded-xl bg-muted/40 border border-border px-4 py-3">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">About the role</p>
                    <p className="text-sm text-foreground/80 leading-relaxed">{description}</p>
                  </div>
                )}

                {/* AI Answer from assistant */}
                {aiAnswer && (
                  <div className="rounded-xl bg-primary/5 border border-primary/20 px-4 py-3">
                    <p className="text-xs font-semibold text-primary uppercase tracking-wider mb-1.5">AI Assistant suggestion</p>
                    <p className="text-sm text-foreground/80 leading-relaxed">{aiAnswer}</p>
                    <button
                      onClick={() => setAiAnswer("")}
                      className="text-xs text-muted-foreground hover:text-foreground mt-2 transition-colors"
                    >
                      Dismiss
                    </button>
                  </div>
                )}

                {/* AI Cover Letter section */}
                <div className="rounded-xl border border-border overflow-hidden">
                  <button
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/50 transition-colors"
                    onClick={() => {
                      if (step === "details") {
                        setStep("coverletter");
                      } else {
                        setStep("details");
                      }
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4 text-primary" />
                      <span className="text-sm font-semibold text-foreground">AI Cover Letter</span>
                      {coverLetter.done && (
                        <span className="text-xs px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 font-medium">
                          Generated
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {step === "coverletter" ? "Hide" : "Generate & edit"}
                    </span>
                  </button>

                  <AnimatePresence>
                    {step === "coverletter" && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden border-t border-border"
                      >
                        <div className="p-4 space-y-3">
                          {!coverLetter.text && !coverLetter.streaming && !coverLetter.error && (
                            <div className="text-center py-6">
                              <p className="text-xs text-muted-foreground mb-4">
                                AI will write a personalised cover letter for <strong>{vacancyTitle}</strong> at <strong>{companyName}</strong> based on your profile and CV.
                              </p>
                              <Button
                                size="sm"
                                onClick={() => void coverLetter.generate({ jobTitle: vacancyTitle, employer: companyName, location })}
                                className="gap-2"
                              >
                                <Sparkles className="w-4 h-4" /> Generate Cover Letter
                              </Button>
                            </div>
                          )}

                          {coverLetter.error && (
                            <div className="text-center py-4">
                              <AlertTriangle className="w-6 h-6 text-destructive mx-auto mb-2" />
                              <p className="text-xs text-destructive mb-3">{coverLetter.error}</p>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => void coverLetter.generate({ jobTitle: vacancyTitle, employer: companyName, location })}
                              >
                                Try Again
                              </Button>
                            </div>
                          )}

                          {(coverLetter.text || coverLetter.streaming) && (
                            <div className="space-y-2">
                              {coverLetter.streaming && (
                                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                  <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                                  Writing cover letter…
                                </div>
                              )}
                              <textarea
                                className="w-full min-h-[220px] p-3 text-sm text-foreground leading-relaxed bg-muted/40 rounded-xl border border-border resize-y focus:outline-none focus:ring-2 focus:ring-primary/30 font-sans"
                                value={coverLetter.streaming ? coverLetter.text : clEditable}
                                onChange={(e) => setClEditable(e.target.value)}
                                readOnly={coverLetter.streaming}
                                placeholder="Your cover letter will appear here…"
                              />
                              {coverLetter.done && (
                                <div className="flex items-center gap-2 flex-wrap">
                                  <button
                                    onClick={handleCopy}
                                    className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                                  >
                                    {clCopied ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                                    {clCopied ? "Copied" : "Copy letter"}
                                  </button>
                                  <button
                                    onClick={() => { coverLetter.reset(); setClEditable(""); }}
                                    className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                                  >
                                    Regenerate
                                  </button>
                                </div>
                              )}
                              {coverLetter.done && coverLetter.disclaimer && (
                                <p className="text-[10px] text-muted-foreground border-l-2 border-primary/20 pl-2">
                                  {coverLetter.disclaimer}
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* CV picker — only shown when candidate has 2+ CV documents */}
                {cvDocuments.length >= 1 && (
                  <div className="rounded-xl border border-border px-4 py-3 space-y-2">
                    <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                      <FileText className="w-3.5 h-3.5 text-primary" />
                      Which CV should we send?
                    </p>
                    {cvDocuments.length >= 2 ? (
                      <div className="relative">
                        <select
                          value={selectedCvId ?? ""}
                          onChange={(e) => setSelectedCvId(e.target.value ? parseInt(e.target.value, 10) : null)}
                          className="w-full appearance-none text-sm rounded-lg border border-border bg-muted/40 px-3 py-2 pr-8 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                        >
                          {cvDocuments.map((cv) => {
                            const cvExtra = cv as typeof cv & { label?: string | null; isPrimary?: boolean };
                            return (
                              <option key={cv.id} value={cv.id}>
                                {cvExtra.label ?? cv.filename}{cvExtra.isPrimary ? " ★ Primary" : ""}
                              </option>
                            );
                          })}
                        </select>
                        <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                      </div>
                    ) : (() => {
                      const cv = cvDocuments[0];
                      const cvExtra = cv as typeof cv & { label?: string | null; isPrimary?: boolean };
                      return (
                        <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-muted/40 text-sm text-foreground">
                          <FileText className="w-3.5 h-3.5 text-primary shrink-0" />
                          <span className="truncate flex-1">{cvExtra.label ?? cv.filename}</span>
                          {cvExtra.isPrimary && <span className="text-amber-500 shrink-0">★</span>}
                        </div>
                      );
                    })()}
                  </div>
                )}

                {/* Info notice */}
                <p className="text-xs text-muted-foreground bg-muted/40 rounded-lg px-3 py-2 border border-border leading-relaxed">
                  Submitting creates a tracked speculative application in JOBSAGE linked to this vacancy. Your CV will be logged so you can follow up and track progress from your Application Tracker.
                </p>

                {alreadySent && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-500/10 border border-blue-200 text-xs text-blue-700">
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                    You already applied for this vacancy at {companyName}.
                  </div>
                )}
              </>
            )}
          </div>

          {/* Footer */}
          {step === "nextMatches" && (
            <div className="flex items-center justify-between px-5 py-4 border-t border-border bg-muted/30 flex-wrap gap-2">
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

          {(step === "details" || step === "coverletter") && (
            <div className="flex items-center justify-between px-5 py-4 border-t border-border bg-muted/30 gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                {externalUrl && (
                  <a
                    href={externalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs px-3 py-2 rounded-xl border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors font-medium"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    View posting
                  </a>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={onClose} className="text-xs">
                  Cancel
                </Button>
                <Button
                  size="sm"
                  className="gap-2 text-xs"
                  onClick={() => void handleApply()}
                  disabled={sendCVMutation.isPending}
                >
                  <Send className="w-3.5 h-3.5" />
                  {speculative
                    ? (alreadySent ? "Resend CV" : "Send CV")
                    : (alreadySent ? "Update application" : "Apply with JOBSAGE")
                  }
                </Button>
              </div>
            </div>
          )}
        </motion.div>
      </div>
    </>
  );
}
