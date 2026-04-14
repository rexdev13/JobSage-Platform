import { useState, useEffect } from "react";
import { useGetMyProfile, useUpsertMyProfile } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetMyProfileQueryKey } from "@workspace/api-client-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, Button, Input, Select, Label, PageTransition } from "@/components/ui-enhanced";
import { Save, UserCircle, Bell } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type Profession = "doctor" | "nurse" | "midwife" | "allied_health_professional" | "clinical_academic";
type RegistrationStatus = "registered" | "not_registered" | "in_process";

const UK_REGIONS = [
  "East of England", "East Midlands", "London", "North East", "North West",
  "South East", "South West", "West Midlands", "Yorkshire and the Humber",
  "Northern Ireland", "Scotland", "Wales", "National / Multiple Regions",
];

type AlertFrequency = "daily" | "weekly" | "off";

type ProfileFormData = {
  profession: Profession | "";
  specialty: string;
  qualificationCountry: string;
  qualificationType: string;
  qualificationYear: string;
  experienceYears: string;
  registrationStatus: RegistrationStatus;
  licenceReady: boolean;
  residencyStatus: string;
  requiresSponsorship: boolean;
  preferredRegion: string;
  alertFrequency: AlertFrequency;
};

export default function ProfilePage() {
  const { data: profile } = useGetMyProfile();
  const upsertMutation = useUpsertMyProfile();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [formData, setFormData] = useState<ProfileFormData>({
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
    preferredRegion: "",
    alertFrequency: "daily",
  });

  useEffect(() => {
    if (profile) {
      setFormData({
        profession: profile.profession || "",
        specialty: profile.specialty || "",
        qualificationCountry: profile.qualificationCountry || "",
        qualificationType: profile.qualificationType || "",
        qualificationYear: profile.qualificationYear?.toString() || "",
        experienceYears: profile.experienceYears?.toString() || "",
        registrationStatus: (profile.registrationStatus as RegistrationStatus) || "not_registered",
        licenceReady: profile.licenceReady || false,
        residencyStatus: profile.residencyStatus || "",
        requiresSponsorship: profile.requiresSponsorship || false,
        preferredRegion: (profile as { preferredRegion?: string | null }).preferredRegion ?? "",
        alertFrequency: ((profile as { alertFrequency?: string | null }).alertFrequency as AlertFrequency) ?? "daily",
      });
    }
  }, [profile]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    const checked = type === "checkbox" ? (e.target as HTMLInputElement).checked : undefined;
    setFormData(prev => ({ ...prev, [name]: type === "checkbox" ? checked : value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.profession) {
      toast({ title: "Validation Error", description: "Profession is required", variant: "destructive" });
      return;
    }
    if (!formData.qualificationCountry || !formData.qualificationType || !formData.qualificationYear) {
      toast({ title: "Validation Error", description: "All qualification fields are required", variant: "destructive" });
      return;
    }
    if (!formData.experienceYears) {
      toast({ title: "Validation Error", description: "Years of experience is required", variant: "destructive" });
      return;
    }
    if (!formData.residencyStatus) {
      toast({ title: "Validation Error", description: "Residency/visa status is required", variant: "destructive" });
      return;
    }

    try {
      await upsertMutation.mutateAsync({
        data: {
          profession: formData.profession,
          specialty: formData.specialty,
          qualificationCountry: formData.qualificationCountry,
          qualificationType: formData.qualificationType,
          qualificationYear: parseInt(formData.qualificationYear, 10),
          experienceYears: parseInt(formData.experienceYears, 10),
          registrationStatus: formData.registrationStatus,
          licenceReady: formData.licenceReady,
          residencyStatus: formData.residencyStatus,
          requiresSponsorship: formData.requiresSponsorship,
          preferredRegion: formData.preferredRegion || undefined,
          alertFrequency: formData.alertFrequency,
        },
      });
      queryClient.invalidateQueries({ queryKey: getGetMyProfileQueryKey() });
      toast({
        title: "Profile Updated",
        description: "Your professional details have been saved successfully.",
      });
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to update profile",
        variant: "destructive",
      });
    }
  };

  if (!profile) return null;

  return (
    <AppLayout>
      <PageTransition>
        <header className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-display font-bold text-foreground flex items-center">
              <UserCircle className="w-8 h-8 mr-3 text-primary" />
              My Profile
            </h1>
            <p className="text-muted-foreground mt-2">Manage your professional details.</p>
          </div>
          <Button onClick={handleSubmit} disabled={upsertMutation.isPending}>
            <Save className="w-4 h-4 mr-2" />
            {upsertMutation.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </header>

        <form onSubmit={handleSubmit} className="space-y-6">
          <Card className="p-6">
            <h3 className="text-lg font-semibold mb-6 border-b pb-4">Professional Information</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <Label>Profession *</Label>
                <Select name="profession" value={formData.profession} onChange={handleChange}>
                  <option value="doctor">Doctor</option>
                  <option value="nurse">Nurse</option>
                  <option value="midwife">Midwife</option>
                  <option value="allied_health_professional">Allied Health Professional</option>
                  <option value="clinical_academic">Clinical Academic</option>
                </Select>
              </div>
              <div>
                <Label>Specialty</Label>
                <Input name="specialty" value={formData.specialty} onChange={handleChange} placeholder="e.g. Cardiology, Pediatrics" />
              </div>
              <div>
                <Label>UK Registration Status *</Label>
                <Select name="registrationStatus" value={formData.registrationStatus} onChange={handleChange}>
                  <option value="not_registered">Not Registered</option>
                  <option value="in_process">In Process</option>
                  <option value="registered">Fully Registered</option>
                </Select>
              </div>
              <div>
                <Label>Years of Experience *</Label>
                <Input type="number" name="experienceYears" value={formData.experienceYears} onChange={handleChange} min="0" required />
              </div>
            </div>
          </Card>

          <Card className="p-6">
            <h3 className="text-lg font-semibold mb-6 border-b pb-4">Qualifications</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <Label>Country of Qualification *</Label>
                <Input name="qualificationCountry" value={formData.qualificationCountry} onChange={handleChange} required />
              </div>
              <div>
                <Label>Degree Type *</Label>
                <Input name="qualificationType" value={formData.qualificationType} onChange={handleChange} placeholder="e.g. MBBS, BSc" required />
              </div>
              <div>
                <Label>Graduation Year *</Label>
                <Input type="number" name="qualificationYear" value={formData.qualificationYear} onChange={handleChange} required />
              </div>
              <div className="flex items-center pt-8">
                <label className="flex items-center space-x-3 cursor-pointer">
                  <input
                    type="checkbox"
                    name="licenceReady"
                    checked={formData.licenceReady}
                    onChange={handleChange}
                    className="w-5 h-5 rounded border-primary/30 text-primary focus:ring-primary"
                  />
                  <span className="font-medium text-foreground">Licence to Practice Ready</span>
                </label>
              </div>
            </div>
          </Card>

          <Card className="p-6">
            <h3 className="text-lg font-semibold mb-6 border-b pb-4">Immigration & Location</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <Label>Residency/Visa Status *</Label>
                <Input name="residencyStatus" value={formData.residencyStatus} onChange={handleChange} placeholder="e.g. UK Citizen, Skilled Worker Visa" required />
              </div>
              <div className="flex items-center pt-8">
                <label className="flex items-center space-x-3 cursor-pointer">
                  <input
                    type="checkbox"
                    name="requiresSponsorship"
                    checked={formData.requiresSponsorship}
                    onChange={handleChange}
                    className="w-5 h-5 rounded border-primary/30 text-primary focus:ring-primary"
                  />
                  <span className="font-medium text-foreground">Requires Visa Sponsorship</span>
                </label>
              </div>
              <div className="col-span-1 md:col-span-2">
                <Label>Preferred UK Region</Label>
                <Select name="preferredRegion" value={formData.preferredRegion} onChange={handleChange}>
                  <option value="">Any / Not specified</option>
                  {UK_REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                </Select>
                <p className="text-xs text-muted-foreground mt-1">Helps employers with region-targeted job postings find you more easily.</p>
              </div>
            </div>
          </Card>

          <Card className="p-6">
            <h3 className="text-lg font-semibold mb-2 border-b pb-4 flex items-center gap-2">
              <Bell className="w-5 h-5 text-primary" />
              Job Alert Preferences
            </h3>
            <p className="text-sm text-muted-foreground mb-4">
              Choose how often you'd like to receive personalised job alert emails with new roles matching your profile.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {(["daily", "weekly", "off"] as AlertFrequency[]).map((freq) => (
                <button
                  key={freq}
                  type="button"
                  onClick={() => setFormData((prev) => ({ ...prev, alertFrequency: freq }))}
                  className={`flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 text-sm font-semibold transition-all ${
                    formData.alertFrequency === freq
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:border-primary/30 hover:bg-muted/40"
                  }`}
                >
                  <Bell className={`w-4 h-4 ${freq === "off" ? "opacity-40" : ""}`} />
                  {freq === "daily" ? "Daily" : freq === "weekly" ? "Weekly" : "Off"}
                </button>
              ))}
            </div>
            {formData.alertFrequency !== "off" && (
              <p className="text-xs text-muted-foreground mt-2">
                You'll receive {formData.alertFrequency} emails listing new roles matching your eligibility status.
              </p>
            )}
            {formData.alertFrequency === "off" && (
              <p className="text-xs text-muted-foreground mt-2">
                You won't receive any job alert emails. You can turn these back on at any time.
              </p>
            )}
          </Card>
        </form>

      </PageTransition>
    </AppLayout>
  );
}
