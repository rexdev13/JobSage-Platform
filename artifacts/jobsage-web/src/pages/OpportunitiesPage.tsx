import { useState } from "react";
import { useAuth } from "@workspace/auth-web";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, Button, PageTransition } from "@/components/ui-enhanced";
import { MarkWebsiteApplicationModal } from "@/components/MarkWebsiteApplicationModal";
import {
  useListMatchedRoles,
  useListMyApplications,
  useMarkApplication,
  useGenerateCoverLetter,
  useGetMyProfile,
  useGetMyMatches,
  useDismissMatch,
  getListMyApplicationsQueryKey,
  getListMatchedRolesQueryKey,
  getGetMyMatchesQueryKey,
  type MatchedRole,
  type ApplicationList,
  type CandidateMatchItem,
  type CandidateMatchList,
} from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { SmartApplyModal } from "@/components/SmartApplyModal";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import {
  Briefcase,
  MapPin,
  Building2,
  CheckCircle2,
  XCircle,
  HelpCircle,
  AlertCircle,
  ArrowRight,
  Star,
  ChevronDown,
  ChevronUp,
  X,
  Megaphone,
  ClipboardList,
  Linkedin,
  Globe,
  Mail,
  Phone,
  TrendingUp,
  Search,
  BadgeCheck,
  Clock,
  DollarSign,
  Sparkles,
  FileText,
  Copy,
  Loader2,
  Zap,
  Medal,
  Info,
  Send,
  Calendar,
  CalendarDays,
  ExternalLink,
} from "lucide-react";
import { DisclaimerBanner } from "@/components/ui/DisclaimerBanner";
import { motion, AnimatePresence } from "framer-motion";

type Tab = "board" | "employers" | "applications";

function AiScoreBadge({ score }: { score: number }) {
  const cls =
    score >= 80
      ? "bg-emerald-100 text-emerald-800 border-emerald-200"
      : score >= 55
      ? "bg-blue-100 text-blue-800 border-blue-200"
      : "bg-muted text-muted-foreground border-border";
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold border ${cls}`}>
      <Zap className="w-3 h-3" /> {score}% match
    </span>
  );
}

function BestMatchesStrip({
  matchesData,
  matchesLoading,
  appliedRoleIds,
  localDismissedIds,
  onSmartApply,
  onDismiss,
}: {
  matchesData: CandidateMatchList | undefined;
  matchesLoading: boolean;
  appliedRoleIds: number[];
  localDismissedIds: Set<number>;
  onSmartApply: (roleId: number, roleTitle: string) => void;
  onDismiss: (roleId: number) => void;
}) {
  const [, setLocation] = useLocation();

  const serverDismissed = new Set(matchesData?.dismissedRoleIds ?? []);
  const effectiveDismissed = new Set([...serverDismissed, ...localDismissedIds]);

  const allMatches: CandidateMatchItem[] = matchesData?.matches ?? [];
  const visibleQueue = allMatches
    .filter((m) => !effectiveDismissed.has(m.roleId) && !appliedRoleIds.includes(m.roleId))
    .slice(0, 3);

  const totalAvailable = (matchesData?.totalCount ?? allMatches.length) - localDismissedIds.size;

  if (matchesLoading) {
    return (
      <div className="rounded-2xl border border-border bg-gradient-to-br from-primary/3 to-accent/3 p-5">
        <div className="flex items-center gap-2 mb-4">
          <Zap className="w-4 h-4 text-primary animate-pulse" />
          <span className="text-sm font-semibold text-foreground">Your Best Matches Right Now</span>
          <span className="text-xs text-muted-foreground ml-1">AI scoring…</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-28 rounded-xl bg-muted/50 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (!matchesData || allMatches.length === 0) return null;

  if (visibleQueue.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-gradient-to-br from-primary/3 to-accent/3 p-5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5 text-emerald-500" />
          <p className="text-sm font-medium text-foreground">You&apos;ve reviewed all your top matches — well done!</p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => document.getElementById("job-board-section")?.scrollIntoView({ behavior: "smooth" })}
        >
          See all roles
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/3 to-accent/3 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">Your Best Matches Right Now</h2>
          <span className="px-1.5 py-0.5 text-xs rounded bg-primary/10 text-primary font-medium">AI</span>
        </div>
        <p className="text-xs text-muted-foreground">{matchesData.cached ? "Updated today" : "Just scored"}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <AnimatePresence mode="popLayout">
          {visibleQueue.map((match) => (
            <motion.div
              key={match.roleId}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative bg-background rounded-xl border border-border p-4 flex flex-col gap-2 shadow-sm"
            >
              <button
                className="absolute top-2 right-2 text-muted-foreground hover:text-foreground p-1 rounded-lg hover:bg-muted transition-colors"
                onClick={() => onDismiss(match.roleId)}
                title="Dismiss"
              >
                <X className="w-3.5 h-3.5" />
              </button>

              <div className="flex items-start gap-2 pr-6">
                <AiScoreBadge score={match.aiScore} />
              </div>

              <p className="text-xs text-muted-foreground italic leading-snug">&ldquo;{match.aiExplanation}&rdquo;</p>

              <div className="flex-1">
                <p className="text-sm font-semibold text-foreground leading-tight line-clamp-2">{match.title}</p>
                <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><Building2 className="w-3 h-3" />{match.employer}</span>
                  <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{match.location}</span>
                </div>
              </div>

              <div className="flex gap-2 mt-auto pt-1">
                {match.isEligible ? (
                  <Button
                    size="sm"
                    className="flex-1 text-xs h-8 gap-1"
                    onClick={() => onSmartApply(match.roleId, match.title)}
                  >
                    <Sparkles className="w-3 h-3" /> Apply Now
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 text-xs h-8 gap-1 text-amber-700 border-amber-200"
                    onClick={() => setLocation("/path")}
                  >
                    View Path <ArrowRight className="w-3 h-3" />
                  </Button>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      <div className="flex items-center justify-between pt-1">
        <p className="text-xs text-muted-foreground">
          Showing top 3 of {totalAvailable} AI-ranked matches
        </p>
        <button
          className="text-xs text-primary font-medium flex items-center gap-1 hover:underline"
          onClick={() => document.getElementById("job-board-section")?.scrollIntoView({ behavior: "smooth" })}
        >
          See all {totalAvailable} matches below <ArrowRight className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

function SponsorshipBadge({ outcome }: { outcome: "feasible" | "not_feasible" | "uncertain" | undefined }) {
  if (!outcome) return null;
  if (outcome === "feasible")
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-800">
        <CheckCircle2 className="w-3 h-3" /> Sponsorship: Feasible
      </span>
    );
  if (outcome === "not_feasible")
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700">
        <XCircle className="w-3 h-3" /> Sponsorship: Not Feasible
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800">
      <HelpCircle className="w-3 h-3" /> Sponsorship: Uncertain
    </span>
  );
}

function MatchScoreBadge({ score }: { score: number }) {
  const color =
    score >= 80 ? "bg-emerald-100 text-emerald-800" : score >= 50 ? "bg-blue-100 text-blue-800" : "bg-muted text-muted-foreground";
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold ${color}`}>
      <Star className="w-3 h-3" /> {score}% match
    </span>
  );
}

