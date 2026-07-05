import { useState, useRef } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, Button, PageTransition } from "@/components/ui-enhanced";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  ShieldCheck,
  Upload,
  CreditCard,
  Camera,
  CheckCircle2,
  AlertTriangle,
  Clock,
  XCircle,
  Loader2,
  Info,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { IdentityVerification } from "@workspace/api-client-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function useIdentityStatus() {
  return useQuery<{ verification: IdentityVerification | null }>({
    queryKey: ["identity-status"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/identity/status`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch status");
      return res.json() as Promise<{ verification: IdentityVerification | null }>;
    },
    refetchInterval: (query) => {
      const status = query.state.data?.verification?.status;
      return status === "pending" ? 5000 : false;
    },
  });
}

async function uploadFile(file: File): Promise<string> {
  const urlRes = await fetch(`${BASE}/api/storage/uploads/request-url`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contentType: file.type }),
  });
  if (!urlRes.ok) throw new Error("Failed to get upload URL");
  const { uploadURL, storageKey } = await urlRes.json() as { uploadURL: string; storageKey: string };
  const putRes = await fetch(uploadURL, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
  if (!putRes.ok) throw new Error("Failed to upload file");
  return storageKey;
}

function FileDropZone({
  label,
  icon: Icon,
  accept,
  file,
  onFile,
  hint,
}: {
  label: string;
  icon: React.ElementType;
  accept: string;
  file: File | null;
  onFile: (f: File) => void;
  hint: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div
      onClick={() => ref.current?.click()}
      className="border-2 border-dashed border-border rounded-2xl p-6 text-center cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-all"
    >
      <input ref={ref} type="file" accept={accept} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
      {file ? (
        <div className="flex flex-col items-center gap-2">
          <CheckCircle2 className="w-8 h-8 text-emerald-500" />
          <p className="text-sm font-semibold text-foreground truncate max-w-full">{file.name}</p>
          <p className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(0)} KB · Click to change</p>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2">
          <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center">
            <Icon className="w-6 h-6 text-muted-foreground" />
          </div>
          <p className="text-sm font-semibold text-foreground">{label}</p>
          <p className="text-xs text-muted-foreground">{hint}</p>
          <Button size="sm" variant="outline" className="mt-1 gap-1.5 pointer-events-none">
            <Upload className="w-3.5 h-3.5" /> Choose file
          </Button>
        </div>
      )}
    </div>
  );
}

function StatusBanner({ verification }: { verification: IdentityVerification }) {
  const configs = {
    pending: {
      icon: Clock,
      title: "Verification in progress",
      desc: verification.aiNotes
        ? `AI assessment: ${verification.aiNotes}`
        : "Your documents are being reviewed. This usually takes a few minutes.",
      bg: "bg-amber-50 border-amber-200",
      text: "text-amber-800",
      iconColor: "text-amber-500",
    },
    verified: {
      icon: CheckCircle2,
      title: "Identity verified",
      desc: `Your identity has been confirmed${verification.aiConfidence ? ` (AI confidence: ${verification.aiConfidence})` : ""}.`,
      bg: "bg-emerald-50 border-emerald-200",
      text: "text-emerald-800",
      iconColor: "text-emerald-500",
    },
    rejected: {
      icon: XCircle,
      title: "Verification unsuccessful",
      desc: verification.adminNotes ?? "Please re-submit with clearer images of your ID and selfie.",
      bg: "bg-rose-50 border-rose-200",
      text: "text-rose-800",
      iconColor: "text-rose-500",
    },
  };

  const cfg = configs[verification.status];
  const StatusIcon = cfg.icon;

  return (
    <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
      className={`flex items-start gap-4 p-5 rounded-2xl border ${cfg.bg} mb-6`}>
      <StatusIcon className={`w-6 h-6 mt-0.5 shrink-0 ${cfg.iconColor}`} />
      <div>
        <p className={`font-semibold text-base ${cfg.text}`}>{cfg.title}</p>
        <p className={`text-sm mt-0.5 ${cfg.text} opacity-80`}>{cfg.desc}</p>
        {verification.status === "pending" && (
          <div className="flex items-center gap-1.5 mt-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-600" />
            <span className="text-xs text-amber-700">Auto-refreshing…</span>
          </div>
        )}
      </div>
    </motion.div>
  );
}

export default function IdentityVerificationPage() {
  const { data, isLoading } = useIdentityStatus();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [passport, setPassport] = useState<File | null>(null);
  const [selfie, setSelfie] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const verification = data?.verification ?? null;
  const canResubmit = !verification || verification.status === "rejected";

  async function handleSubmit() {
    if (!passport || !selfie) return;
    setSubmitting(true);
    try {
      const [passportKey, selfieKey] = await Promise.all([uploadFile(passport), uploadFile(selfie)]);
      const res = await fetch(`${BASE}/api/identity/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ passportKey, selfieKey }),
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        throw new Error(err.error ?? "Submission failed");
      }
      await queryClient.invalidateQueries({ queryKey: ["identity-status"] });
      toast({ title: "Documents submitted", description: "AI verification is running — usually takes a minute." });
      setPassport(null);
      setSelfie(null);
    } catch (err) {
      toast({ title: "Submission failed", description: err instanceof Error ? err.message : "Please try again.", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AppLayout>
      <PageTransition>
        <header className="mb-8">
          <h1 className="text-3xl font-display font-bold text-foreground flex items-center gap-3">
            <ShieldCheck className="w-8 h-8 text-primary" />
            ID Verification
          </h1>
          <p className="text-muted-foreground mt-2 text-sm">
            Verify your identity to unlock the verified badge on your profile and increase employer trust.
          </p>
        </header>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
          </div>
        ) : (
          <div className="max-w-xl space-y-6">
            {verification && <StatusBanner verification={verification} />}

            {verification?.status === "verified" ? (
              <Card className="p-6 flex items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
                  <ShieldCheck className="w-6 h-6 text-emerald-600" />
                </div>
                <div>
                  <p className="font-semibold text-foreground">Your identity is verified</p>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    A verified badge will appear on your profile. Employers can see you're identity-confirmed.
                  </p>
                </div>
              </Card>
            ) : (
              <Card className="p-6 space-y-6">
                <div>
                  <h2 className="text-base font-bold text-foreground mb-1">
                    {verification?.status === "rejected" ? "Re-submit your documents" : "Submit your documents"}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Upload a clear photo of your passport or government ID, and a recent selfie. Our AI will compare them automatically.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FileDropZone
                    label="Passport / ID"
                    icon={CreditCard}
                    accept="image/jpeg,image/png,application/pdf"
                    file={passport}
                    onFile={setPassport}
                    hint="JPG, PNG or PDF · max 10 MB"
                  />
                  <FileDropZone
                    label="Selfie photo"
                    icon={Camera}
                    accept="image/jpeg,image/png"
                    file={selfie}
                    onFile={setSelfie}
                    hint="JPG or PNG · clear face, good lighting"
                  />
                </div>

                <div className="flex items-start gap-3 p-4 bg-blue-50 border border-blue-200 rounded-xl">
                  <Info className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
                  <div className="text-xs text-blue-800 space-y-1">
                    <p><strong>Privacy:</strong> Your documents are stored securely and only used for verification.</p>
                    <p>High-confidence matches are auto-verified. Others are queued for manual admin review.</p>
                  </div>
                </div>

                <Button
                  onClick={handleSubmit}
                  disabled={!passport || !selfie || submitting || !canResubmit}
                  className="w-full gap-2"
                >
                  {submitting ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Uploading & submitting…</>
                  ) : (
                    <><ShieldCheck className="w-4 h-4" /> Submit for verification</>
                  )}
                </Button>
              </Card>
            )}

            <Card className="p-4">
              <h3 className="text-xs font-bold text-foreground mb-3 uppercase tracking-wide">How it works</h3>
              <div className="space-y-2">
                {[
                  ["1", "Upload your passport/ID and a selfie"],
                  ["2", "AI compares the faces in both images"],
                  ["3", "High-confidence matches are instantly verified"],
                  ["4", "Others are manually reviewed by our team (24–48h)"],
                ].map(([num, text]) => (
                  <div key={num} className="flex items-center gap-3">
                    <span className="w-5 h-5 rounded-full bg-primary/10 text-primary text-[11px] font-bold flex items-center justify-center shrink-0">{num}</span>
                    <p className="text-xs text-muted-foreground">{text}</p>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        )}
      </PageTransition>
    </AppLayout>
  );
}
