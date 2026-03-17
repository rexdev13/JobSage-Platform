import { useState, useEffect } from "react";
import { useGetMyProfile, useUpsertMyProfile } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetMyProfileQueryKey } from "@workspace/api-client-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, Button, Input, Select, Label, PageTransition } from "@/components/ui-enhanced";
import { Save, UserCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type Profession = "doctor" | "nurse" | "allied_health_professional" | "clinical_academic";
type RegistrationStatus = "registered" | "not_registered" | "in_process";

type ProfileFormData = {
  profession: Profession | "";
  specialty: string;
  qualificationCountry: string;
  qualificationType: string;
  qualificationYear: string;
  experienceYears: string;
  registrationStatus: RegistrationStatus | "";
  licenceReady: boolean;
  residencyStatus: string;
  requiresSponsorship: boolean;
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
    registrationStatus: "",
    licenceReady: false,
    residencyStatus: "",
    requiresSponsorship: false,
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
        registrationStatus: profile.registrationStatus || "not_registered",
        licenceReady: profile.licenceReady || false,
        residencyStatus: profile.residencyStatus || "",
        requiresSponsorship: profile.requiresSponsorship || false,
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
    if (!formData.profession) return;
    try {
      await upsertMutation.mutateAsync({
        data: {
          profession: formData.profession,
          specialty: formData.specialty || null,
          qualificationCountry: formData.qualificationCountry || null,
          qualificationType: formData.qualificationType || null,
          qualificationYear: formData.qualificationYear ? parseInt(formData.qualificationYear) : null,
          experienceYears: formData.experienceYears ? parseInt(formData.experienceYears) : null,
          registrationStatus: formData.registrationStatus || null,
          licenceReady: formData.licenceReady,
          residencyStatus: formData.residencyStatus || null,
          requiresSponsorship: formData.requiresSponsorship,
        }
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
        variant: "destructive"
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
                <Label>Profession</Label>
                <Select name="profession" value={formData.profession || ""} onChange={handleChange}>
                  <option value="doctor">Doctor</option>
                  <option value="nurse">Nurse</option>
                  <option value="allied_health_professional">Allied Health Professional</option>
                  <option value="clinical_academic">Clinical Academic</option>
                </Select>
              </div>
              <div>
                <Label>Specialty</Label>
                <Input name="specialty" value={formData.specialty || ""} onChange={handleChange} />
              </div>
              <div>
                <Label>UK Registration Status</Label>
                <Select name="registrationStatus" value={formData.registrationStatus || ""} onChange={handleChange}>
                  <option value="not_registered">Not Registered</option>
                  <option value="in_process">In Process</option>
                  <option value="registered">Fully Registered</option>
                </Select>
              </div>
              <div>
                <Label>Years of Experience</Label>
                <Input type="number" name="experienceYears" value={formData.experienceYears || ""} onChange={handleChange} />
              </div>
            </div>
          </Card>

          <Card className="p-6">
            <h3 className="text-lg font-semibold mb-6 border-b pb-4">Qualifications</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <Label>Country of Qualification</Label>
                <Input name="qualificationCountry" value={formData.qualificationCountry || ""} onChange={handleChange} />
              </div>
              <div>
                <Label>Degree Type</Label>
                <Input name="qualificationType" value={formData.qualificationType || ""} onChange={handleChange} />
              </div>
              <div>
                <Label>Graduation Year</Label>
                <Input type="number" name="qualificationYear" value={formData.qualificationYear || ""} onChange={handleChange} />
              </div>
              <div className="flex items-center pt-8">
                <label className="flex items-center space-x-3 cursor-pointer">
                  <input 
                    type="checkbox" 
                    name="licenceReady"
                    checked={formData.licenceReady || false}
                    onChange={handleChange}
                    className="w-5 h-5 rounded border-primary/30 text-primary focus:ring-primary"
                  />
                  <span className="font-medium text-foreground">Licence to Practice Ready</span>
                </label>
              </div>
            </div>
          </Card>

          <Card className="p-6">
            <h3 className="text-lg font-semibold mb-6 border-b pb-4">Immigration & Visa</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <Label>Residency/Visa Status</Label>
                <Input name="residencyStatus" value={formData.residencyStatus || ""} onChange={handleChange} />
              </div>
              <div className="flex items-center pt-8">
                <label className="flex items-center space-x-3 cursor-pointer">
                  <input 
                    type="checkbox" 
                    name="requiresSponsorship"
                    checked={formData.requiresSponsorship || false}
                    onChange={handleChange}
                    className="w-5 h-5 rounded border-primary/30 text-primary focus:ring-primary"
                  />
                  <span className="font-medium text-foreground">Requires Visa Sponsorship</span>
                </label>
              </div>
            </div>
          </Card>
        </form>

      </PageTransition>
    </AppLayout>
  );
}
