import { useState, useEffect, useRef } from "react";
import { useGetMyProfile, useUpsertMyProfile } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetMyProfileQueryKey } from "@workspace/api-client-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, Button, Input, Select, Label, PageTransition } from "@/components/ui-enhanced";
import { Save, UserCircle, Bell, Info } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type RegistrationStatus = "registered" | "not_registered" | "in_process";
type AlertFrequency = "daily" | "weekly" | "off";

const SUGGESTED_PROFESSIONS = [
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
  "Other",
];

const REGULATED_PROFESSION_KEYWORDS = [
  "doctor",
  "nurse",
  "midwife",
  "dentist",
  "pharmacist",
  "optometrist",
  "physiotherapist",
  "radiographer",
  "paramedic",
  "occupational therapist",
  "allied health",
  "clinical academic",
  "social worker",
];

function isUkRegulatedProfession(profession: string): boolean {
  const lower = profession.toLowerCase();
  return REGULATED_PROFESSION_KEYWORDS.some((kw) => lower.includes(kw));
}

const RESIDENCY_STATUS_OPTIONS = [
  "British / Irish Citizen",
  "Settled Status (ILR / ILE)",
  "Pre-Settled Status (EUSS)",
  "Skilled Worker Visa",
  "Health & Care Worker Visa",
  "Student Visa",
  "Graduate Visa",
  "Global Talent Visa",
  "Seasonal Worker Visa",
  "Other",
];

const UK_REGIONS = [
  "East of England",
  "East Midlands",
  "London",
  "North East",
  "North West",
  "South East",
  "South West",
  "West Midlands",
  "Yorkshire and the Humber",
  "Northern Ireland",
  "Scotland",
  "Wales",
  "National / Multiple Regions",
];

type ProfileFormData = {
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
  preferredRegion: string;
  alertFrequency: AlertFrequency;
};

function FieldHint({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs text-muted-foreground mt-1 flex items-start gap-1">
      <Info className="w-3 h-3 mt-0.5 shrink-0 opacity-50" />
      <span>{children}</span>
    </p>
  );
}

function TooltipLabel({
  label,
  tip,
  required,
}: {
  label: string;
  tip: string;
  required?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <span className="relative inline-flex items-center gap-1">
      <span>
        {label}
        {required ? " *" : ""}
      </span>
      <button
        type="button"
        className="text-muted-foreground hover:text-foreground transition-colors"
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        onFocus={() => setShow(true)}
        onBlur={() => setShow(false)}
        aria-label={`More information about ${label}`}
      >
        <Info className="w-3.5 h-3.5" />
      </button>
      {show && (
        <span className="absolute left-0 top-6 z-50 w-64 rounded-lg border border-border bg-popover p-2.5 text-xs font-normal text-popover-foreground shadow-lg">
          {tip}
        </span>
      )}
    </span>
  );
}

