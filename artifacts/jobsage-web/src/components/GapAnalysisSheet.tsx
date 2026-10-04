import { useState, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui-enhanced";
import { useToast } from "@/hooks/use-toast";
import { Send, ExternalLink, CheckCircle2, XCircle, Lightbulb, Loader2, AlertTriangle, Sparkles, UserRoundCog } from "lucide-react";
import { openTrackedOutbound, openTrackedSponsorVacancy } from "@/lib/trackedOutbound";
import {
  normalizeReadinessClaim,
  requiresStructuredProfileUpdate,
  unresolvedReadinessGaps,
} from "@/lib/readinessClaims";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api";

interface GapAnalysisData {
  matchedRequirements: string[];
  gaps: string[];
  optimizationSteps: string[];
  generatedAt: string;
  fromCache: boolean;
}

interface GapAnalysisSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vacancyId: number;
  vacancyTitle: string;
  companyName: string;
  vacancyUrl: string | null | undefined;
  hasCvUploaded: boolean;
  onApply?: () => void;
  sourceType?: "job_board" | "company_site" | null;
  /** Whether this URL is a vacancy apply URL, rather than an employer website. */
  trackVacancyIntent?: boolean;
  /** Override the API path (relative to /api). Defaults to /sponsor-licences/vacancies/:vacancyId/gap-analysis */
  analysisEndpoint?: string;
  analysisSource?: "role" | "sponsor_vacancy";
}

interface UsageData { used: number; limit: number; resetsAt?: string; plan?: "free" | "pro"; bonusRemaining?: number; }

