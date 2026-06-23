import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, Button, PageTransition } from "@/components/ui-enhanced";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Star,
  Building2,
  Plus,
  X,
  CheckCircle2,
  Loader2,
  Trash2,
  BadgeCheck,
  UserCheck,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import type { RecommendationLetter } from "@workspace/api-client-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function useLetters() {
  return useQuery<{ letters: RecommendationLetter[] }>({
    queryKey: ["recommendation-letters"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/recommendation-letters/mine`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch letters");
      return res.json() as Promise<{ letters: RecommendationLetter[] }>;
    },
  });
}

function useAddLetter() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (data: { authorName: string; authorTitle: string; organisation: string; relationship: string; content: string }) => {
      const res = await fetch(`${BASE}/api/recommendation-letters`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        throw new Error(err.error ?? "Failed to add letter");
      }
      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["recommendation-letters"] });
      toast({ title: "Letter added", description: "Your recommendation letter has been saved." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });
}

function useDeleteLetter() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`${BASE}/api/recommendation-letters/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Failed to delete");
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["recommendation-letters"] });
      toast({ title: "Letter removed" });
    },
  });
}

function AddLetterModal({ onClose }: { onClose: () => void }) {
  const addLetter = useAddLetter();
  const [form, setForm] = useState({ authorName: "", authorTitle: "", organisation: "", relationship: "", content: "" });

  async function handleSubmit() {
    if (!form.authorName || !form.authorTitle || !form.organisation || !form.relationship || !form.content) return;
    await addLetter.mutateAsync(form);
    onClose();
  }

  const f = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((p) => ({ ...p, [k]: e.target.value }));

  const inputClass = "w-full text-sm rounded-xl border border-border bg-muted/40 px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-lg bg-background rounded-2xl shadow-2xl border border-border overflow-hidden">
        <div className="flex items-start justify-between p-5 border-b border-border">
          <div>
            <h2 className="text-base font-bold text-foreground">Add Recommendation Letter</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Record a reference from a professional contact.</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-3 max-h-[60vh] overflow-y-auto">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-foreground mb-1 block">Author name *</label>
              <input type="text" value={form.authorName} onChange={f("authorName")} placeholder="Dr Sarah Jones" className={inputClass} />
            </div>
            <div>
              <label className="text-xs font-semibold text-foreground mb-1 block">Author title/role *</label>
              <input type="text" value={form.authorTitle} onChange={f("authorTitle")} placeholder="Consultant Surgeon" className={inputClass} />
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-foreground mb-1 block">Organisation *</label>
            <input type="text" value={form.organisation} onChange={f("organisation")} placeholder="NHS Trust / Hospital name" className={inputClass} />
          </div>
          <div>
            <label className="text-xs font-semibold text-foreground mb-1 block">Your relationship *</label>
            <select value={form.relationship} onChange={f("relationship")} className={inputClass}>
              <option value="">Select relationship</option>
              <option value="Line Manager">Line Manager / Supervisor</option>
              <option value="Colleague">Colleague</option>
              <option value="Clinical Supervisor">Clinical Supervisor</option>
              <option value="Academic Supervisor">Academic Supervisor</option>
              <option value="Mentor">Mentor</option>
              <option value="Other">Other professional contact</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-foreground mb-1 block">Letter content *</label>
            <textarea
              value={form.content}
              onChange={f("content")}
              rows={6}
              placeholder="Paste or type the full recommendation letter text here…"
              className={`${inputClass} resize-none`}
            />
            <p className="text-[10px] text-muted-foreground mt-1">{form.content.length} chars (min 50)</p>
          </div>
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-3">
            <p className="text-xs text-blue-800">
              <strong>Note:</strong> Self-submitted letters are marked as unverified. Ask the employer to submit directly via JOBSAGE for a verified badge.
            </p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 px-5 pb-5 pt-3 border-t border-border">
          <Button variant="outline" size="sm" onClick={onClose} disabled={addLetter.isPending}>Cancel</Button>
          <Button size="sm" onClick={handleSubmit} disabled={addLetter.isPending || form.content.length < 50} className="gap-1.5">
            {addLetter.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
            Save Letter
          </Button>
        </div>
      </motion.div>
    </div>
  );
}

