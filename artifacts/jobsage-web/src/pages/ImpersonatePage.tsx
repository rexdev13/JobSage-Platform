import { useEffect, useState } from "react";
import { useSearch } from "wouter";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api";

interface ApplicationItem {
  id: number;
  roleId: number;
  roleTitle: string | null;
  roleEmployer: string | null;
  status: string;
  appliedAt: string;
  notes: string | null;
}

interface ImpersonationData {
  impersonating: boolean;
  adminId: string | null;
  user: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    role: string;
    emailVerified: boolean;
    createdAt: string;
    lastLogin: string | null;
  };
  profile: Record<string, unknown> | null;
  employerProfile: Record<string, unknown> | null;
  documents: { id: number; filename: string; mimeType: string; storageKey: string; uploadedAt: string }[];
  applications: ApplicationItem[];
  eligibilityHistory: { id: number; outcome: string; createdAt: string }[];
  auditEvents: { id: number; actor: string; action: string; target: string | null; createdAt: string }[];
  consent: Record<string, unknown> | null;
  latestDecision: { outcome: string; createdAt: string } | null;
}

function Field({ label, value }: { label: string; value: string | number | boolean | null | undefined }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="flex gap-3 py-1.5 border-b border-border/50 last:border-0 text-sm">
      <span className="text-muted-foreground min-w-44 capitalize">{label.replace(/([A-Z])/g, " $1").trim()}</span>
      <span className="font-medium">{String(value)}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border p-5 space-y-1">
      <h2 className="text-sm font-semibold mb-3">{title}</h2>
      {children}
    </div>
  );
}

export default function ImpersonatePage() {
  const searchStr = useSearch();
  const token = new URLSearchParams(searchStr).get("token") ?? "";
  const [data, setData] = useState<ImpersonationData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) { setError("No impersonation token provided."); setLoading(false); return; }
    fetch(`${API_BASE}/admin/super/impersonate/validate?token=${encodeURIComponent(token)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error((body as { error?: string }).error ?? "Invalid or expired token.");
        }
        return r.json();
      })
      .then(setData)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-10 h-10 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-4">
        <div className="text-2xl font-bold text-destructive">Access Denied</div>
        <p className="text-muted-foreground">{error ?? "Failed to load impersonation data."}</p>
        <button onClick={() => window.close()} className="text-sm text-primary hover:underline">Close this tab</button>
      </div>
    );
  }

  const { user, profile, employerProfile, documents, applications, eligibilityHistory, auditEvents, consent, latestDecision } = data;
  const displayName = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email;

  const fmt = (d: string | null | undefined) =>
    d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";

  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 z-50 bg-amber-500 text-amber-950 px-6 py-3 flex items-center justify-between shadow-md">
        <div className="flex items-center gap-3">
          <div className="w-2.5 h-2.5 rounded-full bg-amber-900 animate-pulse" />
          <span className="font-semibold text-sm">
            Impersonating: <strong>{displayName}</strong> ({user.email})
          </span>
          <span className="text-xs bg-amber-900/20 px-2 py-0.5 rounded-full capitalize">{user.role.replace(/_/g, " ")}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs font-medium">Read-only — all writes blocked by server</span>
          <button
            onClick={() => window.close()}
            className="text-xs bg-amber-900/20 hover:bg-amber-900/30 px-3 py-1 rounded-lg font-medium transition-colors"
          >
            Close
          </button>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8 space-y-8">
        <div>
          <h1 className="text-2xl font-bold">{displayName}</h1>
          <p className="text-muted-foreground">{user.email} · <span className="capitalize">{user.role.replace(/_/g, " ")}</span></p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Section title="Account">
            <Field label="ID" value={user.id} />
            <Field label="Email Verified" value={user.emailVerified ? "Yes" : "No"} />
            <Field label="Joined" value={fmt(user.createdAt)} />
            <Field label="Last Activity" value={fmt(user.lastLogin)} />
            <Field label="Eligibility Status" value={latestDecision?.outcome?.replace(/_/g, " ") ?? "Not evaluated"} />
            <Field label="Data Consent" value={consent ? `Consented ${fmt((consent as { consentedAt?: string }).consentedAt)}` : "Not consented"} />
          </Section>

          {profile && (
            <Section title="Candidate Profile">
              {Object.entries(profile)
                .filter(([k]) => !["id", "userId", "createdAt", "updatedAt", "lastAlertSentAt", "boostProfile"].includes(k))
                .map(([k, v]) => <Field key={k} label={k} value={v as string} />)}
            </Section>
          )}

          {employerProfile && (
            <Section title="Employer Profile">
              {Object.entries(employerProfile)
                .filter(([k]) => !["id", "userId", "createdAt", "updatedAt"].includes(k))
                .map(([k, v]) => <Field key={k} label={k} value={v as string} />)}
            </Section>
          )}
        </div>

        {documents.length > 0 && (
          <Section title={`Documents (${documents.length})`}>
            <div className="space-y-2 mt-1">
              {documents.map((doc) => (
                <div key={doc.id} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
                  <div>
                    <div className="text-sm font-medium">{doc.filename}</div>
                    <div className="text-xs text-muted-foreground">{doc.mimeType} · {fmt(doc.uploadedAt)}</div>
                  </div>
                  <a
                    href={`${API_BASE}/storage/objects/${doc.storageKey}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-primary hover:underline"
                  >
                    Download
                  </a>
                </div>
              ))}
            </div>
          </Section>
        )}

        {applications.length > 0 && (
          <Section title={`Applications (${applications.length})`}>
            <div className="space-y-0 mt-1">
              {applications.map((app) => (
                <div key={app.id} className="flex items-center justify-between py-2.5 border-b border-border/50 last:border-0">
                  <div>
                    <div className="text-sm font-medium">{app.roleTitle ?? `Role #${app.roleId}`}</div>
                    {app.roleEmployer && <div className="text-xs text-muted-foreground">{app.roleEmployer}</div>}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="capitalize text-xs bg-muted px-2 py-0.5 rounded-full">{app.status}</span>
                    <div className="text-xs text-muted-foreground">{fmt(app.appliedAt)}</div>
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}

        {eligibilityHistory.length > 0 && (
          <Section title="Eligibility History">
            <div className="space-y-0 mt-1">
              {eligibilityHistory.map((rec) => (
                <div key={rec.id} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
                  <span className="text-sm capitalize">{rec.outcome.replace(/_/g, " ")}</span>
                  <span className="text-xs text-muted-foreground">{fmt(rec.createdAt)}</span>
                </div>
              ))}
            </div>
          </Section>
        )}

        {auditEvents.length > 0 && (
          <Section title="Recent Audit Events (last 20)">
            <div className="space-y-0 mt-1">
              {auditEvents.map((ev) => (
                <div key={ev.id} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0 text-xs">
                  <span className="font-mono text-muted-foreground">{ev.action}</span>
                  <span className="text-muted-foreground">{fmt(ev.createdAt)}</span>
                </div>
              ))}
            </div>
          </Section>
        )}

        {!profile && !employerProfile && documents.length === 0 && applications.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <p>This user hasn't set up their profile yet.</p>
          </div>
        )}
      </div>
    </div>
  );
}
