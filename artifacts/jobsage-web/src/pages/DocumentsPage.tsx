import { useRef, useState } from "react";
import {
  useListMyDocuments,
  useDeleteDocument,
  useParseCv,
  useUpsertMyProfile,
  useGetMyProfile,
  getListMyDocumentsQueryKey,
  getGetMyProfileQueryKey,
  type CvExtractedFields,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, Button, PageTransition } from "@/components/ui-enhanced";
import { useDocumentUpload } from "@/hooks/use-document-upload";
import {
  FileUp,
  File,
  Trash2,
  ShieldAlert,
  FileText,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  X,
  Loader2,
  User,
  Tag,
  ChevronDown,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";

const DOCUMENT_TYPES = [
  { value: "cv", label: "CV / Résumé" },
  { value: "qualification", label: "Qualification" },
  { value: "cpd_certificate", label: "CPD Certificate" },
  { value: "recommendation_letter", label: "Recommendation Letter" },
  { value: "passport", label: "Passport" },
  { value: "proof_of_address", label: "Proof of Address" },
  { value: "other", label: "Other" },
] as const;

type DocType = (typeof DOCUMENT_TYPES)[number]["value"];

const TYPE_COLORS: Record<DocType, string> = {
  cv: "bg-primary/10 text-primary border-primary/20",
  qualification: "bg-violet-100 text-violet-800 border-violet-200",
  cpd_certificate: "bg-sky-100 text-sky-800 border-sky-200",
  recommendation_letter: "bg-amber-100 text-amber-800 border-amber-200",
  passport: "bg-emerald-100 text-emerald-800 border-emerald-200",
  proof_of_address: "bg-orange-100 text-orange-800 border-orange-200",
  other: "bg-muted text-muted-foreground border-border",
};

const CATEGORY_ORDER: DocType[] = [
  "cv",
  "qualification",
  "cpd_certificate",
  "recommendation_letter",
  "passport",
  "proof_of_address",
  "other",
];

const CONFIDENCE_COLOR: Record<string, string> = {
  high: "text-emerald-600",
  medium: "text-amber-600",
  low: "text-rose-500",
  none: "text-muted-foreground",
};

const FIELD_LABELS: Record<keyof CvExtractedFields, string> = {
  profession: "Profession",
  specialty: "Specialty",
  qualificationCountry: "Qualification Country",
  qualificationType: "Qualification Type",
  qualificationYear: "Qualification Year",
  experienceYears: "Years of Experience",
  registrationStatus: "UK Registration Status",
  requiresSponsorship: "Requires Sponsorship",
  preferredRegion: "Preferred UK Region",
  confidence: "",
  rawNotes: "AI Notes",
};

function getTypeLabel(value: string | null | undefined): string {
  const found = DOCUMENT_TYPES.find((t) => t.value === value);
  return found ? found.label : "Uncategorised";
}

function TypeBadge({ docType }: { docType: string | null | undefined }) {
  const colorClass = docType ? TYPE_COLORS[docType as DocType] ?? TYPE_COLORS.other : "bg-muted text-muted-foreground border-border";
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${colorClass}`}>
      <Tag className="w-2.5 h-2.5" />
      {getTypeLabel(docType)}
    </span>
  );
}

function CvParseDialog({
  extracted,
  onConfirm,
  onClose,
  isSaving,
}: {
  extracted: CvExtractedFields;
  onConfirm: (fields: CvExtractedFields) => void;
  onClose: () => void;
  isSaving: boolean;
}) {
  const [fields, setFields] = useState<CvExtractedFields>({ ...extracted });

  const displayFields: (keyof CvExtractedFields)[] = [
    "profession",
    "specialty",
    "qualificationCountry",
    "qualificationType",
    "qualificationYear",
    "experienceYears",
    "registrationStatus",
    "requiresSponsorship",
    "preferredRegion",
    "rawNotes",
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-xl bg-background rounded-2xl shadow-2xl border border-border overflow-hidden"
      >
        <div className="flex items-start justify-between p-6 pb-4 border-b border-border">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Sparkles className="w-5 h-5 text-primary" />
              <h2 className="text-lg font-bold text-foreground">CV Extraction Results</h2>
            </div>
            <p className="text-sm text-muted-foreground">
              Review and confirm the fields AI found in your CV before saving to your profile.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 max-h-[60vh] overflow-y-auto space-y-3">
          {displayFields.map((key) => {
            if (key === "confidence") return null;
            const value = fields[key];
            const conf = (extracted.confidence as Record<string, string>)?.[key] ?? "none";
            const label = FIELD_LABELS[key];
            if (!label) return null;

            const displayValue =
              value === null || value === undefined
                ? "Not found"
                : typeof value === "boolean"
                ? value
                  ? "Yes"
                  : "No"
                : String(value);

            return (
              <div key={key} className="flex items-start gap-3">
                <div className="flex-1">
                  <p className="text-xs text-muted-foreground font-medium mb-0.5">{label}</p>
                  <p className={`text-sm font-medium ${value === null || value === undefined ? "text-muted-foreground italic" : "text-foreground"}`}>
                    {displayValue}
                  </p>
                </div>
                <div className="shrink-0 mt-4">
                  {conf === "high" ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  ) : conf === "medium" ? (
                    <AlertTriangle className="w-4 h-4 text-amber-500" />
                  ) : conf === "low" || conf === "none" ? (
                    <AlertTriangle className="w-4 h-4 text-rose-400" />
                  ) : null}
                </div>
              </div>
            );
          })}

          {extracted.rawNotes && (
            <div className="bg-muted/50 rounded-xl p-3 mt-2">
              <p className="text-xs text-muted-foreground font-medium mb-1">AI Notes</p>
              <p className="text-xs text-foreground">{extracted.rawNotes}</p>
            </div>
          )}

          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mt-2">
            <p className="text-xs text-amber-800">
              <span className="font-semibold">Important:</span> Only fields with a value will be saved. Existing profile fields not found in your CV will not be overwritten. Always review before confirming.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border bg-muted/30">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => onConfirm(fields)} disabled={isSaving}>
            {isSaving ? (
              <>
                <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> Saving…
              </>
            ) : (
              <>
                <User className="w-4 h-4 mr-1.5" /> Save to Profile
              </>
            )}
          </Button>
        </div>
      </motion.div>
    </div>
  );
}

export default function DocumentsPage() {
  const { data } = useListMyDocuments();
  const { data: profile } = useGetMyProfile();
  const deleteMutation = useDeleteDocument();
  const parseCvMutation = useParseCv();
  const upsertProfileMutation = useUpsertMyProfile();
  const { uploadFile, isUploading, progress } = useDocumentUpload();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [parsingDocId, setParsingDocId] = useState<number | null>(null);
  const [parsedExtracted, setParsedExtracted] = useState<CvExtractedFields | null>(null);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [updatingTypeId, setUpdatingTypeId] = useState<number | null>(null);
  const [showParseBanner, setShowParseBanner] = useState(false);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const result = await uploadFile(file);
    if (result) {
      toast({ title: "Upload complete", description: `${file.name} uploaded.` });
      queryClient.invalidateQueries({ queryKey: getListMyDocumentsQueryKey() });
      const canParse = result.mimeType === "application/pdf" || result.mimeType.startsWith("image/");
      if (canParse) {
        void handleParseCv(result.id);
      }
    } else {
      toast({ title: "Upload failed", variant: "destructive", description: "There was a problem uploading your file." });
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Are you sure you want to delete this document?")) return;
    try {
      await deleteMutation.mutateAsync({ id });
      queryClient.invalidateQueries({ queryKey: getListMyDocumentsQueryKey() });
      toast({ title: "Document deleted" });
    } catch {
      toast({ title: "Delete failed", variant: "destructive" });
    }
  };

  const handleParseCv = async (id: number) => {
    setParsingDocId(id);
    try {
      const result = await parseCvMutation.mutateAsync({ id });
      setParsedExtracted(result.extracted);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : "Failed to parse CV";
      toast({ title: "CV parse failed", description: errMsg, variant: "destructive" });
    } finally {
      setParsingDocId(null);
    }
  };

  const handleSetType = async (id: number, documentType: string) => {
    setUpdatingTypeId(id);
    try {
      await fetch(`/api/documents/${id}/type`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentType }),
      });
      queryClient.invalidateQueries({ queryKey: getListMyDocumentsQueryKey() });
    } catch {
      toast({ title: "Failed to update category", variant: "destructive" });
    } finally {
      setUpdatingTypeId(null);
    }
  };

  const handleConfirmMerge = async (extracted: CvExtractedFields) => {
    setIsSavingProfile(true);
    const isBootstrap = !profile;
    try {
      const merged = {
        profession:
          ((extracted.profession ?? profile?.profession) as "doctor" | "nurse" | "midwife" | "allied_health_professional" | "clinical_academic") ??
          "doctor",
        specialty: extracted.specialty ?? profile?.specialty ?? "",
        qualificationCountry: extracted.qualificationCountry ?? profile?.qualificationCountry ?? "Unknown",
        qualificationType: extracted.qualificationType ?? profile?.qualificationType ?? "Unknown",
        qualificationYear: extracted.qualificationYear ?? profile?.qualificationYear ?? (new Date().getFullYear() - 5),
        experienceYears: extracted.experienceYears ?? profile?.experienceYears ?? 0,
        registrationStatus:
          ((extracted.registrationStatus ?? profile?.registrationStatus) as "registered" | "not_registered" | "in_process") ??
          "not_registered",
        requiresSponsorship: extracted.requiresSponsorship ?? profile?.requiresSponsorship ?? false,
        licenceReady: profile?.licenceReady ?? null,
        residencyStatus: profile?.residencyStatus ?? "unknown",
        preferredRegion: extracted.preferredRegion ?? profile?.preferredRegion ?? null,
      };

      await upsertProfileMutation.mutateAsync({ data: merged });
      queryClient.invalidateQueries({ queryKey: getGetMyProfileQueryKey() });
      toast({
        title: isBootstrap ? "Profile created from CV!" : "Profile updated!",
        description: isBootstrap
          ? "Your profile has been created from your CV. Please review and complete any missing details."
          : "Your profile has been updated with data from your CV.",
      });
      setParsedExtracted(null);
      setShowParseBanner(true);
    } catch {
      toast({ title: "Failed to save", description: "Could not update your profile. Please try again.", variant: "destructive" });
    } finally {
      setIsSavingProfile(false);
    }
  };

  const documents = data?.documents ?? [];

  const grouped: Record<string, typeof documents> = {};
  for (const doc of documents) {
    const key = doc.documentType ?? "uncategorised";
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(doc);
  }

  const sortedCategories = [
    ...CATEGORY_ORDER.filter((k) => grouped[k]),
    ...(grouped["uncategorised"] ? ["uncategorised"] : []),
  ];

  return (
    <AppLayout>
      <PageTransition>
        <AnimatePresence>
          {parsedExtracted && (
            <CvParseDialog
              extracted={parsedExtracted}
              onConfirm={handleConfirmMerge}
              onClose={() => setParsedExtracted(null)}
              isSaving={isSavingProfile}
            />
          )}
        </AnimatePresence>

        <header className="mb-8 flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-3xl font-display font-bold text-foreground flex items-center">
              <FileText className="w-8 h-8 mr-3 text-primary" />
              My Documents
            </h1>
            <p className="text-muted-foreground mt-2">
              Upload and categorise your CV, qualifications, certificates, and identity documents.
            </p>
          </div>
          <div>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileSelect}
              className="hidden"
              accept=".pdf,.jpg,.jpeg,.png"
            />
            <Button onClick={() => fileInputRef.current?.click()} disabled={isUploading}>
              <FileUp className="w-4 h-4 mr-2" />
              {isUploading ? `Uploading ${progress}%` : "Upload Document"}
            </Button>
          </div>
        </header>

        <AnimatePresence>
          {showParseBanner && (
            <motion.div
              key="parse-banner"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="mb-6 flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4"
            >
              <CheckCircle2 className="w-5 h-5 text-emerald-600 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-emerald-800">Profile updated from your CV</p>
                <p className="text-xs text-emerald-700 mt-0.5">
                  Some fields like languages, photo, and availability still need to be filled in manually.
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <a
                  href="/profile"
                  className="inline-flex items-center gap-1 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg px-3 py-1.5 transition-colors"
                >
                  <User className="w-3.5 h-3.5" />
                  Complete Profile
                </a>
                <button
                  onClick={() => setShowParseBanner(false)}
                  className="text-emerald-500 hover:text-emerald-700 transition-colors p-1"
                  aria-label="Dismiss"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="bg-amber-50 border border-amber-200 text-amber-800 p-4 rounded-xl flex items-start mb-8 shadow-sm">
          <ShieldAlert className="w-5 h-5 mr-3 shrink-0 mt-0.5 text-amber-600" />
          <div className="text-sm">
            <p className="font-semibold mb-1">Important Disclaimer</p>
            <p>
              Documents uploaded here are for your personal reference only. They are{" "}
              <strong>not verified</strong> by JOBSAGE, employers, or any regulatory body. You will
              still need to submit verified documents directly to regulators during official
              applications.
            </p>
          </div>
        </div>

        {isUploading && (
          <Card className="p-6 mb-6 flex flex-col items-center justify-center py-10">
            <div className="w-12 h-12 rounded-full border-4 border-primary/20 border-t-primary animate-spin mb-4" />
            <p className="text-primary font-medium">Uploading your document... {progress}%</p>
            <div className="w-full max-w-md h-2 bg-muted rounded-full mt-4 overflow-hidden">
              <div className="h-full bg-primary transition-all duration-300" style={{ width: `${progress}%` }} />
            </div>
          </Card>
        )}

        {documents.length === 0 && !isUploading ? (
          <Card className="p-12 text-center border-dashed border-2">
            <div className="w-16 h-16 bg-muted rounded-2xl flex items-center justify-center mx-auto mb-4">
              <File className="w-8 h-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">No documents yet</h3>
            <p className="text-muted-foreground mb-6 max-w-sm mx-auto">
              Upload your CV and AI will automatically extract your qualifications, experience, and
              registration details to pre-fill your profile.
            </p>
            <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
              Browse Files
            </Button>
          </Card>
        ) : (
          <div className="space-y-8">
            {sortedCategories.map((category) => {
              const docs = grouped[category] ?? [];
              const categoryLabel = category === "uncategorised"
                ? "Uncategorised"
                : getTypeLabel(category);
              const colorClass = category !== "uncategorised"
                ? TYPE_COLORS[category as DocType] ?? TYPE_COLORS.other
                : "bg-muted text-muted-foreground border-border";

              return (
                <div key={category}>
                  <div className="flex items-center gap-3 mb-4">
                    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border ${colorClass}`}>
                      <Tag className="w-3 h-3" />
                      {categoryLabel}
                    </span>
                    <span className="text-xs text-muted-foreground">{docs.length} document{docs.length !== 1 ? "s" : ""}</span>
                    <div className="flex-1 h-px bg-border" />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {docs.map((doc) => {
                      const isPdf = doc.mimeType === "application/pdf";
                      const isImg = doc.mimeType.startsWith("image/");
                      const canParse = isPdf || isImg;
                      const isParsing = parsingDocId === doc.id;
                      const isUpdatingType = updatingTypeId === doc.id;

                      return (
                        <Card key={doc.id} className="p-5 flex flex-col group hover:shadow-md transition-all">
                          <div className="flex items-start justify-between mb-3">
                            <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center text-primary shrink-0">
                              <FileText className="w-5 h-5" />
                            </div>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 -mr-2 -mt-2 opacity-0 group-hover:opacity-100 transition-opacity"
                              onClick={() => handleDelete(doc.id)}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>

                          <h4
                            className="font-semibold text-foreground truncate mb-2"
                            title={doc.filename}
                          >
                            {doc.filename}
                          </h4>

                          {/* Category selector */}
                          <div className="relative mb-3">
                            <select
                              value={doc.documentType ?? ""}
                              onChange={(e) => void handleSetType(doc.id, e.target.value || "other")}
                              disabled={isUpdatingType}
                              className="w-full appearance-none text-xs rounded-lg border border-border bg-muted/40 px-3 py-1.5 pr-7 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-60 cursor-pointer"
                            >
                              <option value="">Set category…</option>
                              {DOCUMENT_TYPES.map((t) => (
                                <option key={t.value} value={t.value}>{t.label}</option>
                              ))}
                            </select>
                            {isUpdatingType ? (
                              <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 animate-spin text-muted-foreground" />
                            ) : (
                              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                            )}
                          </div>

                          <div className="flex justify-between items-center text-xs text-muted-foreground mt-auto pt-3 border-t border-border">
                            <span>
                              {doc.fileSize ? `${Math.round(doc.fileSize / 1024)} KB` : "Unknown size"}
                            </span>
                            <span>{format(new Date(doc.uploadedAt), "MMM d, yyyy")}</span>
                          </div>

                          {canParse && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="mt-3 w-full text-xs h-8 gap-1.5"
                              disabled={isParsing}
                              onClick={() => handleParseCv(doc.id)}
                            >
                              {isParsing ? (
                                <>
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Parsing CV…
                                </>
                              ) : (
                                <>
                                  <Sparkles className="w-3.5 h-3.5" /> Parse CV with AI
                                </>
                              )}
                            </Button>
                          )}
                        </Card>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </PageTransition>
    </AppLayout>
  );
}
