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
  Pencil,
  Star,
  Download,
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
  professionQualMismatch: "",
  professionQualMismatchWarning: "",
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
          {fields.professionQualMismatch && fields.professionQualMismatchWarning && (
            <div className="flex items-start gap-3 p-3 rounded-xl border border-orange-300 bg-orange-50">
              <AlertTriangle className="w-4 h-4 text-orange-500 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-orange-800">Profession may not match qualification</p>
                <p className="text-xs text-orange-700 mt-0.5 leading-snug">{fields.professionQualMismatchWarning}</p>
                <p className="text-xs text-orange-600 mt-1">Please review the <strong>Profession</strong> field below and correct it if needed before saving.</p>
              </div>
            </div>
          )}
          {displayFields.map((key) => {
            if (key === "confidence") return null;
            const value = fields[key];
            const conf = (extracted.confidence as Record<string, string>)?.[key] ?? "none";
            const label = FIELD_LABELS[key];
            if (!label) return null;

            const confIcon =
              conf === "high" ? <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" /> :
              conf === "medium" ? <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" /> :
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />;

            const confLabel =
              conf === "high" ? "High confidence" :
              conf === "medium" ? "Review suggested" :
              "Low confidence — please correct";

            const inputClass = "w-full text-sm rounded-lg border border-border bg-muted/40 px-2.5 py-1.5 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40";

            return (
              <div key={key} className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs font-semibold text-foreground">{label}</label>
                  <span className={`flex items-center gap-1 text-[10px] ${conf === "high" ? "text-emerald-600" : conf === "medium" ? "text-amber-600" : "text-rose-500"}`}>
                    {confIcon} {confLabel}
                  </span>
                </div>
                {key === "registrationStatus" ? (
                  <select
                    value={String(value ?? "")}
                    onChange={(e) => setFields((f) => ({ ...f, [key]: e.target.value || null }))}
                    className={inputClass}
                  >
                    <option value="">Not found</option>
                    <option value="registered">Registered</option>
                    <option value="not_registered">Not registered</option>
                    <option value="in_process">In process</option>
                  </select>
                ) : key === "requiresSponsorship" ? (
                  <select
                    value={value === null || value === undefined ? "" : value ? "true" : "false"}
                    onChange={(e) => setFields((f) => ({ ...f, [key]: e.target.value === "" ? null : e.target.value === "true" }))}
                    className={inputClass}
                  >
                    <option value="">Not found</option>
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </select>
                ) : key === "qualificationYear" || key === "experienceYears" ? (
                  <input
                    type="number"
                    value={value === null || value === undefined ? "" : String(value)}
                    onChange={(e) => setFields((f) => ({ ...f, [key]: e.target.value ? parseInt(e.target.value, 10) : null }))}
                    className={inputClass}
                    placeholder="Not found"
                    min={key === "experienceYears" ? 0 : 1950}
                    max={key === "experienceYears" ? 60 : new Date().getFullYear()}
                  />
                ) : key === "rawNotes" ? (
                  <textarea
                    value={String(value ?? "")}
                    onChange={(e) => setFields((f) => ({ ...f, [key]: e.target.value || undefined }))}
                    rows={2}
                    className={`${inputClass} resize-none`}
                    placeholder="No notes"
                  />
                ) : (
                  <input
                    type="text"
                    value={String(value ?? "")}
                    onChange={(e) => setFields((f) => ({ ...f, [key]: e.target.value || null }))}
                    className={inputClass}
                    placeholder="Not found — type to add"
                  />
                )}
              </div>
            );
          })}

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

