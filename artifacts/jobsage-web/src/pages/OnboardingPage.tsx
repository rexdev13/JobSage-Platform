import { useState } from "react";
import { useLocation } from "wouter";
import { useUpsertMyProfile } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetMyProfileQueryKey } from "@workspace/api-client-react";
import { Card, Button, Input, Select, Label, PageTransition } from "@/components/ui-enhanced";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, ArrowLeft, CheckCircle2, Shield } from "lucide-react";
import { JourneyIslands } from "@/components/JourneyIslands";
import { JOURNEY_STEPS } from "@/lib/journeySteps";
import type { IslandState } from "@/lib/journeySteps";

type RegistrationStatus = "registered" | "not_registered" | "in_process";

const ONBOARDING_PROFESSIONS = [
  "Doctor",
  "Nurse",
  "Midwife",
  "Allied Health Professional",
  "Clinical Academic",
  "Dentist",
  "Pharmacist",
  "Optometrist",
  "Physiotherapist",
  "Radiographer",
  "Paramedic",
  "Occupational Therapist",
  "Social Worker",
  "Teacher / Lecturer",
  "Engineer",
  "Accountant",
  "IT Professional",
  "Lawyer / Solicitor",
  "Architect",
];

type ProfileData = {
  profession: string;
  specialty: string;
  qualificationCountry: string;
  qualificationType: string;
  qualificationYear: string;
  experienceYears: string;
  registrationStatus: RegistrationStatus;
  licenceReady: boolean;
  residencyStatus: string;
  requiresSponsorship: boolean;
};

const FORM_STEPS = [
  { label: "Identity", title: "Professional Identity" },
  { label: "Qualifications", title: "Qualifications" },
  { label: "Experience", title: "Experience & Registration" },
  { label: "Immigration", title: "Immigration & Visa" },
];

const ONBOARDING_ISLANDS: IslandState[] = JOURNEY_STEPS.map((step, i) => ({
  step,
  status: i === 0 ? "active" : "locked",
}));