function RoleDetailModal({ item, appliedRoleIds, onClose, onApply }: {
  item: MatchedRole;
  appliedRoleIds: number[];
  onClose: () => void;
  onApply: (roleId: number) => void;
}) {
  const [, setLocation] = useLocation();
  const { role, isEligible, matchScore, eligibilityGaps, sponsorshipFeasibility } = item;
  const applied = appliedRoleIds.includes(role.id);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        className="relative bg-background rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto z-10"
      >
        <div className={`h-2 rounded-t-2xl ${isEligible ? "bg-gradient-to-r from-emerald-500 to-green-400" : "bg-gradient-to-r from-amber-400 to-orange-400"}`} />
        <div className="p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="text-xl font-bold text-foreground">{role.title}</h2>
              <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
                <span className="flex items-center gap-1"><Building2 className="w-3.5 h-3.5" /> {role.employer}</span>
                <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /> {role.location}</span>
              </div>
            </div>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1 rounded-lg hover:bg-muted transition-colors ml-2">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex flex-wrap gap-2 mb-4">
            {isEligible ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">
                <BadgeCheck className="w-3.5 h-3.5" /> Eligible Now
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800">
                <Clock className="w-3.5 h-3.5" /> Not Yet Eligible
              </span>
            )}
            <MatchScoreBadge score={matchScore} />
            <SponsorshipBadge outcome={sponsorshipFeasibility?.outcome} />
          </div>

          <div className="space-y-3 mb-5">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="p-3 rounded-lg bg-muted/40">
                <p className="text-xs text-muted-foreground mb-0.5">Regulator</p>
                <p className="font-semibold">{role.regulator}</p>
              </div>
              <div className="p-3 rounded-lg bg-muted/40">
                <p className="text-xs text-muted-foreground mb-0.5">Required Registration</p>
                <p className="font-semibold text-xs leading-tight">{role.requiredRegistration}</p>
              </div>
              <div className="p-3 rounded-lg bg-muted/40">
                <p className="text-xs text-muted-foreground mb-0.5">Sponsorship Offered</p>
                <p className="font-semibold">{role.sponsorshipOffered ? "Yes" : "No"}</p>
              </div>
            </div>
          </div>

          {!isEligible && eligibilityGaps && eligibilityGaps.length > 0 && (
            <div className="mb-4 p-4 rounded-xl bg-amber-50 border border-amber-200">
              <p className="text-xs font-semibold text-amber-800 mb-2 uppercase tracking-wide">Why you&apos;re not yet eligible</p>
              <ul className="space-y-1.5">
                {eligibilityGaps.map((gap, i) => (
                  <li key={i} className="text-xs text-amber-800 flex items-start gap-2">
                    <span className="text-amber-500 mt-0.5">•</span> {gap}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {sponsorshipFeasibility && (
            <div className="mb-4 p-3 rounded-xl bg-blue-50 border border-blue-100 text-xs text-blue-800">
              <p className="font-semibold mb-0.5">Sponsorship note:</p>
              <p>{sponsorshipFeasibility.explanation}</p>
              {sponsorshipFeasibility.disclaimer && (
                <p className="mt-1 italic text-blue-700">{sponsorshipFeasibility.disclaimer}</p>
              )}
            </div>
          )}

          <div className="flex gap-3">
            {isEligible ? (
              <Button
                className="flex-1"
                onClick={() => { onApply(role.id); onClose(); }}
                disabled={applied}
              >
                {applied ? <><CheckCircle2 className="w-4 h-4 mr-2" /> Applied</> : <><ClipboardList className="w-4 h-4 mr-2" /> Start Application</>}
              </Button>
            ) : (
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => { onClose(); setLocation("/path"); }}
              >
                View Remediation Path <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function useCoverLetterStream() {
  const [text, setText] = useState("");
  const [disclaimer, setDisclaimer] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setText("");
    setDisclaimer("");
    setStreaming(false);
    setDone(false);
    setError(null);
  }

  async function generate(payload: {
    jobTitle: string;
    employer: string;
    location?: string | null;
    regulator?: string | null;
    jobDescription?: string | null;
    roleId?: number;
  }) {
    reset();
    setStreaming(true);
    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    try {
      const resp = await fetch(`${base}/api/cover-letter/generate-stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (!resp.ok || !resp.body) {
        setError("Failed to start generation. Please try again.");
        setStreaming(false);
        return;
      }
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done: rdDone, value } = await reader.read();
        if (rdDone) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const parsed = JSON.parse(line.slice(6)) as { text?: string; done?: boolean; disclaimer?: string; error?: string };
            if (parsed.error) { setError(parsed.error); setStreaming(false); return; }
            if (parsed.text) setText((prev) => prev + parsed.text);
            if (parsed.done) {
              setDisclaimer(parsed.disclaimer ?? "");
              setDone(true);
              setStreaming(false);
            }
          } catch { /* ignore parse errors */ }
        }
      }
    } catch {
      setError("Network error. Please try again.");
      setStreaming(false);
    }
  }

  return { text, setText, disclaimer, streaming, done, error, generate, reset };
}

function CoverLetterModal({
  role,
  onClose,
}: {
  role: { id: number; title: string; employer: string; location: string; regulator: string; description?: string | null };
  onClose: () => void;
}) {
  const { toast } = useToast();
  const stream = useCoverLetterStream();
  const [editableText, setEditableText] = useState("");
  const [copied, setCopied] = useState(false);

  // Sync editable text while streaming
  if (stream.streaming && stream.text !== editableText) {
    setEditableText(stream.text);
  }

  function handleGenerate() {
    stream.generate({
      jobTitle: role.title,
      employer: role.employer,
      location: role.location,
      regulator: role.regulator,
      jobDescription: role.description ?? null,
      roleId: role.id,
    }).catch(() => toast({ title: "Error", description: "Failed to generate cover letter.", variant: "destructive" }));
  }

  function handleCopy() {
    const content = stream.done ? editableText : stream.text;
    if (!content) return;
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function handleDownload() {
    const content = stream.done ? editableText : stream.text;
    if (!content) return;
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cover-letter-${role.employer.replace(/\s+/g, "-").toLowerCase()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const hasContent = stream.text.length > 0 || editableText.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 40 }}
        className="relative bg-background border border-border rounded-2xl shadow-2xl w-full max-w-2xl mx-4 max-h-[90vh] flex flex-col overflow-hidden"
      >
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div>
            <h3 className="font-semibold text-foreground flex items-center gap-2">
              <FileText className="w-4 h-4 text-primary" /> Cover Letter Generator
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {role.title} · {role.employer}
            </p>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-accent transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {!hasContent && !stream.streaming && !stream.error && (
            <div className="text-center py-8">
              <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
                <Sparkles className="w-8 h-8 text-primary" />
              </div>
              <h4 className="text-base font-semibold text-foreground mb-2">Generate a tailored cover letter</h4>
              <p className="text-sm text-muted-foreground mb-6 max-w-md mx-auto">
                AI will write a personalised cover letter for this role based on your profile and any CV documents you have uploaded.
              </p>
              <Button onClick={handleGenerate} className="gap-2">
                <Sparkles className="w-4 h-4" /> Generate Cover Letter
              </Button>
            </div>
          )}

          {stream.error && (
            <div className="text-center py-8">
              <p className="text-sm text-destructive mb-3">{stream.error}</p>
              <Button variant="outline" onClick={handleGenerate} className="gap-2">
                <Sparkles className="w-4 h-4" /> Try Again
              </Button>
            </div>
          )}

          {(hasContent || stream.streaming) && (
            <div className="space-y-4">
              {stream.streaming && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                  Writing your cover letter…
                </div>
              )}
              <textarea
                className="w-full min-h-[340px] p-4 text-sm text-foreground leading-relaxed bg-muted/40 rounded-xl border border-border resize-y focus:outline-none focus:ring-2 focus:ring-primary/30 font-sans"
                value={stream.streaming ? stream.text : editableText}
                onChange={(e) => setEditableText(e.target.value)}
                readOnly={stream.streaming}
                placeholder="Your cover letter will appear here…"
              />
              {stream.done && stream.disclaimer && (
                <p className="text-xs text-muted-foreground border-l-2 border-primary/30 pl-3">
                  {stream.disclaimer}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="p-5 border-t border-border flex items-center justify-between gap-3">
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
          <div className="flex gap-2 flex-wrap justify-end">
            {hasContent && (
              <>
                <Button size="sm" variant="outline" onClick={handleGenerate} disabled={stream.streaming} className="gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" /> Regenerate
                </Button>
                <Button size="sm" variant="outline" onClick={handleDownload} disabled={stream.streaming} className="gap-1.5">
                  <FileText className="w-3.5 h-3.5" /> Download .txt
                </Button>
                <Button size="sm" onClick={handleCopy} disabled={stream.streaming} className="gap-1.5">
                  {copied ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? "Copied!" : "Copy"}
                </Button>
              </>
            )}
            {!hasContent && !stream.streaming && (
              <Button size="sm" onClick={handleGenerate} className="gap-1.5">
                <Sparkles className="w-3.5 h-3.5" /> Generate
              </Button>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function RoleCard({
  item,
  appliedRoleIds,
  onApply,
  onSmartApply,
  onViewDetail,
  onCoverLetter,
  onMarkWebsite,
  recommended,
}: {
  item: MatchedRole;
  appliedRoleIds: number[];
  onApply: (roleId: number) => void;
  onSmartApply: (roleId: number, roleTitle: string) => void;
  onViewDetail: (item: MatchedRole) => void;
  onCoverLetter: (role: MatchedRole["role"]) => void;
  onMarkWebsite?: (employer: string) => void;
  recommended?: boolean;
}) {
  const [, setLocation] = useLocation();
  const { role, isEligible, matchScore, eligibilityGaps, sponsorshipFeasibility, contactEmail, contactPhone, contactWebsite, applyUrl } = item;
  const [expanded, setExpanded] = useState(false);
  const { toast } = useToast();

  const applied = appliedRoleIds.includes(role.id);
  const hasContactDetails = !!(contactEmail || contactPhone || contactWebsite);

  return (
    <Card
      className={`p-5 hover:shadow-md transition-all cursor-pointer ${
        recommended
          ? "border-primary/30 bg-gradient-to-r from-primary/[0.03] to-accent/[0.03] hover:border-primary/50"
          : isEligible
          ? "border-emerald-100 hover:border-emerald-200"
          : "hover:border-border"
      }`}
      onClick={() => onViewDetail(item)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            {recommended && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-primary/10 text-primary">
                <Medal className="w-3 h-3" /> Apply First
              </span>
            )}
            {isEligible ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">
                <BadgeCheck className="w-3 h-3" /> Eligible Now
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800">
                <Clock className="w-3 h-3" /> Not Yet Eligible
              </span>
            )}
            <MatchScoreBadge score={matchScore} />
          </div>
          <h3 className="text-base font-semibold text-foreground">{role.title}</h3>
          <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground flex-wrap">
            <span className="flex items-center gap-1">
              <Building2 className="w-3.5 h-3.5" /> {role.employer}
            </span>
            <span className="flex items-center gap-1">
              <MapPin className="w-3.5 h-3.5" /> {role.location}
            </span>
            <span className="px-1.5 py-0.5 text-xs rounded bg-muted text-muted-foreground font-mono">
              {role.regulator}
            </span>
          </div>
        </div>
        {applied && (
          <span className="shrink-0 inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-800">
            <CheckCircle2 className="w-3 h-3" /> Applied
          </span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <SponsorshipBadge outcome={sponsorshipFeasibility?.outcome} />
        {role.sponsorshipOffered && (
          <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
            Sponsorship Available
          </span>
        )}
      </div>

      {/* Company contact row */}
      <div className="mt-3 space-y-2" onClick={(e) => e.stopPropagation()}>
        {contactWebsite && (
          <a
            href={contactWebsite.startsWith("http") ? contactWebsite : `https://${contactWebsite}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-xs text-primary hover:underline"
          >
            <Globe className="w-3.5 h-3.5 shrink-0" />
            {contactWebsite.startsWith("http") ? contactWebsite : `https://${contactWebsite}`}
            <ExternalLink className="w-3 h-3 opacity-50" />
          </a>
        )}
        {contactEmail && (
          <a
            href={`mailto:${contactEmail}`}
            className="flex items-center gap-2 text-xs text-foreground hover:text-primary"
          >
            <Mail className="w-3.5 h-3.5 text-primary shrink-0" />
            {contactEmail}
          </a>
        )}
        {contactPhone && (
          <a
            href={`tel:${contactPhone}`}
            className="flex items-center gap-2 text-xs text-foreground hover:text-primary"
          >
            <Phone className="w-3.5 h-3.5 text-primary shrink-0" />
            {contactPhone}
          </a>
        )}
        {!hasContactDetails && (
          <span className="text-xs text-muted-foreground italic">Contact details not yet available</span>
        )}
      </div>

      {eligibilityGaps && eligibilityGaps.length > 0 && (
        <div className="mt-3">
          <button
            className="text-xs text-amber-700 hover:text-amber-900 flex items-center gap-1 transition-colors"
            onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
          >
            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            {expanded ? "Hide" : "See"} eligibility notes
          </button>
          {expanded && (
            <div className="mt-2 p-3 rounded-lg bg-amber-50 border border-amber-100">
              <p className="text-xs text-amber-700 font-medium mb-1.5">Advisory — you can still apply and contact this employer directly:</p>
              <ul className="space-y-1">
                {eligibilityGaps.map((gap, i) => (
                  <li key={i} className="text-xs text-amber-800 flex items-start gap-1.5">
                    <span className="text-amber-500 mt-0.5 shrink-0">•</span> {gap}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {applyUrl && (
        <div className="mt-3" onClick={(e) => e.stopPropagation()}>
          <a
            href={applyUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" /> Apply on employer site
          </a>
        </div>
      )}

      <div
        className="mt-4 flex items-center justify-between"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="text-xs text-muted-foreground">
          Required: <span className="font-medium text-foreground">{role.requiredRegistration}</span>
        </span>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="ghost"
            className="text-xs h-8 gap-1 text-muted-foreground"
            onClick={(e) => { e.stopPropagation(); onCoverLetter(role); }}
          >
            <FileText className="w-3 h-3" /> Cover Letter
          </Button>
          {onMarkWebsite && (
            <Button
              size="sm"
              variant="ghost"
              className="text-xs h-8 gap-1 text-blue-600"
              onClick={(e) => { e.stopPropagation(); onMarkWebsite(role.employer); }}
              title="Log an application you submitted on this employer's own website"
            >
              <Globe className="w-3 h-3" /> Mark applied
            </Button>
          )}
          {isEligible && !applied && (
            <Button
              size="sm"
              variant="default"
              className="text-xs h-8 gap-1"
              onClick={(e) => { e.stopPropagation(); onSmartApply(role.id, role.title); }}
            >
              <Sparkles className="w-3 h-3" /> Smart Apply
            </Button>
          )}
          {isEligible && applied && (
            <Button size="sm" variant="outline" className="text-xs h-8" disabled>
              Applied
            </Button>
          )}
          {!isEligible && !applied && (
            <Button
              size="sm"
              variant="outline"
              className="text-xs h-8 gap-1"
              onClick={(e) => { e.stopPropagation(); onSmartApply(role.id, role.title); }}
            >
              <Sparkles className="w-3 h-3" /> Apply
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

function EmployerCard({ employer, roles }: { employer: string; roles: MatchedRole[] }) {
  const sponsorsCount = roles.filter((r) => r.role.sponsorshipOffered).length;
  const locations = [...new Set(roles.map((r) => r.role.location))].slice(0, 2);
  const regulator = roles[0]?.role.regulator;

  return (
    <Card className="p-5 hover:shadow-md transition-shadow">
      <div className="flex items-start gap-3 mb-3">
        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary font-bold text-sm shrink-0">
          {employer.charAt(0)}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-foreground text-sm leading-tight truncate">{employer}</h3>
          <p className="text-xs text-muted-foreground">{regulator} · {locations.join(", ")}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 items-center mb-3">
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-muted">
          <Briefcase className="w-3 h-3" /> {roles.length} open role{roles.length !== 1 ? "s" : ""}
        </span>
        {sponsorsCount > 0 && (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-800">
            <CheckCircle2 className="w-3 h-3" /> Offers sponsorship
          </span>
        )}
      </div>

      <div className="flex gap-2">
        <a
          href={`https://www.linkedin.com/search/results/companies/?keywords=${encodeURIComponent(employer)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0077B5]/10 text-[#0077B5] text-xs font-medium hover:bg-[#0077B5]/20 transition-colors"
        >
          <Linkedin className="w-3.5 h-3.5" /> LinkedIn
        </a>
        <a
          href={`https://www.google.com/search?q=${encodeURIComponent(employer + " healthcare careers")}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted text-muted-foreground text-xs font-medium hover:bg-muted/80 transition-colors"
        >
          <Globe className="w-3.5 h-3.5" /> Web
        </a>
      </div>
    </Card>
  );
}

type AppKind = "formal" | "speculative" | "website";
type AppSubTab = "platform" | "website" | "speculative";

type RichApplication = {
  id: number;
  userId: string;
  roleId: number;
  status: string;
  appliedAt: string;
  notes?: string | null;
  roleTitle?: string | null;
  roleLocation?: string | null;
  interviewDate?: string | Date | null;
  interviewNotes?: string | null;
  applicationKind?: AppKind;
  companyName?: string | null;
  vacancyTitle?: string | null;
  emailSent?: boolean | null;
  emailSentAt?: string | null;
  emailRecipient?: string | null;
  jobsageEmail?: string | null;
  applicationUrl?: string | null;
};

type RichStats = {
  total?: number;
  interviews?: number;
  offers?: number;
  noResponse?: number;
  platformCount?: number;
  websiteCount?: number;
  speculativeCount?: number;
  cvSent?: number;
};

const APP_STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  applied: { label: "Applied", className: "bg-blue-100 text-blue-800" },
  shortlisted: { label: "Shortlisted", className: "bg-purple-100 text-purple-800" },
  under_review: { label: "Under Review", className: "bg-violet-100 text-violet-800" },
  interview: { label: "Interview", className: "bg-teal-100 text-teal-800" },
  interview_invited: { label: "Interview Invited", className: "bg-teal-100 text-teal-800" },
  offer: { label: "Offer", className: "bg-emerald-100 text-emerald-800" },
  rejected: { label: "Rejected", className: "bg-red-100 text-red-700" },
  no_response: { label: "No Response", className: "bg-muted text-muted-foreground" },
  cv_sent: { label: "CV Sent", className: "bg-sky-100 text-sky-800" },
  sent: { label: "Sent", className: "bg-sky-100 text-sky-800" },
  acknowledged: { label: "Acknowledged", className: "bg-emerald-100 text-emerald-800" },
};

function AppCard({ app }: { app: RichApplication }) {
  const kind = app.applicationKind ?? "formal";
  const isSpeculative = kind === "speculative";
  const isWebsite = kind === "website";
  const config = APP_STATUS_CONFIG[app.status] ?? APP_STATUS_CONFIG.applied!;

  const title = isSpeculative
    ? (app.vacancyTitle ?? app.companyName ?? "Speculative Application")
    : isWebsite
    ? (app.companyName ?? "Website Application")
    : (app.roleTitle ?? app.companyName ?? "Application");

  const dateLabel = isSpeculative ? "Sent" : "Applied";
  const dateStr = new Date(app.appliedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

  const hasInterview = app.interviewDate != null;
  const interviewStr = hasInterview
    ? new Date(app.interviewDate as string).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    : null;

  return (
    <Card className={`p-4 space-y-2 ${hasInterview ? "border-teal-200" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium text-foreground truncate">{title}</p>
            {isWebsite && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold border bg-blue-50 text-blue-700 border-blue-200">
                <ExternalLink className="w-2.5 h-2.5" /> External Application
              </span>
            )}
            {isSpeculative && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold border bg-sky-50 text-sky-700 border-sky-200">
                <Send className="w-2.5 h-2.5" /> Speculative CV
              </span>
            )}
          </div>
          {app.companyName && (
            <p className="text-xs text-muted-foreground mt-0.5">{app.companyName}</p>
          )}
          <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
            <Calendar className="w-3 h-3" />
            {dateLabel} {dateStr}
          </p>
        </div>
        <span className={`px-2.5 py-1 rounded-full text-xs font-semibold shrink-0 ${config.className}`}>
          {config.label}
        </span>
      </div>

      {isSpeculative && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {app.emailSent ? (
            <span className="flex items-center gap-1 text-teal-700">
              <Send className="w-3 h-3" />
              Sent{app.emailRecipient ? ` to ${app.emailRecipient}` : app.jobsageEmail ? ` via ${app.jobsageEmail}` : " via JOBSAGE ops"}
            </span>
          ) : (
            <span className="flex items-center gap-1 text-muted-foreground">
              <Send className="w-3 h-3" /> Pending delivery
            </span>
          )}
        </div>
      )}

      {hasInterview && (
        <div className="flex flex-col gap-1 bg-teal-50 border border-teal-200 rounded-lg px-3 py-2 text-xs text-teal-800">
          <span className="flex items-center gap-1 font-semibold">
            <CalendarDays className="w-3 h-3" /> Interview: {interviewStr}
          </span>
          {app.interviewNotes && (
            <span className="text-teal-700 leading-relaxed">{app.interviewNotes}</span>
          )}
        </div>
      )}
    </Card>
  );
}

function ApplicationsTab({ data }: { data: ApplicationList | undefined }) {
  const [subTab, setSubTab] = useState<AppSubTab>("platform");

  if (!data) {
    return (
      <Card className="p-8 text-center">
        <ClipboardList className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
        <p className="text-sm text-muted-foreground">No applications tracked yet.</p>
        <p className="text-xs text-muted-foreground mt-1">Use &quot;Mark Applied&quot; on eligible roles to track your journey.</p>
      </Card>
    );
  }

  const applications = (data.applications ?? []) as RichApplication[];
  const stats = data.stats as RichStats;

  const platformApps = applications.filter((a) => (a.applicationKind ?? "formal") === "formal");
  const websiteApps = applications.filter((a) => a.applicationKind === "website");
  const speculativeApps = applications.filter((a) => a.applicationKind === "speculative");

  const subTabs: { id: AppSubTab; label: string; icon: React.ElementType; count: number }[] = [
    { id: "platform", label: "Platform Applications", icon: Building2, count: stats.platformCount ?? platformApps.length },
    { id: "website", label: "Website Applications", icon: Globe, count: stats.websiteCount ?? websiteApps.length },
    { id: "speculative", label: "Speculative CVs", icon: Send, count: stats.speculativeCount ?? speculativeApps.length },
  ];

  const visibleApps = subTab === "platform" ? platformApps : subTab === "website" ? websiteApps : speculativeApps;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "Platform", value: stats.platformCount ?? platformApps.length, color: "text-foreground" },
          { label: "Website", value: stats.websiteCount ?? websiteApps.length, color: "text-blue-700" },
          { label: "Speculative CVs", value: stats.speculativeCount ?? speculativeApps.length, color: "text-sky-700" },
          { label: "Interviews", value: stats.interviews ?? 0, color: "text-teal-700" },
        ].map(({ label, value, color }) => (
          <Card key={label} className="p-3 text-center">
            <p className={`text-2xl font-bold ${color}`}>{value}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
          </Card>
        ))}
      </div>

      <div className="flex gap-1 p-1 bg-muted rounded-xl overflow-x-auto">
        {subTabs.map(({ id, label, icon: Icon, count }) => (
          <button
            key={id}
            onClick={() => setSubTab(id)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
              subTab === id ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
            {count > 0 && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${subTab === id ? "bg-primary/10 text-primary" : "bg-muted-foreground/10 text-muted-foreground"}`}>
                {count}
              </span>
            )}
          </button>
        ))}
      </div>

      {visibleApps.length === 0 ? (
        <Card className="p-8 text-center">
          <ClipboardList className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">
            {subTab === "platform" ? "No platform applications yet." : subTab === "website" ? "No website applications logged yet." : "No speculative CVs sent yet."}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {subTab === "platform" ? "Use \"Smart Apply\" on a role to track it here." : subTab === "website" ? "Use \"Mark as applied on website\" on any sponsor company." : "Send your CV speculatively to a sponsor licence company."}
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {visibleApps.map((app) => (
            <AppCard key={`${app.applicationKind ?? "formal"}-${app.id}`} app={app} />
          ))}
        </div>
      )}
    </div>
  );
}

function SelfPromotionCard() {
  const [budget, setBudget] = useState("");
  return (
    <Card className="p-5 border-dashed border-2 border-primary/20 bg-gradient-to-br from-primary/3 to-accent/3">
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
          <Megaphone className="w-5 h-5 text-primary" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-sm font-semibold text-foreground">Boost Your Profile</h3>
            <span className="px-1.5 py-0.5 text-xs rounded bg-primary/10 text-primary font-medium">Coming Soon</span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed mb-3">
            Premium candidates can promote their profile to NHS trusts and academic institutions actively recruiting in their specialty.
          </p>
          <div className="flex items-center gap-2">
            <div className="relative flex-1 max-w-[160px]">
              <DollarSign className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="number"
                min="0"
                step="10"
                placeholder="Monthly budget"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                disabled
                className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-border bg-background/50 text-muted-foreground cursor-not-allowed"
              />
            </div>
            <Button size="sm" className="text-xs" disabled>
              Set Budget &amp; Go Live
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

export default function OpportunitiesPage() {
  const [, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState<Tab>(() => {
    const p = new URLSearchParams(window.location.search);
    const t = p.get("tab");
    return (t === "employers" || t === "board" || t === "applications") ? t as Tab : "board";
  });
  const [selectedRole, setSelectedRole] = useState<MatchedRole | null>(null);
  const [employerSearch, setEmployerSearch] = useState(() => new URLSearchParams(window.location.search).get("q") ?? "");
  const [smartApplyRole, setSmartApplyRole] = useState<{ id: number; title: string } | null>(null);
  const [coverLetterRole, setCoverLetterRole] = useState<MatchedRole["role"] | null>(null);
  const [websiteAppModal, setWebsiteAppModal] = useState<{ companyName: string } | null>(null);
  const [websiteAppPending, setWebsiteAppPending] = useState(false);

  const queryClient = useQueryClient();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { data, isLoading, isError } = useListMatchedRoles();
  const { data: applicationsData } = useListMyApplications();
  const { data: myProfile } = useGetMyProfile();
  const markApplicationMutation = useMarkApplication();
  const { toast } = useToast();

  const [localDismissedIds, setLocalDismissedIds] = useState<Set<number>>(new Set());
  const { data: aiMatchesData, isLoading: aiMatchesLoading } = useGetMyMatches(
    { limit: 200 },
    { query: { enabled: isAuthenticated && !authLoading, retry: false } },
  );
  const dismissMutation = useDismissMatch();

  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const { data: vacancyStatsData } = useQuery<{ companiesChecked: number; companiesWithVacancies: number; totalVacanciesFound: number }>({
    queryKey: ["sponsorVacancyStats"],
    queryFn: async () => {
      const res = await fetch(`${base}/api/sponsor-licences/vacancy-stats`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch vacancy stats");
      return res.json() as Promise<{ companiesChecked: number; companiesWithVacancies: number; totalVacanciesFound: number }>;
    },
    staleTime: 5 * 60 * 1000,
  });

  function handleDismissMatch(roleId: number) {
    setLocalDismissedIds((prev) => new Set([...prev, roleId]));
    dismissMutation.mutate(
      { data: { roleId } },
      {
        onSettled: () => {
          void queryClient.invalidateQueries({ queryKey: getGetMyMatchesQueryKey({ limit: 200 }) });
        },
      },
    );
  }

  const aiScoreMap = new Map(
    (aiMatchesData?.matches ?? []).map((m) => [m.roleId, m.aiScore]),
  );

  const roles = data?.roles ?? [];
  const appliedRoleIds = data?.appliedRoleIds ?? [];
  const eligibilityOutcome = data?.eligibilityOutcome;
  const noProfile = data?.noProfile === true;

  const allRankedRoles = [...roles].sort(
    (a, b) => (aiScoreMap.get(b.role.id) ?? b.matchScore) - (aiScoreMap.get(a.role.id) ?? a.matchScore),
  );
  const recommendedRoles = allRankedRoles.filter((r) => r.recommended);

  const top5Roles = allRankedRoles.slice(0, 5);
  const next5Roles = allRankedRoles.slice(5, 10);
  const remainingRoles = allRankedRoles.slice(10);

  const employerGroups = Object.entries(
    roles.reduce<Record<string, MatchedRole[]>>((acc, r) => {
      if (!r.role.sponsorshipOffered) return acc;
      const key = r.role.employer;
      acc[key] ??= [];
      acc[key].push(r);
      return acc;
    }, {}),
  ).filter(([emp]) => emp.toLowerCase().includes(employerSearch.toLowerCase()));

  const p = myProfile as unknown as Record<string, unknown> | undefined;
  const keyFieldsComplete = !!(
    p?.profession && p?.specialty && p?.qualificationCountry && p?.qualificationType &&
    p?.qualificationYear && (p?.qualificationYear as number) > 0 &&
    p?.experienceYears && (p?.experienceYears as number) > 0 &&
    p?.registrationStatus && p?.residencyStatus && p?.preferredRegion &&
    p?.preferredStartDate &&
    Array.isArray(p?.languages) && (p?.languages as unknown[]).length > 0
  );

  function handleSmartApply(roleId: number, roleTitle: string) {
    if (!keyFieldsComplete) {
      toast({
        title: "Complete your profile first",
        description: "Please fill in all key profile fields (profession, qualifications, experience, preferred region, start date, and languages) before using Smart Apply.",
        variant: "destructive",
      });
      return;
    }
    setSmartApplyRole({ id: roleId, title: roleTitle });
  }

  function handleApply(roleId: number) {
    if (appliedRoleIds.includes(roleId)) return;
    markApplicationMutation.mutate(
      { data: { roleId } },
      {
        onSuccess: () => {
          void queryClient.invalidateQueries({ queryKey: getListMyApplicationsQueryKey() });
          void queryClient.invalidateQueries({ queryKey: getListMatchedRolesQueryKey() });
          toast({ title: "Application tracked", description: "Role marked as applied. Check 'Application Tracker' for tracking." });
        },
        onError: () => {
          toast({ title: "Error", description: "Could not track application. Please try again.", variant: "destructive" });
        },
      },
    );
  }

  async function handleWebsiteAppSubmit({ companyName, applicationUrl, notes, cvDocumentId }: { companyName: string; applicationUrl: string; notes: string; cvDocumentId?: number | null }) {
    setWebsiteAppPending(true);
    try {
      const res = await fetch(`${base}/api/applications`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ applicationType: "website", companyName, applicationUrl: applicationUrl || null, notes: notes || null, cvDocumentId: cvDocumentId ?? null }),
      });
      if (!res.ok) throw new Error("Failed to submit");
      void queryClient.invalidateQueries({ queryKey: getListMyApplicationsQueryKey() });
      setWebsiteAppModal(null);
      toast({ title: "Application logged", description: `Your application to ${companyName} has been saved to your tracker.` });
    } catch {
      toast({ title: "Error", description: "Could not save application. Please try again.", variant: "destructive" });
    } finally {
      setWebsiteAppPending(false);
    }
  }

  const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: "board", label: "Job Board", icon: Briefcase },
    { id: "employers", label: "Employer Discovery", icon: Building2 },
    { id: "applications", label: "Application Tracker", icon: ClipboardList },
  ];

  return (
    <AppLayout>
      <PageTransition className="max-w-4xl mx-auto p-6 space-y-6">
        <DisclaimerBanner />

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-display font-bold text-foreground">Job Opportunities</h1>
            <p className="text-muted-foreground mt-1 text-sm">
              {noProfile
                ? "Complete your profile to see a personalised ranked list."
                : data
                ? `${allRankedRoles.length} vacancies ranked by fit — highest match first`
                : "All vacancies ranked by how well they match your profile."}
            </p>
            {(vacancyStatsData?.totalVacanciesFound ?? 0) > 0 && (
              <p className="text-xs text-primary/80 mt-0.5 font-medium">
                {vacancyStatsData!.totalVacanciesFound} sponsor vacancies found across {vacancyStatsData!.companiesWithVacancies} employer{vacancyStatsData!.companiesWithVacancies !== 1 ? "s" : ""}
                {" · "}
                <a href="/sponsor-licences" className="underline underline-offset-2 hover:text-primary transition-colors">View sponsors</a>
              </p>
            )}
          </div>
          {eligibilityOutcome && (
            <div className={`px-3 py-1.5 rounded-full text-xs font-semibold flex items-center gap-1.5 ${
              eligibilityOutcome === "eligible"
                ? "bg-emerald-100 text-emerald-800"
                : "bg-amber-100 text-amber-800"
            }`}>
              {eligibilityOutcome === "eligible" ? (
                <><BadgeCheck className="w-3.5 h-3.5" /> Eligible</>
              ) : (
                <><Clock className="w-3.5 h-3.5" /> Building eligibility</>
              )}
            </div>
          )}
        </div>

        {/* Tab navigation */}
        <div className="flex gap-1 p-1 bg-muted rounded-xl">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === id
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="w-4 h-4" />
              <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </div>

        {/* Loading / error states */}
        {isLoading && (
          <Card className="p-8 text-center">
            <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-muted-foreground text-sm">Loading opportunities…</p>
          </Card>
        )}

        {isError && (
          <Card className="p-8 text-center border-destructive/20">
            <AlertCircle className="w-10 h-10 text-destructive mx-auto mb-3" />
            <p className="text-sm text-destructive font-medium">Could not load opportunities.</p>
            <p className="text-xs text-muted-foreground mt-1">Complete your profile and run an eligibility check to see matched roles.</p>
            <Button size="sm" className="mt-4" onClick={() => setLocation("/eligibility")}>
              Run Eligibility Check <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </Card>
        )}

        {/* Job Board tab */}
        {!isLoading && !isError && activeTab === "board" && (
          <div className="space-y-8">
            {/* No-profile nudge */}
            {noProfile && (
              <Card className="p-8 text-center border-primary/20 bg-gradient-to-br from-primary/5 to-accent/5">
                <FileText className="w-10 h-10 text-primary/40 mx-auto mb-3" />
                <h2 className="text-lg font-semibold mb-2">Complete your profile to unlock ranked vacancies</h2>
                <p className="text-sm text-muted-foreground mb-5 max-w-md mx-auto">
                  Upload your CV and fill in your profile so we can rank every vacancy by how well it matches your qualifications, registration status, and sponsorship needs.
                </p>
                <div className="flex gap-3 justify-center flex-wrap">
                  <Button onClick={() => setLocation("/profile")}>
                    Complete Profile <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                  <Button variant="outline" onClick={() => setLocation("/documents")}>
                    <FileText className="w-4 h-4 mr-2" /> Upload CV
                  </Button>
                </div>
              </Card>
            )}

            {/* Best Matches AI Strip */}
            {!noProfile && roles.length > 0 && (
              <BestMatchesStrip
                matchesData={aiMatchesData}
                matchesLoading={aiMatchesLoading}
                appliedRoleIds={appliedRoleIds}
                localDismissedIds={localDismissedIds}
                onSmartApply={handleSmartApply}
                onDismiss={handleDismissMatch}
              />
            )}

            {!noProfile && roles.length === 0 && (
              <Card className="p-8 text-center">
                <Briefcase className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
                <h2 className="text-lg font-semibold mb-2">No roles in catalogue yet</h2>
                <p className="text-sm text-muted-foreground mb-4">
                  No roles have been imported for your profession yet. Check back soon.
                </p>
                <Button variant="outline" onClick={() => setLocation("/eligibility")}>
                  Run Eligibility Check <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </Card>
            )}

            {!noProfile && roles.length > 0 && (
              <>
                {/* Match score info note */}
                <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Info className="w-3.5 h-3.5 shrink-0 text-primary/60" />
                  Match scores are based on your CV, profile, and regulatory eligibility. All vacancies are shown — eligibility notes are advisory only.
                </p>

                {/* Recommended — Apply First band */}
                {recommendedRoles.length > 0 && (
                  <section>
                    <div className="flex items-center gap-2 mb-3">
                      <Medal className="w-4 h-4 text-primary" />
                      <h2 className="text-base font-semibold text-foreground">Recommended — Apply First</h2>
                      <span className="px-1.5 py-0.5 text-xs rounded bg-primary/10 text-primary font-medium">
                        Top {recommendedRoles.length}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mb-4">
                      Your highest-matching vacancies right now — these best fit your profile and eligibility status.
                    </p>
                    <div className="space-y-3">
                      {recommendedRoles.map((item) => (
                        <motion.div
                          key={`rec-${item.role.id}`}
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                        >
                          <RoleCard
                            item={item}
                            recommended
                            appliedRoleIds={appliedRoleIds}
                            onApply={handleApply}
                            onSmartApply={handleSmartApply}
                            onViewDetail={setSelectedRole}
                            onCoverLetter={setCoverLetterRole}
                            onMarkWebsite={(employer) => setWebsiteAppModal({ companyName: employer })}
                          />
                        </motion.div>
                      ))}
                    </div>
                  </section>
                )}

                {/* Tiered ranked lists */}
                <div id="job-board-section" className="space-y-8">
                  {/* Band 1 — Top 5 Recommendations */}
                  {top5Roles.length > 0 && (
                    <section>
                      <div className="flex items-center gap-2 mb-3">
                        <Medal className="w-4 h-4 text-primary" />
                        <h2 className="text-base font-semibold text-foreground">Top 5 Recommendations</h2>
                        <span className="px-1.5 py-0.5 text-xs rounded bg-primary/10 text-primary font-medium">
                          Apply First
                        </span>
                        {!eligibilityOutcome && (
                          <button
                            className="ml-auto text-xs text-primary hover:underline flex items-center gap-1"
                            onClick={() => setLocation("/eligibility")}
                          >
                            <AlertCircle className="w-3 h-3" /> Run eligibility check to improve scores
                          </button>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mb-4">
                        Your five highest-scoring vacancies — prioritise these applications.
                      </p>
                      <div className="space-y-3">
                        {top5Roles.map((item) => (
                          <motion.div
                            key={item.role.id}
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                          >
                            <RoleCard
                              item={item}
                              recommended={true}
                              appliedRoleIds={appliedRoleIds}
                              onApply={handleApply}
                              onSmartApply={handleSmartApply}
                              onViewDetail={setSelectedRole}
                              onCoverLetter={setCoverLetterRole}
                              onMarkWebsite={(employer) => setWebsiteAppModal({ companyName: employer })}
                            />
                          </motion.div>
                        ))}
                      </div>
                    </section>
                  )}

                  {/* Band 2 — Next 5 to Consider */}
                  {next5Roles.length > 0 && (
                    <section>
                      <div className="flex items-center gap-2 mb-3">
                        <TrendingUp className="w-4 h-4 text-blue-500" />
                        <h2 className="text-base font-semibold text-foreground">Next 5 to Consider</h2>
                        <span className="px-1.5 py-0.5 text-xs rounded bg-blue-100 text-blue-700 font-medium">
                          Strong Matches
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mb-4">
                        Solid matches worth exploring once you have applied to your top picks.
                      </p>
                      <div className="space-y-3">
                        {next5Roles.map((item) => (
                          <motion.div
                            key={item.role.id}
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                          >
                            <RoleCard
                              item={item}
                              recommended={false}
                              appliedRoleIds={appliedRoleIds}
                              onApply={handleApply}
                              onSmartApply={handleSmartApply}
                              onViewDetail={setSelectedRole}
                              onCoverLetter={setCoverLetterRole}
                              onMarkWebsite={(employer) => setWebsiteAppModal({ companyName: employer })}
                            />
                          </motion.div>
                        ))}
                      </div>
                    </section>
                  )}

                  {/* Band 3 — More Opportunities */}
                  {remainingRoles.length > 0 && (
                    <section>
                      <div className="flex items-center gap-2 mb-3">
                        <Briefcase className="w-4 h-4 text-muted-foreground" />
                        <h2 className="text-base font-semibold text-foreground">More Opportunities</h2>
                        <span className="px-1.5 py-0.5 text-xs rounded bg-muted text-muted-foreground font-medium">
                          {remainingRoles.length} more
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mb-4">
                        All remaining vacancies — broaden your search or revisit after your top applications.
                      </p>
                      <div className="space-y-3">
                        {remainingRoles.map((item) => (
                          <motion.div
                            key={item.role.id}
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                          >
                            <RoleCard
                              item={item}
                              recommended={false}
                              appliedRoleIds={appliedRoleIds}
                              onApply={handleApply}
                              onSmartApply={handleSmartApply}
                              onViewDetail={setSelectedRole}
                              onCoverLetter={setCoverLetterRole}
                              onMarkWebsite={(employer) => setWebsiteAppModal({ companyName: employer })}
                            />
                          </motion.div>
                        ))}
                      </div>
                    </section>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* Employer Discovery tab */}
        {!isLoading && !isError && activeTab === "employers" && (
          <div className="space-y-4">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search employers…"
                value={employerSearch}
                onChange={(e) => setEmployerSearch(e.target.value)}
                className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>

            {employerGroups.length === 0 ? (
              <Card className="p-8 text-center">
                <Building2 className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">
                  {roles.length === 0
                    ? "No employers in catalogue yet. Roles are imported by administrators."
                    : employerSearch
                    ? "No sponsoring employers match your search."
                    : "No employers in your field currently hold a Skilled Worker sponsor licence."}
                </p>
              </Card>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">
                  {employerGroups.length} Skilled Worker sponsor-licence holder{employerGroups.length !== 1 ? "s" : ""} with open roles in your field
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {employerGroups.map(([employer, empRoles]) => (
                    <EmployerCard key={employer} employer={employer} roles={empRoles} />
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* My Applications tab */}
        {activeTab === "applications" && (
          <ApplicationsTab data={applicationsData} />
        )}

        {/* Self-promotion placeholder */}
        {activeTab === "board" && !isLoading && !isError && (
          <SelfPromotionCard />
        )}
      </PageTransition>

      {/* Role detail modal */}
      <AnimatePresence>
        {selectedRole && (
          <RoleDetailModal
            item={selectedRole}
            appliedRoleIds={appliedRoleIds}
            onClose={() => setSelectedRole(null)}
            onApply={(roleId) => { handleApply(roleId); setSelectedRole(null); }}
          />
        )}
      </AnimatePresence>

      {/* Smart Apply modal */}
      <AnimatePresence>
        {smartApplyRole && (
          <SmartApplyModal
            roleId={smartApplyRole.id}
            roleTitle={smartApplyRole.title}
            onClose={() => setSmartApplyRole(null)}
            onSuccess={() => {
              setSmartApplyRole(null);
              void queryClient.invalidateQueries({ queryKey: getListMyApplicationsQueryKey() });
              void queryClient.invalidateQueries({ queryKey: getListMatchedRolesQueryKey() });
            }}
          />
        )}
      </AnimatePresence>

      {/* Cover Letter modal */}
      <AnimatePresence>
        {coverLetterRole && (
          <CoverLetterModal
            role={coverLetterRole}
            onClose={() => setCoverLetterRole(null)}
          />
        )}
      </AnimatePresence>

      {websiteAppModal && (
        <MarkWebsiteApplicationModal
          companyName={websiteAppModal.companyName}
          onSubmit={(data) => void handleWebsiteAppSubmit(data)}
          onClose={() => setWebsiteAppModal(null)}
          isPending={websiteAppPending}
        />
      )}
    </AppLayout>
  );
}