function LabelEditor({
  docId,
  currentLabel,
  onSaved,
}: {
  docId: number;
  currentLabel: string | null | undefined;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(currentLabel ?? "");
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");

  async function save() {
    setSaving(true);
    try {
      await fetch(`${base}/api/documents/${docId}/label`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: value.trim() || null }),
      });
      onSaved();
      setEditing(false);
    } catch {
      toast({ title: "Failed to save label", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1.5 mt-1">
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void save();
            if (e.key === "Escape") setEditing(false);
          }}
          autoFocus
          maxLength={60}
          placeholder="e.g. Clinical CV"
          className="flex-1 text-xs rounded-lg border border-border bg-muted/40 px-2 py-1 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
        <button
          onClick={() => void save()}
          disabled={saving}
          className="p-1 rounded text-emerald-600 hover:bg-emerald-50"
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
        </button>
        <button onClick={() => setEditing(false)} className="p-1 rounded text-muted-foreground hover:bg-muted">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => { setValue(currentLabel ?? ""); setEditing(true); }}
      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mt-1 group"
    >
      <Pencil className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
      <span className={currentLabel ? "font-medium text-foreground" : "italic"}>
        {currentLabel ?? "Add a label…"}
      </span>
    </button>
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
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");

  const [parsingDocId, setParsingDocId] = useState<number | null>(null);
  const [parsedFromDocId, setParsedFromDocId] = useState<number | null>(null);
  const [parsedExtracted, setParsedExtracted] = useState<CvExtractedFields | null>(null);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [updatingTypeId, setUpdatingTypeId] = useState<number | null>(null);
  const [settingPrimaryId, setSettingPrimaryId] = useState<number | null>(null);
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
      setParsedFromDocId(id);
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
      await fetch(`${base}/api/documents/${id}/type`, {
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

  const handleSetPrimary = async (id: number) => {
    setSettingPrimaryId(id);
    try {
      await fetch(`${base}/api/documents/${id}/label`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPrimary: true }),
      });
      queryClient.invalidateQueries({ queryKey: getListMyDocumentsQueryKey() });
      toast({ title: "Primary CV updated", description: "This CV will be used by default when sending applications." });
    } catch {
      toast({ title: "Failed to set primary CV", variant: "destructive" });
    } finally {
      setSettingPrimaryId(null);
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

      // Persist confirmed parsed fields on the document for multi-CV tracking
      if (parsedFromDocId) {
        try {
          await fetch(`${base}/api/documents/${parsedFromDocId}/save-parsed`, {
            method: "PATCH",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ parsedData: extracted }),
          });
          queryClient.invalidateQueries({ queryKey: getListMyDocumentsQueryKey() });
        } catch { /* non-fatal — profile is already saved */ }
      }

      toast({
        title: isBootstrap ? "Profile created from CV!" : "Profile updated!",
        description: isBootstrap
          ? "Your profile has been created from your CV. Please review and complete any missing details."
          : "Your profile has been updated with data from your CV.",
      });
      setParsedExtracted(null);
      setParsedFromDocId(null);
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
    const key = (doc as { documentType?: string | null }).documentType ?? "uncategorised";
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(doc);
  }

  const sortedCategories = [
    ...CATEGORY_ORDER.filter((k) => grouped[k]),
    ...(grouped["uncategorised"] ? ["uncategorised"] : []),
  ];

  const cvDocs = documents.filter((d) => (d as { documentType?: string | null }).documentType === "cv");

  return (
    <AppLayout>
      <PageTransition>
        <AnimatePresence>
          {parsedExtracted && (
            <CvParseDialog
              extracted={parsedExtracted}
              onConfirm={handleConfirmMerge}
              onClose={() => { setParsedExtracted(null); setParsedFromDocId(null); }}
              isSaving={isSavingProfile}
            />
          )}
        </AnimatePresence>

        <header className="mb-8 flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-3xl font-display font-bold text-foreground flex items-center">
              <FileText className="w-8 h-8 mr-3 text-primary" />
              CV & Supporting Documents
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
              const isCvCategory = category === "cv";

              return (
                <div key={category}>
                  <div className="flex items-center gap-3 mb-4">
                    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border ${colorClass}`}>
                      <Tag className="w-3 h-3" />
                      {categoryLabel}
                    </span>
                    <span className="text-xs text-muted-foreground">{docs.length} document{docs.length !== 1 ? "s" : ""}</span>
                    {isCvCategory && docs.length > 1 && (
                      <span className="text-xs text-muted-foreground italic">Label your CVs and mark one as primary for faster applications</span>
                    )}
                    <div className="flex-1 h-px bg-border" />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {docs.map((doc) => {
                      const docWithExtras = doc as typeof doc & { documentType?: string | null; label?: string | null; isPrimary?: boolean };
                      const isPdf = doc.mimeType === "application/pdf";
                      const isImg = doc.mimeType.startsWith("image/");
                      const canParse = isPdf || isImg;
                      const isParsing = parsingDocId === doc.id;
                      const isUpdatingType = updatingTypeId === doc.id;
                      const isSettingPrimary = settingPrimaryId === doc.id;
                      const isPrimaryDoc = docWithExtras.isPrimary === true;
                      const isCvDoc = docWithExtras.documentType === "cv";

                      return (
                        <Card key={doc.id} className={`p-5 flex flex-col group hover:shadow-md transition-all ${isPrimaryDoc ? "border-primary/40 ring-1 ring-primary/20" : ""}`}>
                          <div className="flex items-start justify-between mb-3">
                            <div className="relative">
                              <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center text-primary shrink-0">
                                <FileText className="w-5 h-5" />
                              </div>
                              {isPrimaryDoc && (
                                <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-amber-400 rounded-full flex items-center justify-center">
                                  <Star className="w-2.5 h-2.5 text-white fill-white" />
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-0.5 -mr-2 -mt-2">
                              <a
                                href={`${base}/api/storage/objects${(doc as typeof doc & { storageKey?: string }).storageKey?.replace(/^\/objects/, "") ?? ""}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center justify-center w-8 h-8 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 opacity-0 group-hover:opacity-100 transition-opacity"
                                title="View / Download"
                              >
                                <Download className="w-4 h-4" />
                              </a>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-opacity"
                                onClick={() => handleDelete(doc.id)}
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </div>
                          </div>

                          <h4
                            className="font-semibold text-foreground truncate mb-0.5"
                            title={doc.filename}
                          >
                            {doc.filename}
                          </h4>

                          {isCvDoc && (
                            <LabelEditor
                              docId={doc.id}
                              currentLabel={docWithExtras.label}
                              onSaved={() => queryClient.invalidateQueries({ queryKey: getListMyDocumentsQueryKey() })}
                            />
                          )}

                          {isCvDoc && (() => {
                            const pd = (docWithExtras as typeof docWithExtras & { parsedData?: Record<string, unknown> | null }).parsedData;
                            if (!pd) return null;
                            const prof = pd.profession as string | null | undefined;
                            const spec = pd.specialty as string | null | undefined;
                            const expYrs = pd.experienceYears as number | null | undefined;
                            return (
                              <div className="flex flex-wrap gap-1 mt-1.5">
                                {prof && (
                                  <span className="inline-flex items-center text-[10px] font-medium bg-primary/10 text-primary px-2 py-0.5 rounded-full capitalize">
                                    {prof.replace(/_/g, " ")}
                                  </span>
                                )}
                                {spec && (
                                  <span className="inline-flex items-center text-[10px] font-medium bg-muted text-muted-foreground px-2 py-0.5 rounded-full">
                                    {spec}
                                  </span>
                                )}
                                {expYrs != null && (
                                  <span className="inline-flex items-center text-[10px] font-medium bg-muted text-muted-foreground px-2 py-0.5 rounded-full">
                                    {expYrs}yr{expYrs !== 1 ? "s" : ""} exp
                                  </span>
                                )}
                              </div>
                            );
                          })()}

                          {isCvDoc && cvDocs.length > 1 && !isPrimaryDoc && (
                            <button
                              onClick={() => void handleSetPrimary(doc.id)}
                              disabled={isSettingPrimary}
                              className="mt-2 flex items-center gap-1 text-xs text-amber-600 hover:text-amber-700 transition-colors disabled:opacity-50"
                            >
                              {isSettingPrimary ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <Star className="w-3 h-3" />
                              )}
                              Set as primary CV
                            </button>
                          )}

                          {isPrimaryDoc && (
                            <span className="mt-1.5 inline-flex items-center gap-1 text-xs text-amber-700 font-medium">
                              <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                              Primary CV
                            </span>
                          )}

                          {/* Category selector */}
                          <div className="relative mt-3 mb-3">
                            <select
                              value={docWithExtras.documentType ?? ""}
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
