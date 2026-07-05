import { useState, useEffect } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, PageTransition, Button } from "@/components/ui-enhanced";
import { SponsorVacancyApplyModal } from "@/components/SponsorVacancyApplyModal";
import {
  useGetSponsorLicenceRoutes,
  useGetSponsorLicenceIndustryCounts,
  useGetSponsorLicenceIndustries,
  useListSponsorLicences,
  useSendSpeculativeApplication,
  useListSpeculativeApplications,
  useCheckSponsorLicenceVacancies,
  useGetSponsorLicenceRegions,
  useBookmarkSponsorLicence,
  useUnbookmarkSponsorLicence,
  useListMyDocuments,
  getListSponsorLicencesQueryKey,
  getGetSponsorLicenceIndustryCountsQueryKey,
  type VacancyCheckResult,
  type VacancyListing,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
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
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const LIMIT = 20;

function formatSyncDate(dt: string | null | undefined): string {
  if (!dt) return "Never";
  return new Date(dt).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
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
  const sendCVMutation = useSendSpeculativeApplication();
  const { data: speculativeData, refetch: refetchSpeculative } = useListSpeculativeApplications();
  const { data: documentsData } = useListMyDocuments();
  const hasCvUploaded = (documentsData?.documents ?? []).some((d) => d.documentType === "cv");
  const sentCompanyNames = new Set((speculativeData?.applications ?? []).map((a) => a.companyName));

  const [vacancyResults, setVacancyResults] = useState<Map<number, VacancyCheckResult>>(new Map());
  const [checkingIds, setCheckingIds] = useState<Set<number>>(new Set());
  const [expandedVacancies, setExpandedVacancies] = useState<Set<number>>(new Set());
  const [expandedContact, setExpandedContact] = useState<Set<number>>(new Set());

  type SelectedVacancy = VacancyListing & { companyName: string; companyId: number };
  const [selectedVacancy, setSelectedVacancy] = useState<SelectedVacancy | null>(null);
  const [applyModalVacancy, setApplyModalVacancy] = useState<SelectedVacancy | null>(null);

  function handleOpenApplyModal(vacancy: SelectedVacancy) {
    if (!hasCvUploaded) {
      toast({
        title: "No CV uploaded",
        description: "Please upload your CV in 'CV & Supporting Documents' before applying.",
        variant: "destructive",
      });
      return;
    }
    setSelectedVacancy(null);
    setApplyModalVacancy(vacancy);
  }
  const checkVacanciesMutation = useCheckSponsorLicenceVacancies();
  const bookmarkMutation = useBookmarkSponsorLicence();
  const unbookmarkMutation = useUnbookmarkSponsorLicence();

  function handleCheckVacancies(companyId: number) {
    if (checkingIds.has(companyId)) return;
    setCheckingIds((prev) => new Set(prev).add(companyId));
    checkVacanciesMutation.mutate(
      { id: companyId },
      {
        onSuccess: (result) => {
          setVacancyResults((prev) => new Map(prev).set(companyId, result));
          setCheckingIds((prev) => {
            const next = new Set(prev);
            next.delete(companyId);
            return next;
          });
          if (result.vacanciesFound) {
            setExpandedVacancies((prev) => new Set(prev).add(companyId));
          }
        },
        onError: () => {
          setCheckingIds((prev) => {
            const next = new Set(prev);
            next.delete(companyId);
            return next;
          });
          toast({ title: "Check failed", description: "Could not check vacancies right now. Please try again.", variant: "destructive" });
        },
      },
    );
  }

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

  function handleSendCV(companyName: string, companyId: number) {
    if (!hasCvUploaded) {
      toast({
        title: "No CV uploaded",
        description: "Please upload your CV in 'CV & Supporting Documents' before sending a speculative application.",
        variant: "destructive",
      });
      return;
    }
    sendCVMutation.mutate(
      { data: { companyName, sponsorLicenceId: companyId } },
      {
        onSuccess: (res) => {
          void refetchSpeculative();
          if (res.alreadySent) {
            toast({ title: "Already sent", description: `You already sent your CV to ${companyName}.` });
          } else {
            toast({ title: "CV sent!", description: `Your speculative application to ${companyName} has been recorded.` });
          }
        },
        onError: () => {
          toast({ title: "Error", description: "Could not send CV. Please try again.", variant: "destructive" });
        },
      },
    );
  }

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [search]);

  const { data: routesData } = useGetSponsorLicenceRoutes();
  const routes = routesData?.routes ?? [];

  const { data: industriesData } = useGetSponsorLicenceIndustries();
  const industries = industriesData?.industries ?? [];

  const { data: regionsData } = useGetSponsorLicenceRegions();
  const regions = regionsData?.regions ?? [];

  const { data: countsData, isLoading: countsLoading } = useGetSponsorLicenceIndustryCounts();
  const sectorCounts = countsData?.counts ?? [];
  const totalSponsors = sectorCounts.reduce((acc, s) => acc + s.count, 0);

  const { data, isLoading, isError } = useListSponsorLicences({
    search: debouncedSearch || undefined,
    route: selectedRoute || undefined,
    industry: selectedIndustry || undefined,
    region: selectedRegions.length > 0 ? selectedRegions : undefined,
    hasVacancies: hasVacancies || undefined,
    bookmarkedOnly: bookmarkedOnly || undefined,
    page,
    limit: LIMIT,
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
                </div>

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
                                  {c.hasVacancies && (
                                    <span className="inline-flex items-center gap-1 text-xs bg-green-500/10 text-green-700 px-2 py-0.5 rounded-full font-medium">
                                      <BadgeCheck className="w-3 h-3" />
                                      Vacancies
                                    </span>
                                  )}
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

                                {/* Vacancy check button / status */}
                              {(() => {
                                  const result = vacancyResults.get(c.id);
                                  const checking = checkingIds.has(c.id);
                                  if (checking) {
                                    return (
                                      <span className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border text-muted-foreground">
                                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                        Checking…
                                      </span>
                                    );
                                  }
                                  if (!result) {
                                    return (
                                      <button
                                        onClick={() => handleCheckVacancies(c.id)}
                                        className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors font-medium"
                                      >
                                        <Sparkles className="w-3.5 h-3.5" />
                                        Check vacancies
                                      </button>
                                    );
                                  }
                                  return null;
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
                                onClick={() => handleSendCV(c.organisationName, c.id)}
                                disabled={sendCVMutation.isPending}
                              >
                                {sendCVMutation.isPending ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : sentCompanyNames.has(c.organisationName) ? (
                                  <><CheckCircle2 className="w-3.5 h-3.5" /> CV Sent</>
                                ) : (
                                  <><Send className="w-3.5 h-3.5" /> Send my CV</>
                                )}
                              </Button>
                            </div>
                          </div>

                          {/* ── Contact panel ── */}
                          <AnimatePresence>
                            {expandedContact.has(c.id) && (
                              <motion.div
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: "auto" }}
                                exit={{ opacity: 0, height: 0 }}
                                transition={{ duration: 0.2 }}
                                className="overflow-hidden"
                              >
                                <div className="mt-3 ml-14 p-4 rounded-xl bg-muted/40 border border-border">
                                  <p className="text-xs font-semibold text-foreground mb-3 flex items-center gap-1.5">
                                    <Phone className="w-3.5 h-3.5 text-primary" />
                                    Contact {c.organisationName}
                                  </p>
                                  <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
                                    Contact details are not published in the official Home Office register. Use the links below to find their website, phone, and email:
                                  </p>
                                  <div className="flex flex-wrap gap-2">
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
                                    <a
                                      href={`mailto:?subject=Application enquiry — ${encodeURIComponent(c.organisationName)}&body=Hello%2C%0A%0AI am writing to enquire about employment opportunities at ${encodeURIComponent(c.organisationName)}.`}
                                      className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-background border border-border text-foreground hover:bg-accent transition-colors font-medium"
                                    >
                                      <Mail className="w-3.5 h-3.5 text-primary" />
                                      Draft email
                                    </a>
                                  </div>
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>

                          {/* ── Vacancy results panel ── */}
                          {(() => {
                            const result = vacancyResults.get(c.id);
                            if (!result) return null;
                            const isExpanded = expandedVacancies.has(c.id);
                            const listings = result.vacancyList ?? [];
                            return (
                              <motion.div
                                initial={{ opacity: 0, y: -4 }}
                                animate={{ opacity: 1, y: 0 }}
                                className="mt-3 ml-14"
                              >
                                {result.vacanciesFound ? (
                                  <div className="rounded-xl border border-green-200 bg-green-50/60 dark:bg-green-950/20 dark:border-green-800/40 overflow-hidden">
                                    {/* Header row */}
                                    <button
                                      className="w-full flex items-center justify-between px-4 py-3 hover:bg-green-100/50 dark:hover:bg-green-900/20 transition-colors"
                                      onClick={() => setExpandedVacancies((prev) => {
                                        const next = new Set(prev);
                                        if (next.has(c.id)) next.delete(c.id); else next.add(c.id);
                                        return next;
                                      })}
                                    >
                                      <div className="flex items-center gap-2">
                                        <BadgeCheck className="w-4 h-4 text-green-600 shrink-0" />
                                        <span className="text-sm font-semibold text-green-800 dark:text-green-300">
                                          {result.vacancyCount != null
                                            ? `${result.vacancyCount} ${result.vacancyCount === 1 ? "vacancy" : "vacancies"} found`
                                            : "Vacancies found"}
                                        </span>
                                        {result.summary && (
                                          <span className="text-xs text-green-700/70 dark:text-green-400/70 hidden sm:block">
                                            · {result.summary}
                                          </span>
                                        )}
                                      </div>
                                      <div className="flex items-center gap-2 shrink-0">
                                        <a
                                          href={result.sourceUrl ?? `https://www.reed.co.uk/jobs?keywords=${encodeURIComponent(c.organisationName)}&locationName=United+Kingdom`}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          onClick={(e) => e.stopPropagation()}
                                          className="inline-flex items-center gap-1 text-xs px-3 py-1 rounded-lg bg-green-600 text-white hover:bg-green-700 transition-colors font-medium"
                                        >
                                          Browse vacancies
                                          <ExternalLink className="w-3 h-3" />
                                        </a>
                                        {isExpanded ? <ChevronUp className="w-4 h-4 text-green-600" /> : <ChevronDown className="w-4 h-4 text-green-600" />}
                                      </div>
                                    </button>

                                    {/* Expandable detail */}
                                    <AnimatePresence>
                                      {isExpanded && (
                                        <motion.div
                                          initial={{ opacity: 0, height: 0 }}
                                          animate={{ opacity: 1, height: "auto" }}
                                          exit={{ opacity: 0, height: 0 }}
                                          transition={{ duration: 0.2 }}
                                          className="overflow-hidden border-t border-green-200 dark:border-green-800/40"
                                        >
                                          <div className="px-4 py-3 space-y-2">
                                            {/* Structured vacancy list */}
                                            {listings.length > 0 ? (
                                              <div className="space-y-1.5">
                                                {listings.map((v, vi) => (
                                                  <div
                                                    key={vi}
                                                    className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg bg-white dark:bg-green-950/40 border border-green-100 dark:border-green-800/30 group hover:border-green-300 dark:hover:border-green-700/60 transition-colors cursor-pointer"
                                                    onClick={() => setSelectedVacancy({ ...v, companyName: c.organisationName, companyId: c.id })}
                                                  >
                                                    <div className="flex-1 min-w-0">
                                                      <p className="text-sm font-medium text-foreground truncate">{v.title}</p>
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
                                                      </div>
                                                    </div>
                                                    <div className="flex items-center gap-1.5 shrink-0">
                                                      {v.url && (
                                                        <a
                                                          href={v.url}
                                                          target="_blank"
                                                          rel="noopener noreferrer"
                                                          onClick={(e) => e.stopPropagation()}
                                                          className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                                                          title="View on job board"
                                                        >
                                                          <ExternalLink className="w-3 h-3" />
                                                        </a>
                                                      )}
                                                      <button
                                                        onClick={(e) => { e.stopPropagation(); handleOpenApplyModal({ ...v, companyName: c.organisationName, companyId: c.id }); }}
                                                        className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 border border-primary/20 transition-colors font-medium"
                                                      >
                                                        <Sparkles className="w-3 h-3" />
                                                        Apply with JOBSAGE
                                                      </button>
                                                    </div>
                                                  </div>
                                                ))}
                                              </div>
                                            ) : (
                                              result.summary && (
                                                <p className="text-xs text-green-800/80 dark:text-green-300/80 leading-relaxed">
                                                  {result.summary}
                                                </p>
                                              )
                                            )}
                                            <div className="flex flex-wrap gap-2 pt-1">
                                              <a
                                                href={result.sourceUrl ?? `https://www.reed.co.uk/jobs?keywords=${encodeURIComponent(c.organisationName)}&locationName=United+Kingdom`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-green-600 text-white hover:bg-green-700 transition-colors font-medium"
                                              >
                                                <Briefcase className="w-3.5 h-3.5" />
                                                View all on job board
                                                <ExternalLink className="w-3 h-3" />
                                              </a>
                                              <Button
                                                size="sm"
                                                variant={sentCompanyNames.has(c.organisationName) ? "outline" : "default"}
                                                className="text-xs gap-1.5 h-7"
                                                onClick={() => handleSendCV(c.organisationName, c.id)}
                                                disabled={sendCVMutation.isPending}
                                              >
                                                {sentCompanyNames.has(c.organisationName) ? (
                                                  <><CheckCircle2 className="w-3.5 h-3.5" /> CV Sent</>
                                                ) : (
                                                  <><Send className="w-3.5 h-3.5" /> Send CV speculatively</>
                                                )}
                                              </Button>
                                            </div>
                                            <p className="text-[10px] text-green-700/60 dark:text-green-400/50">
                                              Vacancies sourced from job boards. Always verify directly on the employer's official site.
                                            </p>
                                          </div>
                                        </motion.div>
                                      )}
                                    </AnimatePresence>
                                  </div>
                                ) : (
                                  <div className="rounded-xl border border-border bg-muted/30 px-4 py-2.5 flex items-center gap-2">
                                    <span className="text-xs text-muted-foreground">No current vacancies found on job boards.</span>
                                    <button
                                      onClick={() => handleSendCV(c.organisationName, c.id)}
                                      disabled={sentCompanyNames.has(c.organisationName) || sendCVMutation.isPending}
                                      className="ml-auto text-xs text-primary font-medium hover:underline disabled:opacity-50 flex items-center gap-1"
                                    >
                                      {sentCompanyNames.has(c.organisationName) ? "CV Sent ✓" : "Send CV speculatively"}
                                    </button>
                                  </div>
                                )}
                              </motion.div>
                            );
                          })()}
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

              <div className="flex flex-wrap gap-3 mb-5">
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
              </div>

              <p className="text-xs text-muted-foreground mb-5 bg-muted/40 rounded-lg px-3 py-2 border border-border leading-relaxed">
                This vacancy was sourced from a public job board. Sending your CV creates a speculative application record in JOBSAGE so you can track it.
              </p>

              <div className="flex items-center gap-3 flex-wrap">
                {selectedVacancy.url && (
                  <a
                    href={selectedVacancy.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border text-sm font-medium text-foreground hover:bg-accent transition-colors"
                  >
                    <ExternalLink className="w-4 h-4" />
                    View original posting
                  </a>
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
            vacancyTitle={applyModalVacancy.title}
            companyName={applyModalVacancy.companyName}
            companyId={applyModalVacancy.companyId}
            location={applyModalVacancy.location}
            salary={applyModalVacancy.salary}
            externalUrl={applyModalVacancy.url}
            onClose={() => setApplyModalVacancy(null)}
            onSuccess={() => {
              setApplyModalVacancy(null);
              void refetchSpeculative();
            }}
          />
        )}
      </AnimatePresence>
    </AppLayout>
  );
}
