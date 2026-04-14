import { useState } from "react";
import { useLocation } from "wouter";
import { Card, Button } from "@/components/ui-enhanced";
import { useUpsertEmployerProfile } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Building2, MapPin, FileText, Award, ArrowRight, CheckCircle2 } from "lucide-react";
import { motion } from "framer-motion";

const INDUSTRY_OPTIONS = [
  { value: "nhs_trust", label: "NHS Trust / Foundation Trust" },
  { value: "university", label: "University / Academic Institution" },
  { value: "private_healthcare", label: "Private Healthcare Group" },
  { value: "charity", label: "Healthcare Charity / Social Enterprise" },
  { value: "other", label: "Other" },
];

const UK_REGIONS = [
  "East of England", "East Midlands", "London", "North East", "North West",
  "South East", "South West", "West Midlands", "Yorkshire and the Humber",
  "Northern Ireland", "Scotland", "Wales", "National / Multiple Regions",
];

export default function EmployerOnboardingPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const mutation = useUpsertEmployerProfile();

  const [form, setForm] = useState({
    companyName: "",
    industry: "",
    sponsorLicenceNumber: "",
    region: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  function validate() {
    const e: Record<string, string> = {};
    if (!form.companyName.trim()) e.companyName = "Organisation name is required.";
    if (!form.industry) e.industry = "Please select an industry.";
    if (!form.region) e.region = "Please select a region.";
    return e;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }

    mutation.mutate(
      {
        data: {
          companyName: form.companyName.trim(),
          industry: form.industry as "nhs_trust" | "university" | "private_healthcare" | "charity" | "other",
          sponsorLicenceNumber: form.sponsorLicenceNumber.trim() || undefined,
          region: form.region,
        },
      },
      {
        onSuccess: () => {
          toast({ title: "Organisation profile saved!", description: "Your employer profile is now set up." });
          setLocation("/employer/dashboard");
        },
        onError: (err) => {
          toast({ title: "Error", description: (err as Error).message || "Could not save profile.", variant: "destructive" });
        },
      },
    );
  }

  const steps = [
    { icon: Building2, label: "Organisation details" },
    { icon: Award, label: "Sponsor licence" },
    { icon: MapPin, label: "Region" },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-accent/5 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-lg"
      >
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-xs font-semibold mb-4">
            <Building2 className="w-3.5 h-3.5" /> Employer Setup
          </div>
          <h1 className="text-3xl font-bold text-foreground">Set up your organisation</h1>
          <p className="text-muted-foreground mt-2 text-sm max-w-sm mx-auto">
            Tell us about your organisation so candidates can see your jobs and sponsorship capabilities.
          </p>
        </div>

        <div className="flex items-center justify-center gap-4 mb-8">
          {steps.map(({ icon: Icon, label }, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-primary/15 text-primary flex items-center justify-center">
                <Icon className="w-3 h-3" />
              </div>
              <span className="text-xs text-muted-foreground hidden sm:inline">{label}</span>
              {i < steps.length - 1 && <ArrowRight className="w-3 h-3 text-muted-foreground/30 hidden sm:block" />}
            </div>
          ))}
        </div>

        <Card className="p-8">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Organisation Name <span className="text-destructive">*</span></label>
              <div className="relative">
                <Building2 className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  value={form.companyName}
                  onChange={(e) => setForm({ ...form, companyName: e.target.value })}
                  placeholder="e.g. Royal London Hospital NHS Foundation Trust"
                  className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
              {errors.companyName && <p className="text-xs text-destructive mt-1">{errors.companyName}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Organisation Type <span className="text-destructive">*</span></label>
              <select
                value={form.industry}
                onChange={(e) => setForm({ ...form, industry: e.target.value })}
                className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
              >
                <option value="">Select type…</option>
                {INDUSTRY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              {errors.industry && <p className="text-xs text-destructive mt-1">{errors.industry}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                <span className="flex items-center gap-1.5">
                  <Award className="w-3.5 h-3.5 text-muted-foreground" /> Skilled Worker Sponsor Licence Number
                  <span className="text-xs text-muted-foreground font-normal">(optional)</span>
                </span>
              </label>
              <div className="relative">
                <FileText className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  value={form.sponsorLicenceNumber}
                  onChange={(e) => setForm({ ...form, sponsorLicenceNumber: e.target.value })}
                  placeholder="e.g. SW12345678"
                  className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
              <p className="text-xs text-muted-foreground mt-1">This helps candidates verify your visa sponsorship capability.</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Primary Region <span className="text-destructive">*</span></label>
              <div className="relative">
                <MapPin className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <select
                  value={form.region}
                  onChange={(e) => setForm({ ...form, region: e.target.value })}
                  className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 appearance-none"
                >
                  <option value="">Select region…</option>
                  {UK_REGIONS.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
              {errors.region && <p className="text-xs text-destructive mt-1">{errors.region}</p>}
            </div>

            <Button type="submit" className="w-full" disabled={mutation.isPending}>
              {mutation.isPending ? (
                <>
                  <div className="w-4 h-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin mr-2" />
                  Saving…
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4 mr-2" /> Complete Setup
                </>
              )}
            </Button>
          </form>
        </Card>

        <p className="text-center text-xs text-muted-foreground mt-4">
          Already a candidate?{" "}
          <button onClick={() => setLocation("/")} className="text-primary hover:underline font-medium">
            Back to candidate dashboard
          </button>
        </p>
      </motion.div>
    </div>
  );
}
