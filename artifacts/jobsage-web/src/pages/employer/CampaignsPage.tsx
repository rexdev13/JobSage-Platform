import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, Button, PageTransition } from "@/components/ui-enhanced";
import { useToast } from "@/hooks/use-toast";
import {
  BookmarkPlus, Search, RefreshCw, Trash2, Calendar, Loader2,
} from "lucide-react";
import { motion } from "framer-motion";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api";

interface Campaign {
  id: number;
  name: string;
  filters: Record<string, string | boolean | number | undefined>;
  vacancyId: number | null;
  createdAt: string;
  lastRunAt: string | null;
}

function formatDate(iso: string | null) {
  if (!iso) return "Never";
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function filterSummary(filters: Record<string, string | boolean | number | undefined>) {
  const parts: string[] = [];
  if (filters.profession) parts.push(`Profession: ${filters.profession}`);
  if (filters.specialty) parts.push(`Specialty: ${filters.specialty}`);
  if (filters.eligibilityStatus) parts.push(`Eligibility: ${filters.eligibilityStatus}`);
  if (filters.requiresSponsorship !== undefined && filters.requiresSponsorship !== "") {
    parts.push(`Sponsorship: ${filters.requiresSponsorship === "true" ? "Required" : "Not required"}`);
  }
  if (filters.experienceYearsMin) parts.push(`Min exp: ${filters.experienceYearsMin}yr`);
  if (filters.preferredRegion) parts.push(`Region: ${filters.preferredRegion}`);
  return parts.length > 0 ? parts.join(" · ") : "All candidates";
}

export default function CampaignsPage() {
  const [, setLocation] = useLocation();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [runningId, setRunningId] = useState<number | null>(null);
  const { toast } = useToast();

  async function loadCampaigns() {
    try {
      const res = await fetch(`${API_BASE}/employer/campaigns`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load campaigns");
      const data = await res.json() as { campaigns: Campaign[] };
      setCampaigns(data.campaigns);
    } catch {
      toast({ title: "Failed to load campaigns", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadCampaigns(); }, []);

  async function handleRun(campaign: Campaign) {
    setRunningId(campaign.id);
    try {
      const res = await fetch(`${API_BASE}/employer/campaigns/${campaign.id}/run`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to run campaign");
      await loadCampaigns();
      const params = new URLSearchParams();
      const f = campaign.filters;
      if (f.profession) params.set("profession", String(f.profession));
      if (f.specialty) params.set("specialty", String(f.specialty));
      if (f.eligibilityStatus) params.set("eligibilityStatus", String(f.eligibilityStatus));
      if (f.requiresSponsorship !== undefined && f.requiresSponsorship !== "") params.set("requiresSponsorship", String(f.requiresSponsorship));
      if (f.experienceYearsMin) params.set("experienceYearsMin", String(f.experienceYearsMin));
      if (f.preferredRegion) params.set("preferredRegion", String(f.preferredRegion));
      if (campaign.vacancyId) params.set("vacancyId", String(campaign.vacancyId));
      setLocation(`/employer/talent-search?${params.toString()}`);
    } catch (err) {
      toast({ title: "Error", description: (err as Error).message, variant: "destructive" });
    } finally {
      setRunningId(null);
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("Delete this campaign? This cannot be undone.")) return;
    try {
      const res = await fetch(`${API_BASE}/employer/campaigns/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to delete");
      setCampaigns(prev => prev.filter(c => c.id !== id));
      toast({ title: "Campaign deleted." });
    } catch (err) {
      toast({ title: "Error", description: (err as Error).message, variant: "destructive" });
    }
  }

  return (
    <AppLayout>
      <PageTransition className="max-w-4xl mx-auto p-6 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <BookmarkPlus className="w-5 h-5 text-primary" />
              <h1 className="text-2xl font-display font-bold text-foreground">Talent Campaigns</h1>
            </div>
            <p className="text-muted-foreground text-sm">Saved searches you can re-run on demand to find the latest matching candidates.</p>
          </div>
          <Button onClick={() => setLocation("/employer/talent-search")}>
            <Search className="w-4 h-4 mr-1.5" /> New Search
          </Button>
        </div>

        {loading ? (
          <Card className="p-10 text-center">
            <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3 text-primary" />
            <p className="text-sm text-muted-foreground">Loading campaigns…</p>
          </Card>
        ) : campaigns.length === 0 ? (
          <Card className="p-10 text-center border-dashed border-2">
            <BookmarkPlus className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
            <h3 className="text-base font-semibold mb-2">No campaigns yet</h3>
            <p className="text-sm text-muted-foreground mb-4">Run a talent search and save it as a campaign to find matching candidates quickly.</p>
            <Button onClick={() => setLocation("/employer/talent-search")}>
              <Search className="w-4 h-4 mr-1.5" /> Start a Search
            </Button>
          </Card>
        ) : (
          <div className="space-y-3">
            {campaigns.map((campaign) => (
              <motion.div key={campaign.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
                <Card className="p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-foreground truncate">{campaign.name}</h3>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">{filterSummary(campaign.filters)}</p>
                      <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" /> Created {formatDate(campaign.createdAt)}
                        </span>
                        <span>Last run: {formatDate(campaign.lastRunAt)}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Button size="sm" onClick={() => void handleRun(campaign)} disabled={runningId === campaign.id}>
                        {runningId === campaign.id ? (
                          <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                        ) : (
                          <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                        )}
                        Run
                      </Button>
                      <Button size="sm" variant="ghost" className="text-destructive hover:bg-destructive/10" onClick={() => void handleDelete(campaign.id)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                </Card>
              </motion.div>
            ))}
          </div>
        )}
      </PageTransition>
    </AppLayout>
  );
}
