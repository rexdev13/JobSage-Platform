import { useState, useCallback } from "react";
import { useLocation, useSearch } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, Button, PageTransition } from "@/components/ui-enhanced";
import { useGetEmployerProfile } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@workspace/auth-web";
import {
  Search, Filter, Star, CheckCircle, AlertCircle, Mail,
  Users, Briefcase, MapPin, Clock, BookmarkPlus, ChevronDown,
  ChevronUp, X, Send, Loader2,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api";

interface TalentCandidate {
  userId: string;
  displayName: string;
  initials: string;
  profession: string | null;
  specialty: string | null;
  experienceYears: number | null;
  qualificationCountry: string | null;
  registrationStatus: string | null;
  requiresSponsorship: boolean | null;
  preferredStartDate: string | null;
  isEligible: boolean;
  eligibilityOutcome: string | null;
  matchScore: number;
  matchRationale: string | null;
  isBoosted: boolean;
}

interface TalentSearchResult {
  candidates: TalentCandidate[];
  total: number;
  page: number;
  pageSize: number;
}

interface Campaign {
  id: number;
  name: string;
  filters: Record<string, unknown>;
  vacancyId: number | null;
  createdAt: string;
  lastRunAt: string | null;
}

interface SearchFilters {
  profession: string;
  specialty: string;
  eligibilityStatus: string;
  requiresSponsorship: string;
  experienceYearsMin: string;
  preferredRegion: string;
  vacancyId: string;
}

const EMPTY_FILTERS: SearchFilters = {
  profession: "",
  specialty: "",
  eligibilityStatus: "",
  requiresSponsorship: "",
  experienceYearsMin: "",
  preferredRegion: "",
  vacancyId: "",
};

function ScoreBadge({ score }: { score: number }) {
  const color =
    score >= 75 ? "bg-emerald-100 text-emerald-800" :
    score >= 50 ? "bg-amber-100 text-amber-700" :
    "bg-rose-100 text-rose-700";
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-sm font-bold ${color}`}>
      {score}% match
    </span>
  );
}

function CandidateCard({
  candidate,
  onContact,
}: {
  candidate: TalentCandidate;
  onContact: (c: TalentCandidate) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} layout>
      <Card className="p-5">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-lg shrink-0">
            {candidate.initials}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="font-semibold text-foreground">{candidate.displayName}</span>
              {candidate.isBoosted && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800">
                  <Star className="w-3 h-3" /> Featured
                </span>
              )}
              {candidate.isEligible ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">
                  <CheckCircle className="w-3 h-3" /> Eligible
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-muted text-muted-foreground">
                  <AlertCircle className="w-3 h-3" /> Eligibility Unconfirmed
                </span>
              )}
              <ScoreBadge score={candidate.matchScore} />
            </div>
            <div className="flex flex-wrap gap-3 text-xs text-muted-foreground mt-1">
              {candidate.profession && (
                <span className="flex items-center gap-1"><Briefcase className="w-3 h-3" /> {candidate.profession}</span>
              )}
              {candidate.specialty && <span>{candidate.specialty}</span>}
              {candidate.experienceYears != null && (
                <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {candidate.experienceYears}yr exp</span>
              )}
              {candidate.qualificationCountry && (
                <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> Qualified in {candidate.qualificationCountry}</span>
              )}
              {candidate.requiresSponsorship && (
                <span className="text-blue-700 font-medium">Requires sponsorship</span>
              )}
              {candidate.preferredStartDate && (
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  Available from {new Date(candidate.preferredStartDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                </span>
              )}
            </div>
            {candidate.matchRationale && (
              <AnimatePresence>
                {expanded && (
                  <motion.p
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="text-xs text-muted-foreground mt-2 italic"
                  >
                    {candidate.matchRationale}
                  </motion.p>
                )}
              </AnimatePresence>
            )}
          </div>
          <div className="flex flex-col gap-2 shrink-0">
            <Button size="sm" onClick={() => onContact(candidate)}>
              <Mail className="w-3.5 h-3.5 mr-1.5" /> Contact
            </Button>
            {candidate.matchRationale && (
              <button
                onClick={() => setExpanded(!expanded)}
                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-0.5 justify-end"
              >
                {expanded ? <><ChevronUp className="w-3 h-3" /> Less</> : <><ChevronDown className="w-3 h-3" /> Why?</>}
              </button>
            )}
          </div>
        </div>
      </Card>
    </motion.div>
  );
}

interface ContactModalProps {
  candidate: TalentCandidate | null;
  companyName: string;
  onClose: () => void;
}

function ContactModal({ candidate, companyName, onClose }: ContactModalProps) {
  const [subject, setSubject] = useState(`Opportunity from ${companyName}`);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const { toast } = useToast();

  async function handleSend() {
    if (!candidate || !message.trim()) return;
    setSending(true);
    try {
      const res = await fetch(`${API_BASE}/employer/contact-candidate`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipientUserId: candidate.userId,
          subject: subject.trim(),
          messageText: message.trim(),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? "Failed to send");
      }
      toast({ title: "Message sent!", description: `Your message has been sent to ${candidate.displayName}.` });
      onClose();
    } catch (err) {
      toast({ title: "Failed to send", description: (err as Error).message, variant: "destructive" });
    } finally {
      setSending(false);
    }
  }

  if (!candidate) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        className="bg-background rounded-2xl shadow-xl w-full max-w-md p-6"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Contact {candidate.displayName}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Subject</label>
            <input
              className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={120}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Message</label>
            <textarea
              className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
              rows={6}
              placeholder="Introduce yourself and explain why you think this candidate would be a great fit..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            The candidate will receive an in-platform notification and an email with your message.
          </p>
        </div>
        <div className="flex gap-2 mt-4 justify-end">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSend} disabled={sending || !message.trim()}>
            {sending ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Send className="w-4 h-4 mr-1.5" />}
            Send Message
          </Button>
        </div>
      </motion.div>
    </div>
  );
}

interface SaveCampaignModalProps {
  filters: SearchFilters;
  vacancyId: string;
  onClose: () => void;
  onSaved: () => void;
}

function SaveCampaignModal({ filters, vacancyId, onClose, onSaved }: SaveCampaignModalProps) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const { vacancyId: _vid, ...filterWithoutVacancy } = filters;
      const body: Record<string, unknown> = { name: name.trim(), filters: filterWithoutVacancy };
      const parsedVacancyId = vacancyId ? parseInt(vacancyId, 10) : null;
      if (parsedVacancyId && !isNaN(parsedVacancyId)) body.vacancyId = parsedVacancyId;
      const res = await fetch(`${API_BASE}/employer/campaigns`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Failed to save campaign");
      toast({ title: "Campaign saved!", description: `"${name}" has been saved to your campaigns.` });
      onSaved();
      onClose();
    } catch (err) {
      toast({ title: "Error", description: (err as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-background rounded-2xl shadow-xl w-full max-w-sm p-6"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Save as Campaign</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Campaign Name</label>
            <input
              className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
              placeholder="e.g. Senior Nurses — London"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              autoFocus
            />
          </div>
          <p className="text-xs text-muted-foreground">Save your current search filters to run this search again at any time from the Campaigns page.</p>
        </div>
        <div className="flex gap-2 mt-4 justify-end">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !name.trim()}>
            {saving ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <BookmarkPlus className="w-4 h-4 mr-1.5" />}
            Save Campaign
          </Button>
        </div>
      </motion.div>
    </div>
  );
}

export default function TalentSearchPage() {
  const searchStr = useSearch();
  const params = new URLSearchParams(searchStr);

  const [filters, setFilters] = useState<SearchFilters>({
    profession: params.get("profession") ?? "",
    specialty: params.get("specialty") ?? "",
    eligibilityStatus: params.get("eligibilityStatus") ?? "",
    requiresSponsorship: params.get("requiresSponsorship") ?? "",
    experienceYearsMin: params.get("experienceYearsMin") ?? "",
    preferredRegion: params.get("preferredRegion") ?? "",
    vacancyId: params.get("vacancyId") ?? "",
  });

  const [results, setResults] = useState<TalentSearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [contactTarget, setContactTarget] = useState<TalentCandidate | null>(null);
  const [showSaveCampaign, setShowSaveCampaign] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const { toast } = useToast();

  const { data: empProfile } = useGetEmployerProfile();

  const runSearch = useCallback(async (f: SearchFilters) => {
    setLoading(true);
    setHasSearched(true);
    try {
      const query = new URLSearchParams();
      if (f.profession) query.set("profession", f.profession);
      if (f.specialty) query.set("specialty", f.specialty);
      if (f.eligibilityStatus) query.set("eligibilityStatus", f.eligibilityStatus);
      if (f.requiresSponsorship) query.set("requiresSponsorship", f.requiresSponsorship);
      if (f.experienceYearsMin) query.set("experienceYearsMin", f.experienceYearsMin);
      if (f.preferredRegion) query.set("preferredRegion", f.preferredRegion);
      if (f.vacancyId) query.set("vacancyId", f.vacancyId);

      const res = await fetch(`${API_BASE}/employer/talent-search?${query.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Search failed");
      const data = await res.json() as TalentSearchResult;
      setResults(data);
    } catch (err) {
      toast({ title: "Search failed", description: (err as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  function handleFilterChange(key: keyof SearchFilters, val: string) {
    setFilters(prev => ({ ...prev, [key]: val }));
  }

  function handleSearch() {
    void runSearch(filters);
  }

  function handleClear() {
    setFilters(EMPTY_FILTERS);
    setResults(null);
    setHasSearched(false);
  }

  const hasActiveFilters = Object.values(filters).some(Boolean);
  const candidates = results?.candidates ?? [];

  return (
    <AppLayout>
      <PageTransition className="max-w-5xl mx-auto p-6 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Users className="w-5 h-5 text-primary" />
              <h1 className="text-2xl font-display font-bold text-foreground">Talent Search</h1>
            </div>
            <p className="text-muted-foreground text-sm">Search the JOBSAGE candidate pool, view AI-ranked matches, and contact candidates directly.</p>
          </div>
        </div>

        {/* Filters */}
        <Card className="p-5">
          <div className="flex items-center gap-2 mb-4">
            <Filter className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Search Filters</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Profession</label>
              <input
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                placeholder="e.g. Nurse, Doctor"
                value={filters.profession}
                onChange={(e) => handleFilterChange("profession", e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Specialty</label>
              <input
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                placeholder="e.g. Cardiology, A&E"
                value={filters.specialty}
                onChange={(e) => handleFilterChange("specialty", e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Eligibility Status</label>
              <select
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 bg-background"
                value={filters.eligibilityStatus}
                onChange={(e) => handleFilterChange("eligibilityStatus", e.target.value)}
              >
                <option value="">Any</option>
                <option value="eligible">Eligible</option>
                <option value="not_eligible">Not yet eligible</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Sponsorship</label>
              <select
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 bg-background"
                value={filters.requiresSponsorship}
                onChange={(e) => handleFilterChange("requiresSponsorship", e.target.value)}
              >
                <option value="">Any</option>
                <option value="true">Requires sponsorship</option>
                <option value="false">No sponsorship needed</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Min. Experience (years)</label>
              <input
                type="number"
                min={0}
                max={40}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                placeholder="e.g. 2"
                value={filters.experienceYearsMin}
                onChange={(e) => handleFilterChange("experienceYearsMin", e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Region</label>
              <input
                className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                placeholder="e.g. London, Manchester"
                value={filters.preferredRegion}
                onChange={(e) => handleFilterChange("preferredRegion", e.target.value)}
              />
            </div>
          </div>
          <div className="flex items-center gap-2 mt-4">
            <Button onClick={handleSearch} disabled={loading}>
              {loading ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Search className="w-4 h-4 mr-1.5" />}
              Search Talent
            </Button>
            {hasActiveFilters && (
              <Button variant="ghost" onClick={handleClear} className="text-xs">
                <X className="w-3.5 h-3.5 mr-1" /> Clear
              </Button>
            )}
            {results && candidates.length > 0 && (
              <Button variant="outline" className="ml-auto" onClick={() => setShowSaveCampaign(true)}>
                <BookmarkPlus className="w-4 h-4 mr-1.5" /> Save as Campaign
              </Button>
            )}
          </div>
        </Card>

        {/* Results */}
        {loading && (
          <Card className="p-10 text-center">
            <Loader2 className="w-8 h-8 border-primary border-t-transparent animate-spin mx-auto mb-3 text-primary" />
            <p className="text-sm text-muted-foreground">Searching and ranking candidates with AI…</p>
          </Card>
        )}

        {!loading && hasSearched && (
          <>
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {candidates.length > 0
                  ? `Found ${results?.total ?? 0} candidate${(results?.total ?? 0) !== 1 ? "s" : ""} — sorted by AI match score`
                  : "No candidates matched your search."}
              </p>
            </div>
            <div className="space-y-3">
              {candidates.map((candidate) => (
                <CandidateCard
                  key={candidate.userId}
                  candidate={candidate}
                  onContact={setContactTarget}
                />
              ))}
            </div>
            {candidates.length === 0 && (
              <Card className="p-10 text-center">
                <Users className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
                <h3 className="text-base font-semibold mb-2">No candidates found</h3>
                <p className="text-sm text-muted-foreground">Try broadening your filters — for example, remove the specialty or region requirement.</p>
              </Card>
            )}
          </>
        )}

        {!hasSearched && (
          <Card className="p-10 text-center border-dashed border-2">
            <Search className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
            <h3 className="text-base font-semibold mb-2">Start your talent search</h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Use the filters above to search the JOBSAGE candidate pool. AI will rank results by match quality and highlight "Featured" boosted candidates first.
            </p>
          </Card>
        )}
      </PageTransition>

      <AnimatePresence>
        {contactTarget && (
          <ContactModal
            candidate={contactTarget}
            companyName={empProfile?.companyName ?? "Your Organisation"}
            onClose={() => setContactTarget(null)}
          />
        )}
        {showSaveCampaign && (
          <SaveCampaignModal
            filters={filters}
            vacancyId={filters.vacancyId}
            onClose={() => setShowSaveCampaign(false)}
            onSaved={() => {}}
          />
        )}
      </AnimatePresence>
    </AppLayout>
  );
}
