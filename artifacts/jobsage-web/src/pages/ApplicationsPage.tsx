import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, Button, PageTransition } from "@/components/ui-enhanced";
import {
  useListMyApplications,
  useListVacancyFavorites,
  useUnfavoriteVacancy,
  getListVacancyFavoritesQueryKey,
  useDeleteApplication,
  type VacancyFavorite,
} from "@workspace/api-client-react";
import { MarkWebsiteApplicationModal } from "@/components/MarkWebsiteApplicationModal";
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
  Heart,
  Trash2,
  AlertTriangle,
} from "lucide-react";
import { format } from "date-fns";
import { confirmAssistedApplication, isRecentInProgress } from "@/lib/assistedApplication";
import { refreshApplicationQueries } from "@/lib/applicationQueryRefresh";
import { getListMyApplicationsQueryKey } from "@workspace/api-client-react";
import { useGetMyAnalytics } from "@workspace/api-client-react";
import { WeeklyApplicationStats } from "@/components/WeeklyApplicationStats";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  excludeClosedApplications,
  filterApplicationsByTimeframe,
  getApplicationProcessStage,
  isRejectedApplicationStatus,
  TIMEFRAME_OPTIONS,
  type TimeframeFilter,
} from "@/lib/applicationTracker";

const STATUS_CONFIG: Record<
  string,
  { label: string; icon: React.ElementType; className: string }
> = {
  in_progress: {
    label: "In Progress",
    icon: Clock,
    className: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  },
  link_clicked: {
    label: "Started",
    icon: ExternalLink,
    className: "bg-slate-100 text-slate-700 dark:bg-slate-800/60 dark:text-slate-300",
  },
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
    label: "Send CV sent",
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
const WEBSITE_STATUSES = ["link_clicked", "in_progress", ...PLATFORM_STATUSES] as const;
const SPECULATIVE_STATUSES = ["cv_sent", "under_review", "interview_invited", "offer", "rejected"] as const;

// Statuses (standard + speculative) that indicate the employer has responded.
const REPLIED_STATUSES = new Set([
  "acknowledged",
  "under_review",
  "shortlisted",
  "interview",
  "interview_invited",
  "offer",
  "rejected",
]);

const isReplied = (a: { status: string }) => REPLIED_STATUSES.has(a.status);

type ApplicationKind = "formal" | "speculative" | "website";

type DeliveryRoute = "employer_contact_email" | "employer_account" | "sponsor_contact_email" | "ops_fallback";

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
  deliveryStatus?: "pending" | "delivered" | "failed" | null;
  deliveryError?: string | null;
  boardName?: string | null;
  sourceType?: "job_board" | "company_site" | null;
  isClosed?: boolean;
  livenessReason?: string | null;
  createdAt?: string | null;
};

type CategoryTab = "all" | "platform" | "speculative" | "website" | "favorites";

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

  const baseOptions = kind === "speculative"
    ? SPECULATIVE_STATUSES
    : kind === "website"
      ? WEBSITE_STATUSES
      : PLATFORM_STATUSES;
  const options: readonly string[] = baseOptions;
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
              className="absolute right-0 top-full mt-1 z-20 max-h-64 min-w-[170px] overflow-y-auto overscroll-contain rounded-xl border border-border bg-background shadow-lg"
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