export function GapAnalysisSheet({
  open,
  onOpenChange,
  vacancyId,
  vacancyTitle,
  companyName,
  vacancyUrl,
  hasCvUploaded,
  onApply,
  sourceType,
  trackVacancyIntent = true,
  analysisEndpoint,
  analysisSource = "sponsor_vacancy",
}: GapAnalysisSheetProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [limitReached, setLimitReached] = useState(false);
  const [acknowledgingClaimKey, setAcknowledgingClaimKey] = useState<string | null>(null);
  const [acknowledgedThisSession, setAcknowledgedThisSession] = useState<Set<string>>(new Set());
  const [lastAcknowledged, setLastAcknowledged] = useState<string | null>(null);

  const { data: claimsData, isError: claimsError } = useQuery<{
    claims: Array<{ claimKey: string; claimText: string }>;
  }>({
    queryKey: ["readiness-claims"],
    enabled: open,
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/readiness/claims`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch readiness claims.");
      return res.json() as Promise<{ claims: Array<{ claimKey: string; claimText: string }> }>;
    },
    staleTime: 0,
  });

  const acknowledgedKeys = useMemo(
    () => new Set([
      ...(claimsData?.claims ?? []).map((claim) => normalizeReadinessClaim(claim.claimKey)),
      ...acknowledgedThisSession,
    ]),
    [claimsData, acknowledgedThisSession],
  );

  const { data: usage } = useQuery<UsageData>({
    queryKey: ["gap-analysis-usage"],
    enabled: open,
    staleTime: 0,
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/sponsor-licences/gap-analyses/usage`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch usage.");
      return res.json() as Promise<UsageData>;
    },
  });

  useEffect(() => {
    if (open && usage && (usage.used < usage.limit || usage.plan === "pro" || (usage.bonusRemaining ?? 0) > 0)) {
      setLimitReached(false);
    }
  }, [open, usage]);

  useEffect(() => {
    const handleUpgrade = () => setLimitReached(false);
    window.addEventListener("jobsage:readiness-upgraded", handleUpgrade);
    return () => window.removeEventListener("jobsage:readiness-upgraded", handleUpgrade);
  }, []);

  const { data, isLoading, isError, error } = useQuery<GapAnalysisData>({
    queryKey: ["gap-analysis", analysisEndpoint ?? "sponsor-vacancy", vacancyId],
    enabled: open && !limitReached,
    staleTime: 7 * 24 * 60 * 60 * 1000, // 7 days — matches server TTL
    retry: false,
    queryFn: async () => {
      const endpoint = analysisEndpoint
        ? `${API_BASE}${analysisEndpoint}`
        : `${API_BASE}/sponsor-licences/vacancies/${vacancyId}/gap-analysis`;
      const res = await fetch(endpoint, { credentials: "include" });
      if (res.status === 429) {
        setLimitReached(true);
        window.dispatchEvent(new CustomEvent("jobsage:readiness-limit-reached"));
        toast({
          title: "Readiness Check limit reached",
          description: `You have used all ${usage?.limit ?? 3} of your Readiness Checks.`,
          variant: "destructive",
        });
        throw new Error("LIMIT_REACHED");
      }
      if (!res.ok) {
        throw new Error("Failed to generate gap analysis.");
      }
      return res.json() as Promise<GapAnalysisData>;
    },
  });
  const visibleGaps = useMemo(
    () => unresolvedReadinessGaps(data?.gaps ?? [], acknowledgedKeys),
    [data?.gaps, acknowledgedKeys],
  );

  async function acknowledgeGap(gap: string) {
    const claimKey = normalizeReadinessClaim(gap);
    setAcknowledgingClaimKey(claimKey);
    setLastAcknowledged(null);
    setAcknowledgedThisSession((current) => new Set(current).add(claimKey));
    try {
      const res = await fetch(`${API_BASE}/readiness/claims`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          claimText: gap,
          ...(analysisSource === "role" ? { sourceRoleId: vacancyId } : { sourceVacancyId: vacancyId }),
        }),
      });
      const body = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Could not save this acknowledgement.");
      setLastAcknowledged(gap);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["readiness-claims"] }),
        queryClient.invalidateQueries({ queryKey: ["gap-analysis"] }),
      ]);
      toast({
        title: "Gap acknowledged",
        description: "Saved as a self-declared claim. It is not verified and will not change your compliance profile.",
      });
    } catch (err) {
      setAcknowledgedThisSession((current) => {
        const next = new Set(current);
        next.delete(claimKey);
        return next;
      });
      toast({
        title: "Could not save acknowledgement",
        description: `Your acknowledgement was not recorded. ${err instanceof Error ? err.message : "Please try again."}`,
        variant: "destructive",
      });
    } finally {
      setAcknowledgingClaimKey(null);
    }
  }

  // When a fresh (non-cached) result arrives, invalidate the usage counter so
  // the usage badge reflects the new count without waiting for a stale-time window.
  useEffect(() => {
    if (data && !data.fromCache) {
      void queryClient.invalidateQueries({ queryKey: ["gap-analysis-usage"] });
    }
  }, [data, queryClient]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader className="pb-4 border-b border-border">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
              <Sparkles className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <SheetTitle className="text-base leading-tight">{vacancyTitle}</SheetTitle>
              <SheetDescription className="text-sm text-muted-foreground mt-0.5">
                {companyName} · Readiness Check
              </SheetDescription>
            </div>
            {usage && (
              <span
                title={usage.resetsAt ? `Resets ${new Date(usage.resetsAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}` : undefined}
                className={`shrink-0 text-[11px] font-semibold px-2 py-1 rounded-full border ${
                usage.used >= usage.limit
                  ? "bg-red-50 text-red-600 border-red-200 dark:bg-red-950/30 dark:text-red-400 dark:border-red-800/40"
                  : usage.used >= usage.limit - 2
                  ? "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800/40"
                  : "bg-muted text-muted-foreground border-border"
              }`}>
                {usage.used}/{usage.limit} this month
              </span>
            )}
          </div>
        </SheetHeader>

        <div className="py-5 space-y-6">
          {/* ── Loading ── */}
          {isLoading && (
            <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted-foreground">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
              <p className="text-sm text-center">
                Analysing your profile against this vacancy…
              </p>
              <p className="text-xs text-center opacity-60">This may take a few seconds</p>
            </div>
          )}

          {/* ── Limit reached ── */}
          {limitReached && !isLoading && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/60 dark:bg-amber-950/20 dark:border-amber-800/40 p-4 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                  Readiness Check limit reached
                </p>
                <p className="text-xs text-amber-700/80 dark:text-amber-400/70 mt-1">
                  You have used all {usage?.limit ?? 3} of your Readiness Checks this month. New checks become available on{" "}
                  {usage?.resetsAt
                    ? new Date(usage.resetsAt).toLocaleDateString("en-GB", { day: "numeric", month: "long" })
                    : "the first day of next month"}
                  . Your existing results remain accessible below.
                </p>
              </div>
            </div>
          )}

          {/* ── Error ── */}
          {isError && !limitReached && (
            <div className="rounded-xl border border-red-200 bg-red-50/60 dark:bg-red-950/20 dark:border-red-800/40 p-4 flex items-start gap-3">
              <XCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-red-700 dark:text-red-400">
                  Could not generate analysis
                </p>
                <p className="text-xs text-red-600/80 dark:text-red-400/70 mt-1">
                  {error instanceof Error && error.message !== "LIMIT_REACHED"
                    ? error.message
                    : "Please try again later."}
                </p>
              </div>
            </div>
          )}

          {/* ── Results ── */}
          {data && !isLoading && (
            <>
              {/* Section 1: What You Bring */}
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-6 h-6 rounded-full bg-green-500/15 flex items-center justify-center">
                    <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />
                  </div>
                  <h3 className="text-sm font-semibold text-foreground">What You Bring</h3>
                  <span className="ml-auto text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                    {data.matchedRequirements.length}
                  </span>
                </div>
                {data.matchedRequirements.length > 0 ? (
                  <ul className="space-y-2">
                    {data.matchedRequirements.map((req, i) => (
                      <li
                        key={i}
                        className="flex items-start gap-2.5 text-sm text-foreground rounded-lg bg-green-50/70 dark:bg-green-950/20 border border-green-200/60 dark:border-green-800/30 px-3 py-2"
                      >
                        <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0 mt-0.5" />
                        {req}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-muted-foreground italic">No clear matches identified for this role.</p>
                )}
              </section>

              {/* Section 2: Gaps */}
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-6 h-6 rounded-full bg-red-500/15 flex items-center justify-center">
                    <XCircle className="w-3.5 h-3.5 text-red-500" />
                  </div>
                  <h3 className="text-sm font-semibold text-foreground">Gaps to Address</h3>
                  <span className="ml-auto text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                    {visibleGaps.length}
                  </span>
                </div>
                {lastAcknowledged && (
                  <div className="mb-3 flex items-start gap-2 rounded-lg border border-green-200 bg-green-50/70 px-3 py-2 text-xs text-green-800 dark:border-green-800/40 dark:bg-green-950/20 dark:text-green-300" role="status">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                    <span><strong>Saved:</strong> “{lastAcknowledged}” is now treated as a self-declared claim, not verified compliance evidence.</span>
                  </div>
                )}
                {visibleGaps.length > 0 ? (
                  <ul className="space-y-2">
                    {visibleGaps.map((gap) => (
                      <li
                        key={normalizeReadinessClaim(gap)}
                        className="rounded-lg bg-red-50/70 dark:bg-red-950/20 border border-red-200/60 dark:border-red-800/30 px-3 py-2"
                      >
                        <div className="flex items-start gap-2.5 text-sm text-foreground">
                          <XCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                          <span>{gap}</span>
                        </div>
                        {requiresStructuredProfileUpdate(gap) ? (
                          <a
                            href={`${import.meta.env.BASE_URL}profile`}
                            className="mt-2 inline-flex min-h-9 items-center gap-1.5 rounded-md border border-primary/30 bg-background px-2.5 text-xs font-medium text-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <UserRoundCog className="h-3.5 w-3.5" />
                            Review this in my profile
                          </a>
                        ) : (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="mt-2 min-h-9 border-red-300/70 bg-background text-xs"
                            disabled={acknowledgingClaimKey !== null}
                            onClick={() => void acknowledgeGap(gap)}
                            aria-label={`I already have this: ${gap}`}
                          >
                            {acknowledgingClaimKey === normalizeReadinessClaim(gap)
                              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              : <CheckCircle2 className="h-3.5 w-3.5" />}
                            I already have this
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-muted-foreground italic">No unresolved gaps identified — great fit!</p>
                )}
                {claimsError && (
                  <p className="mt-2 text-xs text-amber-700 dark:text-amber-400" role="status">
                    Saved acknowledgements could not be loaded. Please refresh before reviewing this result.
                  </p>
                )}
              </section>

              {/* Section 3: How to Optimise */}
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-6 h-6 rounded-full bg-primary/15 flex items-center justify-center">
                    <Lightbulb className="w-3.5 h-3.5 text-primary" />
                  </div>
                  <h3 className="text-sm font-semibold text-foreground">How to Strengthen Your Application</h3>
                </div>
                {data.optimizationSteps.length > 0 ? (
                  <ol className="space-y-2">
                    {data.optimizationSteps.map((step, i) => (
                      <li
                        key={i}
                        className="flex items-start gap-2.5 text-sm text-foreground rounded-lg bg-primary/5 border border-primary/15 px-3 py-2"
                      >
                        <span className="w-5 h-5 rounded-full bg-primary/20 text-primary text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                          {i + 1}
                        </span>
                        {step}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-xs text-muted-foreground italic">No specific optimisation steps needed.</p>
                )}
              </section>

              {data.fromCache && (
                <p className="text-[11px] text-muted-foreground/60 text-center">
                  Analysis generated {new Date(data.generatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })} · refreshes after 7 days
                </p>
              )}
            </>
          )}
        </div>

        {/* ── Action buttons ── */}
        <div className="border-t border-border pt-4 flex flex-col gap-2">
          {vacancyUrl && (
            <Button
              className="w-full"
              onClick={() => {
                if (trackVacancyIntent) {
                  void openTrackedSponsorVacancy({
                    vacancyId,
                    roleId: analysisSource === "sponsor_vacancy" ? vacancyId + 2_000_000 : vacancyId,
                    url: vacancyUrl,
                    title: vacancyTitle,
                    employer: companyName,
                  });
                } else {
                  void openTrackedOutbound({ url: vacancyUrl });
                }
              }}
            >
              {sourceType === "job_board" ? "Apply Via Job Board" : "Apply on company's website"}
              <ExternalLink className="w-4 h-4 opacity-70" />
            </Button>
          )}
          {onApply && (
            <Button
              className="w-full"
              disabled={!hasCvUploaded}
              title={!hasCvUploaded ? "Upload a CV to apply" : undefined}
              onClick={onApply}
            >
              <Send className="w-4 h-4" />
              Send my CV
            </Button>
          )}
          {onApply && !hasCvUploaded && (
            <p className="text-xs text-center text-muted-foreground">
              Upload a CV in{" "}
              <a href={`${import.meta.env.BASE_URL}cv`} className="text-primary hover:underline">
                CV &amp; Supporting Documents
              </a>{" "}
              to apply.
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