export default function OnboardingPage() {
  const [step, setStep] = useState(1);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const upsertProfileMutation = useUpsertMyProfile();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [data, setData] = useState<ProfileData>({
    profession: "",
    specialty: "",
    qualificationCountry: "",
    qualificationType: "",
    qualificationYear: "",
    experienceYears: "",
    registrationStatus: "not_registered",
    licenceReady: false,
    residencyStatus: "",
    requiresSponsorship: false,
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    const checked = type === "checkbox" ? (e.target as HTMLInputElement).checked : undefined;
    setData(prev => ({ ...prev, [name]: type === "checkbox" ? checked : value }));
  };

  const handleNext = () => setStep(s => Math.min(s + 1, 4));
  const handlePrev = () => setStep(s => Math.max(s - 1, 1));

  const handleSubmit = async () => {
    setSubmitError(null);
    try {
      if (!data.profession) throw new Error("Profession is required");
      if (!data.qualificationCountry) throw new Error("Country of qualification is required");
      if (!data.qualificationType) throw new Error("Degree type is required");
      if (!data.qualificationYear) throw new Error("Qualification year is required");
      if (!data.experienceYears) throw new Error("Years of experience is required");
      if (!data.residencyStatus) throw new Error("Residency/visa status is required");

      await upsertProfileMutation.mutateAsync({
        data: {
          profession: data.profession,
          specialty: data.specialty,
          qualificationCountry: data.qualificationCountry,
          qualificationType: data.qualificationType,
          qualificationYear: parseInt(data.qualificationYear, 10),
          experienceYears: parseInt(data.experienceYears, 10),
          registrationStatus: data.registrationStatus,
          licenceReady: data.licenceReady,
          residencyStatus: data.residencyStatus,
          requiresSponsorship: data.requiresSponsorship,
        },
      });
      queryClient.invalidateQueries({ queryKey: getGetMyProfileQueryKey() });
      setLocation("/");
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to save profile. Please try again.");
      console.error("Profile save failed", err);
    }
  };

  const isStep1Valid = data.profession !== "";
  const isStep2Valid = data.qualificationCountry !== "" && data.qualificationType !== "" && data.qualificationYear !== "";
  const isStep3Valid = data.experienceYears !== "";
  const isStep4Valid = data.residencyStatus !== "";

  return (
    <div className="min-h-screen bg-background py-10 px-4 flex flex-col items-center">
      {/* Brand header */}
      <div className="w-full max-w-2xl mb-8 flex justify-between items-center px-2">
        <img src="/logo.png" alt="JOBSAGE" className="h-10 md:h-12 w-auto object-contain" />
        <div className="flex flex-col items-end">
          <span className="text-xs text-muted-foreground">Step {step} of 4</span>
          <span className="text-sm font-semibold text-foreground">{FORM_STEPS[step - 1].label}</span>
        </div>
      </div>

      {/* Journey islands — compact preview showing where profile setup fits */}
      <div className="w-full max-w-2xl mb-6 px-2">
        <p className="text-xs text-muted-foreground mb-3 text-center">
          Your UK healthcare career journey — you're on step 1
        </p>
        <JourneyIslands islands={ONBOARDING_ISLANDS} activeStep={1} compact />
      </div>

      {/* Progress bar */}
      <div className="w-full max-w-2xl mb-8 px-2 flex gap-1.5">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="relative flex-1 h-1.5 rounded-full bg-primary/10 overflow-hidden">
            {i <= step && (
              <motion.div
                className="absolute inset-0 bg-primary rounded-full"
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ duration: 0.4 }}
                style={{ transformOrigin: "left" }}
              />
            )}
          </div>
        ))}
      </div>

      <div className="w-full max-w-2xl">
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.28 }}
          >
            <Card className="p-8 shadow-xl shadow-black/5 border-border/60">

              {step === 1 && (
                <div className="space-y-6">
                  <div>
                    <h2 className="text-2xl font-display font-bold text-foreground mb-1">Professional Identity</h2>
                    <p className="text-muted-foreground text-sm">Select your primary healthcare profession and specialty.</p>
                  </div>
                  <div>
                    <Label htmlFor="profession">Profession <span className="text-destructive">*</span></Label>
                    <Select name="profession" value={data.profession} onChange={handleChange} required>
                      <option value="" disabled>Select profession...</option>
                      {ONBOARDING_PROFESSIONS.map((p) => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="specialty">Specialty</Label>
                    <Input name="specialty" placeholder="e.g. Cardiology, Pediatrics" value={data.specialty} onChange={handleChange} />
                    <p className="text-xs text-muted-foreground mt-1">Leave blank if not applicable.</p>
                  </div>
                  <div className="pt-4 flex justify-end">
                    <Button onClick={handleNext} disabled={!isStep1Valid} size="lg">
                      Next <ArrowRight className="w-5 h-5 ml-2" />
                    </Button>
                  </div>
                </div>
              )}

              {step === 2 && (
                <div className="space-y-6">
                  <div>
                    <h2 className="text-2xl font-display font-bold text-foreground mb-1">Qualifications</h2>
                    <p className="text-muted-foreground text-sm">Where and when did you obtain your primary qualification?</p>
                  </div>
                  <div>
                    <Label htmlFor="qualificationCountry">Country of Qualification <span className="text-destructive">*</span></Label>
                    <Input name="qualificationCountry" placeholder="e.g. India, Nigeria, UK" value={data.qualificationCountry} onChange={handleChange} required />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="qualificationType">Degree Type <span className="text-destructive">*</span></Label>
                      <Input name="qualificationType" placeholder="e.g. MBBS, BSc" value={data.qualificationType} onChange={handleChange} required />
                    </div>
                    <div>
                      <Label htmlFor="qualificationYear">Year <span className="text-destructive">*</span></Label>
                      <Input name="qualificationYear" type="number" placeholder="YYYY" value={data.qualificationYear} onChange={handleChange} required />
                    </div>
                  </div>
                  <div className="pt-4 flex justify-between">
                    <Button variant="outline" onClick={handlePrev} size="lg">
                      <ArrowLeft className="w-5 h-5 mr-2" /> Back
                    </Button>
                    <Button onClick={handleNext} disabled={!isStep2Valid} size="lg">
                      Next <ArrowRight className="w-5 h-5 ml-2" />
                    </Button>
                  </div>
                </div>
              )}

              {step === 3 && (
                <div className="space-y-6">
                  <div>
                    <h2 className="text-2xl font-display font-bold text-foreground mb-1">Experience & Registration</h2>
                    <p className="text-muted-foreground text-sm">Your regulatory standing and clinical experience.</p>
                  </div>
                  <div>
                    <Label htmlFor="experienceYears">Years of Post-graduate Experience <span className="text-destructive">*</span></Label>
                    <Input name="experienceYears" type="number" min="0" placeholder="e.g. 5" value={data.experienceYears} onChange={handleChange} required />
                  </div>
                  <div>
                    <Label htmlFor="registrationStatus">UK Registration Status <span className="text-destructive">*</span></Label>
                    <Select name="registrationStatus" value={data.registrationStatus} onChange={handleChange}>
                      <option value="not_registered">Not Registered</option>
                      <option value="in_process">In Process</option>
                      <option value="registered">Fully Registered</option>
                    </Select>
                  </div>
                  <label className="flex items-center space-x-3 p-4 border border-border rounded-xl hover:bg-muted/50 cursor-pointer transition-colors">
                    <input
                      type="checkbox"
                      name="licenceReady"
                      checked={data.licenceReady}
                      onChange={handleChange}
                      className="w-5 h-5 rounded border-primary/30 text-primary focus:ring-primary accent-primary"
                    />
                    <div>
                      <div className="font-semibold text-foreground text-sm">Licence to Practice Ready</div>
                      <div className="text-xs text-muted-foreground mt-0.5">Do you have all documents required to apply for a licence?</div>
                    </div>
                  </label>
                  <div className="pt-4 flex justify-between">
                    <Button variant="outline" onClick={handlePrev} size="lg">
                      <ArrowLeft className="w-5 h-5 mr-2" /> Back
                    </Button>
                    <Button onClick={handleNext} disabled={!isStep3Valid} size="lg">
                      Next <ArrowRight className="w-5 h-5 ml-2" />
                    </Button>
                  </div>
                </div>
              )}

              {step === 4 && (
                <div className="space-y-6">
                  <div>
                    <h2 className="text-2xl font-display font-bold text-foreground mb-1">Immigration & Visa</h2>
                    <p className="text-muted-foreground text-sm">Required for determining sponsorship feasibility.</p>
                  </div>
                  <div>
                    <Label htmlFor="residencyStatus">Current Residency/Visa Status <span className="text-destructive">*</span></Label>
                    <Input name="residencyStatus" placeholder="e.g. UK Citizen, Skilled Worker Visa, Outside UK" value={data.residencyStatus} onChange={handleChange} required />
                  </div>
                  <label className="flex items-center space-x-3 p-4 border border-border rounded-xl hover:bg-muted/50 cursor-pointer transition-colors">
                    <input
                      type="checkbox"
                      name="requiresSponsorship"
                      checked={data.requiresSponsorship}
                      onChange={handleChange}
                      className="w-5 h-5 rounded border-primary/30 text-primary focus:ring-primary accent-primary"
                    />
                    <div>
                      <div className="font-semibold text-foreground text-sm">Requires Visa Sponsorship</div>
                      <div className="text-xs text-muted-foreground mt-0.5">Check this if you need an employer to sponsor your work visa.</div>
                    </div>
                  </label>
                  {submitError && (
                    <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
                      {submitError}
                    </div>
                  )}
                  <div className="pt-4 flex justify-between">
                    <Button variant="outline" onClick={handlePrev} size="lg">
                      <ArrowLeft className="w-5 h-5 mr-2" /> Back
                    </Button>
                    <Button onClick={handleSubmit} disabled={!isStep4Valid || upsertProfileMutation.isPending} size="lg" variant="accent">
                      {upsertProfileMutation.isPending ? "Saving..." : "Complete Profile"}
                      {!upsertProfileMutation.isPending && <CheckCircle2 className="w-5 h-5 ml-2" />}
                    </Button>
                  </div>
                </div>
              )}

            </Card>
          </motion.div>
        </AnimatePresence>
      </div>

      <p className="mt-6 text-xs text-muted-foreground text-center max-w-md">
        Your data is processed securely and used solely to evaluate your eligibility against UK regulatory criteria.
      </p>
    </div>
  );
}
