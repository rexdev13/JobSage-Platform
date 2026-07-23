import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, Button, PageTransition } from "@/components/ui-enhanced";
import { useListMyApplications } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { motion, AnimatePresence } from "framer-motion";
import {
  ClipboardList,
  CheckCircle2,
  Clock,
  XCircle,
  Trophy,
  MessageSquare,
  ArrowRight,
  Briefcase,
  MapPin,
  Calendar,
  Send,
  Building2,
  Globe,
  CalendarDays,
  ChevronDown,
  ExternalLink,
  FileText,
} from "lucide-react";
import { format } from "date-fns";
import { getListMyApplicationsQueryKey } from "@workspace/api-client-react";

const STATUS_CONFIG: Record<
  string,
  { label: string; icon: React.ElementType; className: string }
> = {
  applied: {
    label: "Applied",
    icon: ClipboardList,
    className: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  },
  under_review: {
    label: "Under Review",
    icon: Clock,
    className: "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300",
  },
  shortlisted: {
    label: "Shortlisted",
    icon: CheckCircle2,
    className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  },
  interview: {
    label: "Interview",
    icon: MessageSquare,
    className: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  },
  interview_invited: {
    label: "Interview Invited",
    icon: CalendarDays,
    className: "bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300",
  },
  offer: {
    label: "Offer Received",
    icon: Trophy,
    className: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  },
  rejected: {
    label: "Not Progressing",
    icon: XCircle,
    className: "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300",
  },
  no_response: {
    label: "No Response",
    icon: Clock,
    className: "bg-muted text-muted-foreground",
  },
  cv_sent: {
    label: "CV Sent",
    icon: Send,
    className: "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300",
  },
  sent: {
    label: "Sent",
    icon: Send,
    className: "bg-sky-100 text-sky-800",
  },
  acknowledged: {
    label: "Acknowledged",
    icon: CheckCircle2,
    className: "bg-emerald-100 text-emerald-800",
  },
};

const PLATFORM_STATUSES = ["applied", "shortlisted", "under_review", "interview", "interview_invited", "offer", "rejected", "no_response"] as const;
const SPECULATIVE_STATUSES = ["cv_sent", "under_review", "interview_invited", "offer", "rejected"] as const;

type ApplicationKind = "formal" | "speculative" | "website";

type DeliveryRoute = "employer_account" | "sponsor_contact_email" | "ai_enrichment" | "ops_fallback";

type EnrichedApplication = {
  id: number;
  userId: string;
  roleId: number;
  applicationType?: string | null;
  applicationUrl?: string | null;
  status: string;
  appliedAt: string;
  notes?: string | null;
  roleTitle?: string | null;
  roleLocation?: string | null;
  interviewDate?: Date | null;
  interviewNotes?: string | null;
  applicationKind?: ApplicationKind;
  companyName?: string | null;
  jobsageEmail?: string | null;
  vacancyTitle?: string | null;
  emailSent?: boolean | null;
  emailSentAt?: string | null;
  emailRecipient?: string | null;
  cvLabel?: string | null;
  deliveryRoute?: DeliveryRoute | null;
};

type CategoryTab = "all" | "platform" | "speculative" | "website";

const base = import.meta.env.BASE_URL.replace(/\/$/, "");

async function patchStatus(id: number, kind: ApplicationKind, status: string): Promise<void> {
  const url = kind === "speculative"
    ? `${base}/api/speculative-applications/${Math.abs(id)}/status`
    : `${base}/api/applications/${id}/status`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw new Error("Failed to update status");
}

