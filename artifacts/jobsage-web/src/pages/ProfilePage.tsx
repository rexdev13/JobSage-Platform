import { useState, useEffect, useRef, useCallback } from "react";
import {
  useGetMyProfile,
  useUpsertMyProfile,
  useRequestUploadUrl,
  useGetJourneyStatus,
  getGetJourneyStatusQueryKey,
  useListCareerProfiles,
  useCreateCareerProfile,
  useUpdateCareerProfile,
  useDeleteCareerProfile,
  useActivateCareerProfile,
  useGenerateProfileCv,
  useListMyDocuments,
  type CareerProfile,
  getCareerProfilesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetMyProfileQueryKey, getGetMyMatchesQueryKey, getListMatchedRolesQueryKey } from "@workspace/api-client-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, Button, Input, Select, Label, PageTransition, cn } from "@/components/ui-enhanced";
import { Save, UserCircle, Bell, Info, Camera, Loader2, CheckCircle2, AlertCircle, AlertTriangle, Star, Trophy, Files, ShieldCheck, Send, MessageSquare, UserCheck, Plus, Trash2, Sparkles, Download, BadgeCheck, FolderOpen, Mail, Copy, X, ChevronRight } from "lucide-react";
import { Link } from "wouter";
import { PROFESSION_OPTIONS } from "@workspace/api-zod/profession-catalog";
import { useToast } from "@/hooks/use-toast";
import {
  CAREER_PROFILE_MAKER_DESCRIPTION,
  CAREER_PROFILE_MAKER_LABEL,
  CAREER_PROFILE_MAKER_REVIEW_WARNING,
} from "@/lib/careerProfileMakerCopy";
import {
  getProfileCompletenessTarget,
  getProfileCompletenessSectionLabel,
  getRemainingCompletenessPct,
} from "@/lib/profileCompletenessChecklist";

type RegistrationStatus = "registered" | "not_registered" | "in_process";
type AlertFrequency = "daily" | "weekly" | "off";
type DbsClearanceLevel = "unknown" | "none" | "basic" | "standard" | "enhanced";
type SafeguardingTrainingLevel = "unknown" | "none" | "level_1" | "level_2";

const FALLBACK_PROFESSIONS = PROFESSION_OPTIONS;

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
  const lower = profession.toLowerCase().replace(/_/g, " ").trim();
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
  dbsClearanceLevel: DbsClearanceLevel;
  safeguardingTrainingLevel: SafeguardingTrainingLevel;
  residencyStatus: string;
  residencyStatusOther: string;
  requiresSponsorship: boolean;
  preferredRegion: string[];
  alertFrequency: AlertFrequency;
  preferredStartDate: string;
  languages: string;
  additionalNotes: string;
  phone: string;
  streetAddress: string;
  city: string;
  postcode: string;
  country: string;
  profilePhotoKey: string;
};

function FieldHint({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs text-muted-foreground mt-1 flex items-start gap-1">
      <Info className="w-3 h-3 mt-0.5 shrink-0 opacity-50" />
      <span>{children}</span>
    </p>
  );
}

function NotFoundBadge() {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 ml-2">
      <AlertCircle className="w-3 h-3" />
      Not found
    </span>
  );
}

