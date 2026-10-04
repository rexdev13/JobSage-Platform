import { useState, useEffect, useCallback } from "react";
import { Link } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useGetSponsorLicenceIndustries } from "@workspace/api-client-react";
import {
  Users, Briefcase, CheckCircle, FileText, Building2, RefreshCw,
  ChevronDown, ChevronUp, Shield, Activity, Search, ExternalLink,
  TrendingUp, AlertTriangle, ShieldCheck, Star, BadgeCheck, UserCheck,
  XCircle, Clock, Ban, RotateCcw, Trash2, UserCog, ListOrdered, UserPlus,
  CalendarDays,
} from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api";

interface PlatformStats {
  totalUsers: number;
  usersByRole: Record<string, number>;
  completedProfiles: number;
  activeJobs: number;
  applicationsThisWeek: number;
  sponsorLicences: number;
  lastSponsorSync: string | null;
  marketingPerformance: MarketingPerformance;
}

interface MarketingPerformance {
  totalLeads: number;
  leadsLast7Days: number;
  byStatus: { status: string; count: number }[];
  byIndustry: { industrySector: string; count: number }[];
  bySource: { source: string; count: number }[];
  conversions: {
    total: number;
    last7Days: number;
    rate: number;
  };
  byMarketer: {
    id: string | null;
    email: string | null;
    name: string;
    assignedCount: number;
    contactedCount: number;
    registeredCount: number;
    conversionRate: number;
    averageResponseTimeMinutes: number | null;
    byIndustry: { industrySector: string; count: number }[];
  }[];
}

interface SuperUser {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: string;
  emailVerified: boolean;
  suspendedAt: string | null;
  createdAt: string;
  updatedAt: string;
  lastLogin: string | null;
  profileCompletion: number;
  documentCount: number;
  applicationCount: number;
  eligibilityStatus: string | null;
  hasConsented: boolean;
  consentedAt: string | null;
  calendlyUrl?: string | null;
}

interface AdminJobListing {
  id: number;
  title: string;
  status: string;
  location: string;
  regulator: string;
  sponsorshipOffered: boolean;
  requiredRegistration: string;
  createdAt: string;
  companyName: string;
  employerUserId: string;
}

interface AdminEmployer {
  id: number;
  userId: string;
  companyName: string;
  industry: string;
  region: string;
  sponsorLicenceNumber: string | null;
  createdAt: string;
  email: string;
  userRole: string;
  emailVerified: boolean;
  totalListings: number;
  publishedListings: number;
}

interface UserFull {
  user: SuperUser;
  profile: Record<string, unknown> | null;
  employerProfile: Record<string, unknown> | null;
  documents: { id: number; fileName: string; fileType: string; storageKey: string; uploadedAt: string }[];
  applications: { id: number; roleId: number; roleTitle: string | null; roleEmployer: string | null; status: string; appliedAt: string; notes: string | null }[];
  eligibilityHistory: { id: number; outcome: string; createdAt: string }[];
  auditEvents: { id: number; actor: string; action: string; target: string | null; details: Record<string, unknown> | null; createdAt: string }[];
  consent: { id: number; termsVersion: string; consentedAt: string } | null;
}

interface HealthData {
  dailyRegistrations: { date: string; count: number }[];
  dailyApplications: { date: string; count: number }[];
  dailyActiveUsers: { date: string; count: number }[];
  syncLog: { id: number; status: string; recordCount: number | null; errorMessage: string | null; createdAt: string }[];
  serverErrors5xxLast7Days: number;
}

