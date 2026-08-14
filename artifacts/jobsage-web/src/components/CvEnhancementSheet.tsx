import { useState } from "react";
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
} from "lucide-react";
import {
  useListCareerProfiles,
  useUpdateCareerProfile,
  getCareerProfilesQueryKey,
  type CareerProfile,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api";

type Mode = "general" | "focused";
type Phase = "input" | "review";

interface EnhancementResult {
  enhancedContent: string;
  mode: Mode;
  focus: string | null;
}

interface CvEnhancementSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CvEnhancementSheet({ open, onOpenChange }: CvEnhancementSheetProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // State
  const [phase, setPhase] = useState<Phase>("input");
  const [mode, setMode] = useState<Mode>("general");
  const [focus, setFocus] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [result, setResult] = useState<EnhancementResult | null>(null);
  const [reviewTab, setReviewTab] = useState<"before" | "after">("after");
  const [isSaving, setIsSaving] = useState(false);

  // Career profiles — to know which one to save to
  const { data: cpData } = useListCareerProfiles();
  const activeProfile: CareerProfile | undefined =
    cpData?.profiles.find((p) => p.isActive) ?? cpData?.profiles[0];

  const updateCareerProfile = useUpdateCareerProfile();

  function handleClose() {
    onOpenChange(false);
    // Reset after close animation
    setTimeout(() => {
      setPhase("input");
      setResult(null);
      setReviewTab("after");
      setIsGenerating(false);
    }, 300);
  }

  async function handleGenerate() {
    if (mode === "focused" && !focus.trim()) return;

    setIsGenerating(true);
    try {
      const res = await fetch(`${API_BASE}/profiles/cv-enhancement`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, focus: focus.trim() || undefined }),
      });

      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? "Failed to generate enhancement.");
      }

      const data = (await res.json()) as EnhancementResult;
      setResult(data);
      setReviewTab("after");
      setPhase("review");
    } catch (err) {
      toast({
        title: "Enhancement failed",
        description: err instanceof Error ? err.message : "Something went wrong.",
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleAccept() {
    if (!result?.enhancedContent) return;

    if (!activeProfile) {
      toast({
        title: "No career profile found",
        description: "Create a career profile on your Profile page first, then try again.",
        variant: "destructive",
      });
      return;
    }

    setIsSaving(true);
    try {
      await updateCareerProfile.mutateAsync({
        id: activeProfile.id,
        data: { aiCvContent: result.enhancedContent },
      });
      await queryClient.invalidateQueries({ queryKey: getCareerProfilesQueryKey() });
      toast({
        title: "CV enhancement saved",
        description: `Saved to your "${activeProfile.name}" career profile.`,
      });
      handleClose();
    } catch {
      toast({
        title: "Save failed",
        description: "Could not save your enhancement. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  }

  const existingContent = activeProfile?.aiCvContent ?? null;

  return (
    <Sheet open={open} onOpenChange={handleClose}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto flex flex-col">
        <SheetHeader className="pb-4 border-b border-border">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
              <Sparkles className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <SheetTitle className="text-base font-semibold leading-tight">
                CV Enhancement
              </SheetTitle>
              <SheetDescription className="text-xs text-muted-foreground mt-0.5">
                {phase === "input"
                  ? "AI-polishes your profile data into a professional UK CV narrative."
                  : "Review the enhanced version before saving."}
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <div className="flex-1 pt-5">
          {/* ── Phase 1: Input ─────────────────────────────────────────── */}
          {phase === "input" && (
            <div className="space-y-6">
              {/* Mode selector */}
              <fieldset className="space-y-3">
                <legend className="text-sm font-medium text-foreground">Enhancement mode</legend>

                <label className={`flex items-start gap-3 p-4 rounded-xl border cursor-pointer transition-colors ${mode === "general" ? "border-primary/50 bg-primary/5" : "border-border hover:border-primary/30"}`}>
                  <input
                    type="radio"
                    name="cv-mode"
                    value="general"
                    checked={mode === "general"}
                    onChange={() => setMode("general")}
                    className="mt-0.5 accent-primary"
                  />
                  <div>
                    <p className="text-sm font-medium text-foreground">General Polish</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Improve grammar, swap weak language for action verbs, and sharpen professional tone.
                    </p>
                  </div>
                </label>

                <label className={`flex items-start gap-3 p-4 rounded-xl border cursor-pointer transition-colors ${mode === "focused" ? "border-primary/50 bg-primary/5" : "border-border hover:border-primary/30"}`}>
                  <input
                    type="radio"
                    name="cv-mode"
                    value="focused"
                    checked={mode === "focused"}
                    onChange={() => setMode("focused")}
                    className="mt-0.5 accent-primary"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">Focused Enhancement</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Tailor the output toward a specific role, skill, or employer type.
                    </p>
                  </div>
                </label>
              </fieldset>

              {/* Focus textarea — shown only in focused mode */}
              {mode === "focused" && (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground" htmlFor="cv-focus">
                    What should the AI focus on?
                  </label>
                  <textarea
                    id="cv-focus"
                    value={focus}
                    onChange={(e) => setFocus(e.target.value)}
                    placeholder={`e.g. "Tailor this for a paediatric nursing role in the NHS" or "Highlight my leadership and management experience"`}
                    rows={3}
                    maxLength={500}
                    className="w-full rounded-xl border border-border bg-muted/40 px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none"
                  />
                  <p className="text-xs text-muted-foreground text-right">{focus.length}/500</p>
                </div>
              )}

              {/* No career profile warning */}
              {!activeProfile && cpData !== undefined && (
                <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-800/40 dark:bg-amber-900/20 p-3.5">
                  <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-800 dark:text-amber-300">
                    You have no career profile yet. You can still generate an enhancement, but you'll need to create a career profile on your Profile page before saving.
                  </p>
                </div>
              )}

              <Button
                className="w-full gap-2"
                onClick={() => void handleGenerate()}
                disabled={isGenerating || (mode === "focused" && !focus.trim())}
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Generating…
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    Generate Enhancement
                  </>
                )}
              </Button>
            </div>
          )}

          {/* ── Phase 2: Review ────────────────────────────────────────── */}
          {phase === "review" && result && (
            <div className="space-y-5">
              {/* Tabs */}
              <div className="flex rounded-lg border border-border overflow-hidden text-sm font-medium">
                <button
                  onClick={() => setReviewTab("before")}
                  className={`flex-1 py-2 transition-colors ${reviewTab === "before" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted/40"}`}
                >
                  Before
                </button>
                <button
                  onClick={() => setReviewTab("after")}
                  className={`flex-1 py-2 transition-colors flex items-center justify-center gap-1.5 ${reviewTab === "after" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted/40"}`}
                >
                  After
                  <CheckCircle2 className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Content area */}
              <div className="rounded-xl border border-border bg-muted/30 p-4 min-h-[220px] max-h-[380px] overflow-y-auto">
                {reviewTab === "before" ? (
                  existingContent ? (
                    <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
                      {existingContent}
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground italic">
                      No existing CV narrative — this would be your first one.
                    </p>
                  )
                ) : (
                  <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
                    {result.enhancedContent}
                  </p>
                )}
              </div>

              {/* Mode badge */}
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1 bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">
                  <Sparkles className="w-3 h-3" />
                  {result.mode === "focused" ? "Focused" : "General Polish"}
                </span>
                {result.focus && (
                  <span className="truncate italic">"{result.focus}"</span>
                )}
              </div>

              {/* Saving target */}
              {activeProfile && (
                <p className="text-xs text-muted-foreground">
                  Accepting will save to your <span className="font-medium text-foreground">"{activeProfile.name}"</span> career profile.
                </p>
              )}

              {/* Actions */}
              <div className="flex gap-3 pt-1">
                <Button
                  variant="outline"
                  className="flex-1 gap-2"
                  onClick={() => {
                    setPhase("input");
                    setResult(null);
                  }}
                >
                  <RotateCcw className="w-4 h-4" />
                  Try again
                </Button>
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={handleClose}
                  disabled={isSaving}
                >
                  Discard
                </Button>
                <Button
                  className="flex-1 gap-2"
                  onClick={() => void handleAccept()}
                  disabled={isSaving || !activeProfile}
                >
                  {isSaving ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Saving…
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      Accept &amp; Save
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