function JobsageEmailBanner({ email }: { email: string }) {
  const { toast } = useToast();
  const handleCopy = () => {
    navigator.clipboard.writeText(email).then(() => {
      toast({ title: "Copied!", description: "Your JOBSAGE address has been copied to the clipboard." });
    });
  };
  return (
    <div className="mt-4 rounded-xl border border-primary/20 bg-primary/5 px-5 py-4 flex items-center gap-3">
      <Mail className="w-5 h-5 text-primary shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground">Your JOBSAGE communication address</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          This alias is used in place of your personal email when CVs are forwarded to employers. Employers will contact you through JOBSAGE.
        </p>
        <p className="text-sm font-mono text-primary mt-1.5 truncate">{email}</p>
      </div>
      <button
        type="button"
        onClick={handleCopy}
        className="shrink-0 p-2 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
        aria-label="Copy JOBSAGE address"
      >
        <Copy className="w-4 h-4" />
      </button>
    </div>
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

export default function ProfilePage() {
  const { data: profile } = useGetMyProfile();
  const upsertMutation = useUpsertMyProfile();
  const queryClient = useQueryClient();
  const { data: journeyData } = useGetJourneyStatus({
    query: { queryKey: getGetJourneyStatusQueryKey(), staleTime: 60_000 },
  });
  const { toast } = useToast();

  const professionSuggestions = FALLBACK_PROFESSIONS;

  const [formData, setFormData] = useState<ProfileFormData>({
    profession: "",
    specialty: "",
    qualificationCountry: "",
    qualificationType: "",
    qualificationYear: "",
    experienceYears: "",
    registrationStatus: "not_registered",
    licenceReady: false,
    dbsClearanceLevel: "unknown",
    safeguardingTrainingLevel: "unknown",
    residencyStatus: "",
    residencyStatusOther: "",
    requiresSponsorship: false,
    preferredRegion: [],
    alertFrequency: "weekly",
    preferredStartDate: "",
    languages: "",
    additionalNotes: "",
    phone: "",
    streetAddress: "",
    city: "",
    postcode: "",
    country: "United Kingdom",
    profilePhotoKey: "",
  });

  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [isPhotoUploading, setIsPhotoUploading] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const requestUploadUrlMutation = useRequestUploadUrl();

  const [autoSaveStatus, setAutoSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const formDataRef = useRef(formData);
  useEffect(() => { formDataRef.current = formData; }, [formData]);

  useEffect(() => {
    if (profile) {
      const storedResidency = profile.residencyStatus || "";
      const isOther =
        storedResidency !== "" &&
        !RESIDENCY_STATUS_OPTIONS.filter((o) => o !== "Other").includes(storedResidency);

      const p = profile as unknown as Record<string, unknown>;
      const rawLanguages = p.languages;
      const languagesStr = Array.isArray(rawLanguages)
        ? (rawLanguages as string[]).join(", ")
        : (rawLanguages as string) ?? "";

      setFormData({
        profession: profile.profession || "",
        specialty: profile.specialty || "",
        qualificationCountry: profile.qualificationCountry || "",
        qualificationType: profile.qualificationType || "",
        qualificationYear: profile.qualificationYear?.toString() || "",
        experienceYears: profile.experienceYears?.toString() || "",
        registrationStatus: (profile.registrationStatus as RegistrationStatus) || "not_registered",
        licenceReady: profile.licenceReady || false,
        dbsClearanceLevel: (profile.dbsClearanceLevel as DbsClearanceLevel) ?? "unknown",
        safeguardingTrainingLevel: (profile.safeguardingTrainingLevel as SafeguardingTrainingLevel) ?? "unknown",
        residencyStatus: isOther ? "Other" : storedResidency,
        residencyStatusOther: isOther ? storedResidency : "",
        requiresSponsorship: profile.requiresSponsorship || false,
        preferredRegion: Array.isArray(p.preferredRegion)
          ? (p.preferredRegion as string[])
          : (p.preferredRegion ? [(p.preferredRegion as string)] : []),
        alertFrequency: p.alertFrequency === "off" ? "off" : "weekly",
        preferredStartDate: (p.preferredStartDate as string) ?? "",
        languages: languagesStr,
        additionalNotes: (p.additionalNotes as string) ?? "",
        phone: (p.phone as string) ?? "",
        streetAddress: (p.streetAddress as string) ?? "",
        city: (p.city as string) ?? "",
        postcode: (p.postcode as string) ?? "",
        country: (p.country as string) || "United Kingdom",
        profilePhotoKey: (p.profilePhotoKey as string) ?? "",
      });
    }
  }, [profile]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    const checked = type === "checkbox" ? (e.target as HTMLInputElement).checked : undefined;
    setFormData((prev) => ({ ...prev, [name]: type === "checkbox" ? checked : value }));
  };

  const buildPayload = useCallback(() => {
    const fd = formDataRef.current;
    const effectiveResidency =
      fd.residencyStatus === "Other"
        ? fd.residencyStatusOther.trim() || "Other"
        : fd.residencyStatus;
    return {
      profession: fd.profession.trim(),
      specialty: fd.specialty.trim(),
      qualificationCountry: fd.qualificationCountry.trim(),
      qualificationType: fd.qualificationType.trim(),
      qualificationYear: parseInt(fd.qualificationYear, 10) || 0,
      experienceYears: parseInt(fd.experienceYears, 10) || 0,
      registrationStatus: fd.registrationStatus,
      licenceReady: fd.licenceReady,
      dbsClearanceLevel: fd.dbsClearanceLevel,
      safeguardingTrainingLevel: fd.safeguardingTrainingLevel,
      residencyStatus: effectiveResidency,
      requiresSponsorship: fd.requiresSponsorship,
      preferredRegion: fd.preferredRegion,
      alertFrequency: fd.alertFrequency,
      preferredStartDate: fd.preferredStartDate || undefined,
      profilePhotoKey: fd.profilePhotoKey || undefined,
      languages: fd.languages
        ? fd.languages.split(",").map((l) => l.trim()).filter(Boolean)
        : undefined,
      additionalNotes: fd.additionalNotes || undefined,
      phone: fd.phone.trim() || undefined,
      streetAddress: fd.streetAddress.trim() || undefined,
      city: fd.city.trim() || undefined,
      postcode: fd.postcode.trim() || undefined,
      country: fd.country.trim() || undefined,
    };
  }, []);

  const doAutoSave = useCallback(async () => {
    const fd = formDataRef.current;
    if (
      !fd.profession.trim() ||
      !fd.residencyStatus ||
      !fd.qualificationCountry.trim() ||
      !fd.qualificationType.trim() ||
      !fd.qualificationYear ||
      !fd.experienceYears
    ) return;
    setAutoSaveStatus("saving");
    try {
      await upsertMutation.mutateAsync({ data: buildPayload() });
      queryClient.invalidateQueries({ queryKey: getGetMyProfileQueryKey() });
      queryClient.invalidateQueries({ queryKey: getCareerProfilesQueryKey() });
      try { localStorage.setItem("jobsage_ai_profession", fd.profession); } catch { /* ignore quota */ }
      setAutoSaveStatus("saved");
      setTimeout(() => setAutoSaveStatus("idle"), 2500);
    } catch {
      setAutoSaveStatus("idle");
    }
  }, [upsertMutation, queryClient, buildPayload]);

  const scheduleAutoSave = useCallback((delayMs: number) => {
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      autoSaveTimerRef.current = null;
      void doAutoSave();
    }, delayMs);
  }, [doAutoSave]);

  const handleBlur = useCallback(() => {
    scheduleAutoSave(800);
  }, [scheduleAutoSave]);

  const handlePhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!["image/jpeg", "image/png"].includes(file.type)) {
      toast({ title: "Invalid file type", description: "Please upload a JPEG or PNG image.", variant: "destructive" });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "File too large", description: "Profile photo must be under 5 MB.", variant: "destructive" });
      return;
    }
    const localUrl = URL.createObjectURL(file);
    setPhotoPreviewUrl(localUrl);
    setIsPhotoUploading(true);
    try {
      const { uploadURL, storageKey } = await requestUploadUrlMutation.mutateAsync({
        data: { name: file.name, size: file.size, contentType: file.type },
      });
      await fetch(uploadURL, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
      setFormData((prev) => ({ ...prev, profilePhotoKey: storageKey }));
      toast({ title: "Photo ready", description: "Photo uploaded — auto-saving…" });
      setTimeout(() => doAutoSave(), 200);
    } catch {
      toast({ title: "Photo upload failed", description: "Could not upload photo. Please try again.", variant: "destructive" });
      setPhotoPreviewUrl(null);
    } finally {
      setIsPhotoUploading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.profession.trim()) {
      toast({ title: "Validation Error", description: "Profession is required", variant: "destructive" });
      return;
    }
    if (!formData.qualificationCountry.trim() || !formData.qualificationType.trim() || !formData.qualificationYear) {
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
    if (!formData.phone.trim() || !formData.streetAddress.trim() || !formData.city.trim() || !formData.postcode.trim() || !formData.country.trim()) {
      toast({ title: "Validation Error", description: "Phone and complete contact address are required for Smart Apply.", variant: "destructive" });
      return;
    }
    if (formData.residencyStatus === "Other" && !formData.residencyStatusOther.trim()) {
      toast({ title: "Validation Error", description: "Please describe your visa / residency status", variant: "destructive" });
      return;
    }

    try {
      await upsertMutation.mutateAsync({ data: buildPayload() });
      queryClient.invalidateQueries({ queryKey: getGetMyProfileQueryKey() });
      // Persist the active profession so SmartApplyAssistant can detect profession changes
      // and clear stale conversation context.
      try { localStorage.setItem("jobsage_ai_profession", formData.profession); } catch { /* ignore quota */ }
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

  const p = profile as unknown as Record<string, unknown>;
  const storedPhotoKey = p?.profilePhotoKey as string | null | undefined;
  const storedPhotoUrl = storedPhotoKey
    ? `/api/storage/objects/${storedPhotoKey.replace(/^\/objects\//, "")}`
    : null;
  const displayPhotoUrl = photoPreviewUrl ?? storedPhotoUrl;
  const completionPct = typeof p?.completionPct === "number" ? (p.completionPct as number) : 0;
  const missingFields = Array.isArray(p?.missingFields) ? (p.missingFields as string[]) : [];
  const remainingCompletenessPct = getRemainingCompletenessPct(completionPct);

  function focusCompletenessTarget(targetId: string) {
    const target = document.getElementById(targetId);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    target.focus({ preventScroll: true });
  }

  if (!profile) return null;

  const effectiveResidencyStatus =
    formData.residencyStatus === "Other"
      ? formData.residencyStatusOther.trim() || "Other"
      : formData.residencyStatus;
  void effectiveResidencyStatus;

  return (
    <AppLayout>
      <PageTransition>
        <header className="mb-6">
          <div className="flex items-start justify-between gap-4 mb-6">
            <div className="flex items-center gap-5">
              <div id="profile-photo-section" className="relative shrink-0">
                <div className="w-20 h-20 rounded-full bg-primary/10 border-2 border-primary/20 flex items-center justify-center overflow-hidden">
                  {displayPhotoUrl ? (
                    <img src={displayPhotoUrl} alt="Profile" className="w-full h-full object-cover" />
                  ) : (
                    <UserCircle className="w-10 h-10 text-primary/40" />
                  )}
                  {isPhotoUploading && (
                    <div className="absolute inset-0 bg-black/40 rounded-full flex items-center justify-center">
                      <Loader2 className="w-5 h-5 text-white animate-spin" />
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  id="profile-photo-upload"
                  onClick={() => photoInputRef.current?.click()}
                  disabled={isPhotoUploading}
                  className="absolute -bottom-1 -right-1 w-7 h-7 bg-primary text-primary-foreground rounded-full flex items-center justify-center shadow-md hover:bg-primary/90 transition-colors disabled:opacity-50"
                  aria-label="Upload profile photo"
                >
                  <Camera className="w-3.5 h-3.5" />
                </button>
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/jpeg,image/png"
                  className="hidden"
                  onChange={handlePhotoSelect}
                />
                {!displayPhotoUrl && (
                  <p className="text-[10px] text-center text-muted-foreground mt-2 max-w-[5rem] leading-tight">
                    Required for 100%
                  </p>
                )}
              </div>
              <div>
                <h1 className="text-3xl font-display font-bold text-foreground">Personal & Professional Profile</h1>
                <p className="text-muted-foreground mt-1 text-sm">
                  Review and complete your details — fields are saved automatically as you fill them in.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              {autoSaveStatus === "saving" && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" /> Saving…
                </span>
              )}
              {autoSaveStatus === "saved" && (
                <span className="text-xs text-emerald-600 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" /> Saved
                </span>
              )}
              <Button onClick={handleSubmit} disabled={upsertMutation.isPending} variant="outline" size="sm">
                <Save className="w-4 h-4 mr-2" />
                {upsertMutation.isPending ? "Saving…" : "Save Changes"}
              </Button>
            </div>
          </div>

          {/* Profile complete banner */}
          {completionPct === 100 && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4 flex items-center gap-3 mb-4">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-emerald-800">Profile complete!</p>
                <p className="text-xs text-emerald-700 mt-0.5">
                  Your profile is 100% complete. You can now Smart Apply to any matched role.
                </p>
              </div>
            </div>
          )}

          {/* Profile completeness bar */}
          <div className="rounded-xl border border-border bg-muted/30 px-5 py-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold text-foreground flex items-center gap-2">
                {completionPct === 100 ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                ) : (
                  <span className="w-4 h-4 rounded-full border-2 border-primary/40 inline-flex" />
                )}
                Profile Completeness
              </span>
              <span className={`text-sm font-bold tabular-nums ${completionPct === 100 ? "text-emerald-600" : "text-primary"}`}>
                {completionPct}%
              </span>
            </div>
            <div className="w-full h-2 bg-border rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-700 ${completionPct === 100 ? "bg-emerald-500" : "bg-primary"}`}
                style={{ width: `${completionPct}%` }}
              />
            </div>
            {completionPct < 100 && (
              <div
                aria-live="polite"
                className="mt-4 overflow-hidden rounded-xl border border-amber-200 bg-amber-50/80 dark:border-amber-800/50 dark:bg-amber-950/20"
              >
                <div className="flex items-start gap-3 border-b border-amber-200/70 px-4 py-3.5 dark:border-amber-800/40">
                  <div className="mt-0.5 rounded-full bg-amber-100 p-1.5 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300">
                    <AlertTriangle className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-amber-900 dark:text-amber-200">
                      What&apos;s blocking 100%?
                    </p>
                    <p className="mt-0.5 text-xs leading-relaxed text-amber-800/85 dark:text-amber-300/85">
                      {missingFields.length > 0
                        ? `${missingFields.length} ${missingFields.length === 1 ? "item is" : "items are"} still incomplete. Use “Fix this” to jump straight to each one.`
                        : "We couldn't load the missing-field list. Please reload the page and try again."}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full bg-white/70 px-2 py-1 text-[11px] font-bold tabular-nums text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                    {remainingCompletenessPct}% left
                  </span>
                </div>

                {missingFields.length > 0 && (
                  <div className="space-y-2 px-3 py-3">
                    {missingFields.map((label, index) => {
                      const targetId = getProfileCompletenessTarget(label);
                      return (
                        <div
                          key={label}
                          className="flex items-center justify-between gap-3 rounded-lg border border-amber-200/80 bg-background px-3 py-2.5 shadow-sm dark:border-amber-800/40"
                        >
                          <div className="flex min-w-0 items-center gap-2.5">
                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-100 text-xs font-bold text-amber-800 dark:bg-amber-900/50 dark:text-amber-200">
                              {index + 1}
                            </span>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-foreground">{label}</p>
                              <p className="text-[11px] text-muted-foreground">
                                {getProfileCompletenessSectionLabel(label)}
                              </p>
                            </div>
                          </div>
                          {targetId ? (
                            <a
                              href={`#${targetId}`}
                              onClick={(event) => {
                                event.preventDefault();
                                focusCompletenessTarget(targetId);
                              }}
                              className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1.5 text-xs font-bold text-primary transition-colors hover:bg-primary/10 hover:underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                            >
                              Fix this
                              <ChevronRight className="h-3.5 w-3.5" />
                            </a>
                          ) : (
                            <span className="shrink-0 text-xs font-medium text-muted-foreground">Review profile</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* JOBSAGE communication alias */}
          {!!p?.jobsageEmail && (
            <JobsageEmailBanner email={p.jobsageEmail as string} />
          )}
        </header>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Professional Information */}
          <Card id="profile-professional-section" className="p-6 scroll-mt-6">
            <h3 className="text-lg font-semibold mb-6 border-b pb-4">Professional Information</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <Label className="flex items-center gap-1">
                  Profession *
                  {!formData.profession && <NotFoundBadge />}
                </Label>
                <Select
                  id="profile-field-profession"
                  name="profession"
                  value={formData.profession}
                  onChange={(event) => setFormData((prev) => ({ ...prev, profession: event.target.value }))}
                  onBlur={handleBlur}
                  required
                >
                  <option value="" disabled>Select profession...</option>
                  {formData.profession && !professionSuggestions.includes(formData.profession) && (
                    <option value={formData.profession} disabled>
                      {formData.profession} (choose a supported profession)
                    </option>
                  )}
                  {professionSuggestions.map((profession) => (
                    <option key={profession} value={profession}>{profession}</option>
                  ))}
                </Select>
                <FieldHint>
                  Choose from the same profession catalogue used for vacancy matching.
                </FieldHint>
              </div>

              <div>
                <Label>
                  Specialty
                </Label>
                <Input
                  id="profile-field-specialty"
                  name="specialty"
                  value={formData.specialty}
                  onChange={handleChange}
                  onBlur={handleBlur}
                  placeholder="e.g. Cardiology, Paediatrics, Civil Engineering"
                />
                {!formData.specialty && <NotFoundBadge />}
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
                    id="profile-field-registrationStatus"
                    name="registrationStatus"
                    value={formData.registrationStatus}
                    onChange={handleChange}
                    onBlur={handleBlur}
                  >
                    <option value="not_registered">Not Yet Registered</option>
                    <option value="in_process">In Process</option>
                    <option value="registered">Fully Registered</option>
                  </Select>
                  <FieldHint>
                    Your current status with the UK regulatory body for your profession (GMC, NMC,
                    GDC, GPhC, HCPC, etc.).
                  </FieldHint>
                </div>
              )}

              <div>
                <Label className="flex items-center gap-1">
                  Years of Experience *
                  {!formData.experienceYears && <NotFoundBadge />}
                </Label>
                <Input
                  id="profile-field-experienceYears"
                  type="number"
                  name="experienceYears"
                  value={formData.experienceYears}
                  onChange={handleChange}
                  onBlur={handleBlur}
                  min="0"
                  placeholder="0"
                  required
                />
                <FieldHint>
                  Total years of post-qualification professional experience in your field.
                </FieldHint>
              </div>
            </div>
          </Card>

          {/* Qualifications */}
          <Card id="profile-qualifications-section" className="p-6 scroll-mt-6">
            <h3 className="text-lg font-semibold mb-6 border-b pb-4">Qualifications</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <Label className="flex items-center gap-1">
                  Country of Qualification *
                  {!formData.qualificationCountry && <NotFoundBadge />}
                </Label>
                <Input
                  id="profile-field-qualificationCountry"
                  name="qualificationCountry"
                  value={formData.qualificationCountry}
                  onChange={handleChange}
                  onBlur={handleBlur}
                  placeholder="e.g. India, Nigeria, Philippines"
                  required
                />
                <FieldHint>
                  The country where you obtained your primary professional qualification.
                </FieldHint>
              </div>

              <div>
                <Label className="flex items-center gap-1">
                  Degree / Qualification Type *
                  {!formData.qualificationType && <NotFoundBadge />}
                </Label>
                <Input
                  id="profile-field-qualificationType"
                  name="qualificationType"
                  value={formData.qualificationType}
                  onChange={handleChange}
                  onBlur={handleBlur}
                  placeholder="e.g. MBBS, BSc Nursing, BEng"
                  required
                />
                <FieldHint>
                  The name of your degree or professional qualification as it appears on your
                  certificate.
                </FieldHint>
              </div>

              <div>
                <Label className="flex items-center gap-1">
                  Graduation Year *
                  {!formData.qualificationYear && <NotFoundBadge />}
                </Label>
                <Input
                  id="profile-field-qualificationYear"
                  type="number"
                  name="qualificationYear"
                  value={formData.qualificationYear}
                  onChange={handleChange}
                  onBlur={handleBlur}
                  placeholder="e.g. 2018"
                  min="1950"
                  max={new Date().getFullYear()}
                  required
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

          {/* Safeguarding */}
          <Card className="p-6">
            <h3 className="text-lg font-semibold mb-2 border-b pb-4 flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-primary" />
              DBS &amp; Safeguarding
            </h3>
            <p className="text-sm text-muted-foreground mb-5">
              Share the levels you already hold so JOBSAGE can compare them with stated job requirements.
              This is not a legal DBS decision.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <Label>DBS clearance level</Label>
                <Select name="dbsClearanceLevel" value={formData.dbsClearanceLevel} onChange={handleChange} onBlur={handleBlur}>
                  <option value="unknown">I don&apos;t know / not recorded</option>
                  <option value="none">None</option>
                  <option value="basic">Basic DBS</option>
                  <option value="standard">Standard DBS</option>
                  <option value="enhanced">Enhanced DBS</option>
                </Select>
              </div>
              <div>
                <Label>Safeguarding training level</Label>
                <Select name="safeguardingTrainingLevel" value={formData.safeguardingTrainingLevel} onChange={handleChange} onBlur={handleBlur}>
                  <option value="unknown">I don&apos;t know / not recorded</option>
                  <option value="none">None</option>
                  <option value="level_1">Level 1</option>
                  <option value="level_2">Level 2</option>
                </Select>
              </div>
            </div>
          </Card>

          {/* Immigration & Location */}
          <Card id="profile-immigration-section" className="p-6 scroll-mt-6">
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
                  {!formData.residencyStatus && <NotFoundBadge />}
                </Label>
                <Select
                  id="profile-field-residencyStatus"
                  name="residencyStatus"
                  value={formData.residencyStatus}
                  onChange={handleChange}
                  onBlur={handleBlur}
                  required
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

              {formData.residencyStatus === "Other" && (
                <div>
                  <Label>Please describe your visa / residency status *</Label>
                  <Input
                    name="residencyStatusOther"
                    value={formData.residencyStatusOther}
                    onChange={handleChange}
                    onBlur={handleBlur}
                    placeholder="e.g. Spouse / Family Visa, Tier 1 Innovator…"
                    required
                  />
                  <FieldHint>
                    Describe your current UK immigration status so JOBSAGE can assess your
                    eligibility accurately.
                  </FieldHint>
                </div>
              )}

              <div className="flex items-start pt-2 md:pt-8">
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
                <Label>
                  Preferred UK Region(s)
                </Label>
                <div id="profile-field-preferredRegion" tabIndex={-1} className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 mt-2 scroll-mt-6">
                  {UK_REGIONS.map((r) => (
                    <label key={r} className="flex items-center gap-2 cursor-pointer group">
                      <input
                        type="checkbox"
                        checked={formData.preferredRegion.includes(r)}
                        onChange={() => {
                          const newRegions = formData.preferredRegion.includes(r)
                            ? formData.preferredRegion.filter(x => x !== r)
                            : [...formData.preferredRegion, r];
                          setFormData(prev => ({ ...prev, preferredRegion: newRegions }));
                          scheduleAutoSave(300);
                        }}
                        className="w-4 h-4 rounded border-input accent-primary"
                      />
                      <span className="text-sm text-foreground group-hover:text-primary transition-colors">{r}</span>
                    </label>
                  ))}
                </div>
                {formData.preferredRegion.length === 0 && <NotFoundBadge />}
                <FieldHint>
                  Select one or more UK regions where you'd prefer to work. Leave all unchecked if
                  you're open to any UK location.
                </FieldHint>
              </div>
            </div>
          </Card>

          {/* Contact Details */}
          <Card className="p-6">
            <h3 className="text-lg font-semibold mb-2 border-b pb-4">Contact Details</h3>
            <p className="text-xs text-muted-foreground mb-5">
              Used only to prefill safe contact fields on application forms. JOBSAGE never fills passwords, identity documents, declarations, or payment details.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <Label>Phone number *</Label>
                <Input name="phone" type="tel" autoComplete="tel" value={formData.phone} onChange={handleChange} onBlur={handleBlur} required />
              </div>
              <div>
                <Label>Street address *</Label>
                <Input name="streetAddress" autoComplete="street-address" value={formData.streetAddress} onChange={handleChange} onBlur={handleBlur} required />
              </div>
              <div>
                <Label>City / town *</Label>
                <Input name="city" autoComplete="address-level2" value={formData.city} onChange={handleChange} onBlur={handleBlur} required />
              </div>
              <div>
                <Label>Postcode *</Label>
                <Input name="postcode" autoComplete="postal-code" value={formData.postcode} onChange={handleChange} onBlur={handleBlur} required />
              </div>
              <div>
                <Label>Country *</Label>
                <Input name="country" autoComplete="country-name" value={formData.country} onChange={handleChange} onBlur={handleBlur} required />
              </div>
            </div>
          </Card>

          {/* Additional Details */}
          <Card id="profile-additional-section" className="p-6 scroll-mt-6">
            <h3 className="text-lg font-semibold mb-2 border-b pb-4">Additional Details</h3>
            <p className="text-xs text-muted-foreground mb-5">
              These fields help employers understand your availability and background. Fill them in to complete your profile.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <Label>
                  Earliest Available Start Date
                </Label>
                <Input
                  id="profile-field-preferredStartDate"
                  type="date"
                  name="preferredStartDate"
                  value={formData.preferredStartDate}
                  onChange={handleChange}
                  onBlur={handleBlur}
                  min={new Date().toISOString().split("T")[0]}
                />
                {!formData.preferredStartDate && <NotFoundBadge />}
                <FieldHint>
                  The earliest date you could start a new role. Helps employers plan their hiring timeline.
                </FieldHint>
              </div>

              <div>
                <Label>
                  Languages Spoken
                </Label>
                <Input
                  id="profile-field-languages"
                  name="languages"
                  value={formData.languages}
                  onChange={handleChange}
                  onBlur={handleBlur}
                  placeholder="e.g. English, Hindi, Urdu"
                />
                {!formData.languages && <NotFoundBadge />}
                <FieldHint>
                  List languages you can communicate in professionally, separated by commas.
                </FieldHint>
              </div>

              <div className="col-span-1 md:col-span-2">
                <Label>
                  Additional Notes
                </Label>
                <textarea
                  id="profile-field-additionalNotes"
                  name="additionalNotes"
                  value={formData.additionalNotes}
                  onChange={handleChange}
                  onBlur={handleBlur}
                  placeholder="Anything else you'd like employers or JOBSAGE to know about you…"
                  rows={3}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none"
                />
                <FieldHint>
                  Optional free-text space for any extra context — certifications, research interests, relocation flexibility, etc.
                </FieldHint>
              </div>
            </div>
          </Card>

          {/* Earned Badges */}
          {journeyData && journeyData.badges.length > 0 && (
            <Card className="p-6">
              <h3 className="text-lg font-semibold mb-2 border-b pb-4 flex items-center gap-2">
                <Star className="w-5 h-5 text-amber-500" />
                My Badges
                <span className="ml-1 inline-flex items-center justify-center px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800">
                  {journeyData.badges.length}
                </span>
              </h3>
              <p className="text-sm text-muted-foreground mb-4">
                Badges you've earned as you progress along your UK healthcare career journey.{" "}
                <Link href="/path"><span className="text-primary font-medium hover:underline cursor-pointer">View full journey →</span></Link>
              </p>
              <div className="flex flex-wrap gap-3">
                {journeyData.badges.map((badge) => {
                  const iconMap: Record<string, React.ElementType> = { UserCheck, Files, ShieldCheck, Send, Star, MessageSquare, Trophy };
                  const Icon = iconMap[badge.iconName] ?? Star;
                  return (
                    <div
                      key={badge.key}
                      title={badge.description}
                      className="flex items-center gap-3 px-4 py-3 rounded-xl bg-amber-50 border border-amber-200 dark:bg-amber-950/20 dark:border-amber-800/40"
                    >
                      <div className="w-9 h-9 rounded-xl bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center text-amber-700 dark:text-amber-400 shrink-0">
                        <Icon className="w-5 h-5" />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-foreground leading-tight">{badge.name}</p>
                        <p className="text-xs text-muted-foreground leading-tight">{badge.description}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          {/* Job Alert Preferences */}
          <Card className="p-6">
            <h3 className="text-lg font-semibold mb-2 border-b pb-4 flex items-center gap-2">
              <Bell className="w-5 h-5 text-primary" />
              Job Alert Preferences
            </h3>
            <p className="text-sm text-muted-foreground mb-4">
              Receive one weekly email with up to five personalised opportunities ranked like your
              Opportunities page.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {(["weekly", "off"] as AlertFrequency[]).map((freq) => (
                <button
                  key={freq}
                  type="button"
                  onClick={() => {
                    setFormData((prev) => ({ ...prev, alertFrequency: freq }));
                    setTimeout(doAutoSave, 300);
                  }}
                  className={`flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 text-sm font-semibold transition-all ${
                    formData.alertFrequency === freq
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:border-primary/30 hover:bg-muted/40"
                  }`}
                >
                  <Bell className={`w-4 h-4 ${freq === "off" ? "opacity-40" : ""}`} />
                  {freq === "weekly" ? "Weekly" : "Off"}
                </button>
              ))}
            </div>
            {formData.alertFrequency !== "off" && (
              <p className="text-xs text-muted-foreground mt-3">
                You'll receive one weekly email with up to five matching opportunities.
              </p>
            )}
            {formData.alertFrequency === "off" && (
              <p className="text-xs text-muted-foreground mt-3">
                You won't receive any job alert emails. You can turn these back on at any time.
              </p>
            )}
          </Card>
        </form>

        {/* ── My Career Profiles ── */}
        <CareerProfilesSection />
      </PageTransition>
    </AppLayout>
  );
}

const MAX_PROFILES = 3;

type MakerSourceDocument = {
  id: number;
  filename: string;
  label?: string | null;
  parsedData?: Record<string, unknown> | null;
};

function CareerProfileDraftReview({
  cp,
  onClose,
}: {
  cp: CareerProfile;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const updateMutation = useUpdateCareerProfile();
  const [editedContent, setEditedContent] = useState(cp.aiCvContent ?? "");
  const [confirmed, setConfirmed] = useState(false);

  async function handleSave() {
    const content = editedContent.trim();
    if (!content || !confirmed) return;
    try {
      await updateMutation.mutateAsync({
        id: cp.id,
        data: { aiCvContent: content, aiCvReviewed: true },
      });
      toast({
        title: "Factual draft reviewed",
        description: "Your edits and confirmation were saved. Check it again before each application.",
      });
      onClose();
    } catch (err) {
      toast({
        title: "Could not save review",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="w-full max-w-3xl overflow-hidden rounded-2xl border border-border bg-background shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-border p-5">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-semibold text-foreground">Review {CAREER_PROFILE_MAKER_LABEL} draft</h2>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              This is a new factual draft for <span className="font-medium text-foreground">{cp.focusArea}</span>, not an uploaded-CV enhancement.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Close CV draft review"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <div className="flex items-start gap-2.5 rounded-xl border border-amber-300 bg-amber-50 p-3.5">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <p className="text-xs leading-relaxed text-amber-900">
              <strong>{CAREER_PROFILE_MAKER_REVIEW_WARNING}</strong>{" "}
              Add or correct missing work history, duties, dates, qualifications, registrations, skills, and metrics yourself. Do not use this draft until every statement is true.
            </p>
          </div>

          <textarea
            value={editedContent}
            onChange={(e) => setEditedContent(e.target.value)}
            className="min-h-[420px] w-full resize-y rounded-xl border border-border bg-muted/20 p-4 font-mono text-sm leading-relaxed text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
            aria-label="Edit AI CV Maker factual draft"
          />

          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-muted/30 p-3.5">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
            />
            <span className="text-xs leading-relaxed text-foreground">
              I have reviewed and edited this draft where needed, and I confirm that I will verify every factual statement before using it.
            </span>
          </label>
        </div>

        <div className="flex justify-end gap-3 border-t border-border bg-muted/20 px-5 py-4">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={updateMutation.isPending}>
            Cancel
          </Button>
          <Button
            size="sm"
            className="gap-1.5"
            onClick={() => void handleSave()}
            disabled={updateMutation.isPending || !editedContent.trim() || !confirmed}
          >
            {updateMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            Save reviewed draft
          </Button>
        </div>
      </div>
    </div>
  );
}

function CareerProfileCard({
  cp,
  sourceDocuments,
  onActivate,
  onDelete,
  onGenerateCv,
  onReview,
  activating,
  deleting,
  generating,
}: {
  cp: CareerProfile;
  sourceDocuments: MakerSourceDocument[];
  onActivate: (id: number) => void;
  onDelete: (id: number) => void;
  onGenerateCv: (id: number, sourceDocumentId?: number) => void;
  onReview: (cp: CareerProfile) => void;
  activating: boolean;
  deleting: boolean;
  generating: boolean;
}) {
  const { toast } = useToast();
  const [sourceDocumentId, setSourceDocumentId] = useState("");

  function handleDownloadCv() {
    if (!cp.aiCvContent || !cp.aiCvReviewedAt) return;
    const blob = new Blob([cp.aiCvContent], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cv-${cp.name.replace(/\s+/g, "-").toLowerCase()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "CV downloaded", description: `${cp.name} CV saved as a text file.` });
  }

  return (
    <div className={cn(
      "rounded-xl border p-5 flex flex-col gap-4 transition-all",
      cp.isActive
        ? "border-primary/40 bg-primary/5 shadow-sm"
        : "border-border bg-background hover:border-primary/20"
    )}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className={cn(
            "w-9 h-9 rounded-lg flex items-center justify-center shrink-0",
            cp.isActive ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
          )}>
            <FolderOpen className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-foreground">{cp.name}</p>
              {cp.isActive && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-primary/10 text-primary border border-primary/20">
                  <BadgeCheck className="w-3 h-3" /> Active
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">{cp.focusArea}</p>
          </div>
        </div>
        <button
          onClick={() => onDelete(cp.id)}
          disabled={deleting}
          className="text-muted-foreground hover:text-destructive transition-colors p-1 rounded-lg hover:bg-destructive/10 shrink-0"
          aria-label="Delete profile"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {cp.aiCvContent && (
        <div className="p-3 rounded-lg bg-muted/40 border border-border">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className={`text-[10px] font-semibold uppercase tracking-wide ${cp.aiCvReviewedAt ? "text-emerald-700" : "text-amber-700"}`}>
              {cp.aiCvReviewedAt ? "Reviewed draft" : "Draft — review required"}
            </span>
            {cp.aiCvSourceDocumentId && (
              <span className="text-[10px] text-muted-foreground">Source CV used</span>
            )}
          </div>
          <p className="text-xs text-muted-foreground line-clamp-3 leading-relaxed">{cp.aiCvContent}</p>
            {!cp.aiCvReviewedAt && (
              <p className="mt-2 text-[11px] leading-relaxed text-amber-800">
                Review this draft again after changing confirmed profile details. Regenerate it if the facts or target direction have changed.
              </p>
            )}
        </div>
      )}

      {sourceDocuments.length > 0 ? (
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-foreground" htmlFor={`maker-source-${cp.id}`}>
            Optional source CV
          </label>
          <select
            id={`maker-source-${cp.id}`}
            value={sourceDocumentId}
            onChange={(e) => setSourceDocumentId(e.target.value)}
            className="w-full rounded-lg border border-border bg-muted/40 px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            <option value="">Use confirmed profile fields only</option>
            {sourceDocuments.map((doc) => (
              <option key={doc.id} value={doc.id}>
                {doc.label ?? doc.filename}{doc.parsedData ? "" : " — parse and confirm first"}
              </option>
            ))}
          </select>
          <p className="text-[11px] text-muted-foreground">
            Only candidate-confirmed fields saved from a CV are used. The focus area is never treated as evidence.
          </p>
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          Optional: upload and confirm a CV on Documents to give the Maker additional source fields.
        </p>
      )}

      <div className="flex flex-wrap gap-2 mt-auto">
        {!cp.isActive && (
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 h-8 text-xs"
            onClick={() => onActivate(cp.id)}
            disabled={activating}
          >
            {activating ? <Loader2 className="w-3 h-3 animate-spin" /> : <BadgeCheck className="w-3 h-3" />}
            Set Active
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 h-8 text-xs"
          onClick={() => onGenerateCv(cp.id, sourceDocumentId ? Number(sourceDocumentId) : undefined)}
          disabled={generating}
        >
          {generating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
          {cp.aiCvContent ? "Regenerate factual draft" : "Make factual CV draft"}
        </Button>
        {cp.aiCvContent && (
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 h-8 text-xs"
            onClick={() => cp.aiCvReviewedAt ? handleDownloadCv() : onReview(cp)}
          >
            {cp.aiCvReviewedAt ? (
              <><Download className="w-3 h-3" /> Download reviewed draft</>
            ) : (
              <><CheckCircle2 className="w-3 h-3" /> Review and edit</>
            )}
          </Button>
        )}
      </div>
    </div>
  );
}

function CareerProfilesSection() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading } = useListCareerProfiles();
  const { data: documentsData } = useListMyDocuments();
  const createMutation = useCreateCareerProfile();
  const deleteMutation = useDeleteCareerProfile();
  const activateMutation = useActivateCareerProfile();
  const generateCvMutation = useGenerateProfileCv();

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newFocusArea, setNewFocusArea] = useState("");
  const [actingId, setActingId] = useState<number | null>(null);
  const [reviewingProfile, setReviewingProfile] = useState<CareerProfile | null>(null);

  const profiles = data?.profiles ?? [];
  const sourceDocuments: MakerSourceDocument[] = (documentsData?.documents ?? [])
    .filter((doc) => doc.documentType === "cv")
    .map((doc) => ({
      id: doc.id,
      filename: doc.filename,
      label: doc.label,
      parsedData: doc.parsedData,
    }));

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim() || !newFocusArea.trim()) return;
    try {
      await createMutation.mutateAsync({ name: newName.trim(), focusArea: newFocusArea.trim() });
      setNewName("");
      setNewFocusArea("");
      setShowCreateForm(false);
      toast({
        title: "Profile created",
        description: `${newName.trim()} profile added. Make a factual CV draft when your confirmed profile details are ready.`,
      });
    } catch {
      toast({ title: "Error", description: "Failed to create career profile.", variant: "destructive" });
    }
  }

  async function handleDelete(id: number) {
    setActingId(id);
    try {
      await deleteMutation.mutateAsync(id);
      toast({ title: "Profile deleted" });
    } catch {
      toast({ title: "Error", description: "Failed to delete profile.", variant: "destructive" });
    } finally {
      setActingId(null);
    }
  }

  async function handleActivate(id: number) {
    setActingId(id);
    try {
      await activateMutation.mutateAsync(id);
      // Invalidate all recommendation and matching query keys so switching profile
      // immediately reflects the new active profile's focus area across all pages.
      void queryClient.invalidateQueries({ queryKey: ["eligibility-eligible-vacancies"] });
      void queryClient.invalidateQueries({ queryKey: ["opportunities-recommended"] });
      void queryClient.invalidateQueries({ queryKey: getGetMyMatchesQueryKey({ limit: 200 }) });
      void queryClient.invalidateQueries({ queryKey: getListMatchedRolesQueryKey() });
      toast({ title: "Active profile updated", description: "Your active career profile has been switched." });
    } catch {
      toast({ title: "Error", description: "Failed to switch profile.", variant: "destructive" });
    } finally {
      setActingId(null);
    }
  }

  async function handleGenerateCv(id: number, sourceDocumentId?: number) {
    setActingId(id);
    try {
      await generateCvMutation.mutateAsync({
        id,
        data: { sourceDocumentId: sourceDocumentId ?? null },
      });
      toast({
        title: "Factual draft created",
        description: "Review and edit the draft before downloading or using it.",
      });
    } catch (err) {
      toast({
        title: "Factual CV draft failed",
        description: err instanceof Error ? err.message : "Complete your confirmed profile details and try again.",
        variant: "destructive",
      });
    } finally {
      setActingId(null);
    }
  }

  return (
    <Card className="p-6 mt-6">
      <div className="flex items-center justify-between mb-2 border-b pb-4">
        <div className="flex items-center gap-2">
          <FolderOpen className="w-5 h-5 text-primary" />
          <h3 className="text-lg font-semibold text-foreground">My Career Profiles</h3>
          <span className="inline-flex items-center justify-center px-2 py-0.5 rounded-full text-xs font-bold bg-primary/10 text-primary">
            {profiles.length}/{MAX_PROFILES}
          </span>
        </div>
        {profiles.length < MAX_PROFILES && !showCreateForm && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setShowCreateForm(true)}
            className="gap-1.5 h-8 text-xs"
          >
            <Plus className="w-3 h-3" /> Add Profile
          </Button>
        )}
      </div>

      <p className="text-sm text-muted-foreground mb-5">
        Create up to {MAX_PROFILES} career profiles — each with its own target direction and evidence-bound {CAREER_PROFILE_MAKER_LABEL} draft. {CAREER_PROFILE_MAKER_DESCRIPTION} For rewriting an uploaded CV, use <strong>Enhance CV</strong> on Documents.
      </p>

      {isLoading ? (
        <div className="space-y-3">
          {[0, 1].map((i) => <div key={i} className="h-28 rounded-xl bg-muted/50 animate-pulse" />)}
        </div>
      ) : profiles.length === 0 ? (
        <div className="rounded-xl border border-dashed border-muted-foreground/30 p-8 text-center">
          <FolderOpen className="w-8 h-8 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-sm font-medium text-muted-foreground mb-1">No career profiles yet</p>
          <p className="text-xs text-muted-foreground mb-4">Add a profile to get a tailored AI CV and targeted opportunities for each career path.</p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setShowCreateForm(true)}
            className="gap-1.5"
          >
            <Plus className="w-3 h-3" /> Create first profile
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {profiles.map((cp) => (
            <CareerProfileCard
              key={cp.id}
              cp={cp}
              sourceDocuments={sourceDocuments}
              onActivate={handleActivate}
              onDelete={handleDelete}
              onGenerateCv={handleGenerateCv}
              onReview={setReviewingProfile}
              activating={actingId === cp.id && activateMutation.isPending}
              deleting={actingId === cp.id && deleteMutation.isPending}
              generating={actingId === cp.id && generateCvMutation.isPending}
            />
          ))}
        </div>
      )}

      {showCreateForm && (
        <form onSubmit={handleCreate} className="mt-5 p-4 rounded-xl border border-primary/20 bg-primary/5 space-y-4">
          <h4 className="text-sm font-semibold text-foreground">New Career Profile</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label>Profile Name *</Label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Clinical Nurse, Nurse Educator"
                required
              />
              <p className="text-xs text-muted-foreground mt-1">A short label for this career direction.</p>
            </div>
            <div>
              <Label>Focus Area *</Label>
              <Input
                value={newFocusArea}
                onChange={(e) => setNewFocusArea(e.target.value)}
                placeholder="e.g. Critical Care, Academic Leadership"
                required
              />
              <p className="text-xs text-muted-foreground mt-1">The specialisation for this profile's AI CV.</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button type="submit" size="sm" className="gap-1.5 h-8 text-xs" disabled={createMutation.isPending}>
              {createMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
              Create Profile
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              onClick={() => { setShowCreateForm(false); setNewName(""); setNewFocusArea(""); }}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}

      {reviewingProfile && (
        <CareerProfileDraftReview
          cp={reviewingProfile}
          onClose={() => setReviewingProfile(null)}
        />
      )}

      <p className="text-xs text-muted-foreground mt-4 italic">
        AI CV Maker drafts are never submission-ready by default. Review, edit, and verify every detail before use.
      </p>
    </Card>
  );
}
