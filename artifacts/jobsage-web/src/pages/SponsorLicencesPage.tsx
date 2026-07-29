import { useState, useEffect, useRef } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, PageTransition, Button } from "@/components/ui-enhanced";
import { SponsorVacancyApplyModal } from "@/components/SponsorVacancyApplyModal";
import { getListMyApplicationsQueryKey } from "@workspace/api-client-react";
import { openTrackedSponsorVacancy } from "@/lib/trackedOutbound";
import { useExtensionGate } from "@/components/SmartApplyExtensionPrompt";
import {
  useGetSponsorLicenceRoutes,
  useGetSponsorLicenceIndustryCounts,
  useGetSponsorLicenceIndustries,
  useListSponsorLicences,
  useListSpeculativeApplications,
  useCheckAllSponsorLicenceVacancies,
  useCheckSponsorLicenceVacancies,
  useCheckSponsorLicenceVacancyBatch,
  useMarkApplication,
  getGetSponsorLicenceVacanciesQueryKey,
  useGetCheckAllSponsorLicenceVacanciesStatus,
  useGetSponsorLicenceVacancies,
  useGetSponsorLicenceVacancyStats,
  useEnrichSponsorLicenceContact,
  useGetSponsorLicenceRegions,
  useBookmarkSponsorLicence,
  useUnbookmarkSponsorLicence,
  useListMyDocuments,
  getListSponsorLicencesQueryKey,
  getGetSponsorLicenceIndustryCountsQueryKey,
  getGetCheckAllSponsorLicenceVacanciesStatusQueryKey,
  type SponsorLicenceVacancyMatch,
  type SponsorLicenceEnrichResponse,
} from "@workspace/api-client-react";
import { useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Building2,
  Search,
  MapPin,
  BadgeCheck,
  Briefcase,
  AlertCircle,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Filter,
  Send,
  CheckCircle2,
  Loader2,
  ExternalLink,
  ArrowLeft,
  Sparkles,
  Heart,
  Users,
  GraduationCap,
  Settings2,
  HardHat,
  Monitor,
  UtensilsCrossed,
  TrendingUp,
  ShoppingBag,
  Truck,
  Scale,
  Landmark,
  Factory,
  LayoutGrid,
  Bookmark,
  BookmarkCheck,
  Globe,
  ChevronDown,
  Phone,
  Mail,
  ChevronUp,
  X,
  DollarSign,
  CalendarDays,
  Gauge,
  AlertTriangle,
  PlayCircle,
  Clock,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@workspace/auth-web";

const LIMIT = 20;

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function isWithinCacheTtl(dt: string | null | undefined): boolean {
  if (!dt) return false;
  const then = new Date(dt).getTime();
  if (Number.isNaN(then)) return false;
  return Date.now() - then < CACHE_TTL_MS;
}

function formatSyncDate(dt: string | null | undefined): string {
  if (!dt) return "Never";
  return new Date(dt).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatCheckedAt(dt: string | null | undefined): string | null {
  if (!dt) return null;
  const then = new Date(dt).getTime();
  if (Number.isNaN(then)) return null;
  const diffMs = Date.now() - then;
  const diffMins = Math.round(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.round(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(dt).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

type SectorConfig = {
  icon: React.ElementType;
  bg: string;
  iconColor: string;
  badgeBg: string;
  badgeText: string;
};

const SECTOR_CONFIG: Record<string, SectorConfig> = {
  Healthcare: { icon: Heart, bg: "bg-rose-500/10", iconColor: "text-rose-600", badgeBg: "bg-rose-500/10", badgeText: "text-rose-700" },
  "Social Care": { icon: Users, bg: "bg-purple-500/10", iconColor: "text-purple-600", badgeBg: "bg-purple-500/10", badgeText: "text-purple-700" },
  Education: { icon: GraduationCap, bg: "bg-amber-500/10", iconColor: "text-amber-600", badgeBg: "bg-amber-500/10", badgeText: "text-amber-700" },
  Engineering: { icon: Settings2, bg: "bg-slate-500/10", iconColor: "text-slate-600", badgeBg: "bg-slate-500/10", badgeText: "text-slate-700" },
  Construction: { icon: HardHat, bg: "bg-orange-500/10", iconColor: "text-orange-600", badgeBg: "bg-orange-500/10", badgeText: "text-orange-700" },
  Technology: { icon: Monitor, bg: "bg-blue-500/10", iconColor: "text-blue-600", badgeBg: "bg-blue-500/10", badgeText: "text-blue-700" },
  Hospitality: { icon: UtensilsCrossed, bg: "bg-teal-500/10", iconColor: "text-teal-600", badgeBg: "bg-teal-500/10", badgeText: "text-teal-700" },
  Finance: { icon: TrendingUp, bg: "bg-green-500/10", iconColor: "text-green-600", badgeBg: "bg-green-500/10", badgeText: "text-green-700" },
  Retail: { icon: ShoppingBag, bg: "bg-pink-500/10", iconColor: "text-pink-600", badgeBg: "bg-pink-500/10", badgeText: "text-pink-700" },
  Transport: { icon: Truck, bg: "bg-sky-500/10", iconColor: "text-sky-600", badgeBg: "bg-sky-500/10", badgeText: "text-sky-700" },
  "Legal & Professional": { icon: Scale, bg: "bg-indigo-500/10", iconColor: "text-indigo-600", badgeBg: "bg-indigo-500/10", badgeText: "text-indigo-700" },
  "Public Services": { icon: Landmark, bg: "bg-violet-500/10", iconColor: "text-violet-600", badgeBg: "bg-violet-500/10", badgeText: "text-violet-700" },
  Manufacturing: { icon: Factory, bg: "bg-zinc-500/10", iconColor: "text-zinc-600", badgeBg: "bg-zinc-500/10", badgeText: "text-zinc-700" },
  Other: { icon: LayoutGrid, bg: "bg-gray-500/10", iconColor: "text-gray-500", badgeBg: "bg-gray-500/10", badgeText: "text-gray-600" },
};

function getSectorConfig(industry: string): SectorConfig {
  return SECTOR_CONFIG[industry] ?? SECTOR_CONFIG["Other"]!;
}

type SelectedVacancy = SponsorLicenceVacancyMatch & { companyName: string; companyId: number };

function VacancyMatchPanel({
  companyId,
  companyName,
  hasCvUploaded,
  isSent,
  sendCVPending,
  storedVacancyCount,
  careersUrl,
  onSendCV,
  onSelectVacancy,
  onApply,
  onWebsiteApply,
  onScoresReady,
  requireExtension,
}: {
  companyId: number;
  companyName: string;
  hasCvUploaded: boolean;
  isSent: boolean;
  sendCVPending: boolean;
  storedVacancyCount: number | null;
  careersUrl: string | null;
  onSendCV: () => void;
  onSelectVacancy: (v: SelectedVacancy) => void;
  onApply: (v: SelectedVacancy) => void;
  onWebsiteApply: () => void;
  onScoresReady: (score: number | null) => void;
  requireExtension: (action: () => void) => void;
}) {
  const { data, isLoading } = useGetSponsorLicenceVacancies(companyId);
  const { toast: panelToast } = useToast();
  const panelQueryClient = useQueryClient();
  const vacancies = data?.vacancies ?? [];
  const noApplyLinks = vacancies.length > 0 && vacancies.every((v) => !v.url);

  // On-demand vacancy check: if this employer has never been checked, kick
  // off a fresh check so "Check Best Fit" always produces a result.
  const checkMutation = useCheckSponsorLicenceVacancies();
  const triggeredCheckRef = useRef(false);
  const neverChecked = !isLoading && vacancies.length === 0 && data?.lastCheckedAt == null;
  useEffect(() => {
    if (neverChecked && !triggeredCheckRef.current) {
      triggeredCheckRef.current = true;
      checkMutation.mutate(
        { id: companyId },
        {
          onSuccess: () => {
            void panelQueryClient.invalidateQueries({ queryKey: getGetSponsorLicenceVacanciesQueryKey(companyId) });
          },
        },
      );
    }
  }, [neverChecked, companyId]);

  // Surface the company-level best-fit % (top vacancy score) to the parent so
  // the "Check Best Fit" button can show it immediately.
  useEffect(() => {
    if (!data) return;
    const scores = (data.vacancies ?? [])
      .map((v) => v.matchScore)
      .filter((s): s is number => s != null);
    onScoresReady(scores.length > 0 ? Math.max(...scores) : null);
  }, [data]);

  const checkInProgress = isLoading || checkMutation.isPending;

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      className="mt-3 ml-14"
    >
      {checkInProgress ? (
        <div className="rounded-xl border border-border bg-muted/30 px-4 py-3 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          {checkMutation.isPending
            ? "Checking live vacancies and scoring your best fit — this can take a moment…"
            : "Loading matched vacancies and scoring your best fit…"}
        </div>
      ) : vacancies.length === 0 && storedVacancyCount != null && storedVacancyCount > 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50/60 dark:bg-amber-950/20 dark:border-amber-800/40 px-4 py-3 space-y-2">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
              {storedVacancyCount} {storedVacancyCount === 1 ? "opening was" : "openings were"} found for this employer, but no direct apply links are currently available. Visit the employer's careers site to see the listings.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 pl-6">
            {careersUrl && (
              <a
                href={careersUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary font-medium hover:underline"
              >
                <Globe className="w-3 h-3" />
                Visit careers site
                <ExternalLink className="w-3 h-3 opacity-60" />
              </a>
            )}
            <button
              onClick={onSendCV}
              disabled={isSent || sendCVPending}
              className="text-xs text-primary font-medium hover:underline disabled:opacity-50 flex items-center gap-1"
            >
              {isSent ? "CV Sent ✓" : "Send CV speculatively"}
            </button>
          </div>
        </div>
      ) : vacancies.length === 0 ? (
        <div className="rounded-xl border border-border bg-muted/30 px-4 py-2.5 flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground">No current vacancies found on job boards.</span>
          <button
            onClick={onWebsiteApply}
            className="ml-auto text-xs text-primary font-medium hover:underline flex items-center gap-1"
          >
            <Globe className="w-3 h-3" />
            Apply on company website
          </button>
          <button
            onClick={onSendCV}
            disabled={isSent || sendCVPending}
            className="text-xs text-primary font-medium hover:underline disabled:opacity-50 flex items-center gap-1"
          >
            {isSent ? "CV Sent ✓" : "Send CV speculatively"}
          </button>
        </div>
      ) : (
        <div className="rounded-xl border border-green-200 bg-green-50/60 dark:bg-green-950/20 dark:border-green-800/40 overflow-hidden">
          <div className="px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BadgeCheck className="w-4 h-4 text-green-600 shrink-0" />
              <span className="text-sm font-semibold text-green-800 dark:text-green-300">
                {vacancies.length} {vacancies.length === 1 ? "vacancy" : "vacancies"}, sorted by suitability
              </span>
              {data?.lastCheckedAt && (
                <span className="text-xs text-green-700/70 dark:text-green-400/70 hidden sm:block">
                  · checked {formatSyncDate(data.lastCheckedAt)}
                </span>
              )}
            </div>
          </div>
          <div className="border-t border-green-200 dark:border-green-800/40 px-4 py-3 space-y-1.5">
            {vacancies.map((v) => {
              const score = v.matchScore ?? null;
              const eligible = v.isEligible ?? null;
              return (
                <div
                  key={v.id}
                  className="flex items-start justify-between gap-3 px-3 py-2.5 rounded-lg bg-white dark:bg-green-950/40 border border-green-100 dark:border-green-800/30 group hover:border-green-300 dark:hover:border-green-700/60 transition-colors cursor-pointer"
                  onClick={() => onSelectVacancy({ ...v, companyName, companyId })}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium text-foreground truncate">{v.title}</p>
                      {v.url && (v.linkVerified ? (
                        <span
                          className="inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 shrink-0"
                          title={v.linkCheckedAt ? `Link checked ${new Date(v.linkCheckedAt).toLocaleString("en-GB")}` : "Apply link confirmed live"}
                        >
                          <BadgeCheck className="w-3 h-3" />
                          Link verified
                        </span>
                      ) : (
                        <span
                          className="inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-700 shrink-0"
                          title="This apply link has not been health-checked yet — it will be verified shortly"
                        >
                          <Clock className="w-3 h-3" />
                          Link unverified
                        </span>
                      ))}
                      {score != null && (
                        <span className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full shrink-0 ${
                          score >= 80
                            ? "bg-green-500/20 text-green-700"
                            : score >= 50
                            ? "bg-amber-500/20 text-amber-700"
                            : "bg-slate-500/15 text-slate-600"
                        }`}>
                          <Gauge className="w-3 h-3" />
                          {Math.round(score)}% Match
                        </span>
                      )}
                      {eligible === false && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-700 shrink-0">
                          <AlertTriangle className="w-3 h-3" />
                          Not yet eligible
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground flex-wrap">
                      {v.location && (
                        <span className="flex items-center gap-1">
                          <MapPin className="w-3 h-3" />
                          {v.location}
                        </span>
                      )}
                      {v.salary && (
                        <span className="flex items-center gap-1">
                          <DollarSign className="w-3 h-3" />
                          {v.salary}
                        </span>
                      )}
                      {v.postedDate && (
                        <span className="flex items-center gap-1">
                          <CalendarDays className="w-3 h-3" />
                          {v.postedDate}
                        </span>
                      )}
                    </div>
                    {v.missingRequirements && v.missingRequirements.length > 0 && (
                      <p className="text-xs text-amber-700/90 mt-1">
                        Missing: {v.missingRequirements.join(", ")}
                      </p>
                    )}
                    {v.matchExplanation && (
                      <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{v.matchExplanation}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {v.url && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          requireExtension(() => {
                            void openTrackedSponsorVacancy({
                              vacancyId: v.id,
                              url: v.url!,
                              toast: panelToast,
                              onTracked: () => {
                                void panelQueryClient.invalidateQueries({ queryKey: getListMyApplicationsQueryKey() });
                              },
                            });
                          });
                        }}
                        className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                        title="View on job board"
                      >
                        <ExternalLink className="w-3 h-3" />
                      </button>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); onApply({ ...v, companyName, companyId }); }}
                      disabled={!hasCvUploaded || eligible === false}
                      className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 border border-primary/20 transition-colors font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Sparkles className="w-3 h-3" />
                      Apply with JOBSAGE
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          {noApplyLinks && (
            <div className="px-4 pb-2 flex items-start gap-2">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
                No direct apply links are available for these openings.{" "}
                {careersUrl ? (
                  <a
                    href={careersUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary font-medium hover:underline inline-flex items-center gap-1"
                  >
                    Visit the careers site
                    <ExternalLink className="w-3 h-3 opacity-60" />
                  </a>
                ) : (
                  "Visit the employer's careers site to apply directly"
                )}
                .
              </p>
            </div>
          )}
          <div className="px-4 pb-3 flex flex-wrap gap-2 items-center">
            <Button
              size="sm"
              variant="outline"
              className="text-xs gap-1.5 h-7"
              onClick={onWebsiteApply}
            >
              <Globe className="w-3.5 h-3.5" /> Apply on company website
            </Button>
            <Button
              size="sm"
              variant={isSent ? "outline" : "default"}
              className="text-xs gap-1.5 h-7"
              onClick={onSendCV}
              disabled={sendCVPending}
            >
              {isSent ? (
                <><CheckCircle2 className="w-3.5 h-3.5" /> CV Sent</>
              ) : (
                <><Send className="w-3.5 h-3.5" /> Send CV speculatively</>
              )}
            </Button>
            <p className="text-[10px] text-green-700/60 dark:text-green-400/50">
              Vacancies sourced from job boards. Always verify directly on the employer's official site.
            </p>
          </div>
        </div>
      )}
    </motion.div>
  );
}

export default function SponsorLicencesPage() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedRoute, setSelectedRoute] = useState("");
  const [selectedIndustry, setSelectedIndustry] = useState("");
  const [selectedRegions, setSelectedRegions] = useState<string[]>([]);
  const [regionDropdownOpen, setRegionDropdownOpen] = useState(false);
  const [hasVacancies, setHasVacancies] = useState(false);
  const [bookmarkedOnly, setBookmarkedOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [localBookmarks, setLocalBookmarks] = useState<Set<number>>(new Set());
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: speculativeData, refetch: refetchSpeculative } = useListSpeculativeApplications();
  const { data: documentsData } = useListMyDocuments();
  const hasCvUploaded = (documentsData?.documents ?? []).some((d) => d.documentType === "cv");
  const sentCompanyNames = new Set((speculativeData?.applications ?? []).map((a) => a.companyName));

  const [expandedVacancies, setExpandedVacancies] = useState<Set<number>>(new Set());
  const [expandedContact, setExpandedContact] = useState<Set<number>>(new Set());
  const [enrichedContacts, setEnrichedContacts] = useState<Map<number, SponsorLicenceEnrichResponse>>(new Map());
  const [enrichingIds, setEnrichingIds] = useState<Set<number>>(new Set());
  const enrichMutation = useEnrichSponsorLicenceContact();

  const [selectedVacancy, setSelectedVacancy] = useState<SelectedVacancy | null>(null);
  const [applyModalVacancy, setApplyModalVacancy] = useState<SelectedVacancy | null>(null);
  const [speculativeModalTarget, setSpeculativeModalTarget] = useState<{ companyName: string; companyId: number } | null>(null);
  // Tracks live best-fit score per company once the VacancyMatchPanel scores vacancies
  const [liveMatchScores, setLiveMatchScores] = useState<Map<number, number | null>>(new Map());
  const markApplicationMutation = useMarkApplication();
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");

  // Applying requires the Smart Apply extension so outbound applications are tracked.
  const { requireExtension, gateModal } = useExtensionGate();

  function handleOpenApplyModal(vacancy: SelectedVacancy) {
    if (!hasCvUploaded) {
      toast({
        title: "No CV uploaded",
        description: "Please upload your CV in 'CV & Supporting Documents' before applying.",
        variant: "destructive",
      });
      return;
    }
    requireExtension(() => {
      setSelectedVacancy(null);
      setApplyModalVacancy(vacancy);
    });
  }

  function handleWebsiteApply(companyName: string, companyId: number, careersUrl: string | null) {
    if (careersUrl) {
      // Open the careers site and log a Company Website application.
      const win = window.open(careersUrl, "_blank", "noopener,noreferrer");
      if (win) win.opener = null;
      markApplicationMutation.mutate(
        {
          data: {
            applicationType: "website",
            applicationUrl: careersUrl,
            companyName,
          } as Parameters<typeof markApplicationMutation.mutate>[0]["data"],
        },
        {
          onSuccess: () => {
            toast({
              title: "Application logged!",
              description: "Track your progress under the 'Company Website' tab in your Tracker.",
            });
            void queryClient.invalidateQueries({ queryKey: getListMyApplicationsQueryKey() });
          },
        },
      );
    } else {
      // No careers URL yet — open the Contact panel for this company so the
      // candidate can use "Find Contact Details" to discover the careers site.
      setExpandedContact((prev) => {
        const next = new Set(prev);
        next.add(companyId);
        return next;
      });
      toast({
        title: "No careers site found yet",
        description: "Expand the Contact panel to find or discover the employer's website.",
      });
    }
  }
  const bookmarkMutation = useBookmarkSponsorLicence();
  const unbookmarkMutation = useUnbookmarkSponsorLicence();

  const { user } = useAuth();
  const isAdmin = (user?.role as string) === "admin" || (user?.role as string) === "super_admin";

  const checkAllMutation = useCheckAllSponsorLicenceVacancies();
  const batchCheckMutation = useCheckSponsorLicenceVacancyBatch();
  const { data: checkAllStatus } = useGetCheckAllSponsorLicenceVacanciesStatus({
    query: {
      queryKey: getGetCheckAllSponsorLicenceVacanciesStatusQueryKey(),
      refetchInterval: (query) => (query.state.data?.isRunning ? 2000 : false),
    },
  });
  const isCheckingAll = checkAllStatus?.isRunning ?? false;
  const checkAllProgressPct =
    checkAllStatus && checkAllStatus.total > 0
      ? Math.round((checkAllStatus.processed / checkAllStatus.total) * 100)
      : 0;

  function handleCheckAllVacancies() {
    const regions = selectedRegions.length > 0 ? selectedRegions : undefined;
    const regionLabel =
      regions == null
        ? "all employers"
        : regions.length === 1
          ? regions[0]
          : `${regions.length} regions`;
    checkAllMutation.mutate({ data: { regions } }, {
      onSuccess: (res) => {
        if (res.started) {
          toast({ title: "Vacancy check started", description: `Scanning ${regionLabel} for new vacancies. This can take a while.` });
        } else {
          toast({ title: "Already running", description: "A vacancy check is already in progress." });
        }
        void queryClient.invalidateQueries({ queryKey: getGetCheckAllSponsorLicenceVacanciesStatusQueryKey() });
      },
      onError: () => {
        toast({ title: "Error", description: "Could not start the vacancy check. Please try again.", variant: "destructive" });
      },
    });
  }

  // Briefly highlights the "Checked Xm ago" badges after a page refresh so
  // users can see the results actually re-rendered.
  const [timestampPulse, setTimestampPulse] = useState(false);

  function handleRefreshVisible(visibleIds: number[]) {
    if (visibleIds.length === 0) {
      toast({ title: "Nothing to refresh", description: "No sponsor cards are currently visible." });
      return;
    }
    batchCheckMutation.mutate({ data: { ids: visibleIds.slice(0, LIMIT) } }, {
      onSuccess: (res) => {
        if (res.newChecks === 0 && res.cacheHits > 0) {
          toast({
            title: "Already up to date",
            description: `⚡ All ${res.cacheHits} visible employers were checked within the last 24 hours — job listings are completely up to date!`,
          });
        } else {
          toast({
            title: "Page refreshed",
            description: `${res.newChecks} freshly checked · ${res.cacheHits} up to date${res.errors > 0 ? ` · ${res.errors} failed` : ""}.`,
          });
        }
        void queryClient.invalidateQueries({ queryKey: [getListSponsorLicencesQueryKey()[0]] });
        void queryClient.invalidateQueries({ queryKey: getGetSponsorLicenceIndustryCountsQueryKey() });
        // Briefly pulse the "Checked Xm ago" badges so the re-render is visible.
        setTimestampPulse(true);
        window.setTimeout(() => setTimestampPulse(false), 2500);
      },
      onError: (err) => {
        const e = err as { status?: number; data?: { error?: string; retryAfterSeconds?: number } | null };
        if (e.status === 429) {
          toast({
            title: "Please wait",
            description: e.data?.error ?? "You refreshed recently — please wait a moment before trying again.",
          });
        } else {
          toast({ title: "Error", description: "Could not refresh this page. Please try again.", variant: "destructive" });
        }
      },
    });
  }

  // Refresh company list and industry counts once a running check-all pass completes
  const wasCheckingAllRef = useRef(false);
  useEffect(() => {
    if (wasCheckingAllRef.current && !isCheckingAll) {
      void queryClient.invalidateQueries({ queryKey: [getListSponsorLicencesQueryKey()[0]] });
      void queryClient.invalidateQueries({ queryKey: getGetSponsorLicenceIndustryCountsQueryKey() });
      toast({ title: "Vacancy check complete", description: "Match scores have been updated." });
    }
    wasCheckingAllRef.current = isCheckingAll;
  }, [isCheckingAll]);

  function handleToggleBookmark(companyId: number, currentlyBookmarked: boolean) {
    const optimisticNew = new Set(localBookmarks);
    if (currentlyBookmarked) {
      optimisticNew.delete(companyId);
    } else {
      optimisticNew.add(companyId);
    }
    setLocalBookmarks(optimisticNew);

    const invalidate = () => {
      void queryClient.invalidateQueries({ queryKey: [getListSponsorLicencesQueryKey()[0]] });
      void queryClient.invalidateQueries({ queryKey: getGetSponsorLicenceIndustryCountsQueryKey() });
    };

    if (currentlyBookmarked) {
      unbookmarkMutation.mutate(
        { id: companyId },
        {
          onSuccess: invalidate,
          onError: () => {
            setLocalBookmarks((prev) => {
              const r = new Set(prev);
              r.add(companyId);
              return r;
            });
            toast({ title: "Error", description: "Could not remove bookmark.", variant: "destructive" });
          },
        },
      );
    } else {
      bookmarkMutation.mutate(
        { id: companyId },
        {
          onSuccess: invalidate,
          onError: () => {
            setLocalBookmarks((prev) => {
              const r = new Set(prev);
              r.delete(companyId);
              return r;
            });
            toast({ title: "Error", description: "Could not bookmark company.", variant: "destructive" });
          },
        },
      );
    }
  }

  function handleRegionToggle(region: string) {
    setSelectedRegions((prev) => {
      const next = prev.includes(region) ? prev.filter((r) => r !== region) : [...prev, region];
      setPage(1);
      return next;
    });
  }

  const showSectorGrid = !selectedIndustry;

  function handleOpenSpeculativeModal(companyName: string, companyId: number) {
    if (!hasCvUploaded) {
      toast({
        title: "No CV uploaded",
        description: "Please upload your CV in 'CV & Supporting Documents' before sending a speculative application.",
        variant: "destructive",
      });
      return;
    }
    setSpeculativeModalTarget({ companyName, companyId });
  }

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [search]);

  const { data: vacancyStats } = useGetSponsorLicenceVacancyStats();
  const totalVacanciesFound = vacancyStats?.totalVacanciesFound ?? 0;
  const vacancyCompaniesCount = vacancyStats?.companiesWithVacancies ?? 0;

  function handleEnrichContact(companyId: number) {
    setEnrichingIds((prev) => new Set(prev).add(companyId));
    enrichMutation.mutate(
      { id: companyId },
      {
        onSuccess: (data) => {
          setEnrichedContacts((prev) => {
            const next = new Map(prev);
            next.set(companyId, data);
            return next;
          });
          void queryClient.invalidateQueries({ queryKey: [getListSponsorLicencesQueryKey()[0]] });
        },
        onError: () => {
          toast({ title: "Could not find contact details", description: "Please try again or search manually.", variant: "destructive" });
        },
        onSettled: () => {
          setEnrichingIds((prev) => {
            const next = new Set(prev);
            next.delete(companyId);
            return next;
          });
        },
      },
    );
  }

  const { data: routesData } = useGetSponsorLicenceRoutes();
  const routes = routesData?.routes ?? [];

  const { data: industriesData } = useGetSponsorLicenceIndustries();
  const industries = industriesData?.industries ?? [];

  const { data: regionsData } = useGetSponsorLicenceRegions();
  const regions = regionsData?.regions ?? [];

  const { data: countsData, isLoading: countsLoading } = useGetSponsorLicenceIndustryCounts();
  const sectorCounts = countsData?.counts ?? [];
  const totalSponsors = sectorCounts.reduce((acc, s) => acc + s.count, 0);

  const sponsorListParams = {
    search: debouncedSearch || undefined,
    route: selectedRoute || undefined,
    industry: selectedIndustry || undefined,
    region: selectedRegions.length > 0 ? selectedRegions : undefined,
    hasVacancies: hasVacancies || undefined,
    bookmarkedOnly: bookmarkedOnly || undefined,
    page,
    limit: LIMIT,
  };
  const { data, isLoading, isError } = useListSponsorLicences(sponsorListParams, {
    query: {
      // Keep the previous company list visible while the next page/filter
      // loads so there's no full-page flash on every filter change.
      queryKey: getListSponsorLicencesQueryKey(sponsorListParams),
      placeholderData: keepPreviousData,
    },
  });

  const companies = data?.companies ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 0;
  const withVacancies = data?.withVacancies ?? 0;
  const bookmarkedCount = data?.bookmarkedCount ?? 0;
  const lastSyncedAt = data?.lastSyncedAt;
  const lastSyncFailed = data?.lastSyncFailed;

  // Seed local bookmark state from server on first load
  useEffect(() => {
    if (companies.length > 0) {
      setLocalBookmarks((prev) => {
        const next = new Set(prev);
        companies.forEach((c) => {
          if (c.isBookmarked) next.add(c.id);
        });
        return next;
      });
    }
  }, [companies]);

  const empty = !isLoading && !isError && total === 0;

  function resetListFilters() {
    setSearch("");
    setDebouncedSearch("");
    setSelectedRoute("");
    setHasVacancies(false);
    setBookmarkedOnly(false);
    setSelectedRegions([]);
    setRegionDropdownOpen(false);
    setPage(1);
  }

  function handleSectorSelect(industry: string) {
    setSelectedIndustry(industry);
    resetListFilters();
  }

  function handleBackToSectors() {
    setSelectedIndustry("");
    resetListFilters();
  }

  function handleRouteChange(r: string) {
    setSelectedRoute(r);
    setPage(1);
  }

  function handleVacancyToggle() {
    setHasVacancies((v) => !v);
    setPage(1);
  }

  function handleBookmarkedToggle() {
    setBookmarkedOnly((v) => !v);
    setPage(1);
  }

  const selectedConfig = selectedIndustry ? getSectorConfig(selectedIndustry) : null;

  return (
    <AppLayout>
      <PageTransition>
        <div className="p-6 max-w-6xl mx-auto space-y-6">

          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col gap-1"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <Building2 className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h1 className="text-2xl font-display font-bold text-foreground">
                  Visa Sponsoring Employers
                </h1>
                <p className="text-sm text-muted-foreground">
                  Official UK Home Office register of licensed sponsors — updated daily
                </p>
              </div>
            </div>
          </motion.div>

          {lastSyncFailed && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex items-center gap-2 px-4 py-3 rounded-xl bg-destructive/10 text-destructive text-sm border border-destructive/20"
            >
              <AlertCircle className="w-4 h-4 shrink-0" />
              Last sync attempt failed. Data may be out of date.
            </motion.div>
          )}

          <AnimatePresence mode="wait">
            {showSectorGrid ? (
              /* ── SECTOR GRID VIEW ── */
              <motion.div
                key="sector-grid"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
                className="space-y-6"
              >
                {/* Vacancy index banner */}
                {totalVacanciesFound > 0 && (
                  <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-green-500/8 border border-green-500/20 text-green-800 dark:text-green-300">
                    <BadgeCheck className="w-4 h-4 text-green-600 shrink-0" />
                    <span className="text-sm font-medium">
                      <span className="font-bold">{totalVacanciesFound.toLocaleString()}</span> vacancies indexed across{" "}
                      <span className="font-bold">{vacancyCompaniesCount.toLocaleString()}</span> sponsor companies
                    </span>
                  </div>
                )}

                {/* Summary stats */}
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <Card className="p-4 flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                      <Building2 className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Total Licensed Sponsors</p>
                      <p className="text-xl font-bold text-foreground">
                        {countsLoading ? "—" : totalSponsors.toLocaleString()}
                      </p>
                    </div>
                  </Card>
                  <Card className="p-4 flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl bg-green-500/10 flex items-center justify-center shrink-0">
                      <Briefcase className="w-5 h-5 text-green-600" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">With JOBSAGE Vacancies</p>
                      <p className="text-xl font-bold text-foreground">
                        {countsLoading ? "—" : withVacancies.toLocaleString()}
                      </p>
                    </div>
                  </Card>
                  <Card className="p-4 flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center shrink-0">
                      <Bookmark className="w-5 h-5 text-amber-600" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Bookmarked</p>
                      <p className="text-xl font-bold text-foreground">
                        {bookmarkedCount.toLocaleString()}
                      </p>
                    </div>
                  </Card>
                  <Card className="p-4 flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl bg-sky-500/10 flex items-center justify-center shrink-0">
                      <RefreshCw className="w-5 h-5 text-sky-600" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Last Register Sync</p>
                      <p className="text-xl font-bold text-foreground">{formatSyncDate(lastSyncedAt)}</p>
                    </div>
                  </Card>
                </div>

                {/* Sector heading */}
                <div>
                  <h2 className="text-base font-semibold text-foreground mb-1">Browse by sector</h2>
                  <p className="text-sm text-muted-foreground">Select an industry to see licensed sponsors in that field</p>
                </div>

                {/* Sector grid */}
                {countsLoading ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                    {Array.from({ length: 14 }).map((_, i) => (
                      <Card key={i} className="p-5 animate-pulse">
                        <div className="w-10 h-10 rounded-xl bg-muted mb-3" />
                        <div className="h-4 bg-muted rounded w-2/3 mb-2" />
                        <div className="h-3 bg-muted rounded w-1/3" />
                      </Card>
                    ))}
                  </div>
                ) : sectorCounts.length === 0 ? (
                  <Card className="p-12 text-center">
                    <RefreshCw className="w-12 h-12 text-muted-foreground/40 mx-auto mb-4" />
                    <h3 className="text-lg font-semibold text-foreground mb-2">Register not yet classified</h3>
                    <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                      Industry classification runs in the background. Check back soon.
                    </p>
                  </Card>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                    {sectorCounts.map((s, i) => {
                      const cfg = getSectorConfig(s.industry);
                      const Icon = cfg.icon;
                      return (
                        <motion.div
                          key={s.industry}
                          initial={{ opacity: 0, y: 12 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: i * 0.03 }}
                        >
                          <button
                            onClick={() => handleSectorSelect(s.industry)}
                            className="w-full text-left"
                          >
                            <Card className="p-5 hover:shadow-md hover:border-primary/30 transition-all duration-150 cursor-pointer group h-full">
                              <div className={`w-11 h-11 rounded-xl ${cfg.bg} flex items-center justify-center mb-3 group-hover:scale-105 transition-transform`}>
                                <Icon className={`w-5 h-5 ${cfg.iconColor}`} />
                              </div>
                              <p className="font-semibold text-sm text-foreground leading-tight mb-1">{s.industry}</p>
                              <p className="text-xs text-muted-foreground">
                                {s.count.toLocaleString()} sponsor{s.count !== 1 ? "s" : ""}
                              </p>
                              {(s.bookmarkedCount ?? 0) > 0 && (
                                <span className="inline-flex items-center gap-1 mt-1 text-[10px] font-medium text-amber-700 bg-amber-500/10 px-1.5 py-0.5 rounded-full">
                                  <Bookmark className="w-2.5 h-2.5" />
                                  {s.bookmarkedCount} saved
                                </span>
                              )}
                            </Card>
                          </button>
                        </motion.div>
                      );
                    })}
                  </div>
                )}
              </motion.div>
            ) : (
              /* ── COMPANY LIST VIEW ── */
              <motion.div
                key="company-list"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
                className="space-y-5"
              >
                {/* Breadcrumb + sector header */}
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleBackToSectors}
                    className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    All sectors
                  </button>
                  <span className="text-muted-foreground/40">/</span>
                  {selectedConfig && (
                    <div className="flex items-center gap-2">
                      <div className={`w-7 h-7 rounded-lg ${selectedConfig.bg} flex items-center justify-center`}>
                        <selectedConfig.icon className={`w-3.5 h-3.5 ${selectedConfig.iconColor}`} />
                      </div>
                      <span className="font-semibold text-sm text-foreground">{selectedIndustry}</span>
                    </div>
                  )}
                </div>

                {/* Vacancy index banner */}
                {totalVacanciesFound > 0 && (
                  <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-green-500/8 border border-green-500/20 text-green-800 dark:text-green-300">
                    <BadgeCheck className="w-4 h-4 text-green-600 shrink-0" />
                    <span className="text-sm font-medium">
                      <span className="font-bold">{totalVacanciesFound.toLocaleString()}</span> vacancies indexed across{" "}
                      <span className="font-bold">{vacancyCompaniesCount.toLocaleString()}</span> sponsor companies
                    </span>
                  </div>
                )}

                {/* Stats row */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  {[
                    {
                      label: "Sponsors in this sector",
                      value: isLoading ? "—" : total.toLocaleString(),
                      icon: Building2,
                      color: "text-primary",
                      bg: "bg-primary/10",
                    },
                    {
                      label: "With JOBSAGE Vacancies",
                      value: isLoading ? "—" : withVacancies.toLocaleString(),
                      icon: Briefcase,
                      color: "text-green-600",
                      bg: "bg-green-500/10",
                    },
                    {
                      label: "Bookmarked",
                      value: bookmarkedCount.toLocaleString(),
                      icon: Bookmark,
                      color: "text-amber-600",
                      bg: "bg-amber-500/10",
                    },
                    {
                      label: "Last Register Sync",
                      value: formatSyncDate(lastSyncedAt),
                      icon: RefreshCw,
                      color: "text-sky-600",
                      bg: "bg-sky-500/10",
                    },
                  ].map((s) => (
                    <Card key={s.label} className="p-4 flex items-center gap-4">
                      <div className={`w-10 h-10 rounded-xl ${s.bg} flex items-center justify-center shrink-0`}>
                        <s.icon className={`w-5 h-5 ${s.color}`} />
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">{s.label}</p>
                        <p className="text-xl font-bold text-foreground">{s.value}</p>
                      </div>
                    </Card>
                  ))}
                </div>

                {/* Search & filters */}
                <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
                  <div className="relative flex-1 min-w-[180px]">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input
                      type="text"
                      placeholder="Search by organisation name…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  </div>

                  {routes.length > 0 && (
                    <div className="relative">
                      <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                      <select
                        value={selectedRoute}
                        onChange={(e) => handleRouteChange(e.target.value)}
                        className="pl-9 pr-8 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 appearance-none cursor-pointer"
                      >
                        <option value="">All routes</option>
                        {routes.map((r) => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {industries.length > 0 && (
                    <div className="relative">
                      <LayoutGrid className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                      <select
                        value={selectedIndustry}
                        onChange={(e) => {
                          setSelectedIndustry(e.target.value);
                          setPage(1);
                        }}
                        className="pl-9 pr-8 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 appearance-none cursor-pointer"
                      >
                        {industries.map((ind) => (
                          <option key={ind} value={ind}>{ind}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {regions.length > 0 && (
                    <div className="relative">
                      <button
                        onClick={() => setRegionDropdownOpen((v) => !v)}
                        className={`flex items-center gap-2 pl-3 pr-3 py-2.5 rounded-xl border text-sm transition-colors ${
                          selectedRegions.length > 0
                            ? "border-primary bg-primary/5 text-foreground"
                            : "border-border bg-background text-foreground hover:bg-accent"
                        }`}
                      >
                        <Globe className="w-4 h-4 text-muted-foreground shrink-0" />
                        <span>
                          {selectedRegions.length === 0
                            ? "All regions"
                            : selectedRegions.length === 1
                              ? selectedRegions[0]
                              : `${selectedRegions.length} regions`}
                        </span>
                        <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${regionDropdownOpen ? "rotate-180" : ""}`} />
                      </button>
                      {regionDropdownOpen && (
                        <div className="absolute z-50 top-full mt-1 left-0 bg-background border border-border rounded-xl shadow-lg py-1 min-w-[200px]">
                          {regions.map((r) => (
                            <label
                              key={r}
                              className="flex items-center gap-2.5 px-3 py-2 hover:bg-accent cursor-pointer text-sm"
                            >
                              <input
                                type="checkbox"
                                checked={selectedRegions.includes(r)}
                                onChange={() => handleRegionToggle(r)}
                                className="w-4 h-4 rounded accent-primary"
                              />
                              <span className="text-foreground">{r}</span>
                            </label>
                          ))}
                          {selectedRegions.length > 0 && (
                            <div className="border-t border-border mt-1 pt-1 px-3 pb-1">
                              <button
                                onClick={() => { setSelectedRegions([]); setPage(1); }}
                                className="text-xs text-muted-foreground hover:text-foreground"
                              >
                                Clear selection
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  <button
                    onClick={handleVacancyToggle}
                    className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-medium transition-colors ${
                      hasVacancies
                        ? "bg-primary text-primary-foreground border-primary"
                        : "border-border text-foreground hover:bg-accent"
                    }`}
                  >
                    <Briefcase className="w-4 h-4" />
                    Has Vacancies
                  </button>

                  <button
                    onClick={handleBookmarkedToggle}
                    className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-medium transition-colors ${
                      bookmarkedOnly
                        ? "bg-amber-500 text-white border-amber-500"
                        : "border-border text-foreground hover:bg-accent"
                    }`}
                  >
                    {bookmarkedOnly ? <BookmarkCheck className="w-4 h-4" /> : <Bookmark className="w-4 h-4" />}
                    Bookmarked
                    {bookmarkedCount > 0 && (
                      <span className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${bookmarkedOnly ? "bg-white/20 text-white" : "bg-amber-500/10 text-amber-700"}`}>
                        {bookmarkedCount}
                      </span>
                    )}
                  </button>

                  <button
                    onClick={() => handleRefreshVisible(companies.map((c) => c.id))}
                    disabled={batchCheckMutation.isPending || companies.length === 0}
                    title="Check vacancies for the sponsor cards currently on this page (takes ~5–15 seconds)"
                    className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-medium transition-colors ${
                      batchCheckMutation.isPending
                        ? "bg-primary/10 border-primary/20 text-primary cursor-not-allowed"
                        : "bg-primary text-primary-foreground border-primary hover:bg-primary/90 disabled:opacity-50"
                    }`}
                  >
                    {batchCheckMutation.isPending ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Refreshing this page…
                      </>
                    ) : (
                      <>
                        <RefreshCw className="w-4 h-4" />
                        Refresh Visible Page ({Math.min(companies.length, LIMIT)})
                      </>
                    )}
                  </button>

                  {isAdmin && (
                    <button
                      onClick={handleCheckAllVacancies}
                      disabled={isCheckingAll}
                      title={isCheckingAll ? "A vacancy check is already running" : "Admin: scan every employer for new vacancies and rescore matches"}
                      className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-medium transition-colors ${
                        isCheckingAll
                          ? "bg-primary/10 border-primary/20 text-primary cursor-not-allowed"
                          : "border-border text-foreground hover:bg-accent"
                      }`}
                    >
                      {isCheckingAll ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Checking… {checkAllStatus ? `${checkAllStatus.processed}/${checkAllStatus.total}` : ""}
                        </>
                      ) : (
                        <>
                          <PlayCircle className="w-4 h-4" />
                          Check All Vacancies
                        </>
                      )}
                    </button>
                  )}
                </div>

                {isCheckingAll && checkAllStatus && checkAllStatus.total > 0 && (
                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                      <motion.div
                        className="h-full bg-primary rounded-full"
                        initial={{ width: 0 }}
                        animate={{ width: `${checkAllProgressPct}%` }}
                        transition={{ duration: 0.3 }}
                      />
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {checkAllStatus.regions && checkAllStatus.regions.length > 0
                        ? checkAllStatus.regions.length === 1
                          ? `Scanning ${checkAllStatus.regions[0]} · `
                          : `Scanning ${checkAllStatus.regions.length} regions · `
                        : ""}
                      {checkAllProgressPct}% · {checkAllStatus.newChecks} new · {checkAllStatus.cacheHits} cached
                      {checkAllStatus.errors > 0 ? ` · ${checkAllStatus.errors} errors` : ""}
                    </span>
                  </div>
                )}

                {/* Empty state */}
                {empty && (
                  <Card className="p-12 text-center">
                    <Search className="w-12 h-12 text-muted-foreground/40 mx-auto mb-4" />
                    <h3 className="text-lg font-semibold text-foreground mb-2">No matching sponsors</h3>
                    <p className="text-sm text-muted-foreground">Try adjusting your search or filters.</p>
                  </Card>
                )}

                {isError && (
                  <Card className="p-12 text-center">
                    <AlertCircle className="w-12 h-12 text-destructive/40 mx-auto mb-4" />
                    <h3 className="text-lg font-semibold text-foreground mb-2">Failed to load register</h3>
                    <p className="text-sm text-muted-foreground">Please try refreshing the page.</p>
                  </Card>
                )}

                {/* Company list */}
                {!empty && !isError && companies.length > 0 && (
                  <div className="space-y-2">
                    {companies.map((c, i) => {
                      const cfg = c.industry ? getSectorConfig(c.industry) : null;
                      const isBookmarked = localBookmarks.has(c.id) || (c.isBookmarked ?? false);
                      return (
                        <motion.div
                          key={c.id}
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: i * 0.02 }}
                        >
                          <Card className="px-5 py-4 hover:shadow-md transition-shadow">
                            <div className="flex items-center gap-4">
                              <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${cfg ? cfg.bg : "bg-primary/10"}`}>
                                {cfg ? (
                                  <cfg.icon className={`w-5 h-5 ${cfg.iconColor}`} />
                                ) : (
                                  <Building2 className="w-5 h-5 text-primary" />
                                )}
                              </div>

                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-semibold text-foreground truncate">{c.organisationName}</span>
                                  {(c.storedVacancyCount != null && c.storedVacancyCount > 0) ? (
                                    <button
                                      onClick={() => setExpandedVacancies((prev) => {
                                        const next = new Set(prev);
                                        if (next.has(c.id)) next.delete(c.id); else next.add(c.id);
                                        return next;
                                      })}
                                      title="View vacancies for this employer"
                                      className="inline-flex items-center gap-1 text-xs bg-green-500/10 text-green-700 px-2 py-0.5 rounded-full font-medium hover:bg-green-500/20 transition-colors cursor-pointer"
                                    >
                                      <BadgeCheck className="w-3 h-3" />
                                      {c.storedVacancyCount} {c.storedVacancyCount === 1 ? "Vacancy" : "Vacancies"}
                                      {expandedVacancies.has(c.id) ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                                    </button>
                                  ) : c.hasVacancies ? (
                                    <button
                                      onClick={() => setExpandedVacancies((prev) => {
                                        const next = new Set(prev);
                                        if (next.has(c.id)) next.delete(c.id); else next.add(c.id);
                                        return next;
                                      })}
                                      title="View vacancies for this employer"
                                      className="inline-flex items-center gap-1 text-xs bg-green-500/10 text-green-700 px-2 py-0.5 rounded-full font-medium hover:bg-green-500/20 transition-colors cursor-pointer"
                                    >
                                      <BadgeCheck className="w-3 h-3" />
                                      Vacancies
                                      {expandedVacancies.has(c.id) ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                                    </button>
                                  ) : null}
                                  {sentCompanyNames.has(c.organisationName) && (
                                    <span className="inline-flex items-center gap-1 text-xs bg-blue-500/10 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                                      <CheckCircle2 className="w-3 h-3" /> CV Sent
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-3 mt-1 flex-wrap text-xs text-muted-foreground">
                                  {(c.townCity || c.county) && (
                                    <span className="flex items-center gap-1">
                                      <MapPin className="w-3 h-3" />
                                      {[c.townCity, c.county].filter(Boolean).join(", ")}
                                      {c.region && (
                                        <span className="ml-1 text-muted-foreground/60">({c.region})</span>
                                      )}
                                    </span>
                                  )}
                                  {c.route && (
                                    <span className="bg-sky-500/10 text-sky-700 px-2 py-0.5 rounded-full">
                                      {c.route}
                                    </span>
                                  )}
                                  {c.subRoute && (
                                    <span className="bg-violet-500/10 text-violet-700 px-2 py-0.5 rounded-full">
                                      {c.subRoute}
                                    </span>
                                  )}
                                  {c.rating && (
                                    <span className="bg-amber-500/10 text-amber-700 px-2 py-0.5 rounded-full">
                                      {c.rating}
                                    </span>
                                  )}
                                  {formatCheckedAt(c.lastVacancyCheckedAt) && (
                                    <span
                                      className={`flex items-center gap-1 rounded-full px-1 transition-colors duration-500 ${timestampPulse ? "animate-pulse bg-primary/15 text-primary" : ""}`}
                                      title="Last checked for vacancies"
                                    >
                                      <Clock className="w-3 h-3" />
                                      Checked {formatCheckedAt(c.lastVacancyCheckedAt)}
                                    </span>
                                  )}
                                  {isWithinCacheTtl(c.lastVacancyCheckedAt) && (
                                    <span
                                      className="inline-flex items-center gap-1 text-[11px] font-medium bg-green-500/10 text-green-700 dark:text-green-400 px-2 py-0.5 rounded-full"
                                      title="Checked within the last 24 hours — results are served from cache"
                                    >
                                      ⚡ Up to date (Cached)
                                    </span>
                                  )}
                                </div>
                              </div>

                              <div className="flex items-center gap-2 shrink-0">
                                {/* Bookmark button */}
                                <button
                                  onClick={() => handleToggleBookmark(c.id, localBookmarks.has(c.id) || (c.isBookmarked ?? false))}
                                  title={isBookmarked ? "Remove bookmark" : "Bookmark this company"}
                                  className={`p-2 rounded-xl border transition-colors ${
                                    isBookmarked
                                      ? "bg-amber-500/10 border-amber-500/20 text-amber-600 hover:bg-amber-500/20"
                                      : "border-border text-muted-foreground hover:text-foreground hover:bg-accent"
                                  }`}
                                >
                                  {isBookmarked ? (
                                    <BookmarkCheck className="w-4 h-4" />
                                  ) : (
                                    <Bookmark className="w-4 h-4" />
                                  )}
                                </button>

                                {/* Check Best Fit CTA — live score overrides cached matchScore once panel scores on-demand */}
                                {(() => {
                                  const liveScore = liveMatchScores.has(c.id) ? liveMatchScores.get(c.id) : undefined;
                                  const displayScore = liveScore !== undefined ? liveScore : (c.matchScore ?? null);
                                  return (
                                    <button
                                      onClick={() => setExpandedVacancies((prev) => {
                                        const next = new Set(prev);
                                        if (next.has(c.id)) next.delete(c.id); else next.add(c.id);
                                        return next;
                                      })}
                                      title="View matched vacancies for this employer"
                                      className={`inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors font-semibold ${
                                        expandedVacancies.has(c.id)
                                          ? "bg-primary/15 border-primary/30 text-primary hover:bg-primary/20"
                                          : "bg-primary text-primary-foreground border-primary hover:bg-primary/90"
                                      }`}
                                    >
                                      <Gauge className="w-3.5 h-3.5" />
                                      ⚡ Check Best Fit{displayScore != null ? ` · ${Math.round(displayScore)}%` : ""}
                                      {expandedVacancies.has(c.id) ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                                    </button>
                                  );
                                })()}

                              {/* Contact toggle */}
                              <button
                                onClick={() => setExpandedContact((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(c.id)) next.delete(c.id); else next.add(c.id);
                                  return next;
                                })}
                                className={`inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors font-medium ${
                                  expandedContact.has(c.id)
                                    ? "bg-primary/10 border-primary/20 text-primary"
                                    : "border-border text-muted-foreground hover:text-foreground hover:bg-accent"
                                }`}
                                title="Find contact details for this company"
                              >
                                <Phone className="w-3.5 h-3.5" />
                                Contact
                                {expandedContact.has(c.id) ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                              </button>

                              <Button
                                size="sm"
                                variant={sentCompanyNames.has(c.organisationName) ? "outline" : "default"}
                                className="text-xs gap-1.5"
                                onClick={() => handleOpenSpeculativeModal(c.organisationName, c.id)}
                              >
                                {sentCompanyNames.has(c.organisationName) ? (
                                  <><CheckCircle2 className="w-3.5 h-3.5" /> CV Sent</>
                                ) : (
                                  <><Send className="w-3.5 h-3.5" /> Send my CV</>
                                )}
                              </Button>
                            </div>
                          </div>

                          {/* ── Contact panel ── */}
                          <AnimatePresence>
                            {expandedContact.has(c.id) && (() => {
                              const enriched = enrichedContacts.get(c.id);
                              const website = enriched?.website ?? c.website;
                              const contactEmail = enriched?.contactEmail ?? c.contactEmail;
                              const contactPhone = enriched?.contactPhone ?? c.contactPhone;
                              const address = enriched?.address ?? c.address;
                              const hasStoredContact = !!(website || contactEmail || contactPhone || address);
                              const isEnriching = enrichingIds.has(c.id);
                              return (
                                <motion.div
                                  initial={{ opacity: 0, height: 0 }}
                                  animate={{ opacity: 1, height: "auto" }}
                                  exit={{ opacity: 0, height: 0 }}
                                  transition={{ duration: 0.2 }}
                                  className="overflow-hidden"
                                >
                                  <div className="mt-3 ml-14 p-4 rounded-xl bg-muted/40 border border-border space-y-3">
                                    <div className="flex items-center justify-between">
                                      <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                                        <Phone className="w-3.5 h-3.5 text-primary" />
                                        Contact {c.organisationName}
                                      </p>
                                      {!hasStoredContact && (
                                        <button
                                          onClick={() => handleEnrichContact(c.id)}
                                          disabled={isEnriching}
                                          className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors font-medium disabled:opacity-60"
                                        >
                                          {isEnriching ? (
                                            <><Loader2 className="w-3 h-3 animate-spin" /> Finding…</>
                                          ) : (
                                            <><Sparkles className="w-3 h-3" /> Find Contact Details</>
                                          )}
                                        </button>
                                      )}
                                    </div>

                                    {hasStoredContact ? (
                                      <div className="space-y-2">
                                        {website && (
                                          <a
                                            href={website}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="flex items-center gap-2 text-xs text-primary hover:underline"
                                          >
                                            <Globe className="w-3.5 h-3.5 shrink-0" />
                                            {website}
                                            <ExternalLink className="w-3 h-3 opacity-50" />
                                          </a>
                                        )}
                                        {contactEmail && (
                                          <a
                                            href={`mailto:${contactEmail}`}
                                            className="flex items-center gap-2 text-xs text-foreground hover:text-primary"
                                          >
                                            <Mail className="w-3.5 h-3.5 text-primary shrink-0" />
                                            {contactEmail}
                                          </a>
                                        )}
                                        {contactPhone && (
                                          <a
                                            href={`tel:${contactPhone}`}
                                            className="flex items-center gap-2 text-xs text-foreground hover:text-primary"
                                          >
                                            <Phone className="w-3.5 h-3.5 text-primary shrink-0" />
                                            {contactPhone}
                                          </a>
                                        )}
                                        {address && (
                                          <p className="flex items-start gap-2 text-xs text-muted-foreground">
                                            <MapPin className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
                                            {address}
                                          </p>
                                        )}
                                        <div className="pt-1">
                                          <button
                                            onClick={() => handleEnrichContact(c.id)}
                                            disabled={isEnriching}
                                            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                                          >
                                            {isEnriching ? (
                                              <><Loader2 className="w-3 h-3 animate-spin" /> Refreshing…</>
                                            ) : (
                                              <><RefreshCw className="w-3 h-3" /> Refresh contact details</>
                                            )}
                                          </button>
                                        </div>
                                      </div>
                                    ) : (
                                      <p className="text-xs text-muted-foreground leading-relaxed">
                                        Contact details are not in the official register. Click <strong>Find Contact Details</strong> to search automatically, or use the links below:
                                      </p>
                                    )}

                                    <div className="flex flex-wrap gap-2 pt-1 border-t border-border/60">
                                      <a
                                        href={`https://www.google.com/search?q=${encodeURIComponent(c.organisationName + " " + (c.townCity ?? "") + " contact email phone")}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-background border border-border text-foreground hover:bg-accent transition-colors font-medium"
                                      >
                                        <Globe className="w-3.5 h-3.5 text-primary" />
                                        Search online
                                        <ExternalLink className="w-3 h-3 opacity-50" />
                                      </a>
                                      <a
                                        href={`https://find-and-update.company-information.service.gov.uk/search?q=${encodeURIComponent(c.organisationName)}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-background border border-border text-foreground hover:bg-accent transition-colors font-medium"
                                      >
                                        <Building2 className="w-3.5 h-3.5 text-primary" />
                                        Companies House
                                        <ExternalLink className="w-3 h-3 opacity-50" />
                                      </a>
                                    </div>
                                  </div>
                                </motion.div>
                              );
                            })()}
                          </AnimatePresence>

                          {/* ── Vacancy match panel ── */}
                          {expandedVacancies.has(c.id) && (
                            <VacancyMatchPanel
                              companyId={c.id}
                              companyName={c.organisationName}
                              storedVacancyCount={c.storedVacancyCount ?? null}
                              careersUrl={enrichedContacts.get(c.id)?.website ?? c.website ?? null}
                              hasCvUploaded={hasCvUploaded}
                              isSent={sentCompanyNames.has(c.organisationName)}
                              sendCVPending={false}
                              onSendCV={() => handleOpenSpeculativeModal(c.organisationName, c.id)}
                              onSelectVacancy={setSelectedVacancy}
                              onApply={handleOpenApplyModal}
                              onWebsiteApply={() =>
                                handleWebsiteApply(
                                  c.organisationName,
                                  c.id,
                                  enrichedContacts.get(c.id)?.website ?? c.website ?? null,
                                )
                              }
                              onScoresReady={(score) =>
                                setLiveMatchScores((prev) => {
                                  const next = new Map(prev);
                                  next.set(c.id, score);
                                  return next;
                                })
                              }
                              requireExtension={requireExtension}
                            />
                          )}
                        </Card>
                        </motion.div>
                      );
                    })}
                  </div>
                )}

                {/* Loading skeleton */}
                {isLoading && (
                  <div className="space-y-2">
                    {Array.from({ length: 8 }).map((_, i) => (
                      <Card key={i} className="px-5 py-4 flex items-center gap-4 animate-pulse">
                        <div className="w-10 h-10 rounded-xl bg-muted shrink-0" />
                        <div className="flex-1 space-y-2">
                          <div className="h-4 bg-muted rounded w-1/3" />
                          <div className="h-3 bg-muted rounded w-1/4" />
                        </div>
                      </Card>
                    ))}
                  </div>
                )}

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between pt-2">
                    <span className="text-sm text-muted-foreground">
                      Page {page} of {totalPages} · {total.toLocaleString()} results
                    </span>
                    <div className="flex gap-2">
                      <button
                        disabled={page <= 1}
                        onClick={() => setPage((p) => p - 1)}
                        className="flex items-center gap-1 px-3 py-2 rounded-xl border border-border text-sm disabled:opacity-40 hover:bg-accent transition-colors"
                      >
                        <ChevronLeft className="w-4 h-4" /> Prev
                      </button>
                      <button
                        disabled={page >= totalPages}
                        onClick={() => setPage((p) => p + 1)}
                        className="flex items-center gap-1 px-3 py-2 rounded-xl border border-border text-sm disabled:opacity-40 hover:bg-accent transition-colors"
                      >
                        Next <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </PageTransition>

      {/* ── Vacancy Detail Sheet ── */}
      <AnimatePresence>
        {selectedVacancy && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
              onClick={() => setSelectedVacancy(null)}
            />
            <motion.div
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 40 }}
              transition={{ type: "spring", damping: 28, stiffness: 300 }}
              className="fixed bottom-0 left-0 right-0 z-50 bg-background rounded-t-2xl shadow-2xl border border-border p-6 max-w-xl mx-auto"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-green-500/10 flex items-center justify-center shrink-0">
                    <Briefcase className="w-5 h-5 text-green-600" />
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-foreground">{selectedVacancy.title}</h2>
                    <p className="text-sm text-muted-foreground">{selectedVacancy.companyName}</p>
                  </div>
                </div>
                <button
                  onClick={() => setSelectedVacancy(null)}
                  className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex flex-wrap gap-3 mb-4">
                {selectedVacancy.location && (
                  <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <MapPin className="w-4 h-4 shrink-0 text-primary/60" />
                    {selectedVacancy.location}
                  </div>
                )}
                {selectedVacancy.salary && (
                  <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <DollarSign className="w-4 h-4 shrink-0 text-primary/60" />
                    {selectedVacancy.salary}
                  </div>
                )}
                {selectedVacancy.postedDate && (
                  <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <CalendarDays className="w-4 h-4 shrink-0 text-primary/60" />
                    {selectedVacancy.postedDate}
                  </div>
                )}
              </div>

              {selectedVacancy.description && (
                <p className="text-sm text-foreground/80 leading-relaxed mb-4">
                  {selectedVacancy.description}
                </p>
              )}

              <p className="text-xs text-muted-foreground mb-5 bg-muted/40 rounded-lg px-3 py-2 border border-border leading-relaxed">
                This vacancy lead was discovered via web scraping. Sending your CV creates a speculative application record in JOBSAGE so you can track your outreach.
              </p>

              <div className="flex items-center gap-3 flex-wrap">
                {selectedVacancy.url && (
                  <button
                    type="button"
                    onClick={() =>
                      requireExtension(() => {
                        void openTrackedSponsorVacancy({
                          vacancyId: selectedVacancy.id,
                          url: selectedVacancy.url!,
                          toast,
                          onTracked: () => {
                            void queryClient.invalidateQueries({ queryKey: getListMyApplicationsQueryKey() });
                          },
                        });
                      })
                    }
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border text-sm font-medium text-foreground hover:bg-accent transition-colors"
                  >
                    <ExternalLink className="w-4 h-4" />
                    View original posting
                  </button>
                )}
                <Button
                  className="gap-2"
                  onClick={() => handleOpenApplyModal(selectedVacancy)}
                >
                  <Sparkles className="w-4 h-4" />
                  Apply with JOBSAGE
                </Button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {applyModalVacancy && (
          <SponsorVacancyApplyModal
            vacancyId={applyModalVacancy.id}
            vacancyTitle={applyModalVacancy.title}
            companyName={applyModalVacancy.companyName}
            companyId={applyModalVacancy.companyId}
            location={applyModalVacancy.location}
            salary={applyModalVacancy.salary}
            postedDate={applyModalVacancy.postedDate}
            description={applyModalVacancy.description}
            externalUrl={applyModalVacancy.url}
            onClose={() => setApplyModalVacancy(null)}
            onSuccess={() => {
              setApplyModalVacancy(null);
              void refetchSpeculative();
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {speculativeModalTarget && (
          <SponsorVacancyApplyModal
            speculative
            companyName={speculativeModalTarget.companyName}
            companyId={speculativeModalTarget.companyId}
            onClose={() => setSpeculativeModalTarget(null)}
            onSuccess={() => {
              setSpeculativeModalTarget(null);
              void refetchSpeculative();
            }}
          />
        )}
      </AnimatePresence>

      {gateModal}
    </AppLayout>
  );
}
