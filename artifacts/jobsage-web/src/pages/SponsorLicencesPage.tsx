import { useState, useEffect } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, PageTransition, Button } from "@/components/ui-enhanced";
import {
  useGetSponsorLicenceRoutes,
  useGetSponsorLicenceIndustries,
  useListSponsorLicences,
  useSendSpeculativeApplication,
  useListSpeculativeApplications,
} from "@workspace/api-client-react";
import { motion } from "framer-motion";
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
  Tag,
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

export default function SponsorLicencesPage() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedRoute, setSelectedRoute] = useState("");
  const [selectedIndustry, setSelectedIndustry] = useState("");
  const [hasVacancies, setHasVacancies] = useState(false);
  const [page, setPage] = useState(1);
  const { toast } = useToast();
  const sendCVMutation = useSendSpeculativeApplication();
  const { data: speculativeData, refetch: refetchSpeculative } = useListSpeculativeApplications();
  const sentCompanyNames = new Set((speculativeData?.applications ?? []).map((a) => a.companyName));

  function handleSendCV(companyName: string, companyId: number) {
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

  // Debounce search
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

  const { data, isLoading, isError } = useListSponsorLicences({
    search: debouncedSearch || undefined,
    route: selectedRoute || undefined,
    industry: selectedIndustry || undefined,
    hasVacancies: hasVacancies || undefined,
    page,
    limit: LIMIT,
  });

  const companies = data?.companies ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 0;
  const withVacancies = data?.withVacancies ?? 0;
  const lastSyncedAt = data?.lastSyncedAt;
  const lastSyncFailed = data?.lastSyncFailed;

  const noData = !isLoading && !isError && total === 0 && !debouncedSearch && !selectedRoute && !selectedIndustry && !hasVacancies;
  const empty = !isLoading && !isError && total === 0 && (!!debouncedSearch || !!selectedRoute || !!selectedIndustry || hasVacancies);

  function handleRouteChange(r: string) {
    setSelectedRoute(r);
    setPage(1);
  }

  function handleIndustryChange(i: string) {
    setSelectedIndustry(i);
    setPage(1);
  }

  function handleVacancyToggle() {
    setHasVacancies((v) => !v);
    setPage(1);
  }

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
                  Sponsor Licence Companies
                </h1>
                <p className="text-sm text-muted-foreground">
                  Official UK Home Office register of licensed sponsors — updated daily
                </p>
              </div>
            </div>
          </motion.div>

          {/* Sync status banner */}
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

          {/* Stats row */}
          {!noData && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 }}
              className="grid grid-cols-3 gap-4"
            >
              {[
                {
                  label: "Total Licensed Sponsors",
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
            </motion.div>
          )}

          {/* Search & filters */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="flex flex-col sm:flex-row gap-3"
          >
            <div className="relative flex-1">
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
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {industries.length > 0 && (
              <div className="relative">
                <Tag className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <select
                  value={selectedIndustry}
                  onChange={(e) => handleIndustryChange(e.target.value)}
                  className="pl-9 pr-8 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 appearance-none cursor-pointer"
                >
                  <option value="">All industries</option>
                  {industries.map((ind) => (
                    <option key={ind} value={ind}>
                      {ind}
                    </option>
                  ))}
                </select>
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
          </motion.div>

          {/* No data / empty state */}
          {noData && (
            <Card className="p-12 text-center">
              <RefreshCw className="w-12 h-12 text-muted-foreground/40 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-foreground mb-2">Register not yet loaded</h3>
              <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                The Home Office sponsor licence register is downloaded nightly at 02:00 London time.
                Data will appear here after the first sync completes.
              </p>
            </Card>
          )}

          {empty && (
            <Card className="p-12 text-center">
              <Search className="w-12 h-12 text-muted-foreground/40 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-foreground mb-2">No matching sponsors</h3>
              <p className="text-sm text-muted-foreground">
                Try adjusting your search or filters.
              </p>
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
          {!noData && companies.length > 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.15 }}
              className="space-y-2"
            >
              {companies.map((c, i) => (
                <motion.div
                  key={c.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.02 }}
                >
                  <Card className="px-5 py-4 flex items-center gap-4 hover:shadow-md transition-shadow">
                    <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                      <Building2 className="w-5 h-5 text-primary" />
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
                          </span>
                        )}
                        {c.industry && (
                          <span className="bg-emerald-500/10 text-emerald-700 px-2 py-0.5 rounded-full font-medium">
                            {c.industry}
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
                      <a
                        href={`https://www.reed.co.uk/jobs?keywords=${encodeURIComponent(c.organisationName)}&locationName=United+Kingdom`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors font-medium"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        Find vacancies
                      </a>
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
                  </Card>
                </motion.div>
              ))}
            </motion.div>
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
        </div>
      </PageTransition>
    </AppLayout>
  );
}