function ProfessionCombobox({
  value,
  onChange,
}: {
  value: string;
  onChange: (val: string) => void;
}) {
  const [inputValue, setInputValue] = useState(value);
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setInputValue(value);
  }, [value]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filtered =
    inputValue.trim() === ""
      ? SUGGESTED_PROFESSIONS
      : SUGGESTED_PROFESSIONS.filter((p) =>
          p.toLowerCase().includes(inputValue.toLowerCase())
        );

  return (
    <div ref={wrapperRef} className="relative">
      <Input
        value={inputValue}
        onChange={(e) => {
          setInputValue(e.target.value);
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
        placeholder="e.g. Doctor, Nurse, Engineer…"
        autoComplete="off"
      />
      {open && filtered.length > 0 && (
        <ul className="absolute z-50 mt-1 w-full rounded-lg border border-border bg-popover shadow-lg max-h-52 overflow-y-auto text-sm">
          {filtered.map((p) => (
            <li
              key={p}
              className={`px-3 py-2 cursor-pointer hover:bg-accent hover:text-accent-foreground ${
                p === inputValue ? "bg-accent/50 font-medium" : ""
              }`}
              onMouseDown={(e) => {
                e.preventDefault();
                setInputValue(p);
                onChange(p);
                setOpen(false);
              }}
            >
              {p}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

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
        alertFrequency:
          ((profile as { alertFrequency?: string | null }).alertFrequency as AlertFrequency) ??
          "daily",
      });
    }
  }, [profile]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    const checked = type === "checkbox" ? (e.target as HTMLInputElement).checked : undefined;
    setFormData((prev) => ({ ...prev, [name]: type === "checkbox" ? checked : value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.profession.trim()) {
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
          profession: formData.profession.trim(),
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

  const showRegistrationStatus = isUkRegulatedProfession(formData.profession);

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
            <p className="text-muted-foreground mt-2">
              Keep your professional details up to date so JOBSAGE can give you the most accurate
              eligibility assessments and job matches.
            </p>
          </div>
          <Button onClick={handleSubmit} disabled={upsertMutation.isPending}>
            <Save className="w-4 h-4 mr-2" />
            {upsertMutation.isPending ? "Saving…" : "Save Changes"}
          </Button>
        </header>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Professional Information */}
          <Card className="p-6">
            <h3 className="text-lg font-semibold mb-6 border-b pb-4">Professional Information</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <Label>Profession *</Label>
                <ProfessionCombobox
                  value={formData.profession}
                  onChange={(val) => setFormData((prev) => ({ ...prev, profession: val }))}
                />
                <FieldHint>
                  Start typing to search common professions, or enter yours if it's not listed.
                </FieldHint>
              </div>

              <div>
                <Label>Specialty</Label>
                <Input
                  name="specialty"
                  value={formData.specialty}
                  onChange={handleChange}
                  placeholder="e.g. Cardiology, Paediatrics, Civil Engineering"
                />
                <FieldHint>
                  Your area of focus within your main profession. Leave blank if not applicable.
                </FieldHint>
              </div>

              {showRegistrationStatus && (
                <div>
                  <Label>
                    <TooltipLabel
                      label="UK Registration Status"
                      required
                      tip="UK statutory registration (e.g. GMC for doctors, NMC for nurses, GDC for dentists) is required to practise in regulated roles. Select 'In Process' if you've begun the application."
                    />
                  </Label>
                  <Select
                    name="registrationStatus"
                    value={formData.registrationStatus}
                    onChange={handleChange}
                  >
                    <option value="not_registered">Not Yet Registered</option>
                    <option value="in_process">In Process</option>
                    <option value="registered">Fully Registered</option>
                  </Select>
                  <FieldHint>
                    Your current status with the UK statutory regulatory body for your profession
                    (e.g. GMC, NMC, GDC, GPhC, HCPC).
                  </FieldHint>
                </div>
              )}

              <div>
                <Label>Years of Experience *</Label>
                <Input
                  type="number"
                  name="experienceYears"
                  value={formData.experienceYears}
                  onChange={handleChange}
                  min="0"
                  placeholder="0"
                />
                <FieldHint>
                  Total years of post-qualification professional experience in your field.
                </FieldHint>
              </div>
            </div>
          </Card>

          {/* Qualifications */}
          <Card className="p-6">
            <h3 className="text-lg font-semibold mb-6 border-b pb-4">Qualifications</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <Label>Country of Qualification *</Label>
                <Input
                  name="qualificationCountry"
                  value={formData.qualificationCountry}
                  onChange={handleChange}
                  placeholder="e.g. India, Nigeria, Philippines"
                />
                <FieldHint>
                  The country where you obtained your primary professional qualification.
                </FieldHint>
              </div>

              <div>
                <Label>Degree / Qualification Type *</Label>
                <Input
                  name="qualificationType"
                  value={formData.qualificationType}
                  onChange={handleChange}
                  placeholder="e.g. MBBS, BSc Nursing, BEng"
                />
                <FieldHint>
                  The name of your degree or professional qualification as it appears on your
                  certificate.
                </FieldHint>
              </div>

              <div>
                <Label>Graduation Year *</Label>
                <Input
                  type="number"
                  name="qualificationYear"
                  value={formData.qualificationYear}
                  onChange={handleChange}
                  placeholder="e.g. 2018"
                  min="1950"
                  max={new Date().getFullYear()}
                />
                <FieldHint>The year you were awarded your qualification.</FieldHint>
              </div>

              <div className="flex items-start pt-8">
                <label className="flex items-start space-x-3 cursor-pointer">
                  <input
                    type="checkbox"
                    name="licenceReady"
                    checked={formData.licenceReady}
                    onChange={handleChange}
                    className="mt-0.5 w-5 h-5 rounded border-primary/30 text-primary focus:ring-primary"
                  />
                  <span>
                    <span className="font-medium text-foreground block">
                      Licence to Practise Ready
                    </span>
                    <span className="text-xs text-muted-foreground">
                      Tick if you hold a current, valid licence to practise in your home country.
                    </span>
                  </span>
                </label>
              </div>
            </div>
          </Card>

          {/* Immigration & Location */}
          <Card className="p-6">
            <h3 className="text-lg font-semibold mb-6 border-b pb-4">
              Immigration &amp; Location
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <Label>
                  <TooltipLabel
                    label="Residency / Visa Status"
                    required
                    tip="Your current UK immigration status determines which roles you're legally eligible for and whether you'll need an employer to sponsor your visa."
                  />
                </Label>
                <Select
                  name="residencyStatus"
                  value={formData.residencyStatus}
                  onChange={handleChange}
                >
                  <option value="">— Select your status —</option>
                  {RESIDENCY_STATUS_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </Select>
                <FieldHint>
                  Select the option that best describes your current right to work in the UK.
                </FieldHint>
              </div>

              <div className="flex items-start pt-8">
                <label className="flex items-start space-x-3 cursor-pointer">
                  <input
                    type="checkbox"
                    name="requiresSponsorship"
                    checked={formData.requiresSponsorship}
                    onChange={handleChange}
                    className="mt-0.5 w-5 h-5 rounded border-primary/30 text-primary focus:ring-primary"
                  />
                  <span>
                    <span className="font-medium text-foreground block">
                      Requires Visa Sponsorship
                    </span>
                    <span className="text-xs text-muted-foreground">
                      Tick if you need an employer to sponsor your UK work visa.
                    </span>
                  </span>
                </label>
              </div>

              <div className="col-span-1 md:col-span-2">
                <Label>Preferred UK Region</Label>
                <Select
                  name="preferredRegion"
                  value={formData.preferredRegion}
                  onChange={handleChange}
                >
                  <option value="">Any / Not specified</option>
                  {UK_REGIONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </Select>
                <FieldHint>
                  Employers with region-targeted job postings will find you more easily. Leave blank
                  if you're open to any UK location.
                </FieldHint>
              </div>
            </div>
          </Card>

          {/* Job Alert Preferences */}
          <Card className="p-6">
            <h3 className="text-lg font-semibold mb-2 border-b pb-4 flex items-center gap-2">
              <Bell className="w-5 h-5 text-primary" />
              Job Alert Preferences
            </h3>
            <p className="text-sm text-muted-foreground mb-4">
              Choose how often you'd like to receive personalised job alert emails listing new roles
              that match your eligibility status and profile.
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
              <p className="text-xs text-muted-foreground mt-3">
                You'll receive {formData.alertFrequency} emails listing new roles matching your
                eligibility status.
              </p>
            )}
            {formData.alertFrequency === "off" && (
              <p className="text-xs text-muted-foreground mt-3">
                You won't receive any job alert emails. You can turn these back on at any time.
              </p>
            )}
          </Card>
        </form>
      </PageTransition>
    </AppLayout>
  );
}
