import { useState, useEffect, useCallback } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  Users, Briefcase, CheckCircle, FileText, Building2, RefreshCw,
  ChevronDown, ChevronUp, Shield, Activity, Search, ExternalLink,
  TrendingUp, AlertTriangle, ShieldCheck, Star, BadgeCheck, UserCheck,
  XCircle, Clock,
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
}

interface SuperUser {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: string;
  emailVerified: boolean;
  createdAt: string;
  updatedAt: string;
  lastLogin: string | null;
  profileCompletion: number;
  documentCount: number;
  applicationCount: number;
  eligibilityStatus: string | null;
  hasConsented: boolean;
  consentedAt: string | null;
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
    fetch(`${API_BASE}/admin/super/stats`, { credentials: "include" })
      .then((r) => r.json())
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
    </div>
  );
}

function UserDetailPanel({ userId, apiBase, onImpersonate }: { userId: string; apiBase: string; onImpersonate: (userId: string) => void }) {
  const [detail, setDetail] = useState<UserFull | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${apiBase}/admin/super/users/${userId}/full`, { credentials: "include" })
      .then((r) => r.json())
      .then(setDetail)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [userId, apiBase]);

  if (loading) return <div className="py-6 flex justify-center"><div className="w-6 h-6 border-4 border-primary/20 border-t-primary rounded-full animate-spin" /></div>;
  if (!detail) return <p className="text-xs text-muted-foreground py-4 px-6">Failed to load user detail.</p>;

  const { user, profile, employerProfile, documents, applications, eligibilityHistory, auditEvents, consent } = detail;

  return (
    <div className="px-6 pb-6 pt-2 space-y-5 border-t border-border bg-muted/30">
      <div className="flex items-center justify-end pt-2">
        <Button size="sm" variant="outline" onClick={() => onImpersonate(userId)} className="gap-1.5">
          <ExternalLink className="w-3.5 h-3.5" />
          Impersonate (Read-Only)
        </Button>
      </div>

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

function AllUsersTab() {
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
      const data = await res.json();
      setUsers(data.users ?? []);
      setTotal(data.total ?? 0);
    } catch {
      toast({ title: "Error", description: "Failed to load users.", variant: "destructive" });
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

      <div className="text-xs text-muted-foreground">{total} users total</div>

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
              {!loading && users.length === 0 && (
                <tr><td colSpan={12} className="text-center py-10 text-muted-foreground">No users found.</td></tr>
              )}
              {!loading && users.map((u) => (
                <>
                  <tr
                    key={u.id}
                    className="border-b border-border/50 hover:bg-muted/30 cursor-pointer transition-colors"
                    onClick={() => setExpandedId(expandedId === u.id ? null : u.id)}
                  >
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground" title={u.id}>{u.id.slice(0, 8)}&hellip;</td>
                    <td className="px-4 py-3 font-medium">{u.email}</td>
                    <td className="px-4 py-3">
                      <span className="capitalize text-xs bg-muted px-2 py-0.5 rounded-full">{u.role.replace("_", " ")}</span>
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
                        <UserDetailPanel userId={u.id} apiBase={API_BASE} onImpersonate={handleImpersonate} />
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
            <table className="w-full text-sm">
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
        <div className="border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
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
        <div className="border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
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

type Tab = "overview" | "users" | "health" | "identity" | "letters";

export default function SuperAdminPage() {
  const [activeTab, setActiveTab] = useState<Tab>("overview");

  const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: "overview", label: "Overview", icon: Shield },
    { id: "users", label: "All Users", icon: Users },
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

        <div className="flex gap-1 border-b border-border">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
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
          {activeTab === "users" && <AllUsersTab />}
          {activeTab === "health" && <HealthTab />}
          {activeTab === "identity" && <IdentityQueueTab />}
          {activeTab === "letters" && <LettersTab />}
        </div>
      </div>
    </AppLayout>
  );
}
