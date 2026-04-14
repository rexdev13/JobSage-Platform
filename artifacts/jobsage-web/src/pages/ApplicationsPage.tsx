import { AppLayout } from "@/components/layout/AppLayout";
import { Card, Button, PageTransition } from "@/components/ui-enhanced";
import { useListMyApplications } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
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
} from "lucide-react";
import { format } from "date-fns";
import type { Application, ApplicationStatus } from "@workspace/api-client-react";

const STATUS_CONFIG: Record<
  ApplicationStatus,
  { label: string; icon: React.ElementType; className: string }
> = {
  applied: {
    label: "Applied",
    icon: ClipboardList,
    className: "bg-blue-100 text-blue-800",
  },
  shortlisted: {
    label: "Shortlisted",
    icon: CheckCircle2,
    className: "bg-emerald-100 text-emerald-800",
  },
  interview: {
    label: "Interview",
    icon: MessageSquare,
    className: "bg-purple-100 text-purple-800",
  },
  offer: {
    label: "Offer Received",
    icon: Trophy,
    className: "bg-amber-100 text-amber-800",
  },
  rejected: {
    label: "Not Progressing",
    icon: XCircle,
    className: "bg-rose-100 text-rose-800",
  },
  no_response: {
    label: "No Response",
    icon: Clock,
    className: "bg-muted text-muted-foreground",
  },
};

function ApplicationCard({ application }: { application: Application & { roleTitle?: string | null; roleLocation?: string | null } }) {
  const cfg = STATUS_CONFIG[application.status as ApplicationStatus] ?? STATUS_CONFIG.applied;
  const Icon = cfg.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full"
    >
      <Card className="p-5 flex flex-col gap-3 hover:shadow-md transition-all">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-foreground truncate">
              {application.roleTitle ?? `Role #${application.roleId}`}
            </h3>
            <div className="flex items-center flex-wrap gap-3 mt-1 text-xs text-muted-foreground">
              {application.roleLocation && (
                <span className="flex items-center gap-1">
                  <MapPin className="w-3 h-3" />
                  {application.roleLocation}
                </span>
              )}
              <span className="flex items-center gap-1">
                <Calendar className="w-3 h-3" />
                Applied {format(new Date(application.appliedAt), "MMM d, yyyy")}
              </span>
            </div>
          </div>
          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold shrink-0 ${cfg.className}`}
          >
            <Icon className="w-3 h-3" />
            {cfg.label}
          </span>
        </div>

        {application.notes && (
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

        {application.roleId > 1_000_000 && (
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
  const { data, isLoading } = useListMyApplications();
  const [, setLocation] = useLocation();

  const applications = (data?.applications ?? []) as (Application & { roleTitle?: string | null; roleLocation?: string | null })[];
  const stats = data?.stats;

  return (
    <AppLayout>
      <PageTransition className="max-w-4xl mx-auto p-6 space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-display font-bold text-foreground flex items-center gap-2">
              <ClipboardList className="w-6 h-6 text-primary" />
              My Applications
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Track all your job applications and their current status.
            </p>
          </div>
          <Button onClick={() => setLocation("/opportunities")}>
            <Briefcase className="w-4 h-4 mr-1.5" /> Browse Opportunities
          </Button>
        </div>

        {stats && applications.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: "Total", value: stats.total, color: "text-foreground" },
              { label: "Interviews", value: stats.interviews, color: "text-purple-600" },
              { label: "Offers", value: stats.offers, color: "text-amber-600" },
              { label: "No Response", value: stats.noResponse, color: "text-muted-foreground" },
            ].map(({ label, value, color }) => (
              <Card key={label} className="p-4 text-center">
                <p className={`text-2xl font-bold ${color}`}>{value}</p>
                <p className="text-xs text-muted-foreground mt-1">{label}</p>
              </Card>
            ))}
          </div>
        )}

        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="w-10 h-10 rounded-full border-4 border-primary/20 border-t-primary animate-spin mb-4" />
            <p className="text-muted-foreground text-sm">Loading applications…</p>
          </div>
        ) : applications.length === 0 ? (
          <Card className="p-12 text-center border-dashed border-2">
            <div className="w-16 h-16 bg-muted rounded-2xl flex items-center justify-center mx-auto mb-4">
              <ClipboardList className="w-8 h-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">No applications yet</h3>
            <p className="text-muted-foreground mb-6 max-w-sm mx-auto">
              Use Smart Apply on any role to submit an AI-assisted application in minutes.
            </p>
            <Button variant="outline" onClick={() => setLocation("/opportunities")}>
              Browse Opportunities
            </Button>
          </Card>
        ) : (
          <div className="flex flex-col gap-4">
            {applications.map((app) => (
              <ApplicationCard key={app.id} application={app} />
            ))}
          </div>
        )}
      </PageTransition>
    </AppLayout>
  );
}
