import { useState, useEffect } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui-enhanced";
import { useToast } from "@/hooks/use-toast";
import {
  Sparkles,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Download,
  FileText,
  Star,
} from "lucide-react";
import {
  useListMyDocuments,
  getListMyDocumentsQueryKey,
  getCareerProfilesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api";
const DAILY_LIMIT = 5;

type Mode  = "general" | "focused";
type Phase = "input" | "review" | "success";

interface EnhancementResult {
  enhancedContent: string;
  originalText:    string;
  documentId:      number;
  mode:            Mode;
  focus:           string | null;
  remaining?:      number;
}

interface FinalizeResult {
  documentId: number;
  storageKey: string;
  filename:   string;
  isPrimary:  boolean;
}

interface CvDocument {
  id:        number;
  filename:  string;
  label:     string | null;
  isPrimary: boolean;
}

interface CvEnhancementSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CvEnhancementSheet({ open, onOpenChange }: CvEnhancementSheetProps) {
  const { toast }       = useToast();
  const queryClient     = useQueryClient();

  const [phase, setPhase]                     = useState<Phase>("input");
  const [selectedCvId, setSelectedCvId]       = useState<number | null>(null);
  const [mode, setMode]                       = useState<Mode>("general");
  const [focus, setFocus]                     = useState("");
  const [isGenerating, setIsGenerating]       = useState(false);
  const [result, setResult]                   = useState<EnhancementResult | null>(null);
  const [editedContent, setEditedContent]     = useState("");
  const [reviewTab, setReviewTab]             = useState<"before" | "after">("after");
  const [isSaving, setIsSaving]               = useState(false);
  const [generationsLeft, setGenerationsLeft] = useState<number | null>(null);
  const [finalizeResult, setFinalizeResult]   = useState<FinalizeResult | null>(null);
  const [setAsPrimary, setSetAsPrimary]       = useState(true);

  const { data: documentsData } = useListMyDocuments();
  const cvDocuments: CvDocument[] = (documentsData?.documents ?? [])
    .filter((d) => (d as { documentType?: string | null }).documentType === "cv")
    .map((d) => ({
      id:        d.id,
      filename:  (d as { filename?: string }).filename ?? "CV",
      label:     (d as { label?: string | null }).label ?? null,
      isPrimary: (d as { isPrimary?: boolean }).isPrimary ?? false,
    }));

  // Auto-select primary (or first) when list loads
  useEffect(() => {
    if (!documentsData || selectedCvId !== null) return;
    const primary  = cvDocuments.find((d) => d.isPrimary);
    const fallback = cvDocuments[0];
    setSelectedCvId(primary?.id ?? fallback?.id ?? null);
  }, [documentsData]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleClose() {
    onOpenChange(false);
    setTimeout(() => {
      setPhase("input");
      setResult(null);
      setEditedContent("");
      setReviewTab("after");
      setIsGenerating(false);
      setFinalizeResult(null);
      setSetAsPrimary(true);
    }, 300);
  }

  async function handleEnhance() {
    if (!selectedCvId) return;
    if (mode === "focused" && !focus.trim()) return;
    setIsGenerating(true);
    try {
      const res = await fetch(`${API_BASE}/profiles/cv-enhancement`, {
        method:      "POST",
        credentials: "include",
        headers:     { "Content-Type": "application/json" },
        body:        JSON.stringify({
          documentId: selectedCvId,
          mode,
          focus: mode === "focused" ? focus.trim() : undefined,
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as {
          error?: string;
          limitReached?: boolean;
        };
        if (err.limitReached) setGenerationsLeft(0);
        throw new Error(err.error ?? "Failed to enhance CV.");
      }
      const data = (await res.json()) as EnhancementResult;
      setResult(data);
      setEditedContent(data.enhancedContent);
      setReviewTab("after");
      setPhase("review");
      if (data.remaining !== undefined) setGenerationsLeft(data.remaining);
    } catch (err) {
      toast({
        title:       "Enhancement failed",
        description: err instanceof Error ? err.message : "Something went wrong.",
        variant:     "destructive",
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
      const res = await fetch(`${API_BASE}/profiles/cv-enhancement/finalize`, {
        method:      "POST",
        credentials: "include",
        headers:     { "Content-Type": "application/json" },
        body:        JSON.stringify({
          editedContent: content,
          documentId:    result.documentId,
          setAsPrimary,
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? "Failed to save enhanced CV.");
      }
      const data = (await res.json()) as FinalizeResult;
      setFinalizeResult(data);
      setPhase("success");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListMyDocumentsQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getCareerProfilesQueryKey() }),
      ]);
    } catch (err) {
      toast({
        title:       "Save failed",
        description: err instanceof Error ? err.message : "Could not save. Please try again.",
        variant:     "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  }

  const dailyLimitReached = generationsLeft === 0;
  const downloadUrl = finalizeResult
    ? `${API_BASE}/storage/objects${finalizeResult.storageKey.replace(/^\/objects/, "")}`
    : null;

  return (
    <Sheet open={open} onOpenChange={handleClose}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto flex flex-col">
        <SheetHeader className="pb-4 border-b border-border">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
              <Sparkles className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <SheetTitle className="text-base font-semibold leading-tight">AI CV Enhancement</SheetTitle>
              <SheetDescription className="text-xs text-muted-foreground mt-0.5">
                {phase === "input"
                  ? "Select a CV — AI rewrites it better, all facts kept exactly as-is."
                  : phase === "review"
                  ? "Review and edit before saving."
                  : "Your enhanced CV has been saved."}
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <div className="flex-1 pt-5">

          {/* ── Phase 1: Select CV + mode ───────────────────────────────── */}
          {phase === "input" && (
            <div className="space-y-5">

              {/* No CVs uploaded yet */}
              {documentsData !== undefined && cvDocuments.length === 0 && (
                <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-3.5">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-800">
                    Upload a CV from your Documents page first.
                  </p>
                </div>
              )}

              {/* CV picker */}
              {cvDocuments.length > 0 && (
                <div className="space-y-2">
                  {cvDocuments.length > 1 && (
                    <p className="text-sm font-medium text-foreground">Choose which CV to enhance</p>
                  )}
                  <div className="space-y-2">
                    {cvDocuments.map((cv) => (
                      <label
                        key={cv.id}
                        className={`flex items-center gap-3 p-3.5 rounded-xl border cursor-pointer transition-colors ${
                          selectedCvId === cv.id
                            ? "border-primary/50 bg-primary/5"
                            : "border-border hover:border-primary/30"
                        }`}
                      >
                        {cvDocuments.length > 1 && (
                          <input
                            type="radio"
                            name="cv-select"
                            value={cv.id}
                            checked={selectedCvId === cv.id}
                            onChange={() => setSelectedCvId(cv.id)}
                            className="accent-primary shrink-0"
                          />
                        )}
                        <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
                          <FileText className="w-4 h-4 text-muted-foreground" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">
                            {cv.label ?? cv.filename}
                          </p>
                          {cv.label && (
                            <p className="text-xs text-muted-foreground truncate">{cv.filename}</p>
                          )}
                        </div>
                        {cv.isPrimary && (
                          <span className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                            <Star className="w-3 h-3 fill-amber-400 text-amber-400" />Primary
                          </span>
                        )}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Enhancement mode */}
              {cvDocuments.length > 0 && (
                <fieldset className="space-y-2">
                  <legend className="text-sm font-medium text-foreground">Enhancement mode</legend>
                  <label className={`flex items-start gap-3 p-3.5 rounded-xl border cursor-pointer transition-colors ${mode === "general" ? "border-primary/50 bg-primary/5" : "border-border hover:border-primary/30"}`}>
                    <input type="radio" name="enh-mode" value="general" checked={mode === "general"} onChange={() => setMode("general")} className="mt-0.5 accent-primary shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-foreground">General rewrite</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Stronger language, clearer structure, more professional tone across the whole CV.</p>
                    </div>
                  </label>
                  <label className={`flex items-start gap-3 p-3.5 rounded-xl border cursor-pointer transition-colors ${mode === "focused" ? "border-primary/50 bg-primary/5" : "border-border hover:border-primary/30"}`}>
                    <input type="radio" name="enh-mode" value="focused" checked={mode === "focused"} onChange={() => setMode("focused")} className="mt-0.5 accent-primary shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground">Focused rewrite</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Tailor the rewrite toward a specific role, specialty, or employer type.</p>
                    </div>
                  </label>
                </fieldset>
              )}

              {/* Focus text field */}
              {mode === "focused" && cvDocuments.length > 0 && (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground" htmlFor="cv-focus">
                    What should the rewrite focus on?
                  </label>
                  <textarea
                    id="cv-focus"
                    value={focus}
                    onChange={(e) => setFocus(e.target.value)}
                    placeholder={`e.g. "Paediatric ICU nursing role in an NHS trust"`}
                    rows={3}
                    maxLength={500}
                    className="w-full rounded-xl border border-border bg-muted/40 px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none"
                  />
                  <p className="text-xs text-muted-foreground text-right">{focus.length}/500</p>
                </div>
              )}

              {/* Daily limit warnings */}
              {dailyLimitReached && (
                <div className="flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 p-3.5">
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <p className="text-xs text-rose-800">
                    You've used all {DAILY_LIMIT} enhancements for today. Come back tomorrow.
                  </p>
                </div>
              )}
              {generationsLeft !== null && generationsLeft > 0 && (
                <p className="text-xs text-muted-foreground text-center">
                  {generationsLeft} of {DAILY_LIMIT} enhancements remaining today
                </p>
              )}

              <Button
                className="w-full gap-2"
                onClick={() => void handleEnhance()}
                disabled={
                  isGenerating ||
                  dailyLimitReached ||
                  !selectedCvId ||
                  cvDocuments.length === 0 ||
                  (mode === "focused" && !focus.trim())
                }
              >
                {isGenerating
                  ? <><Loader2 className="w-4 h-4 animate-spin" />Enhancing CV…</>
                  : <><Sparkles className="w-4 h-4" />Enhance CV</>}
              </Button>
            </div>
          )}

          {/* ── Phase 2: Review ─────────────────────────────────────────── */}
          {phase === "review" && result && (
            <div className="space-y-5">
              <div className="flex rounded-lg border border-border overflow-hidden text-sm font-medium">
                <button
                  onClick={() => setReviewTab("before")}
                  className={`flex-1 py-2 transition-colors ${
                    reviewTab === "before"
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
                  }`}
                >Original</button>
                <button
                  onClick={() => setReviewTab("after")}
                  className={`flex-1 py-2 transition-colors flex items-center justify-center gap-1.5 ${
                    reviewTab === "after"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
                  }`}
                ><Sparkles className="w-3.5 h-3.5" />Enhanced</button>
              </div>

              <div className="rounded-xl border border-border bg-muted/30 overflow-hidden">
                {reviewTab === "before" ? (
                  <div className="p-4 min-h-[280px] max-h-[420px] overflow-y-auto">
                    <pre className="text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap font-sans">
                      {result.originalText}
                    </pre>
                  </div>
                ) : (
                  <textarea
                    value={editedContent}
                    onChange={(e) => setEditedContent(e.target.value)}
                    className="w-full min-h-[280px] max-h-[420px] p-4 text-sm text-foreground leading-relaxed bg-transparent resize-y focus:outline-none focus:ring-2 focus:ring-primary/40 rounded-xl font-mono"
                    aria-label="Edit enhanced CV content"
                  />
                )}
              </div>

              {reviewTab === "after" && (
                <p className="text-xs text-muted-foreground -mt-2">
                  You can edit the text above before saving.
                </p>
              )}

              {/* Mode badge */}
              <div className="flex items-center gap-2 text-xs text-muted-foreground -mt-1">
                <span className="inline-flex items-center gap-1 bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">
                  <Sparkles className="w-3 h-3" />
                  {result.mode === "focused" ? "Focused rewrite" : "General rewrite"}
                </span>
                {result.focus && (
                  <span className="truncate italic">"{result.focus}"</span>
                )}
              </div>

              {/* Set as primary toggle */}
              <label className="flex items-center gap-3 rounded-xl border border-border bg-muted/30 p-3.5 cursor-pointer hover:bg-muted/50 transition-colors">
                <input
                  type="checkbox"
                  checked={setAsPrimary}
                  onChange={(e) => setSetAsPrimary(e.target.checked)}
                  className="w-4 h-4 accent-primary rounded shrink-0"
                />
                <div>
                  <p className="text-sm font-medium text-foreground flex items-center gap-1.5">
                    <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-400" />
                    Set as primary CV
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {setAsPrimary
                      ? "This enhanced PDF will replace your current primary CV for applications."
                      : "Your existing primary CV will not change."}
                  </p>
                </div>
              </label>

              <div className="flex gap-3 pt-1">
                <Button
                  variant="outline"
                  className="flex-1 gap-2"
                  onClick={() => { setPhase("input"); setResult(null); setEditedContent(""); }}
                >
                  <RotateCcw className="w-4 h-4" />Try again
                </Button>
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={handleClose}
                  disabled={isSaving}
                >Discard</Button>
                <Button
                  className="flex-1 gap-2"
                  onClick={() => void handleAccept()}
                  disabled={isSaving || !editedContent.trim()}
                >
                  {isSaving
                    ? <><Loader2 className="w-4 h-4 animate-spin" />Saving…</>
                    : <><CheckCircle2 className="w-4 h-4" />Accept &amp; Save</>}
                </Button>
              </div>
            </div>
          )}

          {/* ── Phase 3: Success ────────────────────────────────────────── */}
          {phase === "success" && finalizeResult && (
            <div className="flex flex-col items-center gap-6 py-6 text-center">
              <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center">
                <CheckCircle2 className="w-8 h-8 text-emerald-600" />
              </div>

              <div className="space-y-1.5">
                <h3 className="text-base font-semibold text-foreground">CV Enhanced &amp; Saved</h3>
                <p className="text-sm text-muted-foreground max-w-xs mx-auto">
                  {finalizeResult.isPrimary
                    ? "Saved as a PDF and set as your primary CV."
                    : "Saved as a PDF and added to your documents."}
                </p>
              </div>

              <div className="w-full rounded-xl border border-border bg-muted/30 p-4 flex items-center gap-3 text-left">
                <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center shrink-0">
                  <FileText className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{finalizeResult.filename}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    PDF  ·  AI Enhanced{finalizeResult.isPrimary ? "  ·  Primary CV" : ""}
                  </p>
                </div>
                {finalizeResult.isPrimary && (
                  <Star className="w-4 h-4 text-amber-400 fill-amber-400 shrink-0" />
                )}
              </div>

              <div className="flex flex-col gap-3 w-full">
                {downloadUrl && (
                  <a
                    href={downloadUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-2 w-full rounded-xl bg-primary text-primary-foreground text-sm font-medium px-4 py-2.5 hover:bg-primary/90 transition-colors"
                  >
                    <Download className="w-4 h-4" />
                    Download Enhanced CV (.pdf)
                  </a>
                )}
                <Button variant="outline" className="w-full" onClick={handleClose}>Close</Button>
              </div>
            </div>
          )}

        </div>
      </SheetContent>
    </Sheet>
  );
}
