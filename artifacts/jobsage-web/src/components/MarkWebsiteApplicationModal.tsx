import { useState, useEffect } from "react";
import { Button } from "@/components/ui-enhanced";
import { useListMyDocuments } from "@workspace/api-client-react";
import { Globe, X, ExternalLink, Building2, FileText, ChevronDown } from "lucide-react";
import { motion } from "framer-motion";

interface Props {
  companyName?: string;
  onSubmit: (data: { companyName: string; applicationUrl: string; notes: string; cvDocumentId?: number | null }) => void;
  onClose: () => void;
  isPending?: boolean;
}

export function MarkWebsiteApplicationModal({ companyName: initialCompany = "", onSubmit, onClose, isPending }: Props) {
  const [company, setCompany] = useState(initialCompany);
  const [url, setUrl] = useState("");
  const [notes, setNotes] = useState("");

  const { data: documentsData } = useListMyDocuments();
  const cvDocuments = (documentsData?.documents ?? []).filter(
    (d) => (d as { documentType?: string | null }).documentType === "cv",
  );
  const [selectedCvId, setSelectedCvId] = useState<number | null>(null);
  useEffect(() => {
    if (!documentsData) return;
    setSelectedCvId((prev) => {
      if (prev !== null) return prev;
      const cvDocs = (documentsData.documents ?? []).filter(
        (d) => (d as { documentType?: string | null }).documentType === "cv",
      );
      const primary = cvDocs.find((d) => (d as { isPrimary?: boolean }).isPrimary);
      return primary?.id ?? cvDocs[0]?.id ?? null;
    });
  }, [documentsData]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!company.trim()) return;
    onSubmit({
      companyName: company.trim(),
      applicationUrl: url.trim(),
      notes: notes.trim(),
      cvDocumentId: selectedCvId,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96 }}
        className="relative bg-background rounded-2xl shadow-2xl w-full max-w-md z-10 overflow-hidden"
      >
        <div className="h-1.5 bg-gradient-to-r from-blue-500 to-indigo-500" />
        <div className="p-6">
          <div className="flex items-start justify-between mb-5">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-xl bg-blue-500/10 flex items-center justify-center">
                <Globe className="w-4 h-4 text-blue-600" />
              </div>
              <div>
                <h2 className="text-base font-bold text-foreground">Mark as Applied on Website</h2>
                <p className="text-xs text-muted-foreground">Log an application you submitted directly on a company's site</p>
              </div>
            </div>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1 rounded-lg hover:bg-muted transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-xs font-semibold text-foreground mb-1.5 flex items-center gap-1">
                <Building2 className="w-3 h-3" /> Company name <span className="text-destructive">*</span>
              </label>
              <input
                type="text"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                placeholder="e.g. NHS Greater Manchester"
                required
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-foreground mb-1.5 flex items-center gap-1">
                <ExternalLink className="w-3 h-3" /> Application URL <span className="text-muted-foreground font-normal">(optional)</span>
              </label>
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://jobs.example.com/apply/123"
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-foreground mb-1.5">
                Notes <span className="text-muted-foreground font-normal">(optional)</span>
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Role title, reference number, anything useful..."
                rows={2}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none"
              />
            </div>

            {cvDocuments.length >= 1 && (
              <div>
                <label className="text-xs font-semibold text-foreground mb-1.5 flex items-center gap-1">
                  <FileText className="w-3 h-3 text-primary" /> Which CV did you use? <span className="text-muted-foreground font-normal">(optional)</span>
                </label>
                <div className="relative">
                  <select
                    value={selectedCvId ?? ""}
                    onChange={(e) => setSelectedCvId(e.target.value ? parseInt(e.target.value, 10) : null)}
                    className="w-full appearance-none text-sm rounded-lg border border-border bg-muted/40 px-3 py-2 pr-8 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                  >
                    <option value="">None / not sure</option>
                    {cvDocuments.map((cv) => {
                      const cvExtra = cv as typeof cv & { label?: string | null; isPrimary?: boolean };
                      return (
                        <option key={cv.id} value={cv.id}>
                          {cvExtra.label ?? cv.filename}{cvExtra.isPrimary ? " ★ Primary" : ""}
                        </option>
                      );
                    })}
                  </select>
                  <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                </div>
              </div>
            )}

            <div className="flex gap-3 pt-1">
              <Button type="button" variant="outline" className="flex-1" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" className="flex-1 gap-1.5" disabled={!company.trim() || isPending}>
                {isPending ? (
                  <span className="flex items-center gap-1.5">
                    <span className="w-3.5 h-3.5 border-2 border-current/30 border-t-current rounded-full animate-spin" />
                    Saving…
                  </span>
                ) : (
                  <><Globe className="w-3.5 h-3.5" /> Log Application</>
                )}
              </Button>
            </div>
          </form>
        </div>
      </motion.div>
    </div>
  );
}
