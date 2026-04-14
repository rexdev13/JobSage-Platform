import { useState, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, Button, PageTransition } from "@/components/ui-enhanced";
import {
  useCreateJobListing,
  useUpdateJobListing,
  useGetJobListing,
  useGenerateJobDescription,
  getListEmployerJobsQueryKey,
  type CreateJobListingRequest,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft,
  Sparkles,
  Briefcase,
  MapPin,
  Building2,
  BadgeCheck,
  FileText,
  CheckCircle2,
  Info,
} from "lucide-react";
import { motion } from "framer-motion";

const PROFESSIONS = [
  { value: "doctor", label: "Doctor" },
  { value: "clinical_academic", label: "Clinical Academic" },
  { value: "nurse", label: "Nurse" },
  { value: "midwife", label: "Midwife" },
  { value: "allied_health_professional", label: "Allied Health Professional" },
];

const REGULATOR_MAP: Record<string, string> = {
  doctor: "GMC",
  clinical_academic: "GMC",
  nurse: "NMC",
  midwife: "NMC",
  allied_health_professional: "HCPC",
};

const UK_REGIONS = [
  "East of England", "East Midlands", "London", "North East", "North West",
  "South East", "South West", "West Midlands", "Yorkshire and the Humber",
  "Northern Ireland", "Scotland", "Wales", "National / Multiple Regions",
];

type FormState = {
  title: string;
  specialty: string;
  location: string;
  salaryBand: string;
  sponsorshipOffered: boolean;
  requirements: string;
  description: string;
  regulator: string;
  requiredRegistration: string;
  targetProfessions: string[];
  targetRegions: string[];
};

const EMPTY_FORM: FormState = {
  title: "",
  specialty: "",
  location: "",
  salaryBand: "",
  sponsorshipOffered: false,
  requirements: "",
  description: "",
  regulator: "GMC",
  requiredRegistration: "",
  targetProfessions: [],
  targetRegions: [],
};