function LetterCard({ letter }: { letter: RecommendationLetter }) {
  const [expanded, setExpanded] = useState(false);
  const deleteLetter = useDeleteLetter();

  return (
    <Card className="p-5">
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
          <Star className="w-5 h-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-semibold text-foreground text-sm">{letter.authorName}</p>
                {letter.isEmployerVerified ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-700 border border-emerald-300">
                    <BadgeCheck className="w-3 h-3" /> Employer Verified
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-muted text-muted-foreground border border-border">
                    <UserCheck className="w-3 h-3" /> Self-submitted
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">{letter.authorTitle} · {letter.relationship}</p>
              <div className="flex items-center gap-1.5 mt-0.5 text-xs text-muted-foreground">
                <Building2 className="w-3 h-3" /> {letter.organisation}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-[11px] text-muted-foreground">
                {format(parseISO(letter.createdAt), "d MMM yyyy")}
              </span>
              <button
                onClick={() => deleteLetter.mutate(letter.id)}
                disabled={deleteLetter.isPending}
                className="p-1.5 rounded-lg hover:bg-rose-50 text-muted-foreground hover:text-rose-500 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
          <button
            onClick={() => setExpanded((e) => !e)}
            className="flex items-center gap-1 text-xs text-primary hover:underline mt-2"
          >
            {expanded ? <><ChevronUp className="w-3 h-3" /> Hide letter</> : <><ChevronDown className="w-3 h-3" /> Read letter</>}
          </button>
          <AnimatePresence>
            {expanded && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="mt-3 p-4 bg-muted/40 rounded-xl border border-border">
                  <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">{letter.content}</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </Card>
  );
}

export default function RecommendationLettersPage() {
  const { data, isLoading } = useLetters();
  const [showAdd, setShowAdd] = useState(false);
  const letters = data?.letters ?? [];

  const verified = letters.filter((l) => l.isEmployerVerified);
  const selfSubmitted = letters.filter((l) => !l.isEmployerVerified);

  return (
    <AppLayout>
      <PageTransition>
        {showAdd && <AddLetterModal onClose={() => setShowAdd(false)} />}

        <header className="mb-8 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-display font-bold text-foreground flex items-center gap-3">
              <Star className="w-8 h-8 text-primary" />
              Recommendation Letters
            </h1>
            <p className="text-muted-foreground mt-2 text-sm">
              Professional references and verified employer endorsements that strengthen your profile.
            </p>
          </div>
          <Button onClick={() => setShowAdd(true)} className="gap-1.5 shrink-0">
            <Plus className="w-4 h-4" /> Add Letter
          </Button>
        </header>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
          </div>
        ) : letters.length === 0 ? (
          <Card className="p-10 text-center">
            <Star className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
            <p className="font-semibold text-foreground">No recommendation letters yet</p>
            <p className="text-sm text-muted-foreground mt-1 mb-4">
              Add a self-submitted letter or ask an employer to send a verified reference through JOBSAGE.
            </p>
            <Button onClick={() => setShowAdd(true)} variant="outline" className="gap-1.5">
              <Plus className="w-4 h-4" /> Add your first letter
            </Button>
          </Card>
        ) : (
          <div className="space-y-6">
            {verified.length > 0 && (
              <section>
                <h2 className="text-sm font-bold text-foreground mb-3 flex items-center gap-2">
                  <BadgeCheck className="w-4 h-4 text-emerald-500" /> Employer Verified ({verified.length})
                </h2>
                <div className="space-y-3">
                  {verified.map((l) => <LetterCard key={l.id} letter={l} />)}
                </div>
              </section>
            )}
            {selfSubmitted.length > 0 && (
              <section>
                <h2 className="text-sm font-bold text-foreground mb-3 flex items-center gap-2">
                  <UserCheck className="w-4 h-4 text-muted-foreground" /> Self-submitted ({selfSubmitted.length})
                </h2>
                <div className="space-y-3">
                  {selfSubmitted.map((l) => <LetterCard key={l.id} letter={l} />)}
                </div>
              </section>
            )}
          </div>
        )}
      </PageTransition>
    </AppLayout>
  );
}