function StatusDropdown({
  current,
  kind,
  applicationId,
  onUpdated,
}: {
  current: string;
  kind: ApplicationKind;
  applicationId: number;
  onUpdated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const options = kind === "speculative" ? SPECULATIVE_STATUSES : PLATFORM_STATUSES;
  const cfg = STATUS_CONFIG[current] ?? STATUS_CONFIG.applied!;
  const Icon = cfg.icon;

  async function handleSelect(newStatus: string) {
    if (newStatus === current) { setOpen(false); return; }
    setSaving(true);
    setOpen(false);
    try {
      await patchStatus(applicationId, kind, newStatus);
      onUpdated();
    } catch {
      toast({ title: "Error", description: "Could not update status.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={saving}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold shrink-0 transition-all ${cfg.className} ${saving ? "opacity-60 cursor-not-allowed" : "hover:opacity-80 cursor-pointer"}`}
      >
        {saving ? (
          <span className="w-3 h-3 border-2 border-current/30 border-t-current rounded-full animate-spin" />
        ) : (
          <Icon className="w-3 h-3" />
        )}
        {cfg.label}
        <ChevronDown className="w-2.5 h-2.5 opacity-60" />
      </button>

      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: -4, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.97 }}
              transition={{ duration: 0.12 }}
              className="absolute right-0 top-full mt-1 z-20 bg-background border border-border rounded-xl shadow-lg overflow-hidden min-w-[170px]"
            >
              {options.map((s) => {
                const c = STATUS_CONFIG[s] ?? STATUS_CONFIG.applied!;
                const SI = c.icon;
                return (
                  <button
                    key={s}
                    onClick={() => void handleSelect(s)}
                    className={`w-full flex items-center gap-2 px-3 py-2.5 text-xs font-medium text-left transition-colors hover:bg-muted ${s === current ? "opacity-50 pointer-events-none" : ""}`}
                  >
                    <SI className="w-3 h-3 shrink-0" />
                    {c.label}
                  </button>
                );
              })}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

function ApplicationCard({ application, onStatusUpdated }: { application: EnrichedApplication; onStatusUpdated: () => void }) {
  const kind = application.applicationKind ?? "formal";
  const isSpeculative = kind === "speculative";
  const isWebsite = kind === "website";

  const kindBadge = isSpeculative
    ? { label: "Speculative CV", icon: Send, className: "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-900/20 dark:text-sky-400" }
    : isWebsite
    ? { label: "Company Website", icon: Globe, className: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400" }
    : { label: "Applied via JOBSAGE", icon: Building2, className: "bg-primary/5 text-primary border-primary/20" };

  const KindIcon = kindBadge.icon;
  const isInterviewInvited = application.status === "interview_invited" || application.status === "interview";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full"
    >
      <Card className={`p-5 flex flex-col gap-3 hover:shadow-md transition-all ${isInterviewInvited ? "border-teal-200 dark:border-teal-800/50" : ""}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-foreground truncate">
                {isSpeculative
                  ? application.companyName ?? application.roleTitle ?? "Speculative Application"
                  : isWebsite
                  ? application.companyName ?? "Website Application"
                  : application.roleTitle ?? `Role #${application.roleId}`}
              </h3>
              {isInterviewInvited && (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-teal-700 dark:text-teal-400">
                  <CalendarDays className="w-3 h-3" />
                </span>
              )}
            </div>
            <div className="flex items-center flex-wrap gap-3 mt-1 text-xs text-muted-foreground">
              {application.roleLocation && !isSpeculative && !isWebsite && (
                <span className="flex items-center gap-1">
                  <MapPin className="w-3 h-3" />
                  {application.roleLocation}
                </span>
              )}
              <span className="flex items-center gap-1">
                <Calendar className="w-3 h-3" />
                {isSpeculative ? "Sent" : "Applied"} {format(new Date(application.appliedAt), "MMM d, yyyy")}
              </span>
              <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold border ${kindBadge.className}`}>
                <KindIcon className="w-2.5 h-2.5" />
                {kindBadge.label}
              </span>
            </div>
          </div>
          <StatusDropdown
            current={application.status}
            kind={kind}
            applicationId={application.id}
            onUpdated={onStatusUpdated}
          />
        </div>

        {isSpeculative && application.jobsageEmail && (
          <div className="flex items-center gap-1.5 text-xs text-teal-700 dark:text-teal-400 bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-800 rounded-lg px-3 py-2">
            <Send className="w-3 h-3 shrink-0" />
            <span>Sent via <span className="font-mono font-medium">{application.jobsageEmail}</span></span>
          </div>
        )}

        {isSpeculative && (() => {
          const route = application.deliveryRoute;
          // Only show delivery route when the email was confirmed as sent — avoids
          // showing misleading "Delivered directly" on failed sends
          if (!route || !application.emailSent) return null;
          const routeConfig: Record<DeliveryRoute, { label: string; description: string; className: string }> = {
            employer_account: {
              label: "Delivered directly",
              description: "Sent to the employer's registered JOBSAGE account",
              className: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-800",
            },
            sponsor_contact_email: {
              label: "Delivered directly",
              description: "Sent to the employer's registered contact email",
              className: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-800",
            },
            ai_enrichment: {
              label: "Delivered directly",
              description: "Contact email found automatically and saved for future sends",
              className: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-800",
            },
            ops_fallback: {
              label: "Via JOBSAGE team",
              description: "No direct email found — the JOBSAGE team will follow up on your behalf",
              className: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800",
            },
          };
          const cfg = routeConfig[route];
          return (
            <div className={`flex items-start gap-1.5 text-xs border rounded-lg px-3 py-2 ${cfg.className}`}>
              <CheckCircle2 className="w-3 h-3 shrink-0 mt-0.5" />
              <span><span className="font-semibold">{cfg.label}:</span> {cfg.description}</span>
            </div>
          );
        })()}

        {application.cvLabel && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/40 border border-border rounded-lg px-3 py-2">
            <FileText className="w-3 h-3 shrink-0 text-primary" />
            <span>{isSpeculative ? "CV sent" : "CV used"}: <span className="font-medium text-foreground">{application.cvLabel}</span></span>
          </div>
        )}

        {isWebsite && application.applicationUrl && (
          <a
            href={application.applicationUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-blue-700 dark:text-blue-400 hover:underline"
          >
            <ExternalLink className="w-3 h-3" />
            View application
          </a>
        )}

        {!isSpeculative && application.notes && (
          <div className="bg-muted/50 rounded-lg p-3 text-xs text-muted-foreground leading-relaxed line-clamp-2">
            {(() => {
              try {
                const parsed = JSON.parse(application.notes!);
                if (parsed.summary) return parsed.summary;
              } catch {}
              return application.notes;
            })()}
          </div>
        )}

        {!isSpeculative && !isWebsite && application.roleId > 1_000_000 && (
          <div className="flex">
            <Button
              size="sm"
              variant="ghost"
              className="text-xs h-7 text-primary"
              onClick={() => {
                const jobId = application.roleId - 1_000_000;
                window.open(`/opportunities?job=${jobId}`, "_self");
              }}
            >
              View Role <ArrowRight className="w-3 h-3 ml-1" />
            </Button>
          </div>
        )}
      </Card>
    </motion.div>
  );
}

export default function ApplicationsPage() {
  const { data, isLoading, refetch } = useListMyApplications();
  const [, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState<CategoryTab>("all");

  const applications = (data?.applications ?? []) as EnrichedApplication[];
  const stats = data?.stats as {
    total?: number;
    interviews?: number;
    offers?: number;
    noResponse?: number;
    cvSent?: number;
    platformCount?: number;
    websiteCount?: number;
    speculativeCount?: number;
  } | undefined;

  const filtered = activeTab === "all"
    ? applications
    : activeTab === "platform"
    ? applications.filter((a) => a.applicationKind === "formal")
    : activeTab === "speculative"
    ? applications.filter((a) => a.applicationKind === "speculative")
    : applications.filter((a) => a.applicationKind === "website");

  const tabs: { id: CategoryTab; label: string; icon: React.ElementType; count: number }[] = [
    { id: "all", label: "All", icon: ClipboardList, count: applications.length },
    { id: "platform", label: "Via JOBSAGE", icon: Building2, count: stats?.platformCount ?? applications.filter((a) => a.applicationKind === "formal").length },
    { id: "speculative", label: "Speculative CV", icon: Send, count: stats?.speculativeCount ?? applications.filter((a) => a.applicationKind === "speculative").length },
    { id: "website", label: "Company Website", icon: Globe, count: stats?.websiteCount ?? applications.filter((a) => a.applicationKind === "website").length },
  ];

  return (
    <AppLayout>
      <PageTransition className="max-w-4xl mx-auto p-6 space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-display font-bold text-foreground flex items-center gap-2">
              <ClipboardList className="w-6 h-6 text-primary" />
              Application Tracker
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Track all your job applications, speculative CVs, and direct website submissions.
            </p>
          </div>
          <Button onClick={() => setLocation("/opportunities")}>
            <Briefcase className="w-4 h-4 mr-1.5" /> Browse Jobs
          </Button>
        </div>

        {stats && applications.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: "Total", value: stats.total ?? applications.length, color: "text-foreground" },
              { label: "Interviews", value: stats.interviews ?? 0, color: "text-teal-600" },
              { label: "Offers", value: stats.offers ?? 0, color: "text-amber-600" },
              { label: "CV Sends", value: stats.speculativeCount ?? 0, color: "text-sky-600" },
            ].map(({ label, value, color }) => (
              <Card key={label} className="p-4 text-center">
                <p className={`text-2xl font-bold ${color}`}>{value}</p>
                <p className="text-xs text-muted-foreground mt-1">{label}</p>
              </Card>
            ))}
          </div>
        )}

        {/* Category tabs */}
        <div className="flex gap-1 p-1 bg-muted rounded-xl overflow-x-auto">
          {tabs.map(({ id, label, icon: Icon, count }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
                activeTab === id
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
              {count > 0 && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${activeTab === id ? "bg-primary/10 text-primary" : "bg-muted-foreground/10 text-muted-foreground"}`}>
                  {count}
                </span>
              )}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="w-10 h-10 rounded-full border-4 border-primary/20 border-t-primary animate-spin mb-4" />
            <p className="text-muted-foreground text-sm">Loading applications…</p>
          </div>
        ) : filtered.length === 0 ? (
          <Card className="p-12 text-center border-dashed border-2">
            <div className="w-16 h-16 bg-muted rounded-2xl flex items-center justify-center mx-auto mb-4">
              {activeTab === "website" ? (
                <Globe className="w-8 h-8 text-muted-foreground" />
              ) : activeTab === "speculative" ? (
                <Send className="w-8 h-8 text-muted-foreground" />
              ) : (
                <ClipboardList className="w-8 h-8 text-muted-foreground" />
              )}
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">
              {activeTab === "all" ? "No applications yet" : "No applications in this category"}
            </h3>
            <p className="text-muted-foreground mb-6 max-w-sm mx-auto text-sm">
              {activeTab === "website"
                ? "Use the 'Mark as applied on website' button on any sponsor company or job opportunity to log an external application."
                : activeTab === "speculative"
                ? "Send your CV speculatively to a sponsor licence company to create a record here."
                : "Use Smart Apply on any role or send your CV directly to sponsor licence companies."}
            </p>
            <Button variant="outline" onClick={() => setLocation(activeTab === "speculative" || activeTab === "website" ? "/sponsor-licences" : "/opportunities")}>
              {activeTab === "speculative" || activeTab === "website" ? "Browse Sponsors" : "Browse Jobs"}
            </Button>
          </Card>
        ) : (
          <div className="flex flex-col gap-4">
            {filtered.map((app) => (
              <ApplicationCard
                key={`${app.applicationKind ?? "formal"}-${app.id}`}
                application={app}
                onStatusUpdated={() => void refetch()}
              />
            ))}
          </div>
        )}
      </PageTransition>
    </AppLayout>
  );
}