export default function EmployerJobFormPage() {
  const params = useParams<{ id?: string }>();
  const isEdit = !!params.id;
  const jobId = params.id ? parseInt(params.id, 10) : undefined;
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [generatingDesc, setGeneratingDesc] = useState(false);
  const [savedId, setSavedId] = useState<number | null>(null);

  const { data: existingJob } = useGetJobListing(jobId!, { query: { enabled: isEdit && !!jobId } });
  const createMutation = useCreateJobListing();
  const updateMutation = useUpdateJobListing();
  const generateMutation = useGenerateJobDescription();

  useEffect(() => {
    if (existingJob) {
      setForm({
        title: existingJob.title,
        specialty: existingJob.specialty ?? "",
        location: existingJob.location,
        salaryBand: existingJob.salaryBand ?? "",
        sponsorshipOffered: existingJob.sponsorshipOffered,
        requirements: existingJob.requirements ?? "",
        description: existingJob.description ?? "",
        regulator: existingJob.regulator,
        requiredRegistration: existingJob.requiredRegistration,
        targetProfessions: (existingJob.targetProfessions ?? []) as string[],
        targetRegions: (existingJob.targetRegions ?? []) as string[],
      });
    }
  }, [existingJob]);

  function validate() {
    const e: Record<string, string> = {};
    if (!form.title.trim()) e.title = "Job title is required.";
    if (!form.location.trim()) e.location = "Location is required.";
    if (!form.regulator) e.regulator = "Regulator is required.";
    if (!form.requiredRegistration.trim()) e.requiredRegistration = "Required registration is required.";
    return e;
  }

  function toggleProfession(val: string) {
    const reg = REGULATOR_MAP[val];
    setForm((prev) => {
      const already = prev.targetProfessions.includes(val);
      const updated = already ? prev.targetProfessions.filter((p) => p !== val) : [...prev.targetProfessions, val];
      const allReg = updated.map((p) => REGULATOR_MAP[p]).filter(Boolean);
      const newRegulator = allReg.length > 0 ? allReg[0] : prev.regulator;
      return { ...prev, targetProfessions: updated, regulator: newRegulator ?? prev.regulator };
    });
  }

  function toggleRegion(val: string) {
    setForm((prev) => {
      const already = prev.targetRegions.includes(val);
      return { ...prev, targetRegions: already ? prev.targetRegions.filter((r) => r !== val) : [...prev.targetRegions, val] };
    });
  }

  async function handleSave(e: React.FormEvent, andPublish = false) {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }

    const payload: CreateJobListingRequest = {
      title: form.title.trim(),
      specialty: form.specialty.trim() || undefined,
      location: form.location.trim(),
      salaryBand: form.salaryBand.trim() || undefined,
      sponsorshipOffered: form.sponsorshipOffered,
      requirements: form.requirements.trim() || undefined,
      description: form.description.trim() || undefined,
      regulator: form.regulator as "GMC" | "NMC" | "HCPC",
      requiredRegistration: form.requiredRegistration.trim(),
      targetProfessions: form.targetProfessions,
      targetRegions: form.targetRegions,
    };

    if (isEdit && jobId) {
      updateMutation.mutate(
        { id: jobId, data: payload },
        {
          onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: getListEmployerJobsQueryKey() });
            toast({ title: "Job listing updated!" });
            setLocation("/employer/dashboard");
          },
          onError: (err) => toast({ title: "Error", description: (err as Error).message, variant: "destructive" }),
        },
      );
    } else {
      createMutation.mutate(
        { data: payload },
        {
          onSuccess: (job) => {
            void queryClient.invalidateQueries({ queryKey: getListEmployerJobsQueryKey() });
            setSavedId(job.id);
            toast({ title: "Job listing created!", description: andPublish ? "Now publishing…" : "Saved as draft." });
            setLocation("/employer/dashboard");
          },
          onError: (err) => toast({ title: "Error", description: (err as Error).message, variant: "destructive" }),
        },
      );
    }
  }

  async function handleGenerateDescription() {
    const jobId = isEdit ? params.id ? parseInt(params.id, 10) : undefined : savedId;
    if (!jobId) {
      toast({ title: "Save the job first", description: "Save the job as a draft, then use AI to generate the description.", variant: "destructive" });
      return;
    }
    setGeneratingDesc(true);
    generateMutation.mutate(
      { id: jobId },
      {
        onSuccess: (data) => {
          setForm((prev) => ({ ...prev, description: data.description ?? "" }));
          toast({ title: "Description generated!", description: "Review and edit before publishing." });
        },
        onError: (err) => toast({ title: "AI error", description: (err as Error).message, variant: "destructive" }),
        onSettled: () => setGeneratingDesc(false),
      },
    );
  }

  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <AppLayout>
      <PageTransition className="max-w-3xl mx-auto p-6 space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setLocation("/employer/dashboard")}>
            <ArrowLeft className="w-4 h-4 mr-1" /> Dashboard
          </Button>
          <h1 className="text-xl font-bold text-foreground">{isEdit ? "Edit Job Listing" : "Post a New Job"}</h1>
        </div>

        <form onSubmit={handleSave} className="space-y-6">
          {/* Basic info */}
          <Card className="p-6 space-y-5">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Briefcase className="w-4 h-4 text-primary" /> Role Details
            </h2>

            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="block text-sm font-medium mb-1.5">Job Title <span className="text-destructive">*</span></label>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="e.g. Consultant Cardiologist"
                  className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
                {errors.title && <p className="text-xs text-destructive mt-1">{errors.title}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium mb-1.5">Specialty</label>
                <input
                  type="text"
                  value={form.specialty}
                  onChange={(e) => setForm({ ...form, specialty: e.target.value })}
                  placeholder="e.g. Cardiology, Oncology"
                  className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1.5">Salary Band</label>
                <input
                  type="text"
                  value={form.salaryBand}
                  onChange={(e) => setForm({ ...form, salaryBand: e.target.value })}
                  placeholder="e.g. £80,000–£107,000"
                  className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>

              <div className="col-span-2">
                <label className="block text-sm font-medium mb-1.5"><MapPin className="w-3.5 h-3.5 inline mr-1" />Location <span className="text-destructive">*</span></label>
                <input
                  type="text"
                  value={form.location}
                  onChange={(e) => setForm({ ...form, location: e.target.value })}
                  placeholder="e.g. Leeds General Infirmary, Leeds"
                  className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
                {errors.location && <p className="text-xs text-destructive mt-1">{errors.location}</p>}
              </div>
            </div>

            <div className="flex items-center gap-3 p-3 rounded-xl border border-border">
              <input
                type="checkbox"
                id="sponsorship"
                checked={form.sponsorshipOffered}
                onChange={(e) => setForm({ ...form, sponsorshipOffered: e.target.checked })}
                className="w-4 h-4 rounded accent-primary"
              />
              <label htmlFor="sponsorship" className="text-sm">
                <span className="flex items-center gap-1.5">
                  <BadgeCheck className="w-4 h-4 text-emerald-600" />
                  <span className="font-medium">Offer Skilled Worker visa sponsorship for this role</span>
                </span>
              </label>
            </div>
          </Card>

          {/* Regulatory */}
          <Card className="p-6 space-y-5">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Building2 className="w-4 h-4 text-primary" /> Regulatory Requirements
            </h2>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1.5">Regulator <span className="text-destructive">*</span></label>
                <select
                  value={form.regulator}
                  onChange={(e) => setForm({ ...form, regulator: e.target.value })}
                  className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                >
                  <option value="GMC">GMC (Doctors)</option>
                  <option value="NMC">NMC (Nurses / Midwives)</option>
                  <option value="HCPC">HCPC (Allied Health)</option>
                </select>
                {errors.regulator && <p className="text-xs text-destructive mt-1">{errors.regulator}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium mb-1.5">Required Registration <span className="text-destructive">*</span></label>
                <input
                  type="text"
                  value={form.requiredRegistration}
                  onChange={(e) => setForm({ ...form, requiredRegistration: e.target.value })}
                  placeholder="e.g. Full GMC Registration"
                  className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
                {errors.requiredRegistration && <p className="text-xs text-destructive mt-1">{errors.requiredRegistration}</p>}
              </div>
            </div>
          </Card>

          {/* Targeted posting */}
          <Card className="p-6 space-y-5">
            <div className="flex items-start gap-2">
              <div className="flex-1">
                <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  Targeted Posting
                  <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded font-normal">Optional</span>
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">Narrow who sees this job. Leave blank to show to all eligible candidates.</p>
              </div>
              <Info className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">Target Professions</p>
              <div className="flex flex-wrap gap-2">
                {PROFESSIONS.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => toggleProfession(p.value)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                      form.targetProfessions.includes(p.value)
                        ? "bg-primary text-primary-foreground border-primary"
                        : "border-border text-muted-foreground hover:border-primary/50"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">Target Regions</p>
              <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
                {UK_REGIONS.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => toggleRegion(r)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                      form.targetRegions.includes(r)
                        ? "bg-primary text-primary-foreground border-primary"
                        : "border-border text-muted-foreground hover:border-primary/50"
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
          </Card>

          {/* Requirements & Description */}
          <Card className="p-6 space-y-5">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <FileText className="w-4 h-4 text-primary" /> Person Spec &amp; Description
            </h2>

            <div>
              <label className="block text-sm font-medium mb-1.5">Person Specification / Requirements</label>
              <textarea
                value={form.requirements}
                onChange={(e) => setForm({ ...form, requirements: e.target.value })}
                placeholder="List key requirements: qualifications, experience, skills, GMC/NMC/HCPC registration status…"
                rows={4}
                className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-sm font-medium">Job Description</label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="text-xs h-7 gap-1.5"
                  onClick={handleGenerateDescription}
                  disabled={generatingDesc}
                >
                  {generatingDesc ? (
                    <><div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" /> Generating…</>
                  ) : (
                    <><Sparkles className="w-3 h-3" /> Generate with AI</>
                  )}
                </Button>
              </div>
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Write or generate a job description…"
                rows={8}
                className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
              />
              {isEdit ? null : (
                <p className="text-xs text-muted-foreground mt-1">
                  <Sparkles className="w-3 h-3 inline mr-0.5" /> Save the job first, then use &quot;Generate with AI&quot; to create a professional description.
                </p>
              )}
            </div>
          </Card>

          {/* Actions */}
          <div className="flex gap-3">
            <Button type="submit" className="flex-1" disabled={isSaving}>
              {isSaving ? (
                <><div className="w-4 h-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin mr-2" /> Saving…</>
              ) : (
                <><CheckCircle2 className="w-4 h-4 mr-2" /> {isEdit ? "Save Changes" : "Save as Draft"}</>
              )}
            </Button>
            <Button type="button" variant="outline" onClick={() => setLocation("/employer/dashboard")} disabled={isSaving}>
              Cancel
            </Button>
          </div>
        </form>
      </PageTransition>
    </AppLayout>
  );
}
