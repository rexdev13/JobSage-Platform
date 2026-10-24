import { useEffect, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui-enhanced";
import { AIContentReport } from "@/components/AIContentReport";
import { useToast } from "@/hooks/use-toast";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Download,
  FileText,
  Loader2,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Star,
} from "lucide-react";
import {
  getCareerProfilesQueryKey,
  getListMyDocumentsQueryKey,
  useGetMyProfile,
  useListCareerProfiles,
  useListMyDocuments,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { CV_ENHANCEMENT_LABEL } from "@/lib/careerProfileMakerCopy";
import "./CvEnhancementSheet.css";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api";
const DAILY_LIMIT = 5;

type Mode = "general" | "focused" | "focus_only";
type Phase = "input" | "review" | "success";

interface EnhancementResult {
  enhancedContent: string;
  originalText: string;
  documentId: number;
  mode: Mode;
  focus: string | null;
  remaining?: number;
  preservationWarnings?: string[];
}

interface FinalizeResult {
  documentId: number;
  storageKey: string;
  filename: string;
  isPrimary: boolean;
  contentTruncated?: boolean;
}

interface CvDocument {
  id: number;
  filename: string;
  label: string | null;
  isPrimary: boolean;
}

interface CvEnhancementSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const modeOptions: { value: Mode; title: string; detail: string }[] = [
  {
    value: "general",
    title: "General rewrite",
    detail: "Refresh wording and structure across your full CV, using UK English.",
  },
  {
    value: "focused",
    title: "Focused rewrite",
    detail: "Bring relevant experience forward for a role, specialty or employer type.",
  },
  {
    value: "focus_only",
    title: "Focus only",
    detail: "Keep the rewrite centred on your chosen direction; unrelated content may be left out.",
  },
];

export function CvEnhancementSheet({ open, onOpenChange }: CvEnhancementSheetProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [phase, setPhase] = useState<Phase>("input");
  const [selectedCvId, setSelectedCvId] = useState<number | null>(null);
  const [mode, setMode] = useState<Mode>("general");
  const [focus, setFocus] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [result, setResult] = useState<EnhancementResult | null>(null);
  const [editedContent, setEditedContent] = useState("");
  const [reviewTab, setReviewTab] = useState<"before" | "after">("after");
  const [originalReviewed, setOriginalReviewed] = useState(false);
  const [factsConfirmed, setFactsConfirmed] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [generationsLeft, setGenerationsLeft] = useState<number | null>(null);
  const [finalizeResult, setFinalizeResult] = useState<FinalizeResult | null>(null);
  const [setAsPrimary, setSetAsPrimary] = useState(true);
  const [focusInitialized, setFocusInitialized] = useState(false);

  const documentsQuery = useListMyDocuments();
  const { data: documentsData } = documentsQuery;
  const { data: careerProfilesData } = useListCareerProfiles();
  const { data: profileData } = useGetMyProfile();
  const cvDocuments: CvDocument[] = (documentsData?.documents ?? [])
    .filter((document) => (document as { documentType?: string | null }).documentType === "cv")
    .map((document) => ({
      id: document.id,
      filename: (document as { filename?: string }).filename ?? "CV",
      label: (document as { label?: string | null }).label ?? null,
      isPrimary: (document as { isPrimary?: boolean }).isPrimary ?? false,
    }));
  const activeCareerProfile = careerProfilesData?.profiles.find((profile) => profile.isActive);
  const selectedCv = cvDocuments.find((document) => document.id === selectedCvId);

  useEffect(() => {
    if (!open) {
      setFocusInitialized(false);
      return;
    }
    if (focusInitialized || careerProfilesData === undefined) return;
    setFocus(activeCareerProfile?.focusArea?.trim() ?? "");
    setFocusInitialized(true);
  }, [open, careerProfilesData, activeCareerProfile?.focusArea, focusInitialized]);

  useEffect(() => {
    if (!documentsData || selectedCvId !== null) return;
    const primary = cvDocuments.find((document) => document.isPrimary);
    setSelectedCvId(primary?.id ?? cvDocuments[0]?.id ?? null);
  }, [documentsData]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleClose() {
    onOpenChange(false);
    setTimeout(() => {
      setPhase("input");
      setResult(null);
      setEditedContent("");
      setReviewTab("after");
      setOriginalReviewed(false);
      setFactsConfirmed(false);
      setIsGenerating(false);
      setFinalizeResult(null);
      setSetAsPrimary(true);
      setFocus("");
      setFocusInitialized(false);
    }, 300);
  }

  async function handleEnhance() {
    if (!selectedCvId) return;
    if ((mode === "focused" || mode === "focus_only") && !focus.trim()) return;
    setIsGenerating(true);
    try {
      const response = await fetch(`${API_BASE}/profiles/cv-enhancement`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentId: selectedCvId,
          mode,
          focus: mode === "general" ? undefined : focus.trim(),
        }),
      });
      if (!response.ok) {
        const error = (await response.json().catch(() => ({}))) as {
          error?: string;
          limitReached?: boolean;
        };
        if (error.limitReached) setGenerationsLeft(0);
        throw new Error(error.error ?? "Failed to enhance CV.");
      }
      const data = (await response.json()) as EnhancementResult;
      setResult(data);
      setEditedContent(data.enhancedContent);
      setReviewTab("after");
      setOriginalReviewed(false);
      setFactsConfirmed(false);
      setPhase("review");
      if (data.remaining !== undefined) setGenerationsLeft(data.remaining);
    } catch (error) {
      toast({
        title: "Enhancement failed",
        description: error instanceof Error ? error.message : "Something went wrong.",
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleAccept() {
    const content = editedContent.trim();
    if (!content || !result) return;
    setIsSaving(true);
    try {
      const response = await fetch(`${API_BASE}/profiles/cv-enhancement/finalize`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          editedContent: content,
          documentId: result.documentId,
          setAsPrimary,
        }),
      });
      if (!response.ok) {
        const error = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(error.error ?? "Failed to save enhanced CV.");
      }
      const data = (await response.json()) as FinalizeResult;
      setFinalizeResult(data);
      setPhase("success");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListMyDocumentsQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getCareerProfilesQueryKey() }),
      ]);
    } catch (error) {
      toast({
        title: "Save failed",
        description: error instanceof Error ? error.message : "Could not save. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  }

  function showOriginal() {
    setReviewTab("before");
    setOriginalReviewed(true);
  }

  const dailyLimitReached = generationsLeft === 0;
  const downloadUrl = finalizeResult
    ? `${API_BASE}/storage/objects${finalizeResult.storageKey.replace(/^\/objects/, "")}`
    : null;

  return (
    <Sheet open={open} onOpenChange={handleClose}>
      <SheetContent className="jobsage-cv-sheet flex w-full flex-col overflow-y-auto border-l border-[#e7ddd4] bg-[#fbf8f4] p-0 sm:max-w-[620px]">
        <SheetHeader className="sticky top-0 z-10 border-b border-[#e7ddd4] bg-[#fbf8f4]/95 px-6 pb-5 pt-7 text-left backdrop-blur sm:px-8">
          <div className="flex items-start gap-4">
            <div className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#f2e8df] text-[#8b1a1a]">
              <FileText className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#8b1a1a]">
                <span>Documents</span><span aria-hidden="true">/</span><span>CV editor</span>
              </div>
              <SheetTitle className="font-display text-[22px] font-semibold leading-tight text-[#29231f]">
                {phase === "success" ? "Your new CV is ready" : CV_ENHANCEMENT_LABEL}
              </SheetTitle>
              <SheetDescription className="mt-1.5 max-w-[440px] text-[13px] leading-relaxed text-[#746a63]">
                {phase === "input"
                  ? "A clearer, more considered version of your CV — with you in control of every detail."
                  : phase === "review"
                    ? "Review the original and edit the new draft before anything is saved."
                    : "Your reviewed draft has been saved as a new PDF."}
              </SheetDescription>
            </div>
          </div>
          {phase !== "success" && (
            <div className="mt-5 flex items-center gap-2" aria-label={`Step ${phase === "input" ? 1 : 2} of 2`}>
              <span className={`h-1.5 flex-1 rounded-full ${phase === "input" ? "bg-[#8b1a1a]" : "bg-[#8b1a1a]"}`} />
              <span className={`h-1.5 flex-1 rounded-full ${phase === "review" ? "bg-[#8b1a1a]" : "bg-[#e6dcd3]"}`} />
              <span className="ml-1 text-[11px] font-medium text-[#82766e]">{phase === "input" ? "1 of 2 · Set up" : "2 of 2 · Review"}</span>
            </div>
          )}
        </SheetHeader>

        <div className="flex-1 px-6 pb-8 pt-6 sm:px-8">
          {phase === "input" && (
            <div className="space-y-6">
              <section className="rounded-2xl border border-[#e8d9cc] bg-[#f5ede5] p-4" aria-label="How the CV rewrite works">
                <div className="flex gap-3">
                  <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[#7e4b30]" aria-hidden="true" />
                  <div>
                    <p className="text-sm font-semibold text-[#382b22]">A fresh document, not a layout copy</p>
                    <p className="mt-1 text-xs leading-relaxed text-[#6f5c4d]">
                      JOBSAGE rewrites the text extracted from your CV, then uses it to create a clean new PDF. Your source document’s design, columns and formatting are not preserved.
                    </p>
                  </div>
                </div>
              </section>

              {documentsQuery.isLoading && (
                <div className="space-y-3" role="status" aria-live="polite" aria-label="Loading your CVs">
                  <div className="h-4 w-36 animate-pulse rounded bg-[#e9e0d8]" />
                  <div className="h-[72px] animate-pulse rounded-2xl border border-[#e9e0d8] bg-[#f4eee8]" />
                </div>
              )}
              {documentsQuery.isError && (
                <div className="rounded-2xl border border-[#e6c9bf] bg-[#fff3ef] p-4" role="alert">
                  <p className="text-sm font-semibold text-[#762b20]">Your documents could not be loaded</p>
                  <p className="mt-1 text-xs text-[#80564e]">Try again to choose a CV for your rewrite.</p>
                  <Button variant="outline" className="mt-3 h-9 border-[#d9b8ac] bg-transparent text-[#762b20]" onClick={() => void documentsQuery.refetch()}>
                    Try again
                  </Button>
                </div>
              )}

              {documentsData !== undefined && cvDocuments.length === 0 && (
                <div className="flex items-start gap-3 rounded-2xl border border-[#e6d6c5] bg-[#fff9ef] p-4" role="status">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#9b6233]" aria-hidden="true" />
                  <div>
                    <p className="text-sm font-semibold text-[#513a25]">Add a CV to get started</p>
                    <p className="mt-1 text-xs leading-relaxed text-[#79634d]">Upload a CV from your Documents page, then return here to create a rewritten PDF.</p>
                  </div>
                </div>
              )}

              {cvDocuments.length > 0 && (
                <fieldset className="space-y-2.5">
                  <legend className="mb-2 text-sm font-semibold text-[#342a24]">Choose a source CV</legend>
                  {cvDocuments.length === 1 && (
                    <p className="mb-3 text-xs text-[#82766e]">This is the CV text JOBSAGE will rewrite.</p>
                  )}
                  {cvDocuments.map((cv) => (
                    <label
                      key={cv.id}
                      data-testid={`cv-option-${cv.id}`}
                      className={`group flex cursor-pointer items-center gap-3.5 rounded-2xl border p-3.5 transition-colors ${
                        selectedCvId === cv.id
                          ? "border-[#9c5c4e] bg-[#fffaf6] shadow-[0_2px_8px_rgba(80,45,30,0.05)]"
                          : "border-[#e5dbd2] bg-[#fffdfa] hover:border-[#c7a99b]"
                      }`}
                    >
                      <input
                        type="radio"
                        name="cv-select"
                        value={cv.id}
                        aria-label={`Use ${cv.label ?? cv.filename}${cv.isPrimary ? ", primary CV" : ""}`}
                        checked={selectedCvId === cv.id}
                        onChange={() => setSelectedCvId(cv.id)}
                        className="h-4 w-4 shrink-0 accent-[#8b1a1a]"
                        data-testid={`radio-cv-${cv.id}`}
                      />
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#f3ece5] text-[#765b49]">
                        <FileText className="h-4 w-4" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-[#342a24]">{cv.label ?? cv.filename}</span>
                        {cv.label && <span className="mt-0.5 block truncate text-xs text-[#82766e]">{cv.filename}</span>}
                      </span>
                      {cv.isPrimary && (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[#ead8b8] bg-[#fbf3e5] px-2 py-1 text-[10px] font-semibold text-[#775523]">
                          <Star className="h-3 w-3 fill-current" aria-hidden="true" /> Primary
                        </span>
                      )}
                    </label>
                  ))}
                </fieldset>
              )}

              {cvDocuments.length > 0 && (
                <fieldset className="space-y-2.5">
                  <legend className="mb-2 text-sm font-semibold text-[#342a24]">Choose the edit approach</legend>
                  {modeOptions.map((option, index) => (
                    <label
                      key={option.value}
                      className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-3.5 transition-colors ${
                        mode === option.value
                          ? "border-[#9c5c4e] bg-[#fffaf6]"
                          : "border-[#e5dbd2] bg-[#fffdfa] hover:border-[#c7a99b]"
                      }`}
                      data-testid={`mode-card-${option.value}`}
                    >
                      <input
                        type="radio"
                        name="enh-mode"
                        value={option.value}
                        checked={mode === option.value}
                        onChange={() => setMode(option.value)}
                        className="mt-0.5 h-4 w-4 shrink-0 accent-[#8b1a1a]"
                        data-testid={`radio-mode-${option.value}`}
                      />
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#f3ece5] text-[11px] font-semibold text-[#7b6252]">{`0${index + 1}`}</span>
                      <span>
                        <span className="block text-sm font-semibold text-[#342a24]">{option.title}</span>
                        <span className="mt-0.5 block text-xs leading-relaxed text-[#82766e]">{option.detail}</span>
                      </span>
                    </label>
                  ))}
                </fieldset>
              )}

              {(mode === "focused" || mode === "focus_only") && cvDocuments.length > 0 && (
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-[#342a24]" htmlFor="cv-focus">What should this CV be tailored towards?</label>
                  <textarea
                    id="cv-focus"
                    value={focus}
                    onChange={(event) => setFocus(event.target.value)}
                    placeholder="For example: paediatric ICU nursing role in an NHS trust"
                    rows={3}
                    maxLength={500}
                    aria-describedby="cv-focus-hint cv-focus-count"
                    data-testid="input-cv-focus"
                    className="w-full resize-none rounded-xl border border-[#ded2c8] bg-[#fffdfa] px-3.5 py-3 text-sm leading-relaxed text-[#342a24] placeholder:text-[#a39890] focus:border-[#9c5c4e] focus:outline-none focus:ring-4 focus:ring-[#8b1a1a]/10"
                  />
                  <div className="flex items-start justify-between gap-3">
                    {profileData?.specialty ? (
                      <p id="cv-focus-hint" className="text-xs leading-relaxed text-[#82766e]">
                        Your profile specialty is <span className="font-medium text-[#594a40]">{profileData.specialty}</span>. This is context only; change the focus above for this rewrite.
                      </p>
                    ) : <span id="cv-focus-hint" className="text-xs text-[#82766e]">Choose a role, specialism, sector or employer type.</span>}
                    <span id="cv-focus-count" className="shrink-0 text-[11px] tabular-nums text-[#91857c]">{focus.length}/500</span>
                  </div>
                </div>
              )}

              {dailyLimitReached && (
                <div className="flex items-start gap-3 rounded-2xl border border-[#e8c9be] bg-[#fff2ed] p-4" role="alert">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#a64b38]" aria-hidden="true" />
                  <p className="text-sm leading-relaxed text-[#763d32]">You have used all {DAILY_LIMIT} rewrites available today. You can try again tomorrow.</p>
                </div>
              )}
              {generationsLeft !== null && generationsLeft > 0 && (
                <p className="text-center text-xs text-[#82766e]" data-testid="status-quota">
                  {generationsLeft} of {DAILY_LIMIT} rewrites remaining today
                </p>
              )}

              <div className="border-t border-[#e7ddd4] pt-4">
                <Button
                  className="h-12 w-full gap-2 rounded-xl bg-[#8b1a1a] text-sm font-semibold text-white hover:bg-[#741515]"
                  onClick={() => void handleEnhance()}
                  disabled={isGenerating || dailyLimitReached || !selectedCvId || cvDocuments.length === 0 || documentsQuery.isError || ((mode === "focused" || mode === "focus_only") && !focus.trim())}
                  data-testid="button-enhance-cv"
                >
                  {isGenerating ? <><Loader2 className="h-4 w-4 animate-spin" />Preparing your rewrite…</> : <><Sparkles className="h-4 w-4" />Create my CV draft</>}
                </Button>
                <p className="mt-2.5 text-center text-[11px] leading-relaxed text-[#8a7f77]">
                  Nothing is saved until you review and choose to save it.
                </p>
              </div>
            </div>
          )}

          {phase === "review" && result && (
            <div className="space-y-5">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-[#8b1a1a]">Your review</p>
                  <p className="mt-1 truncate text-sm font-semibold text-[#342a24]">{selectedCv?.label ?? selectedCv?.filename ?? "Source CV"}</p>
                </div>
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[#edf2eb] px-2.5 py-1 text-[11px] font-medium text-[#50664d]">
                  <Check className="h-3 w-3" aria-hidden="true" /> Editable draft
                </span>
              </div>

              <div className="rounded-2xl border border-[#e8d9cc] bg-[#f5ede5] p-4" role="note" data-testid="uk-cv-conventions-note">
                <div className="flex gap-3">
                  <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[#7e4b30]" aria-hidden="true" />
                  <div>
                    <p className="text-sm font-semibold text-[#382b22]">Written for the UK job market</p>
                    <p className="mt-1 text-xs leading-relaxed text-[#6f5c4d]">
                      The rewrite uses UK English and a clean CV structure. It works from extracted text and creates a new PDF; it does not retain your source layout. It is not independently fact-checked, so please verify the details yourself.
                    </p>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-[#ded2c8] bg-[#fffdfa] p-1.5">
                <div className="grid grid-cols-2 gap-1 rounded-xl bg-[#f4eee8] p-1" role="tablist" aria-label="Compare original and enhanced CV">
                  <button
                    type="button"
                    role="tab"
                    id="cv-tab-original"
                    aria-selected={reviewTab === "before"}
                    aria-controls="cv-review-panel"
                    onClick={showOriginal}
                    data-testid="tab-cv-original"
                    className={`min-h-10 rounded-lg px-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8b1a1a] ${reviewTab === "before" ? "bg-white text-[#342a24] shadow-sm" : "text-[#81766e] hover:text-[#342a24]"}`}
                  >
                    Original
                  </button>
                  <button
                    type="button"
                    role="tab"
                    id="cv-tab-enhanced"
                    aria-selected={reviewTab === "after"}
                    aria-controls="cv-review-panel"
                    onClick={() => setReviewTab("after")}
                    data-testid="tab-cv-enhanced"
                    className={`min-h-10 rounded-lg px-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8b1a1a] ${reviewTab === "after" ? "bg-[#8b1a1a] text-white shadow-sm" : "text-[#81766e] hover:text-[#342a24]"}`}
                  >
                    Enhanced draft
                  </button>
                </div>
                <div id="cv-review-panel" role="tabpanel" aria-labelledby={reviewTab === "before" ? "cv-tab-original" : "cv-tab-enhanced"} className="mt-1">
                  {reviewTab === "before" ? (
                    <div className="min-h-[300px] max-h-[440px] overflow-y-auto rounded-xl bg-[#faf7f3] p-4 sm:p-5">
                      <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#95877d]">Source text extracted from your CV</p>
                      <pre className="whitespace-pre-wrap break-words font-sans text-[13px] leading-[1.75] text-[#62574f]" data-testid="text-original-cv">{result.originalText}</pre>
                    </div>
                  ) : (
                    <div className="overflow-hidden rounded-xl bg-[#fffdfa]">
                      <div className="flex items-center justify-between border-b border-[#eee6df] px-4 py-2.5">
                        <span className="text-[10px] font-semibold uppercase tracking-[0.13em] text-[#95877d]">Draft · yours to edit</span>
                        <span className="text-[11px] text-[#95877d]">{editedContent.length.toLocaleString()} characters</span>
                      </div>
                      <textarea
                        value={editedContent}
                        onChange={(event) => setEditedContent(event.target.value)}
                        className="min-h-[300px] max-h-[440px] w-full resize-y bg-transparent p-4 font-sans text-[14px] leading-[1.8] text-[#342a24] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#8b1a1a]/40 sm:p-5"
                        aria-label="Edit enhanced CV content"
                        data-testid="textarea-enhanced-cv"
                      />
                    </div>
                  )}
                </div>
              </div>
              {reviewTab === "after" && <p className="-mt-3 text-xs text-[#81766e]">Edit the wording directly above. Your changes are included in the saved PDF.</p>}

              {result.preservationWarnings && result.preservationWarnings.length > 0 && (
                <div className="rounded-2xl border border-[#ead6ad] bg-[#fff8e9] p-4 text-[#594522]" role="alert" aria-label="CV details need review" data-testid="warning-preservation">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#a4772e]" aria-hidden="true" />
                    <div className="space-y-2">
                      <p className="text-sm font-semibold">A closer look at dates and numbers is worthwhile</p>
                      <ul className="list-disc space-y-1 pl-4 text-xs leading-relaxed">
                        {result.preservationWarnings.map((warning) => <li key={warning}>{warning}</li>)}
                      </ul>
                      <button type="button" className="text-xs font-semibold underline underline-offset-2 hover:text-[#8b1a1a]" onClick={showOriginal} data-testid="button-review-original">
                        Compare with the original
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <div className="rounded-2xl border border-[#e7ddd4] bg-[#f7f2ed] p-4">
                <p className="text-sm font-semibold text-[#342a24]">Your review matters</p>
                <p className="mt-1 text-xs leading-relaxed text-[#756a62]">
                  A rewrite can omit or change details. Compare both versions, especially roles, employers, dates, qualifications, registrations, achievements and figures. The finished PDF uses as many pages as the text needs.
                </p>
                <label className={`mt-3 flex items-start gap-3 rounded-xl border p-3.5 transition-colors ${originalReviewed ? "border-[#d6c9bd] bg-[#fffdfa]" : "border-[#e4dbd3] bg-[#f2ece6]"}`}>
                  <input
                    type="checkbox"
                    checked={factsConfirmed}
                    disabled={!originalReviewed}
                    onChange={(event) => setFactsConfirmed(event.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-[#8b1a1a]"
                    data-testid="checkbox-confirm-cv-review"
                  />
                  <span className="text-xs leading-relaxed text-[#50463f]">
                    I have compared the draft with my original and checked the details before saving.
                    {!originalReviewed && <span className="mt-1 block text-[11px] text-[#8b1a1a]">Open the Original tab first to enable confirmation.</span>}
                  </span>
                </label>
              </div>

              <AIContentReport content={editedContent} context="AI CV enhancement review" label="Report this enhanced CV draft" />

              <div className="flex flex-wrap items-center gap-2 text-xs text-[#82766e]">
                <span className="rounded-full border border-[#e4d8ce] bg-[#f7f1eb] px-2.5 py-1 font-semibold text-[#705548]">
                  {result.mode === "focus_only" ? "Focus only" : result.mode === "focused" ? "Focused rewrite" : "General rewrite"}
                </span>
                {result.focus && <span className="max-w-full truncate rounded-full bg-[#f4eee8] px-2.5 py-1">Focus: {result.focus}</span>}
              </div>

              <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-[#e4d8ce] bg-[#fffdfa] p-4 transition-colors hover:border-[#c7a99b]">
                <input type="checkbox" checked={setAsPrimary} onChange={(event) => setSetAsPrimary(event.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-[#8b1a1a]" data-testid="checkbox-set-primary-cv" />
                <span className="flex-1">
                  <span className="flex items-center gap-2 text-sm font-semibold text-[#342a24]"><Star className="h-4 w-4 fill-[#b18a4d] text-[#a17738]" aria-hidden="true" />Set as my primary CV</span>
                  <span className="mt-1 block text-xs leading-relaxed text-[#82766e]">{setAsPrimary ? "The new PDF will become your primary CV for applications. Your source CV remains in Documents." : "Your current primary CV will stay as it is."}</span>
                </span>
              </label>

              <div className="flex flex-col-reverse gap-2 border-t border-[#e7ddd4] pt-4 sm:flex-row sm:items-center">
                <Button variant="outline" className="h-10 flex-1 gap-2 border-[#ded2c8] bg-transparent text-[#594a40] hover:bg-[#f4eee8]" onClick={() => { setPhase("input"); setResult(null); setEditedContent(""); }} disabled={isSaving} data-testid="button-try-again">
                  <RotateCcw className="h-4 w-4" /> Try another rewrite
                </Button>
                <Button variant="outline" className="h-10 flex-1 border-[#ded2c8] bg-transparent text-[#594a40] hover:bg-[#f4eee8]" onClick={handleClose} disabled={isSaving} data-testid="button-discard-cv">Discard draft</Button>
                <Button className="h-10 flex-1 gap-2 bg-[#8b1a1a] font-semibold text-white hover:bg-[#741515]" onClick={() => void handleAccept()} disabled={isSaving || !editedContent.trim() || !originalReviewed || !factsConfirmed} data-testid="button-save-enhanced-cv">
                  {isSaving ? <><Loader2 className="h-4 w-4 animate-spin" />Saving…</> : <><CheckCircle2 className="h-4 w-4" />Save new CV</>}
                </Button>
              </div>
            </div>
          )}

          {phase === "success" && finalizeResult && (
            <div className="mx-auto flex max-w-md flex-col items-center gap-6 py-8 text-center">
              <div className="flex h-[76px] w-[76px] items-center justify-center rounded-[26px] bg-[#e8efe5] text-[#4f7051]">
                <CheckCircle2 className="h-9 w-9" aria-hidden="true" />
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.17em] text-[#5d7758]">Saved to your documents</p>
                <h3 className="mt-2 font-display text-2xl font-semibold text-[#342a24]">A fresh CV, ready to use</h3>
                <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-[#786d65]">
                  {finalizeResult.isPrimary ? "Your new PDF is saved and set as your primary CV." : "Your new PDF is saved. Your primary CV has not changed."}
                </p>
              </div>
              <div className="flex w-full items-center gap-3 rounded-2xl border border-[#e5dbd2] bg-[#fffdfa] p-4 text-left">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#f2e8df] text-[#8b1a1a]"><FileText className="h-5 w-5" aria-hidden="true" /></div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-[#342a24]" data-testid="text-saved-cv-filename">{finalizeResult.filename}</p>
                  <p className="mt-1 text-xs text-[#82766e]">PDF · Newly formatted from your reviewed text</p>
                </div>
                {finalizeResult.isPrimary && <Star className="h-4 w-4 shrink-0 fill-[#b18a4d] text-[#a17738]" aria-label="Primary CV" />}
              </div>
              <div className="w-full space-y-2.5">
                {downloadUrl && (
                  <a href={downloadUrl} target="_blank" rel="noopener noreferrer" data-testid="link-download-enhanced-cv" className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#8b1a1a] px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#741515] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8b1a1a] focus-visible:ring-offset-2">
                    <Download className="h-4 w-4" aria-hidden="true" />Download your new CV (PDF)
                  </a>
                )}
                <Button variant="outline" className="h-11 w-full border-[#ded2c8] bg-transparent text-[#594a40] hover:bg-[#f4eee8]" onClick={handleClose} data-testid="button-close-cv-sheet">
                  Close
                </Button>
              </div>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
