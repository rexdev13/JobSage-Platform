import { useState } from "react";
import { useLocation, Link } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, Button, PageTransition } from "@/components/ui-enhanced";
import {
  useListEmployerJobs,
  useGetEmployerProfile,
  useDeleteJobListing,
  usePublishJobListing,
  useCloseJobListing,
  getListEmployerJobsQueryKey,
  type JobListingWithCount,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import {
  Briefcase,
  Plus,
  Building2,
  MapPin,
  Users,
  Eye,
  Edit3,
  Trash2,
  CheckCircle2,
  Clock,
  XCircle,
  ArrowRight,
  Globe,
  BadgeCheck,
  BarChart3,
  Settings,
  Search,
} from "lucide-react";
import { motion } from "framer-motion";

const STATUS_CONFIG = {
  draft: { label: "Draft", icon: Clock, className: "bg-muted text-muted-foreground" },
  published: { label: "Live", icon: CheckCircle2, className: "bg-emerald-100 text-emerald-800" },
  closed: { label: "Closed", icon: XCircle, className: "bg-red-100 text-red-700" },
};

function JobCard({ job, onDelete, onPublish, onClose, onHeadhunt }: {
  job: JobListingWithCount;
  onDelete: (id: number) => void;
  onPublish: (id: number) => void;
  onClose: (id: number) => void;
  onHeadhunt: (job: JobListingWithCount) => void;
}) {
  const [, setLocation] = useLocation();
  const cfg = STATUS_CONFIG[job.status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.draft;
  const Icon = cfg.icon;

  return (
    <Card className="p-5 hover:shadow-md transition-all">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${cfg.className}`}>
              <Icon className="w-3 h-3" /> {cfg.label}
            </span>
            {job.sponsorshipOffered && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                <BadgeCheck className="w-3 h-3" /> Sponsorship
              </span>
            )}
            <span className="text-xs text-muted-foreground font-mono bg-muted px-1.5 py-0.5 rounded">{job.regulator}</span>
          </div>
          <h3 className="text-base font-semibold text-foreground truncate">{job.title}</h3>
          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {job.location}</span>
            {job.salaryBand && <span>{job.salaryBand}</span>}
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0 text-center">
          <div>
            <p className="text-lg font-bold text-foreground leading-none">{job.applicantCount}</p>
            <p className="text-xs text-muted-foreground">Total</p>
          </div>
          <div>
            <p className="text-lg font-bold text-emerald-600 leading-none">{job.shortlistedCount}</p>
            <p className="text-xs text-muted-foreground">Shortlisted</p>
          </div>
          <div>
            <p className="text-lg font-bold text-rose-500 leading-none">{job.rejectedCount}</p>
            <p className="text-xs text-muted-foreground">Rejected</p>
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2 flex-wrap">
        <Button size="sm" variant="outline" className="text-xs h-8" onClick={() => setLocation(`/employer/jobs/${job.id}`)}>
          <Users className="w-3.5 h-3.5 mr-1.5" /> View Applicants
        </Button>
        <Button size="sm" variant="ghost" className="text-xs h-8 text-primary" onClick={() => onHeadhunt(job)}>
          <Search className="w-3.5 h-3.5 mr-1.5" /> Headhunt
        </Button>
        <Button size="sm" variant="ghost" className="text-xs h-8" onClick={() => setLocation(`/employer/jobs/${job.id}/edit`)}>
          <Edit3 className="w-3.5 h-3.5 mr-1.5" /> Edit
        </Button>
        {job.status === "draft" && (
          <Button size="sm" variant="ghost" className="text-xs h-8 text-emerald-700" onClick={() => onPublish(job.id)}>
            <Globe className="w-3.5 h-3.5 mr-1.5" /> Publish
          </Button>
        )}
        {job.status === "published" && (
          <Button size="sm" variant="ghost" className="text-xs h-8 text-muted-foreground" onClick={() => onClose(job.id)}>
            <XCircle className="w-3.5 h-3.5 mr-1.5" /> Close
          </Button>
        )}
        {job.status !== "published" && (
          <Button size="sm" variant="ghost" className="text-xs h-8 text-destructive hover:bg-destructive/10" onClick={() => onDelete(job.id)}>
            <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Delete
          </Button>
        )}
      </div>
    </Card>
  );
}

export default function EmployerDashboardPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useListEmployerJobs();
  const { data: empProfile } = useGetEmployerProfile();
  const deleteMutation = useDeleteJobListing();
  const publishMutation = usePublishJobListing();
  const closeMutation = useCloseJobListing();

  const [activeFilter, setActiveFilter] = useState<"all" | "draft" | "published" | "closed">("all");

  const jobs = data?.jobs ?? [];
  const publishedJobs = jobs.filter((j) => j.status === "published");
  const draftJobs = jobs.filter((j) => j.status === "draft");
  const totalApplicants = jobs.reduce((sum, j) => sum + j.applicantCount, 0);
  const totalShortlisted = jobs.reduce((sum, j) => sum + (j.shortlistedCount ?? 0), 0);
  const totalRejected = jobs.reduce((sum, j) => sum + (j.rejectedCount ?? 0), 0);

  const filteredJobs = activeFilter === "all" ? jobs : jobs.filter((j) => j.status === activeFilter);

  function invalidateJobs() {
    void queryClient.invalidateQueries({ queryKey: getListEmployerJobsQueryKey() });
  }

  function handleDelete(id: number) {
    if (!confirm("Delete this job listing? This cannot be undone.")) return;
    deleteMutation.mutate({ id }, {
      onSuccess: () => { toast({ title: "Job listing deleted." }); invalidateJobs(); },
      onError: () => toast({ title: "Error", description: "Could not delete listing.", variant: "destructive" }),
    });
  }

  function handlePublish(id: number) {
    publishMutation.mutate({ id }, {
      onSuccess: () => { toast({ title: "Job listing published!", description: "It's now visible to eligible candidates." }); invalidateJobs(); },
      onError: (err) => toast({ title: "Cannot publish", description: (err as Error).message, variant: "destructive" }),
    });
  }

  function handleClose(id: number) {
    closeMutation.mutate({ id }, {
      onSuccess: () => { toast({ title: "Job listing closed." }); invalidateJobs(); },
      onError: () => toast({ title: "Error", description: "Could not close listing.", variant: "destructive" }),
    });
  }

  function handleHeadhunt(job: JobListingWithCount) {
    const params = new URLSearchParams({ vacancyId: String(job.id) });
    if (job.specialty) params.set("specialty", job.specialty);
    if (job.targetProfessions?.length) params.set("profession", job.targetProfessions[0]);
    if (job.targetRegions?.length) params.set("preferredRegion", job.targetRegions[0]);
    setLocation(`/employer/talent-search?${params.toString()}`);
  }

  return (
    <AppLayout>
      <PageTransition className="max-w-4xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-start">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Building2 className="w-5 h-5 text-primary" />
              <h1 className="text-2xl font-display font-bold text-foreground">
                {empProfile?.companyName ?? "Employer Dashboard"}
              </h1>
            </div>
            <p className="text-muted-foreground text-sm">
              {empProfile?.region && <><MapPin className="w-3.5 h-3.5 inline mr-1" />{empProfile.region} · </>}
              Manage your job listings and candidate pipeline.
            </p>
          </div>
          <div className="flex w-full flex-wrap gap-2 sm:w-auto">
            <Button size="sm" variant="outline" onClick={() => setLocation("/employer/profile")}>
              <Settings className="w-4 h-4 mr-1.5" /> Profile
            </Button>
            <Button onClick={() => setLocation("/employer/jobs/new")}>
              <Plus className="w-4 h-4 mr-1.5" /> Post a Job
            </Button>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { icon: Briefcase, label: "Total Listings", value: jobs.length, sub: `${publishedJobs.length} live, ${draftJobs.length} draft`, color: "text-primary" },
            { icon: Users, label: "Total Applicants", value: totalApplicants, sub: "Across all jobs", color: "text-primary" },
            { icon: BarChart3, label: "Shortlisted", value: totalShortlisted, sub: "Ready for interview", color: "text-emerald-600" },
            { icon: BarChart3, label: "Rejected", value: totalRejected, sub: "Not progressing", color: "text-rose-500" },
          ].map(({ icon: Icon, label, value, sub, color }) => (
            <motion.div key={label} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
              <Card className="p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                  <Icon className={`w-5 h-5 ${color}`} />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className={`text-xl font-bold ${color}`}>{value}</p>
                  <p className="text-xs text-muted-foreground">{sub}</p>
                </div>
              </Card>
            </motion.div>
          ))}
        </div>

        {/* Profile setup nudge if no employer profile */}
        {!empProfile && !isLoading && (
          <Card className="p-5 border-amber-200 bg-amber-50">
            <div className="flex items-start gap-3">
              <Building2 className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-semibold text-amber-800 text-sm">Complete your employer profile</p>
                <p className="text-xs text-amber-700 mt-0.5">Add your organisation details to start posting jobs.</p>
              </div>
              <Button size="sm" onClick={() => setLocation("/employer/onboarding")}>
                Set up profile <ArrowRight className="w-3.5 h-3.5 ml-1" />
              </Button>
            </div>
          </Card>
        )}

        {/* Job listings */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-foreground">Job Listings</h2>
            {/* Filter tabs */}
            <div className="flex gap-1 p-1 bg-muted rounded-lg text-xs">
              {(["all", "draft", "published", "closed"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setActiveFilter(f)}
                  className={`px-2.5 py-1 rounded-md capitalize transition-all ${activeFilter === f ? "bg-background shadow-sm text-foreground font-medium" : "text-muted-foreground"}`}
                >
                  {f === "all" ? `All (${jobs.length})` : f === "published" ? `Live (${publishedJobs.length})` : f === "draft" ? `Draft (${draftJobs.length})` : `Closed (${jobs.filter((j) => j.status === "closed").length})`}
                </button>
              ))}
            </div>
          </div>

          {isLoading ? (
            <Card className="p-8 text-center">
              <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">Loading jobs…</p>
            </Card>
          ) : filteredJobs.length === 0 ? (
            <Card className="p-10 text-center">
              <Briefcase className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
              <h3 className="text-base font-semibold mb-2">{activeFilter === "all" ? "No job listings yet" : `No ${activeFilter} listings`}</h3>
              {activeFilter === "all" && (
                <>
                  <p className="text-sm text-muted-foreground mb-4">Post your first job to start receiving pre-qualified candidates.</p>
                  <Button onClick={() => setLocation("/employer/jobs/new")}>
                    <Plus className="w-4 h-4 mr-2" /> Post a Job
                  </Button>
                </>
              )}
            </Card>
          ) : (
            <div className="space-y-4">
              {filteredJobs.map((job) => (
                <motion.div key={job.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                  <JobCard
                    job={job}
                    onDelete={handleDelete}
                    onPublish={handlePublish}
                    onClose={handleClose}
                    onHeadhunt={handleHeadhunt}
                  />
                </motion.div>
              ))}
            </div>
          )}
        </div>

        {/* Candidate view shortcut */}
        {jobs.length > 0 && (
          <Card className="p-4 border-dashed border-2 border-muted bg-muted/20">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <Eye className="w-5 h-5 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium text-foreground">See how your jobs appear to candidates</p>
                  <p className="text-xs text-muted-foreground">Published jobs are visible on the candidate job board.</p>
                </div>
              </div>
              <Link href="/opportunities">
                <Button size="sm" variant="outline">
                  View Board <ArrowRight className="w-3.5 h-3.5 ml-1" />
                </Button>
              </Link>
            </div>
          </Card>
        )}
      </PageTransition>
    </AppLayout>
  );
}