function DeleteConfirmationDialog({
  open,
  onOpenChange,
  title,
  description,
  pending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  pending: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!pending) onOpenChange(nextOpen);
      }}
    >
      <AlertDialogContent className="w-[calc(100%-2rem)] max-w-md rounded-2xl p-5 sm:p-6">
        <AlertDialogHeader className="text-left">
          <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-full bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-300">
            <Trash2 className="h-5 w-5" />
          </div>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2 sm:gap-2">
          <AlertDialogCancel disabled={pending} className="mt-0 w-full sm:w-auto">
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            onClick={(event) => {
              event.preventDefault();
              onConfirm();
            }}
            className="w-full bg-rose-600 text-white hover:bg-rose-700 focus:ring-rose-500 sm:w-auto"
          >
            {pending ? "Deleting…" : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ApplicationProcessStatusBar({ application }: { application: EnrichedApplication }) {
  const activeStage = getApplicationProcessStage(application.status);
  const rejected = isRejectedApplicationStatus(application.status);
  const dateSubmitted = application.appliedAt
    ? format(new Date(application.appliedAt), "d MMM")
    : null;

  const badge = rejected
    ? { label: "Not Progressing / Closed", detail: "", className: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-900/20 dark:text-rose-300 dark:border-rose-800" }
    : activeStage === 3
      ? { label: "Offer Received 🎉", detail: "", className: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-800" }
      : activeStage === 2
        ? { label: "Interviewing", detail: "In Progress", className: "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-900/20 dark:text-purple-300 dark:border-purple-800" }
        : activeStage === 1
          ? { label: "Applied", detail: "Awaiting Review", className: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-300 dark:border-blue-800" }
          : { label: "Started", detail: "Application in draft", className: "bg-slate-50 text-slate-700 border-slate-200 dark:bg-slate-900/20 dark:text-slate-300 dark:border-slate-700" };

  const stages = [
    { label: "Started", subtitle: activeStage === 0 ? "In draft" : "Started" },
    { label: "Applied", subtitle: dateSubmitted ? `Submitted ${dateSubmitted}` : "Submitted" },
    {
      label: "Interview",
      subtitle: application.status === "interview_invited" ? "Invited to interview" : activeStage >= 2 ? "Interview stage" : "Next stage",
    },
    { label: "Offers", subtitle: activeStage === 3 ? "Offer Received 🎉" : "Next stage" },
  ];

  return (
    <div className={`rounded-xl border px-2 py-3 sm:px-6 ${rejected ? "border-rose-200 bg-rose-50/40 dark:border-rose-900/60 dark:bg-rose-950/10" : "border-border bg-muted/20"}`}>
      <div className="flex items-center justify-between gap-2 mb-3">
        <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-bold sm:text-xs ${badge.className}`}>
          {badge.label}
          {badge.detail && <><span className="mx-1 opacity-50">•</span>{badge.detail}</>}
        </span>
        {rejected && <XCircle className="w-4 h-4 text-rose-600 shrink-0" />}
      </div>
      <div className="relative">
        <div className="absolute left-[12.5%] right-[12.5%] top-3 h-1 rounded-full bg-border" aria-hidden="true" />
        <div
          className={`absolute left-[12.5%] top-3 h-1 rounded-full ${rejected ? "bg-rose-400" : "bg-emerald-500"}`}
          style={{ width: `${activeStage * 25}%` }}
          aria-hidden="true"
        />
        <div className="relative grid grid-cols-4 gap-1">
          {stages.map((stage, index) => {
            const completed = index < activeStage;
            const active = index === activeStage;
            return (
              <div key={stage.label} className="flex min-w-0 flex-col items-center text-center">
                <div
                  className={`z-10 flex h-6 w-6 items-center justify-center rounded-full border-2 bg-background text-[10px] font-bold ${
                    completed
                      ? "border-emerald-500 bg-emerald-500 text-white"
                      : active
                        ? rejected
                          ? "border-rose-500 bg-rose-100 text-rose-700 ring-2 ring-rose-200 dark:bg-rose-900/40 dark:text-rose-300 dark:ring-rose-900"
                          : "border-primary bg-background text-primary ring-2 ring-primary/20"
                        : "border-border text-muted-foreground"
                  }`}
                >
                  {completed ? <CheckCircle2 className="h-4 w-4" /> : index + 1}
                </div>
                <span className={`mt-1.5 max-w-20 truncate text-[9px] font-semibold sm:max-w-32 sm:text-[11px] ${active ? "text-foreground" : "text-muted-foreground"}`}>
                  {stage.label}
                </span>
                <span className="max-w-20 truncate text-[9px] text-muted-foreground sm:max-w-32 sm:text-[10px]">
                  {stage.subtitle}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ApplicationCard({
  application,
  onStatusUpdated,
  selected,
  onSelectedChange,
}: {
  application: EnrichedApplication;
  onStatusUpdated: () => void;
  selected: boolean;
  onSelectedChange: (selected: boolean) => void;
}) {
  const kind = application.applicationKind ?? "formal";
  const isSpeculative = kind === "speculative";
  const isWebsite = kind === "website";
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const { mutateAsync: deleteApplication, isPending: isDeleting } = useDeleteApplication();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const kindBadge = isSpeculative
    ? { label: "Send CV", icon: Send, className: "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-900/20 dark:text-sky-400" }
    : isWebsite
    ? { label: "Apply on company websites", icon: Globe, className: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400" }
    : { label: "Apply Via Job Board", icon: Building2, className: "bg-primary/5 text-primary border-primary/20" };

  const KindIcon = kindBadge.icon;
  const isInterviewInvited = application.status === "interview_invited" || application.status === "interview";

  async function handleDelete() {
    try {
      await deleteApplication({ id: application.id });
      await queryClient.invalidateQueries({ queryKey: getListMyApplicationsQueryKey() });
      setDeleteDialogOpen(false);
      toast({ title: "Application deleted", description: "The application was removed from your tracker." });
      onStatusUpdated();
    } catch {
      toast({ title: "Error", description: "Could not delete this application. Please try again.", variant: "destructive" });
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full"
    >
      <Card className={`p-5 flex flex-col gap-3 overflow-visible hover:shadow-md transition-all ${isInterviewInvited ? "border-teal-200 dark:border-teal-800/50" : ""}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <input
                type="checkbox"
                checked={selected}
                onChange={(event) => onSelectedChange(event.target.checked)}
                aria-label={`Select ${application.roleTitle ?? application.companyName ?? "application"}`}
                className="h-4 w-4 shrink-0 cursor-pointer rounded border-border accent-primary"
              />
              <h3 className="font-semibold text-foreground truncate">
                {isSpeculative
                  ? application.roleTitle ?? application.companyName ?? "CV Send"
                  : isWebsite
                  ? application.roleTitle ?? application.companyName ?? "Website Application"
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
              {isWebsite && application.companyName && application.roleTitle && application.companyName !== application.roleTitle && (
                <span className="flex items-center gap-1">
                  <Building2 className="w-3 h-3" />
                  {application.companyName}
                </span>
              )}
              {isSpeculative && application.companyName && application.companyName !== application.roleTitle && (
                <span className="flex items-center gap-1">
                  <Building2 className="w-3 h-3" /> {application.companyName}
                </span>
              )}
              <span className="flex items-center gap-1">
                <Calendar className="w-3 h-3" />
                {isSpeculative ? "Sent" : isWebsite && (application.status === "link_clicked" || application.status === "in_progress") ? "Started" : "Applied"} {format(new Date(application.appliedAt), "MMM d, yyyy")}
              </span>
              <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold border ${kindBadge.className}`}>
                <KindIcon className="w-2.5 h-2.5" />
                {kindBadge.label}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {application.isClosed && (
              <span
                title={application.livenessReason ?? "This vacancy is no longer available."}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
              >
                <AlertTriangle className="w-3 h-3" />
                Closed / expired
              </span>
            )}
            <StatusDropdown
              current={application.status}
              kind={kind}
              applicationId={application.id}
              onUpdated={onStatusUpdated}
            />
            <button
              type="button"
              onClick={() => setDeleteDialogOpen(true)}
              disabled={isDeleting}
              aria-label="Delete application"
              title="Delete application"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-900/20 disabled:opacity-50"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        <ApplicationProcessStatusBar application={application} />

        {application.isClosed && application.livenessReason && (
          <div className="flex items-start gap-1.5 text-xs text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
            <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
            <span>{application.livenessReason}</span>
          </div>
        )}

        {isSpeculative && application.jobsageEmail && (
          <div className="flex items-center gap-1.5 text-xs text-teal-700 dark:text-teal-400 bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-800 rounded-lg px-3 py-2">
            <Send className="w-3 h-3 shrink-0" />
             <span>Send CV via <span className="font-mono font-medium">{application.jobsageEmail}</span></span>
          </div>
        )}

        {isSpeculative && (() => {
          const route = application.deliveryRoute;
          // Only show delivery route when the email was confirmed as sent — avoids
          // showing misleading "Delivered directly" on failed sends
          if (!route || !application.emailSent) return null;
          const routeConfig: Record<DeliveryRoute, { label: string; description: string; className: string }> = {
            employer_contact_email: {
              label: "Delivered directly",
              description: "Sent to the employer's stored contact email",
              className: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-800",
            },
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
            ops_fallback: {
              label: "Send CV via JOBSAGE team",
              description: "No direct email was found — the JOBSAGE team will follow up on your behalf",
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

         {isSpeculative && application.deliveryStatus === "pending" && !application.emailSent && (
           <div className="text-xs border rounded-lg px-3 py-2 bg-amber-50 text-amber-800 border-amber-200">
             <span className="font-semibold">Send CV saved — awaiting employer contact.</span>{" "}
             No email has been sent yet because no stored contact was available.
           </div>
         )}

         {isSpeculative && application.deliveryStatus === "failed" && (
          <div className="text-xs border rounded-lg px-3 py-2 bg-rose-50 text-rose-700 border-rose-200">
             <span className="font-semibold">Send CV delivery failed.</span> {application.deliveryError ?? "You can retry Send CV from Opportunities."}
          </div>
        )}

        {isSpeculative && application.applicationUrl && (
          <a href={application.applicationUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs text-blue-700 dark:text-blue-400 hover:underline">
            <ExternalLink className="w-3 h-3" /> View vacancy{application.boardName ? ` on ${application.boardName}` : ""}
          </a>
        )}

        {application.cvLabel && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/40 border border-border rounded-lg px-3 py-2">
            <FileText className="w-3 h-3 shrink-0 text-primary" />
             <span>{isSpeculative ? "CV used for Send CV" : "CV used"}: <span className="font-medium text-foreground">{application.cvLabel}</span></span>
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
      <DeleteConfirmationDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="Delete this application?"
        description={`This will permanently remove ${application.roleTitle ?? application.companyName ?? "this application"} from your Application Tracker. This action cannot be undone.`}
        pending={isDeleting}
        onConfirm={() => void handleDelete()}
      />
    </motion.div>
  );
}

function FavoriteCard({ favorite }: { favorite: VacancyFavorite }) {
  const queryClient = useQueryClient();
  const unfavoriteMutation = useUnfavoriteVacancy();
  const [, setLocation] = useLocation();

  function handleUnfavorite() {
    unfavoriteMutation.mutate(
      { vacancyId: favorite.vacancyId },
      {
        onSettled: () => {
          void queryClient.invalidateQueries({ queryKey: getListVacancyFavoritesQueryKey() });
        },
      },
    );
  }

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="w-full">
      <Card className="p-5 flex flex-col gap-3 hover:shadow-md transition-all">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-foreground truncate">
              {favorite.title ?? "Vacancy no longer listed"}
            </h3>
            <div className="flex items-center flex-wrap gap-3 mt-1 text-xs text-muted-foreground">
              {favorite.company && (
                <span className="flex items-center gap-1">
                  <Building2 className="w-3 h-3" />
                  {favorite.company}
                </span>
              )}
              {favorite.location && (
                <span className="flex items-center gap-1">
                  <MapPin className="w-3 h-3" />
                  {favorite.location}
                </span>
              )}
              <span className="flex items-center gap-1">
                <Calendar className="w-3 h-3" />
                Favorited {format(new Date(favorite.createdAt), "MMM d, yyyy")}
              </span>
            </div>
          </div>
          <button
            onClick={handleUnfavorite}
            disabled={unfavoriteMutation.isPending}
            title="Remove from favorites"
            aria-label="Remove from favorites"
            className="shrink-0 p-1.5 rounded-lg text-rose-500 hover:text-rose-600 hover:bg-muted transition-colors disabled:opacity-50"
          >
            <Heart className="w-4 h-4 fill-current" />
          </button>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            size="sm"
            variant="ghost"
            className="text-xs h-7 text-primary"
            onClick={() => setLocation("/opportunities")}
          >
            View Role <ArrowRight className="w-3 h-3 ml-1" />
          </Button>
          {favorite.applyUrl && (
            <a
              href={favorite.applyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-blue-700 dark:text-blue-400 hover:underline"
            >
              <ExternalLink className="w-3 h-3" />
              Apply / view posting
            </a>
          )}
        </div>
      </Card>
    </motion.div>
  );
}

function InProgressSection({ items }: { items: EnrichedApplication[] }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [pendingId, setPendingId] = useState<number | null>(null);
  if (items.length === 0) return null;
  async function confirm(app: EnrichedApplication) {
    if (!app.applicationUrl) return;
    setPendingId(app.id);
    try {
      await confirmAssistedApplication(app.applicationUrl);
      await refreshApplicationQueries(queryClient);
      toast({ title: "Marked as applied", description: `${app.roleTitle ?? app.companyName ?? "Application"} is now in your tracker as applied.` });
    } catch (e) {
      toast({ title: "Could not confirm", description: e instanceof Error ? e.message : "Please try again.", variant: "destructive" });
    } finally {
      setPendingId(null);
    }
  }
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50/60 p-4 dark:border-amber-800/50 dark:bg-amber-900/10" data-testid="section-in-progress">
      <div className="flex items-center gap-2">
        <Clock className="w-4 h-4 text-amber-700" />
        <h2 className="text-sm font-semibold text-foreground">Applications in progress</h2>
        <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold bg-amber-100 text-amber-800">{items.length}</span>
      </div>
      <p className="text-xs text-muted-foreground">Started in the last 48 hours. Confirm only once you have submitted on the employer site.</p>
      {items.map((app) => (
        <div key={app.id} className="flex flex-col gap-2 rounded-xl border border-border bg-background p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">{app.roleTitle ?? app.companyName ?? "Website application"}</p>
            <p className="truncate text-xs text-muted-foreground">{app.companyName ?? "Employer"} · Started {format(new Date(app.appliedAt), "MMM d, HH:mm")}</p>
          </div>
          <Button size="sm" disabled={pendingId === app.id || !app.applicationUrl} onClick={() => void confirm(app)} className="min-h-11 w-full sm:w-auto" data-testid={`button-confirm-in-progress-${app.id}`}>
            {pendingId === app.id ? "Confirming…" : "Yes, Mark as Applied"}
          </Button>
        </div>
      ))}
    </section>
  );
}

function FavoritesList({ favorites }: { favorites: VacancyFavorite[] }) {
  const [, setLocation] = useLocation();

  if (favorites.length === 0) {
    return (
      <Card className="p-12 text-center border-dashed border-2">
        <div className="w-16 h-16 bg-muted rounded-2xl flex items-center justify-center mx-auto mb-4">
          <Heart className="w-8 h-8 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold text-foreground mb-2">No favorites yet</h3>
        <p className="text-muted-foreground mb-6 max-w-sm mx-auto text-sm">
          Tap the heart on any vacancy card on the Opportunities page to save it here for later.
        </p>
        <Button variant="outline" onClick={() => setLocation("/opportunities")}>
          Browse Jobs
        </Button>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {favorites.map((f) => (
        <FavoriteCard key={f.vacancyId} favorite={f} />
      ))}
    </div>
  );
}

export default function ApplicationsPage() {
  const { data, isLoading, refetch } = useListMyApplications();
  const { data: analyticsData, isLoading: analyticsLoading } = useGetMyAnalytics();
  const [, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState<CategoryTab>("all");
  const [timeframe, setTimeframe] = useState<TimeframeFilter>("all");
  const [selectedApplications, setSelectedApplications] = useState<Set<string>>(() => new Set());
  const [confirmingBulkDelete, setConfirmingBulkDelete] = useState(false);
  const [logExternalOpen, setLogExternalOpen] = useState(false);
  const [logExternalPending, setLogExternalPending] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { mutateAsync: deleteApplication, isPending: isBulkDeleting } = useDeleteApplication();
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");

  async function handleLogExternalSubmit({ companyName, applicationUrl, notes, cvDocumentId }: { companyName: string; applicationUrl: string; notes: string; cvDocumentId?: number | null }) {
    setLogExternalPending(true);
    try {
      const res = await fetch(`${base}/api/applications`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ applicationType: "website", companyName, applicationUrl: applicationUrl || null, notes: notes || null, cvDocumentId: cvDocumentId ?? null }),
      });
      if (!res.ok) throw new Error("Failed to submit");
      void queryClient.invalidateQueries({ queryKey: getListMyApplicationsQueryKey() });
      setLogExternalOpen(false);
      toast({ title: "Application logged", description: `Your application to ${companyName} has been saved to your tracker.` });
    } catch {
      toast({ title: "Error", description: "Could not save application. Please try again.", variant: "destructive" });
    } finally {
      setLogExternalPending(false);
    }
  }

  const { data: favoritesData } = useListVacancyFavorites();
  const favorites = favoritesData?.favorites ?? [];

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

  const activeApplications = excludeClosedApplications(applications);
  const timeframeApplications = filterApplicationsByTimeframe(activeApplications, timeframe);
  const filtered = activeTab === "all"
    ? timeframeApplications
    : activeTab === "platform"
    ? timeframeApplications.filter((a) => a.applicationKind === "formal")
    : activeTab === "speculative"
    ? timeframeApplications.filter((a) => a.applicationKind === "speculative")
    : timeframeApplications.filter((a) => a.applicationKind === "website");

  const repliedApps = filtered.filter(isReplied);
  const otherApps = filtered.filter((a) => !isReplied(a));
  const applicationKey = (application: EnrichedApplication) =>
    `${application.applicationKind ?? "formal"}-${application.id}`;
  const visibleApplicationKeys = filtered.map(applicationKey);
  const selectedVisibleApplications = filtered.filter((application) =>
    selectedApplications.has(applicationKey(application)),
  );
  const allVisibleSelected = filtered.length > 0 && selectedVisibleApplications.length === filtered.length;

  function setApplicationSelected(application: EnrichedApplication, selected: boolean) {
    const key = applicationKey(application);
    setSelectedApplications((current) => {
      const next = new Set(current);
      if (selected) next.add(key);
      else next.delete(key);
      return next;
    });
    setConfirmingBulkDelete(false);
  }

  function toggleSelectAllVisible() {
    setSelectedApplications((current) => {
      const next = new Set(current);
      if (allVisibleSelected) {
        visibleApplicationKeys.forEach((key) => next.delete(key));
      } else {
        visibleApplicationKeys.forEach((key) => next.add(key));
      }
      return next;
    });
    setConfirmingBulkDelete(false);
  }

  async function handleBulkDelete() {
    if (selectedVisibleApplications.length === 0) return;
    const deleting = [...selectedVisibleApplications];
    const results = await Promise.allSettled(
      deleting.map((application) => deleteApplication({ id: application.id })),
    );
    const deleted = deleting.filter((_, index) => results[index]?.status === "fulfilled");
    const failed = deleting.length - deleted.length;
    const deletedKeys = new Set(deleted.map(applicationKey));
    setSelectedApplications((current) =>
      new Set([...current].filter((key) => !deletedKeys.has(key))),
    );
    setConfirmingBulkDelete(false);
    await queryClient.invalidateQueries({ queryKey: getListMyApplicationsQueryKey() });
    await refetch();

    if (failed === 0) {
      toast({
        title: `${deleted.length} application${deleted.length === 1 ? "" : "s"} deleted`,
        description: "The selected applications were removed from your tracker.",
      });
    } else {
      toast({
        title: `${failed} application${failed === 1 ? "" : "s"} could not be deleted`,
        description: deleted.length > 0
          ? `${deleted.length} application${deleted.length === 1 ? " was" : "s were"} deleted. Failed items remain selected so you can retry.`
          : "The selected applications remain selected so you can try again.",
        variant: "destructive",
      });
    }
  }

  const tabs: { id: CategoryTab; label: string; icon: React.ElementType; count: number }[] = [
    { id: "all", label: "All", icon: ClipboardList, count: timeframeApplications.length },
    { id: "platform", label: "Apply Via Job Board", icon: Building2, count: timeframeApplications.filter((a) => a.applicationKind === "formal").length },
    { id: "speculative", label: "Send CV", icon: Send, count: timeframeApplications.filter((a) => a.applicationKind === "speculative").length },
    { id: "website", label: "Apply on company websites", icon: Globe, count: timeframeApplications.filter((a) => a.applicationKind === "website").length },
    { id: "favorites", label: "Favorites", icon: Heart, count: favorites.length },
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
               Track applications from job boards, Send CV, and company websites.
            </p>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <Button onClick={() => setLocation("/opportunities")}>
              <Briefcase className="w-4 h-4 mr-1.5" /> Browse Jobs
            </Button>
            <button
              onClick={() => setLogExternalOpen(true)}
              className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
              title="Use this to record an application you made on an employer's website or anywhere outside JOBSAGE"
            >
              Log an application made elsewhere
            </button>
          </div>
        </div>

        {stats && timeframeApplications.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: "Total", value: timeframeApplications.length, color: "text-foreground" },
              { label: "Interviews", value: timeframeApplications.filter((a) => a.status === "interview" || a.status === "interview_invited").length, color: "text-teal-600" },
              { label: "Offers", value: timeframeApplications.filter((a) => a.status === "offer").length, color: "text-amber-600" },
              { label: "Send CV", value: timeframeApplications.filter((a) => a.applicationKind === "speculative").length, color: "text-sky-600" },
            ].map(({ label, value, color }) => (
              <Card key={label} className="p-4 text-center">
                <p className={`text-2xl font-bold ${color}`}>{value}</p>
                <p className="text-xs text-muted-foreground mt-1">{label}</p>
              </Card>
            ))}
          </div>
        )}

        <WeeklyApplicationStats
          stats={analyticsData?.applicationsLast7Days}
          isLoading={analyticsLoading}
        />

        <div className="flex items-center gap-1 overflow-x-auto rounded-xl bg-muted p-1 text-xs font-medium">
          {TIMEFRAME_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => {
                setTimeframe(option.id);
                setSelectedApplications(new Set());
                setConfirmingBulkDelete(false);
              }}
              className={`whitespace-nowrap rounded-lg px-3 py-2 transition-all ${
                timeframe === option.id
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        {/* Category tabs */}
        <div className="flex gap-1 p-1 bg-muted rounded-xl overflow-x-auto">
          {tabs.map(({ id, label, icon: Icon, count }) => (
            <button
              key={id}
              onClick={() => {
                setActiveTab(id);
                setSelectedApplications(new Set());
                setConfirmingBulkDelete(false);
              }}
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

        {activeTab !== "favorites" && filtered.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-muted/20 px-3 py-2.5">
            <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-foreground">
              <input
                type="checkbox"
                checked={allVisibleSelected}
                onChange={toggleSelectAllVisible}
                className="h-4 w-4 cursor-pointer rounded border-border accent-primary"
              />
              Select all visible
            </label>
            {selectedVisibleApplications.length > 0 && (
              <div className="flex flex-wrap items-center justify-end gap-2">
                <Button
                  size="sm"
                  variant="destructive"
                  className="gap-1.5"
                  onClick={() => setConfirmingBulkDelete(true)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete selected ({selectedVisibleApplications.length})
                </Button>
              </div>
            )}
          </div>
        )}

        <InProgressSection items={applications.filter((a) => a.applicationKind === "website" && isRecentInProgress(a))} />

        {activeTab === "favorites" ? (
          <FavoritesList favorites={favorites} />
        ) : isLoading ? (
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
                ? "Applied on an employer's website? Use 'Log an application made elsewhere' above to record it here."
                : activeTab === "speculative"
                 ? "Use Send CV to create a tracked record with a sponsor licence company."
                 : "Use Smart Apply, Send CV, or log an application you made elsewhere."}
            </p>
            <Button variant="outline" onClick={() => setLocation(activeTab === "speculative" || activeTab === "website" ? "/sponsor-licences" : "/opportunities")}>
              {activeTab === "speculative" || activeTab === "website" ? "Browse Sponsors" : "Browse Jobs"}
            </Button>
          </Card>
        ) : (
          <div className="flex flex-col gap-6">
            {repliedApps.length > 0 && (
              <section className="flex flex-col gap-4">
                <div className="flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-emerald-600" />
                  <h2 className="text-sm font-semibold text-foreground">Replied</h2>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300">
                    {repliedApps.length}
                  </span>
                  <span className="text-xs text-muted-foreground">Employer has responded</span>
                </div>
                {repliedApps.map((app) => (
                  <ApplicationCard
                    key={`${app.applicationKind ?? "formal"}-${app.id}`}
                    application={app}
                    onStatusUpdated={() => void refetch()}
                    selected={selectedApplications.has(applicationKey(app))}
                    onSelectedChange={(selected) => setApplicationSelected(app, selected)}
                  />
                ))}
              </section>
            )}
            {otherApps.length > 0 && (
              <section className="flex flex-col gap-4">
                {repliedApps.length > 0 && (
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-muted-foreground" />
                    <h2 className="text-sm font-semibold text-foreground">Awaiting Response</h2>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold bg-muted-foreground/10 text-muted-foreground">
                      {otherApps.length}
                    </span>
                  </div>
                )}
                {otherApps.map((app) => (
                  <ApplicationCard
                    key={`${app.applicationKind ?? "formal"}-${app.id}`}
                    application={app}
                    onStatusUpdated={() => void refetch()}
                    selected={selectedApplications.has(applicationKey(app))}
                    onSelectedChange={(selected) => setApplicationSelected(app, selected)}
                  />
                ))}
              </section>
            )}
          </div>
        )}
      </PageTransition>

      {logExternalOpen && (
        <MarkWebsiteApplicationModal
          onSubmit={(data) => void handleLogExternalSubmit(data)}
          onClose={() => setLogExternalOpen(false)}
          isPending={logExternalPending}
        />
      )}

      <DeleteConfirmationDialog
        open={confirmingBulkDelete}
        onOpenChange={setConfirmingBulkDelete}
        title={`Delete ${selectedVisibleApplications.length} selected application${selectedVisibleApplications.length === 1 ? "" : "s"}?`}
        description="The selected applications will be permanently removed from your Application Tracker. This action cannot be undone."
        pending={isBulkDeleting}
        onConfirm={() => void handleBulkDelete()}
      />
    </AppLayout>
  );
}
