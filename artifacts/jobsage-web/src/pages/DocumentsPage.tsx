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
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";

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
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" title="High confidence" />
                  ) : conf === "medium" ? (
                    <AlertTriangle className="w-4 h-4 text-amber-500" title="Medium confidence" />
                  ) : conf === "low" || conf === "none" ? (
                    <AlertTriangle className="w-4 h-4 text-rose-400" title="Low/no confidence" />
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

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const result = await uploadFile(file);
    if (result) {
      toast({ title: "Upload complete", description: `${file.name} uploaded. Extracting profile data…` });
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

  const handleConfirmMerge = async (extracted: CvExtractedFields) => {
    if (!profile) {
      toast({ title: "Profile not found", description: "Please complete your profile first.", variant: "destructive" });
      return;
    }
    setIsSavingProfile(true);
    try {
      const merged = {
        profession: (extracted.profession as typeof profile.profession) ?? profile.profession,
        specialty: extracted.specialty ?? profile.specialty,
        qualificationCountry: extracted.qualificationCountry ?? profile.qualificationCountry,
        qualificationType: extracted.qualificationType ?? profile.qualificationType,
        qualificationYear: extracted.qualificationYear ?? profile.qualificationYear,
        experienceYears: extracted.experienceYears ?? profile.experienceYears,
        registrationStatus: (extracted.registrationStatus as typeof profile.registrationStatus) ?? profile.registrationStatus,
        requiresSponsorship: extracted.requiresSponsorship ?? profile.requiresSponsorship,
        licenceReady: profile.licenceReady,
        residencyStatus: profile.residencyStatus,
        preferredRegion: extracted.preferredRegion ?? profile.preferredRegion,
      };

      await upsertProfileMutation.mutateAsync({ data: merged });
      queryClient.invalidateQueries({ queryKey: getGetMyProfileQueryKey() });
      toast({ title: "Profile updated!", description: "Your profile has been updated with data from your CV." });
      setParsedExtracted(null);
    } catch {
      toast({ title: "Failed to save", description: "Could not update your profile. Please try again.", variant: "destructive" });
    } finally {
      setIsSavingProfile(false);
    }
  };

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
              Upload your CV to auto-fill your profile, or keep documents for easy reference.
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

        {(!data?.documents || data.documents.length === 0) && !isUploading ? (
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {data?.documents.map((doc) => {
              const isPdf = doc.mimeType === "application/pdf";
              const isImg = doc.mimeType.startsWith("image/");
              const canParse = isPdf || isImg;
              const isParsing = parsingDocId === doc.id;

              return (
                <Card key={doc.id} className="p-5 flex flex-col group hover:shadow-md transition-all">
                  <div className="flex items-start justify-between mb-4">
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
                    className="font-semibold text-foreground truncate mb-1"
                    title={doc.filename}
                  >
                    {doc.filename}
                  </h4>
                  <div className="flex justify-between items-center text-xs text-muted-foreground mt-auto pt-4 border-t border-border">
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
        )}
      </PageTransition>
    </AppLayout>
  );
}