function StatCard({ title, value, icon: Icon, sub }: { title: string; value: string | number; icon: React.ElementType; sub?: string }) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{title}</span>
          <Icon className="w-4 h-4 text-muted-foreground" />
        </div>
        <div className="text-2xl font-bold text-foreground">{value}</div>
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function OverviewTab() {
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`${API_BASE}/admin/super/stats`, { credentials: "include" })
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load stats");
        return r.json() as Promise<PlatformStats>;
      })
      .then(setStats)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex items-center justify-center py-20"><div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" /></div>;
  if (!stats) return <p className="text-muted-foreground text-center py-12">Failed to load stats.</p>;

  const lastSync = stats.lastSponsorSync
    ? new Date(stats.lastSponsorSync).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
    : "Never";

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Total Users" value={stats.totalUsers} icon={Users} />
        <StatCard title="Completed Profiles" value={stats.completedProfiles} icon={CheckCircle} />
        <StatCard title="Active Jobs" value={stats.activeJobs} icon={Briefcase} />
        <StatCard title="Applications This Week" value={stats.applicationsThisWeek} icon={FileText} />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard title="Sponsor Licences" value={stats.sponsorLicences.toLocaleString()} icon={Building2} sub={`Last sync: ${lastSync}`} />
        <StatCard title="Candidates" value={stats.usersByRole["candidate"] ?? 0} icon={Users} />
        <StatCard title="Employers" value={stats.usersByRole["employer"] ?? 0} icon={Building2} />
      </div>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Users by Role</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="divide-y divide-border">
            {Object.entries(stats.usersByRole).map(([role, cnt]) => (
              <div key={role} className="flex items-center justify-between py-2">
                <span className="text-sm capitalize text-muted-foreground">{role.replace("_", " ")}</span>
                <span className="text-sm font-semibold">{cnt}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Quick Access */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Quick Access</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            <Link href="/admin/users">
              <button className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-input bg-background text-sm font-medium hover:bg-muted transition-colors">
                <UserCog className="w-4 h-4 text-muted-foreground" />
                User Management
              </button>
            </Link>
            <Link href="/admin/audit">
              <button className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-input bg-background text-sm font-medium hover:bg-muted transition-colors">
                <Shield className="w-4 h-4 text-muted-foreground" />
                Audit Logs
              </button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function MarketingPerformanceTab() {
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [industry, setIndustry] = useState("");
  const { data: industryData } = useGetSponsorLicenceIndustries();

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (industry) params.set("industry", industry);
    const query = params.size > 0 ? `?${params.toString()}` : "";
    fetch(`${API_BASE}/admin/super/stats${query}`, { credentials: "include" })
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load marketing performance");
        return r.json() as Promise<PlatformStats>;
      })
      .then(setStats)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [industry]);

  if (loading) return <div className="flex items-center justify-center py-20"><div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" /></div>;
  if (!stats) return <p className="text-muted-foreground text-center py-12">Failed to load marketing performance.</p>;

  const marketing = stats.marketingPerformance;
  const industryOptions = industryData?.industries ?? [];

  return (
    <div className="space-y-6">
      <section className="space-y-4" aria-labelledby="marketing-performance-title">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="marketing-performance-title" className="text-lg font-semibold text-foreground">
              Marketing performance
            </h2>
            <p className="text-sm text-muted-foreground">
              Lead ownership, contact progress, and registrations.
            </p>
          </div>
          <label className="text-xs font-medium text-muted-foreground">
            Industry
            <select
              value={industry}
              onChange={(event) => setIndustry(event.target.value)}
              className="mt-1 block min-w-52 rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              <option value="">All industries</option>
              {industryOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard title="Total Leads" value={marketing.totalLeads} icon={Users} />
          <StatCard title="Leads in 7 Days" value={marketing.leadsLast7Days} icon={TrendingUp} />
          <StatCard
            title="Registered Leads"
            value={marketing.conversions.total}
            icon={UserCheck}
            sub={`${marketing.conversions.last7Days} in the last 7 days`}
          />
          <StatCard title="Conversion Rate" value={`${marketing.conversions.rate}%`} icon={BadgeCheck} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Lead status</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="divide-y divide-border">
                {marketing.byStatus.map((item) => (
                  <div key={item.status} className="flex items-center justify-between py-2">
                    <span className="text-sm capitalize text-muted-foreground">{item.status}</span>
                    <span className="text-sm font-semibold">{item.count}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Lead source</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="divide-y divide-border">
                {marketing.bySource.map((item) => (
                  <div key={item.source} className="flex items-center justify-between py-2">
                    <span className="text-sm capitalize text-muted-foreground">
                      {item.source === "chat" ? "AI Chat" : item.source}
                    </span>
                    <span className="text-sm font-semibold">{item.count}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Industry</CardTitle>
            </CardHeader>
            <CardContent>
              {marketing.byIndustry.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">No leads for this industry.</p>
              ) : (
                <div className="max-h-64 overflow-y-auto divide-y divide-border">
                  {marketing.byIndustry.map((item) => (
                    <div key={item.industrySector} className="flex items-center justify-between gap-3 py-2">
                      <span className="text-sm text-muted-foreground">{item.industrySector}</span>
                      <span className="text-sm font-semibold">{item.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Performance by marketer</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Marketer</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">Assigned</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">Contacted</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">Registered</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">Conv. Rate</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">Avg Response</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Industries</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {marketing.byMarketer.map((marketer) => (
                    <tr key={marketer.id ?? "__unassigned__"} className="hover:bg-muted/30">
                      <td className="px-4 py-3">
                        <p className="font-medium text-foreground">{marketer.name}</p>
                        {marketer.email && (
                          <p className="text-xs text-muted-foreground">{marketer.email}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold">{marketer.assignedCount}</td>
                      <td className="px-4 py-3 text-right font-semibold">{marketer.contactedCount}</td>
                      <td className="px-4 py-3 text-right font-semibold">{marketer.registeredCount}</td>
                      <td className="px-4 py-3 text-right font-semibold">{marketer.conversionRate.toFixed(1)}%</td>
                      <td className="px-4 py-3 text-right font-semibold">
                        {marketer.averageResponseTimeMinutes == null ? "—" : `${marketer.averageResponseTimeMinutes.toFixed(1)} min`}
                      </td>
                      <td className="px-4 py-3">
                        {marketer.byIndustry.length === 0 ? (
                          <span className="text-xs text-muted-foreground">None</span>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {marketer.byIndustry.map((item) => (
                              <span
                                key={item.industrySector}
                                className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
                              >
                                {item.industrySector} · {item.count}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function UserDetailPanel({ userId, apiBase, onImpersonate, onAction }: { userId: string; apiBase: string; onImpersonate: (userId: string) => void; onAction: () => void }) {
  const [detail, setDetail] = useState<UserFull | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [newRole, setNewRole] = useState("");
  const [calendlyUrl, setCalendlyUrl] = useState("");
  const [gapAnalysisUsage, setGapAnalysisUsage] = useState<{ used: number; limit: number } | null>(null);
  const { toast } = useToast();

  const loadDetail = useCallback(() => {
    setLoading(true);
    fetch(`${apiBase}/admin/super/users/${userId}/full`, { credentials: "include" })
      .then((r) => r.json())
      .then(setDetail)
      .catch(console.error)
      .finally(() => setLoading(false));
    // Load gap analysis quota separately (candidate-only feature)
    fetch(`${apiBase}/sponsor-licences/gap-analyses/usage/${userId}`, { credentials: "include" })
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d) setGapAnalysisUsage(d as { used: number; limit: number }); })
      .catch(() => null);
  }, [userId, apiBase]);

  useEffect(() => { loadDetail(); }, [loadDetail]);
  useEffect(() => {
    setCalendlyUrl(detail?.user.calendlyUrl ?? "");
  }, [detail?.user.calendlyUrl]);

  async function doAction(path: string, method: string, body?: Record<string, unknown>) {
    setActionLoading(path);
    try {
      const res = await fetch(`${apiBase}${path}`, {
        method,
        credentials: "include",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        toast({ title: "Error", description: err.error ?? "Action failed.", variant: "destructive" });
        return false;
      }
      onAction();
      loadDetail();
      return true;
    } catch {
      toast({ title: "Error", description: "Network error.", variant: "destructive" });
      return false;
    } finally {
      setActionLoading(null);
    }
  }

  async function handleSuspend() {
    if (!confirm("Suspend this account? The user will not be able to log in.")) return;
    if (await doAction(`/admin/super/users/${userId}/suspend`, "POST"))
      toast({ title: "Account suspended" });
  }

  async function handleRestore() {
    if (await doAction(`/admin/super/users/${userId}/restore`, "POST"))
      toast({ title: "Account restored" });
  }

  async function handleDelete() {
    if (!confirm("Permanently delete this account? This cannot be undone.")) return;
    if (await doAction(`/admin/super/users/${userId}`, "DELETE")) {
      toast({ title: "Account deleted" });
    }
  }

  async function handleRoleChange() {
    if (!newRole) return;
    if (!confirm(`Change role to "${newRole}"?`)) return;
    if (await doAction(`/admin/super/users/${userId}/role`, "PATCH", { role: newRole }))
      toast({ title: "Role updated", description: `Role changed to ${newRole}.` });
  }

  async function handleResetGapAnalysis() {
    const limit = gapAnalysisUsage?.limit ?? 3;
    if (!confirm(`Reset this candidate's Readiness Check quota? They will get a fresh ${limit} checks.`)) return;
    if (await doAction(`/sponsor-licences/gap-analyses/${userId}`, "DELETE")) {
      setGapAnalysisUsage({ used: 0, limit });
      toast({ title: "Quota reset", description: `Gap analysis quota reset to 0 / ${limit}.` });
    }
  }

  async function handleCalendlySave() {
    const saved = await doAction(`/admin/super/users/${userId}/calendly-url`, "PATCH", {
      calendlyUrl: calendlyUrl.trim(),
    });
    if (saved) {
      toast({ title: calendlyUrl.trim() ? "Calendly link saved" : "Calendly link cleared" });
      loadDetail();
      onAction();
    }
  }

  if (loading) return <div className="py-6 flex justify-center"><div className="w-6 h-6 border-4 border-primary/20 border-t-primary rounded-full animate-spin" /></div>;
  if (!detail) return <p className="text-xs text-muted-foreground py-4 px-6">Failed to load user detail.</p>;

  const { user, profile, employerProfile, documents, applications, eligibilityHistory, auditEvents, consent } = detail;
  const isSuspended = !!user.suspendedAt;

  return (
    <div className="px-6 pb-6 pt-2 space-y-5 border-t border-border bg-muted/30">
      <div className="flex flex-wrap items-center gap-2 pt-2">
        {isSuspended && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700 border border-red-200">
            <Ban className="w-3 h-3" /> Suspended since {new Date(user.suspendedAt!).toLocaleDateString("en-GB")}
          </span>
        )}
        <div className="ml-auto flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => onImpersonate(userId)} className="gap-1.5">
            <ExternalLink className="w-3.5 h-3.5" />
            Impersonate (Read-Only)
          </Button>
          {isSuspended ? (
            <Button size="sm" variant="outline" onClick={() => void handleRestore()} disabled={!!actionLoading} className="gap-1.5 text-green-600 border-green-300 hover:bg-green-50">
              <RotateCcw className="w-3.5 h-3.5" /> Restore Account
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={() => void handleSuspend()} disabled={!!actionLoading} className="gap-1.5 text-amber-600 border-amber-300 hover:bg-amber-50">
              <Ban className="w-3.5 h-3.5" /> Suspend
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => void handleDelete()} disabled={!!actionLoading} className="gap-1.5 text-red-600 border-red-300 hover:bg-red-50">
            <Trash2 className="w-3.5 h-3.5" /> Delete Account
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-2 p-3 bg-background rounded-lg border border-border">
        <UserCog className="w-4 h-4 text-muted-foreground mt-1" />
        <div className="flex-1 min-w-32">
          <label className="text-xs text-muted-foreground block mb-1">Change Role</label>
          <select
            className="text-sm border border-border rounded-lg px-3 py-1.5 bg-background focus:outline-none w-full"
            value={newRole}
            onChange={(e) => setNewRole(e.target.value)}
          >
            <option value="">— select new role —</option>
            <option value="candidate">Candidate</option>
            <option value="employer">Employer</option>
            <option value="reviewer">Reviewer</option>
            <option value="admin">Admin</option>
            <option value="super_admin">Super Admin</option>
            <option value="marketing">Marketing</option>
          </select>
        </div>
        <Button size="sm" onClick={() => void handleRoleChange()} disabled={!newRole || !!actionLoading} className="gap-1.5">
          Apply
        </Button>
        <span className="text-xs text-muted-foreground">Current: <strong>{user.role.replace("_", " ")}</strong></span>
      </div>

      {user.role === "marketing" && (
        <div className="flex flex-wrap items-end gap-2 p-3 bg-background rounded-lg border border-border">
          <CalendarDays className="w-4 h-4 text-muted-foreground mb-2" />
          <div className="flex-1 min-w-64">
            <label className="text-xs text-muted-foreground block mb-1">Calendly URL</label>
            <input
              type="url"
              placeholder="https://calendly.com/marketing-user"
              className="w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
              value={calendlyUrl}
              onChange={(event) => setCalendlyUrl(event.target.value)}
            />
          </div>
          <Button
            size="sm"
            onClick={() => void handleCalendlySave()}
            disabled={!!actionLoading}
          >
            Save Calendly link
          </Button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {profile && (
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">Profile</h4>
            <div className="space-y-1 text-sm">
              {Object.entries(profile).filter(([k]) => !["id", "userId", "createdAt", "updatedAt", "lastAlertSentAt"].includes(k)).map(([k, v]) => (
                <div key={k} className="flex gap-2">
                  <span className="text-muted-foreground capitalize min-w-32">{k.replace(/([A-Z])/g, " $1").trim()}:</span>
                  <span className="font-medium">{String(v ?? "—")}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {employerProfile && (
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">Employer Profile</h4>
            <div className="space-y-1 text-sm">
              {Object.entries(employerProfile).filter(([k]) => !["id", "userId", "createdAt", "updatedAt"].includes(k)).map(([k, v]) => (
                <div key={k} className="flex gap-2">
                  <span className="text-muted-foreground capitalize min-w-32">{k.replace(/([A-Z])/g, " $1").trim()}:</span>
                  <span className="font-medium">{String(v ?? "—")}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {documents.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">Documents ({documents.length})</h4>
          <div className="space-y-1">
            {documents.map((doc) => (
              <div key={doc.id} className="flex items-center justify-between text-sm py-1 border-b border-border/50 last:border-0">
                <span>{doc.fileName}</span>
                <a href={`${apiBase}/admin/super/documents?storageKey=${encodeURIComponent(doc.storageKey)}`} target="_blank" rel="noopener noreferrer" className="text-primary text-xs hover:underline flex items-center gap-1">
                  <ExternalLink className="w-3 h-3" /> Download
                </a>
              </div>
            ))}
          </div>
        </div>
      )}

      {applications.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">Applications ({applications.length})</h4>
          <div className="space-y-1">
            {applications.map((app) => (
              <div key={app.id} className="flex items-center justify-between text-sm py-1 border-b border-border/50 last:border-0">
                <div>
                  <div>{app.roleTitle ?? `Role #${app.roleId}`}</div>
                  {app.roleEmployer && <div className="text-xs text-muted-foreground">{app.roleEmployer}</div>}
                </div>
                <span className="capitalize text-xs bg-muted px-2 py-0.5 rounded-full">{app.status}</span>
                <span className="text-muted-foreground text-xs">{new Date(app.appliedAt).toLocaleDateString("en-GB")}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {eligibilityHistory.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">Eligibility History</h4>
          <div className="space-y-1">
            {eligibilityHistory.map((e) => (
              <div key={e.id} className="flex items-center justify-between text-sm py-1 border-b border-border/50 last:border-0">
                <span className={`capitalize text-xs font-medium px-2 py-0.5 rounded-full ${e.outcome === "eligible" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>{e.outcome.replace("_", " ")}</span>
                <span className="text-muted-foreground text-xs">{new Date(e.createdAt).toLocaleDateString("en-GB")}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {gapAnalysisUsage && (
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">Readiness Check Quota</h4>
          <div className="flex items-center gap-3 p-3 bg-background rounded-lg border border-border">
            <div className="flex-1 text-sm">
              <span className="font-semibold">{gapAnalysisUsage.used}</span>
              <span className="text-muted-foreground"> / {gapAnalysisUsage.limit} analyses used</span>
            </div>
            <div className="w-32 h-2 bg-muted rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${gapAnalysisUsage.used >= gapAnalysisUsage.limit ? "bg-red-500" : gapAnalysisUsage.used >= gapAnalysisUsage.limit - 2 ? "bg-amber-500" : "bg-primary"}`}
                style={{ width: `${Math.min(100, (gapAnalysisUsage.used / gapAnalysisUsage.limit) * 100)}%` }}
              />
            </div>
            {gapAnalysisUsage.used > 0 && (
              <button
                onClick={() => void handleResetGapAnalysis()}
                disabled={!!actionLoading}
                className="text-xs px-2.5 py-1 rounded-lg border border-amber-300 text-amber-700 hover:bg-amber-50 transition-colors disabled:opacity-50"
              >
                Reset
              </button>
            )}
          </div>
        </div>
      )}

      {consent ? (
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">Consent Record</h4>
          <div className="space-y-1 text-xs">
            <div className="flex justify-between"><span className="text-muted-foreground">ID</span><span className="font-mono">{consent.id}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Terms Version</span><span>v{consent.termsVersion}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Consented At</span><span>{new Date(consent.consentedAt).toLocaleString("en-GB")}</span></div>
          </div>
        </div>
      ) : (
        <div className="text-xs text-muted-foreground italic">No consent record.</div>
      )}

      {auditEvents.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">Audit Events (last {auditEvents.length})</h4>
          <div className="space-y-1">
            {auditEvents.map((e) => (
              <div key={e.id} className="flex items-center justify-between text-xs py-1 border-b border-border/50 last:border-0">
                <span className="font-mono text-muted-foreground">{e.action}</span>
                <span className="text-muted-foreground">{new Date(e.createdAt).toLocaleDateString("en-GB")}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function CreateMarketingAccountForm({ onCreated }: { onCreated: () => void }) {
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [calendlyUrl, setCalendlyUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/admin/super/marketing-accounts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, firstName, lastName, calendlyUrl: calendlyUrl.trim() || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to create marketing account.");

      setEmail("");
      setFirstName("");
      setLastName("");
      setCalendlyUrl("");
      toast({
        title: "Marketing account created",
        description: "A secure password setup link has been sent to the new account.",
      });
      onCreated();
    } catch (error) {
      toast({
        title: "Could not create account",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <UserPlus className="w-4 h-4 text-primary" />
          Create marketing account
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          The new user will receive a one-time link to set their password. No password is entered or stored here.
        </p>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_1.3fr_auto] items-end">
          <label className="space-y-1.5">
            <span className="text-xs font-medium">First name</span>
            <input
              required
              maxLength={80}
              className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
              value={firstName}
              onChange={(event) => setFirstName(event.target.value)}
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-medium">Last name</span>
            <input
              required
              maxLength={80}
              className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
              value={lastName}
              onChange={(event) => setLastName(event.target.value)}
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-medium">Email address</span>
            <input
              required
              type="email"
              className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-medium">Calendly URL <span className="font-normal text-muted-foreground">(optional)</span></span>
            <input
              type="url"
              placeholder="https://calendly.com/name"
              className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
              value={calendlyUrl}
              onChange={(event) => setCalendlyUrl(event.target.value)}
            />
          </label>
          <Button type="submit" disabled={submitting} className="gap-1.5">
            <UserPlus className="w-3.5 h-3.5" />
            {submitting ? "Sending..." : "Create & invite"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export function AllUsersTab() {
  const [users, setUsers] = useState<SuperUser[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [verifiedFilter, setVerifiedFilter] = useState("");
  const [sortBy, setSortBy] = useState("createdAt");
  const [sortDir, setSortDir] = useState("desc");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), sortBy, sortDir });
      if (search) params.set("search", search);
      if (roleFilter) params.set("role", roleFilter);
      if (verifiedFilter) params.set("verified", verifiedFilter);
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
      const res = await fetch(`${API_BASE}/admin/super/users?${params}`, { credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `Failed to load users (${res.status}).`);
      }
      setError(null);
      setUsers(data.users ?? []);
      setTotal(data.total ?? 0);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load users.";
      setError(message);
      setUsers([]);
      setTotal(0);
      toast({ title: "Error", description: message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [page, search, roleFilter, verifiedFilter, sortBy, sortDir, dateFrom, dateTo, toast]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  async function handleImpersonate(userId: string) {
    try {
      const res = await fetch(`${API_BASE}/admin/super/impersonate/${userId}`, { method: "POST", credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
      window.open(`${base}/impersonate?token=${data.token}`, "_blank");
    } catch {
      toast({ title: "Error", description: "Failed to start impersonation.", variant: "destructive" });
    }
  }

  function toggleSort(col: string) {
    if (sortBy === col) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortBy(col); setSortDir("desc"); }
    setPage(1);
  }

  const PAGE_SIZE = 25;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="space-y-4">
      <CreateMarketingAccountForm onCreated={() => { setPage(1); void fetchUsers(); }} />

      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            className="w-full pl-9 pr-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
            placeholder="Search by email..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
        <select
          className="text-sm border border-border rounded-lg px-3 py-2 bg-background focus:outline-none"
          value={roleFilter}
          onChange={(e) => { setRoleFilter(e.target.value); setPage(1); }}
        >
          <option value="">All Roles</option>
          <option value="candidate">Candidate</option>
          <option value="employer">Employer</option>
          <option value="admin">Admin</option>
          <option value="reviewer">Reviewer</option>
          <option value="super_admin">Super Admin</option>
           <option value="marketing">Marketing</option>
        </select>
        <select
          className="text-sm border border-border rounded-lg px-3 py-2 bg-background focus:outline-none"
          value={verifiedFilter}
          onChange={(e) => { setVerifiedFilter(e.target.value); setPage(1); }}
        >
          <option value="">All Verification</option>
          <option value="true">Verified</option>
          <option value="false">Unverified</option>
        </select>
        <div className="flex items-center gap-2 text-sm">
          <label className="text-muted-foreground text-xs whitespace-nowrap">From</label>
          <input
            type="date"
            className="text-sm border border-border rounded-lg px-3 py-2 bg-background focus:outline-none"
            value={dateFrom}
            onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
          />
          <label className="text-muted-foreground text-xs whitespace-nowrap">To</label>
          <input
            type="date"
            className="text-sm border border-border rounded-lg px-3 py-2 bg-background focus:outline-none"
            value={dateTo}
            onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
          />
        </div>
        <Button variant="outline" size="sm" onClick={fetchUsers} className="gap-1.5">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </Button>
      </div>

      <div className={`text-xs ${error ? "text-destructive" : "text-muted-foreground"}`}>
        {error ? "Unable to load users" : `${total} users total`}
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                {[
                  { label: "ID", col: "id" },
                  { label: "Email", col: "email" },
                  { label: "Role", col: "role" },
                  { label: "Verified", col: "emailVerified" },
                  { label: "Profile %", col: "profileCompletion" },
                  { label: "Docs", col: "documentCount" },
                  { label: "Apps", col: "applicationCount" },
                  { label: "Eligibility", col: "eligibilityStatus" },
                  { label: "Consent", col: "hasConsented" },
                  { label: "Joined", col: "createdAt" },
                  { label: "Last Activity", col: "lastLogin" },
                ].map(({ label, col }) => (
                  <th
                    key={label}
                    className={`text-left px-4 py-3 font-medium text-muted-foreground text-xs ${col ? "cursor-pointer hover:text-foreground select-none" : ""}`}
                    onClick={col ? () => toggleSort(col) : undefined}
                  >
                    {label}
                    {col && sortBy === col && <span className="ml-1">{sortDir === "asc" ? "↑" : "↓"}</span>}
                  </th>
                ))}
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={12} className="text-center py-10 text-muted-foreground">Loading...</td></tr>
              )}
              {!loading && error && (
                <tr>
                  <td colSpan={12} className="text-center py-10">
                    <p className="font-medium text-destructive">Unable to load the user directory.</p>
                    <p className="mt-1 text-sm text-muted-foreground">{error}</p>
                    <Button variant="outline" size="sm" onClick={fetchUsers} className="mt-3 gap-1.5">
                      <RefreshCw className="w-3.5 h-3.5" /> Try again
                    </Button>
                  </td>
                </tr>
              )}
              {!loading && !error && users.length === 0 && (
                <tr><td colSpan={12} className="text-center py-10 text-muted-foreground">No users found.</td></tr>
              )}
              {!loading && !error && users.map((u) => (
                <>
                  <tr
                    key={u.id}
                    className="border-b border-border/50 hover:bg-muted/30 cursor-pointer transition-colors"
                    onClick={() => setExpandedId(expandedId === u.id ? null : u.id)}
                  >
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground" title={u.id}>{u.id.slice(0, 8)}&hellip;</td>
                    <td className="px-4 py-3 font-medium">{u.email}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="capitalize text-xs bg-muted px-2 py-0.5 rounded-full">{u.role.replace("_", " ")}</span>
                        {u.suspendedAt && (
                          <span className="text-xs font-semibold px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 flex items-center gap-0.5">
                            <Ban className="w-2.5 h-2.5" /> Suspended
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium ${u.emailVerified ? "text-green-600" : "text-red-500"}`}>
                        {u.emailVerified ? "Yes" : "No"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-16 bg-muted rounded-full h-1.5">
                          <div className="bg-primary h-1.5 rounded-full" style={{ width: `${u.profileCompletion}%` }} />
                        </div>
                        <span className="text-xs text-muted-foreground">{u.profileCompletion}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">{u.documentCount}</td>
                    <td className="px-4 py-3 text-center">{u.applicationCount}</td>
                    <td className="px-4 py-3">
                      {u.eligibilityStatus ? (
                        <span className={`capitalize text-xs font-medium px-2 py-0.5 rounded-full ${u.eligibilityStatus === "eligible" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                          {u.eligibilityStatus.replace("_", " ")}
                        </span>
                      ) : <span className="text-muted-foreground text-xs">—</span>}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {u.hasConsented ? (
                        <span className="text-xs text-green-600 font-medium">Yes</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">No</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {new Date(u.createdAt).toLocaleDateString("en-GB")}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {u.lastLogin ? new Date(u.lastLogin).toLocaleDateString("en-GB") : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {expandedId === u.id ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                    </td>
                  </tr>
                  {expandedId === u.id && (
                    <tr key={`${u.id}-detail`}>
                      <td colSpan={12} className="p-0">
                        <UserDetailPanel userId={u.id} apiBase={API_BASE} onImpersonate={handleImpersonate} onAction={fetchUsers} />
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <Button variant="outline" size="sm" onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1}>Previous</Button>
          <span className="text-sm text-muted-foreground">Page {page} of {totalPages}</span>
          <Button variant="outline" size="sm" onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page === totalPages}>Next</Button>
        </div>
      )}
    </div>
  );
}

export function SuperAdminUsersPage() {
  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground">User Directory</h1>
          <p className="text-muted-foreground text-sm mt-1">
            View and manage every JOBSAGE account, including marketing users.
          </p>
        </div>
        <AllUsersTab />
      </div>
    </AppLayout>
  );
}

function HealthTab() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_BASE}/admin/super/health`, { credentials: "include" })
      .then((r) => r.json())
      .then(setHealth)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex items-center justify-center py-20"><div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" /></div>;
  if (!health) return <p className="text-muted-foreground text-center py-12">Failed to load health data.</p>;

  const merged = (() => {
    const dateMap = new Map<string, { date: string; registrations: number; applications: number; activeUsers: number }>();
    for (const r of health.dailyRegistrations) {
      dateMap.set(r.date, { date: r.date, registrations: r.count, applications: 0, activeUsers: 0 });
    }
    for (const r of health.dailyApplications) {
      const entry = dateMap.get(r.date) ?? { date: r.date, registrations: 0, applications: 0, activeUsers: 0 };
      entry.applications = r.count;
      dateMap.set(r.date, entry);
    }
    for (const r of health.dailyActiveUsers) {
      const entry = dateMap.get(r.date) ?? { date: r.date, registrations: 0, applications: 0, activeUsers: 0 };
      entry.activeUsers = r.count;
      dateMap.set(r.date, entry);
    }
    return Array.from(dateMap.values()).sort((a, b) => a.date.localeCompare(b.date));
  })();

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              <span className="text-xs font-semibold text-muted-foreground uppercase">Error Events (Audit Log)</span>
            </div>
            <div className="text-3xl font-bold">{health.serverErrors5xxLast7Days}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-1">
              <Activity className="w-4 h-4 text-primary" />
              <span className="text-xs font-semibold text-muted-foreground uppercase">Sponsor Sync Runs</span>
            </div>
            <div className="text-3xl font-bold">{health.syncLog.length}</div>
            {health.syncLog[0] && (
              <p className="text-xs text-muted-foreground mt-1">
                Last: {new Date(health.syncLog[0].createdAt).toLocaleDateString("en-GB")} — {health.syncLog[0].status}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <TrendingUp className="w-4 h-4" /> Activity — Last 30 Days
          </CardTitle>
        </CardHeader>
        <CardContent>
          {merged.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-8">No activity data yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={merged} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(d) => d.slice(5)} />
                <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                <Tooltip labelFormatter={(l) => `Date: ${l}`} />
                <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="registrations" name="Registrations" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="applications" name="Applications" stroke="#10b981" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="activeUsers" name="Active Users" stroke="#f59e0b" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {health.syncLog.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Sponsor Licence Sync Log</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="mobile-scroll-x">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Date</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Status</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Records</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Message</th>
                </tr>
              </thead>
              <tbody>
                {health.syncLog.map((log) => (
                  <tr key={log.id} className="border-b border-border/50">
                    <td className="px-4 py-2 text-xs text-muted-foreground">{new Date(log.createdAt).toLocaleDateString("en-GB")}</td>
                    <td className="px-4 py-2">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${log.status === "success" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                        {log.status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-xs">{log.recordCount?.toLocaleString() ?? "—"}</td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">{log.errorMessage ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

interface IdentityRecord {
  id: number;
  userId: string;
  passportKey: string | null;
  selfieKey: string | null;
  status: "pending" | "verified" | "rejected";
  aiConfidence: "high" | "medium" | "low" | "none" | null;
  aiNotes: string | null;
  adminNotes: string | null;
  verifiedAt: string | null;
  createdAt: string;
}

interface RecommendationLetterAdmin {
  id: number;
  candidateUserId: string;
  employerUserId: string | null;
  authorName: string;
  authorTitle: string;
  organisation: string;
  relationship: string;
  content: string;
  isEmployerVerified: boolean;
  createdAt: string;
}

function IdentityQueueTab() {
  const [records, setRecords] = useState<IdentityRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [adminNote, setAdminNote] = useState<Record<number, string>>({});
  const { toast } = useToast();

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`${API_BASE}/admin/identity`, { credentials: "include" });
    const data = await res.json() as { verifications: IdentityRecord[] };
    setRecords(data.verifications ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { void fetchRecords(); }, [fetchRecords]);

  async function updateStatus(id: number, status: "verified" | "rejected") {
    setActionLoading(id);
    const res = await fetch(`${API_BASE}/admin/identity/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ status, adminNotes: adminNote[id] ?? null }),
    });
    if (res.ok) {
      toast({ title: `Verification ${status}` });
      void fetchRecords();
    } else {
      toast({ title: "Error", variant: "destructive" });
    }
    setActionLoading(null);
  }

  const statusIcon = (s: IdentityRecord["status"]) =>
    s === "verified" ? <CheckCircle className="w-4 h-4 text-emerald-500" /> :
    s === "rejected" ? <XCircle className="w-4 h-4 text-rose-500" /> :
    <Clock className="w-4 h-4 text-amber-500" />;

  const confColor = (c: IdentityRecord["aiConfidence"]) =>
    c === "high" ? "text-emerald-600 bg-emerald-50" :
    c === "medium" ? "text-amber-600 bg-amber-50" :
    c === "low" ? "text-rose-600 bg-rose-50" : "text-muted-foreground bg-muted";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-primary" /> Identity Verification Queue
        </h2>
        <Button variant="outline" size="sm" onClick={fetchRecords} className="gap-1.5">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </Button>
      </div>

      {loading ? (
        <div className="text-center py-12 text-muted-foreground">Loading…</div>
      ) : records.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">No identity verification submissions yet.</div>
      ) : (
        <div className="mobile-scroll-x rounded-xl border border-border">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">User ID</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Status</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">AI Confidence</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">AI Notes</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Submitted</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <tr key={r.id} className="border-t border-border hover:bg-muted/30">
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{r.userId.slice(0, 12)}…</td>
                  <td className="px-4 py-3">
                    <span className="flex items-center gap-1.5">{statusIcon(r.status)} {r.status}</span>
                  </td>
                  <td className="px-4 py-3">
                    {r.aiConfidence ? (
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold ${confColor(r.aiConfidence)}`}>
                        {r.aiConfidence}
                      </span>
                    ) : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-4 py-3 max-w-[200px]">
                    <p className="text-xs text-muted-foreground truncate">{r.aiNotes ?? "—"}</p>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {new Date(r.createdAt).toLocaleDateString("en-GB")}
                  </td>
                  <td className="px-4 py-3">
                    {r.status === "pending" ? (
                      <div className="flex flex-col gap-1.5">
                        <input
                          type="text"
                          placeholder="Admin note (optional)"
                          value={adminNote[r.id] ?? ""}
                          onChange={(e) => setAdminNote((p) => ({ ...p, [r.id]: e.target.value }))}
                          className="text-xs px-2 py-1 rounded-lg border border-border bg-muted/40 w-36"
                        />
                        <div className="flex gap-1.5">
                          <button
                            disabled={actionLoading === r.id}
                            onClick={() => void updateStatus(r.id, "verified")}
                            className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg bg-emerald-100 text-emerald-700 hover:bg-emerald-200 font-semibold"
                          >
                            <CheckCircle className="w-3 h-3" /> Verify
                          </button>
                          <button
                            disabled={actionLoading === r.id}
                            onClick={() => void updateStatus(r.id, "rejected")}
                            className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg bg-rose-100 text-rose-700 hover:bg-rose-200 font-semibold"
                          >
                            <XCircle className="w-3 h-3" /> Reject
                          </button>
                        </div>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">{r.adminNotes ?? "—"}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function LettersTab() {
  const [letters, setLetters] = useState<RecommendationLetterAdmin[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<number | null>(null);
  const { toast } = useToast();

  const fetchLetters = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`${API_BASE}/admin/recommendation-letters`, { credentials: "include" });
    const data = await res.json() as { letters: RecommendationLetterAdmin[] };
    setLetters(data.letters ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { void fetchLetters(); }, [fetchLetters]);

  async function deleteLetter(id: number) {
    const res = await fetch(`${API_BASE}/recommendation-letters/${id}`, { method: "DELETE", credentials: "include" });
    if (res.ok) {
      toast({ title: "Letter removed" });
      void fetchLetters();
    } else {
      toast({ title: "Error deleting letter", variant: "destructive" });
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
          <Star className="w-5 h-5 text-primary" /> Recommendation Letters ({letters.length})
        </h2>
        <Button variant="outline" size="sm" onClick={fetchLetters} className="gap-1.5">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </Button>
      </div>

      {loading ? (
        <div className="text-center py-12 text-muted-foreground">Loading…</div>
      ) : letters.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">No recommendation letters submitted yet.</div>
      ) : (
        <div className="mobile-scroll-x rounded-xl border border-border">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Candidate</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Author</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Organisation</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Type</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Date</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {letters.map((l) => (
                <>
                  <tr key={l.id} className="border-t border-border hover:bg-muted/30">
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{l.candidateUserId.slice(0, 12)}…</td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-foreground">{l.authorName}</p>
                      <p className="text-xs text-muted-foreground">{l.authorTitle}</p>
                    </td>
                    <td className="px-4 py-3 text-xs">{l.organisation}</td>
                    <td className="px-4 py-3">
                      {l.isEmployerVerified ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-700 border border-emerald-300">
                          <BadgeCheck className="w-3 h-3" /> Employer
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-muted text-muted-foreground border border-border">
                          <UserCheck className="w-3 h-3" /> Self
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {new Date(l.createdAt).toLocaleDateString("en-GB")}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setExpanded(expanded === l.id ? null : l.id)}
                          className="text-xs text-primary hover:underline"
                        >
                          {expanded === l.id ? "Hide" : "Read"}
                        </button>
                        <button
                          onClick={() => void deleteLetter(l.id)}
                          className="text-xs text-rose-500 hover:underline"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                  {expanded === l.id && (
                    <tr key={`${l.id}-exp`} className="border-t border-border bg-muted/20">
                      <td colSpan={6} className="px-4 py-3">
                        <p className="text-xs text-foreground whitespace-pre-wrap leading-relaxed max-w-2xl">{l.content}</p>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function JobListingsTab() {
  const [listings, setListings] = useState<AdminJobListing[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const { toast } = useToast();

  const fetchListings = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (search) params.set("search", search);
      if (statusFilter) params.set("status", statusFilter);
      const res = await fetch(`${API_BASE}/admin/super/job-listings?${params}`, { credentials: "include" });
      const data = await res.json() as { listings: AdminJobListing[]; total: number };
      setListings(data.listings ?? []);
      setTotal(data.total ?? 0);
    } catch {
      toast({ title: "Error", description: "Failed to load listings.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [page, search, statusFilter, toast]);

  useEffect(() => { void fetchListings(); }, [fetchListings]);

  async function handleStatusChange(id: number, status: string) {
    setActionLoading(id);
    try {
      const res = await fetch(`${API_BASE}/admin/super/job-listings/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error();
      toast({ title: "Status updated" });
      void fetchListings();
    } catch {
      toast({ title: "Error", description: "Failed to update status.", variant: "destructive" });
    } finally {
      setActionLoading(null);
    }
  }

  async function handleDelete(id: number, title: string) {
    if (!confirm(`Delete job listing "${title}"? This cannot be undone.`)) return;
    setActionLoading(id);
    try {
      const res = await fetch(`${API_BASE}/admin/super/job-listings/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error();
      toast({ title: "Listing deleted" });
      void fetchListings();
    } catch {
      toast({ title: "Error", description: "Failed to delete listing.", variant: "destructive" });
    } finally {
      setActionLoading(null);
    }
  }

  const PAGE_SIZE = 25;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const statusColor = (s: string) =>
    s === "published" ? "bg-green-100 text-green-700" :
    s === "draft" ? "bg-amber-100 text-amber-700" :
    "bg-muted text-muted-foreground";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            className="w-full pl-9 pr-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
            placeholder="Search by title or company..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
        <select
          className="text-sm border border-border rounded-lg px-3 py-2 bg-background focus:outline-none"
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
        >
          <option value="">All Statuses</option>
          <option value="published">Published</option>
          <option value="draft">Draft</option>
          <option value="closed">Closed</option>
        </select>
        <Button variant="outline" size="sm" onClick={() => void fetchListings()} className="gap-1.5">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </Button>
      </div>

      <div className="text-xs text-muted-foreground">{total} listings total</div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">Title</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">Company</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">Location</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">Regulator</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">Status</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">Created</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={7} className="text-center py-10 text-muted-foreground">Loading...</td></tr>}
              {!loading && listings.length === 0 && <tr><td colSpan={7} className="text-center py-10 text-muted-foreground">No listings found.</td></tr>}
              {!loading && listings.map((l) => (
                <tr key={l.id} className="border-b border-border/50 hover:bg-muted/30">
                  <td className="px-4 py-3 font-medium">{l.title}</td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">{l.companyName}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{l.location}</td>
                  <td className="px-4 py-3">
                    <span className="text-xs bg-muted px-2 py-0.5 rounded-full">{l.regulator}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full capitalize ${statusColor(l.status)}`}>{l.status}</span>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{new Date(l.createdAt).toLocaleDateString("en-GB")}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {l.status !== "published" && (
                        <button
                          disabled={actionLoading === l.id}
                          onClick={() => void handleStatusChange(l.id, "published")}
                          className="text-xs text-green-600 hover:underline disabled:opacity-50"
                        >
                          Publish
                        </button>
                      )}
                      {l.status === "published" && (
                        <button
                          disabled={actionLoading === l.id}
                          onClick={() => void handleStatusChange(l.id, "closed")}
                          className="text-xs text-amber-600 hover:underline disabled:opacity-50"
                        >
                          Unpublish
                        </button>
                      )}
                      <button
                        disabled={actionLoading === l.id}
                        onClick={() => void handleDelete(l.id, l.title)}
                        className="text-xs text-red-500 hover:underline disabled:opacity-50"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <Button variant="outline" size="sm" onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1}>Previous</Button>
          <span className="text-sm text-muted-foreground">Page {page} of {totalPages}</span>
          <Button variant="outline" size="sm" onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page === totalPages}>Next</Button>
        </div>
      )}
    </div>
  );
}

interface EmployerDetailData {
  employer: Record<string, unknown>;
  user: Record<string, unknown>;
  listings: Array<Record<string, unknown>>;
}

function EmployerDetailPanel({ id, onClose }: { id: number; onClose: () => void }) {
  const [data, setData] = useState<EmployerDetailData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_BASE}/admin/super/employers/${id}`, { credentials: "include" })
      .then((r) => r.json())
      .then((d: EmployerDetailData) => setData(d))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  return (
    <div className="px-6 py-5 bg-muted/30 border-t border-border space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm">Full Employer Detail</h3>
        <button onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground underline">Close</button>
      </div>

      {loading && <div className="flex justify-center py-4"><div className="w-5 h-5 border-4 border-primary/20 border-t-primary rounded-full animate-spin" /></div>}

      {!loading && data && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
            {[
              ["Company", String(data.employer["companyName"] ?? "—")],
              ["Region", String(data.employer["region"] ?? "—")],
              ["Industry", String(data.employer["industry"] ?? "—").replace(/_/g, " ")],
              ["Sponsor Licence", String(data.employer["sponsorLicenceNumber"] ?? "—")],
              ["Website", String(data.employer["website"] ?? "—")],
              ["Phone", String(data.employer["phone"] ?? "—")],
              ["User Email", String(data.user["email"] ?? "—")],
              ["User Role", String(data.user["role"] ?? "—").replace("_", " ")],
              ["Email Verified", String(data.user["emailVerified"]) === "true" ? "Yes" : "No"],
              ["User ID", String(data.user["id"] ?? "—").slice(0, 16) + "…"],
              ["Joined", data.employer["createdAt"] ? new Date(String(data.employer["createdAt"])).toLocaleDateString("en-GB") : "—"],
            ].map(([label, val]) => (
              <div key={label} className="bg-background rounded-lg px-3 py-2 border border-border">
                <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
                <p className="font-medium text-sm break-all">{val}</p>
              </div>
            ))}
          </div>

          <div>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Job Listings ({data.listings.length})</h4>
            {data.listings.length === 0 ? (
              <p className="text-xs text-muted-foreground">No listings.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/50">
                      <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Title</th>
                      <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Location</th>
                      <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Status</th>
                      <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Posted</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.listings.map((l, i) => (
                      <tr key={i} className="border-b border-border/50 last:border-0">
                        <td className="px-3 py-2 font-medium">{String(l["title"] ?? "—")}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{String(l["location"] ?? "—")}</td>
                        <td className="px-3 py-2">
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full capitalize ${String(l["status"]) === "published" ? "bg-green-100 text-green-700" : String(l["status"]) === "draft" ? "bg-amber-100 text-amber-700" : "bg-muted text-muted-foreground"}`}>
                            {String(l["status"] ?? "—")}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {l["createdAt"] ? new Date(String(l["createdAt"])).toLocaleDateString("en-GB") : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function EmployersTab() {
  const [employers, setEmployers] = useState<AdminEmployer[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const { toast } = useToast();

  const fetchEmployers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (search) params.set("search", search);
      const res = await fetch(`${API_BASE}/admin/super/employers?${params}`, { credentials: "include" });
      const data = await res.json() as { employers: AdminEmployer[]; total: number };
      setEmployers(data.employers ?? []);
      setTotal(data.total ?? 0);
    } catch {
      toast({ title: "Error", description: "Failed to load employers.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [page, search, toast]);

  useEffect(() => { void fetchEmployers(); }, [fetchEmployers]);

  const PAGE_SIZE = 25;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            className="w-full pl-9 pr-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
            placeholder="Search by company or email..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
        <Button variant="outline" size="sm" onClick={() => void fetchEmployers()} className="gap-1.5">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </Button>
      </div>

      <div className="text-xs text-muted-foreground">{total} employers total</div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">Company</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">Email</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">Industry</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">Region</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">Listings</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">Published</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground text-xs">Joined</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={8} className="text-center py-10 text-muted-foreground">Loading...</td></tr>}
              {!loading && employers.length === 0 && <tr><td colSpan={8} className="text-center py-10 text-muted-foreground">No employers found.</td></tr>}
              {!loading && employers.map((e) => (
                <>
                  <tr
                    key={e.id}
                    className="border-b border-border/50 hover:bg-muted/30 cursor-pointer"
                    onClick={() => setExpandedId(expandedId === e.id ? null : e.id)}
                  >
                    <td className="px-4 py-3 font-medium">{e.companyName}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{e.email}</td>
                    <td className="px-4 py-3 text-xs capitalize">{e.industry.replace(/_/g, " ")}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{e.region}</td>
                    <td className="px-4 py-3 text-center font-medium">{e.totalListings}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`text-xs font-medium ${e.publishedListings > 0 ? "text-green-600" : "text-muted-foreground"}`}>{e.publishedListings}</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{new Date(e.createdAt).toLocaleDateString("en-GB")}</td>
                    <td className="px-4 py-3">
                      {expandedId === e.id ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                    </td>
                  </tr>
                  {expandedId === e.id && (
                    <tr key={`${e.id}-detail`}>
                      <td colSpan={8} className="p-0">
                        <EmployerDetailPanel id={e.id} onClose={() => setExpandedId(null)} />
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <Button variant="outline" size="sm" onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1}>Previous</Button>
          <span className="text-sm text-muted-foreground">Page {page} of {totalPages}</span>
          <Button variant="outline" size="sm" onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page === totalPages}>Next</Button>
        </div>
      )}
    </div>
  );
}

type Tab = "overview" | "marketing" | "users" | "health" | "identity" | "letters" | "job-listings" | "employers";

export default function SuperAdminPage() {
  const [activeTab, setActiveTab] = useState<Tab>("overview");

  const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: "overview", label: "Overview", icon: Shield },
    { id: "marketing", label: "Marketing", icon: TrendingUp },
    { id: "users", label: "All Users", icon: Users },
    { id: "job-listings", label: "Job Listings", icon: ListOrdered },
    { id: "employers", label: "Employers", icon: Building2 },
    { id: "health", label: "Platform Health", icon: Activity },
    { id: "identity", label: "Identity Queue", icon: ShieldCheck },
    { id: "letters", label: "References", icon: Star },
  ];

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground">Super Admin</h1>
          <p className="text-muted-foreground text-sm mt-1">Operational intelligence view — full platform visibility.</p>
        </div>

        <div className="mobile-scroll-x flex gap-1 border-b border-border">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              data-testid={`button-super-admin-tab-${id}`}
              className={`flex shrink-0 items-center gap-2 whitespace-nowrap px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
                activeTab === id
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>

        <div>
          {activeTab === "overview" && <OverviewTab />}
          {activeTab === "marketing" && <MarketingPerformanceTab />}
          {activeTab === "users" && <AllUsersTab />}
          {activeTab === "job-listings" && <JobListingsTab />}
          {activeTab === "employers" && <EmployersTab />}
          {activeTab === "health" && <HealthTab />}
          {activeTab === "identity" && <IdentityQueueTab />}
          {activeTab === "letters" && <LettersTab />}
        </div>
      </div>
    </AppLayout>
  );
}
