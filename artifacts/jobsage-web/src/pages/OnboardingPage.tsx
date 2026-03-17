import { useState } from "react";
import { useLocation } from "wouter";
import { useUpsertMyProfile } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetMyProfileQueryKey } from "@workspace/api-client-react";
import { Card, Button, Input, Select, Label, PageTransition } from "@/components/ui-enhanced";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, ArrowLeft, CheckCircle2 } from "lucide-react";

type ProfileData = {
  profession: string;
  specialty: string;
  qualificationCountry: string;
  qualificationType: string;
  qualificationYear: string;
  experienceYears: string;
  registrationStatus: string;
  licenceReady: boolean;
  residencyStatus: string;
  requiresSponsorship: boolean;
};

export default function OnboardingPage() {
  const [step, setStep] = useState(1);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const upsertProfileMutation = useUpsertMyProfile();

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
    try {
      await upsertProfileMutation.mutateAsync({
        data: {
          profession: data.profession as any,
          specialty: data.specialty || null,
          qualificationCountry: data.qualificationCountry || null,
          qualificationType: data.qualificationType || null,
          qualificationYear: data.qualificationYear ? parseInt(data.qualificationYear) : null,
          experienceYears: data.experienceYears ? parseInt(data.experienceYears) : null,
          registrationStatus: data.registrationStatus as any,
          licenceReady: data.licenceReady,
          residencyStatus: data.residencyStatus || null,
          requiresSponsorship: data.requiresSponsorship,
        }
      });
      queryClient.invalidateQueries({ queryKey: getGetMyProfileQueryKey() });
      setLocation("/");
    } catch (err) {
      console.error("Profile save failed", err);
    }
  };

  const isStep1Valid = data.profession !== "";
  const isStep2Valid = data.qualificationCountry !== "" && data.qualificationYear !== "";
  const isStep3Valid = data.experienceYears !== "";
  
  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 flex flex-col items-center">
      <div className="w-full max-w-2xl mb-8 flex justify-between items-center px-4">
        <h1 className="text-2xl font-display font-bold text-primary tracking-tight">JOBSAGE</h1>
        <div className="text-sm font-medium text-muted-foreground">Step {step} of 4</div>
      </div>

      <div className="w-full max-w-2xl mb-8 px-4 flex gap-2">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className={`h-2 flex-1 rounded-full transition-colors duration-500 ${i <= step ? "bg-primary" : "bg-primary/10"}`} />
        ))}
      </div>

      <div className="w-full max-w-2xl relative">
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.3 }}
          >
            <Card className="p-8 shadow-xl shadow-black/5">
              
              {step === 1 && (
                <div className="space-y-6">
                  <div>
                    <h2 className="text-2xl font-display font-bold text-foreground mb-2">Professional Identity</h2>
                    <p className="text-muted-foreground">Select your primary healthcare profession.</p>
                  </div>
                  <div>
                    <Label htmlFor="profession">Profession *</Label>
                    <Select name="profession" value={data.profession} onChange={handleChange} required>
                      <option value="" disabled>Select profession...</option>
                      <option value="doctor">Doctor</option>
                      <option value="nurse">Nurse</option>
                      <option value="allied_health_professional">Allied Health Professional</option>
                      <option value="clinical_academic">Clinical Academic</option>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="specialty">Specialty (Optional)</Label>
                    <Input name="specialty" placeholder="e.g. Cardiology, Pediatrics" value={data.specialty} onChange={handleChange} />
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
                    <h2 className="text-2xl font-display font-bold text-foreground mb-2">Qualifications</h2>
                    <p className="text-muted-foreground">Where and when did you obtain your primary qualification?</p>
                  </div>
                  <div>
                    <Label htmlFor="qualificationCountry">Country of Qualification *</Label>
                    <Input name="qualificationCountry" placeholder="e.g. India, Nigeria, UK" value={data.qualificationCountry} onChange={handleChange} />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="qualificationType">Degree Type</Label>
                      <Input name="qualificationType" placeholder="e.g. MBBS, BSc" value={data.qualificationType} onChange={handleChange} />
                    </div>
                    <div>
                      <Label htmlFor="qualificationYear">Year *</Label>
                      <Input name="qualificationYear" type="number" placeholder="YYYY" value={data.qualificationYear} onChange={handleChange} />
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
                    <h2 className="text-2xl font-display font-bold text-foreground mb-2">Experience & Registration</h2>
                    <p className="text-muted-foreground">Your regulatory standing and clinical experience.</p>
                  </div>
                  <div>
                    <Label htmlFor="experienceYears">Years of Post-graduate Experience *</Label>
                    <Input name="experienceYears" type="number" min="0" value={data.experienceYears} onChange={handleChange} />
                  </div>
                  <div>
                    <Label htmlFor="registrationStatus">UK Registration Status</Label>
                    <Select name="registrationStatus" value={data.registrationStatus} onChange={handleChange}>
                      <option value="not_registered">Not Registered</option>
                      <option value="in_process">In Process</option>
                      <option value="registered">Fully Registered</option>
                    </Select>
                  </div>
                  <label className="flex items-center space-x-3 p-4 border rounded-xl hover:bg-muted/50 cursor-pointer">
                    <input 
                      type="checkbox" 
                      name="licenceReady"
                      checked={data.licenceReady}
                      onChange={handleChange}
                      className="w-5 h-5 rounded border-primary/30 text-primary focus:ring-primary"
                    />
                    <div>
                      <div className="font-semibold text-foreground">Licence to Practice Ready</div>
                      <div className="text-sm text-muted-foreground">Do you have all documents required to apply for a licence?</div>
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
                    <h2 className="text-2xl font-display font-bold text-foreground mb-2">Immigration & Visa</h2>
                    <p className="text-muted-foreground">Required for determining sponsorship feasibility.</p>
                  </div>
                  <div>
                    <Label htmlFor="residencyStatus">Current Residency/Visa Status</Label>
                    <Input name="residencyStatus" placeholder="e.g. Citizen, Tier 2, Outside UK" value={data.residencyStatus} onChange={handleChange} />
                  </div>
                  <label className="flex items-center space-x-3 p-4 border rounded-xl hover:bg-muted/50 cursor-pointer">
                    <input 
                      type="checkbox" 
                      name="requiresSponsorship"
                      checked={data.requiresSponsorship}
                      onChange={handleChange}
                      className="w-5 h-5 rounded border-primary/30 text-primary focus:ring-primary"
                    />
                    <div>
                      <div className="font-semibold text-foreground">Requires Visa Sponsorship</div>
                      <div className="text-sm text-muted-foreground">Check this if you need an employer to sponsor your work visa.</div>
                    </div>
                  </label>
                  <div className="pt-4 flex justify-between">
                    <Button variant="outline" onClick={handlePrev} size="lg">
                      <ArrowLeft className="w-5 h-5 mr-2" /> Back
                    </Button>
                    <Button onClick={handleSubmit} disabled={upsertProfileMutation.isPending} size="lg" variant="accent">
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
    </div>
  );
}
