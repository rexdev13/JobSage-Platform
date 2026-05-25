import { useEffect, useState } from "react";
import { useSearch } from "wouter";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api";

interface ImpersonationData {
  impersonating: boolean;
  adminId: string;
  user: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    role: string;
    emailVerified: boolean;
    createdAt: string;
  };
  profile: Record<string, unknown> | null;
  employerProfile: Record<string, unknown> | null;
  documents: { id: number; fileName: string; fileType: string; storageKey: string; uploadedAt: string }[];
  applications: { id: number; roleId: number; status: string; appliedAt: string }[];
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

export default function ImpersonatePage() {
  const searchStr = useSearch();
  const token = new URLSearchParams(searchStr).get("token") ?? "";
  const [data, setData] = useState<ImpersonationData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) { setError("No impersonation token provided."); setLoading(false); return; }
    fetch(`${API_BASE}/admin/super/impersonate/validate?token=${encodeURIComponent(token)}`, { credentials: "include" })
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

  const { user, profile, employerProfile, documents, applications, latestDecision } = data;
  const displayName = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email;

  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 z-50 bg-amber-500 text-amber-950 px-6 py-3 flex items-center justify-between shadow-md">
        <div className="flex items-center gap-3">
          <div className="w-2.5 h-2.5 rounded-full bg-amber-900 animate-pulse" />
          <span className="font-semibold text-sm">
            Impersonating: <strong>{displayName}</strong> ({user.email})
          </span>
          <span className="text-xs bg-amber-900/20 px-2 py-0.5 rounded-full capitalize">{user.role.replace("_", " ")}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs">Read-only — no writes permitted</span>
          <button
            onClick={() => window.close()}
            className="text-xs bg-amber-900/20 hover:bg-amber-900/30 px-3 py-1 rounded-lg font-medium transition-colors"
          >
            Close
          </button>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-8 space-y-8">
        <div>
          <h1 className="text-2xl font-bold">{displayName}</h1>
          <p className="text-muted-foreground">{user.email} · <span className="capitalize">{user.role.replace("_", " ")}</span></p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="rounded-xl border border-border p-5 space-y-1">
            <h2 className="text-sm font-semibold mb-3">Account</h2>
            <Field label="ID" value={user.id} />
            <Field label="Email Verified" value={user.emailVerified ? "Yes" : "No"} />
            <Field label="Joined" value={new Date(user.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })} />
            <Field label="Eligibility Status" value={latestDecision?.outcome?.replace("_", " ") ?? "Not evaluated"} />
          </div>

          {profile && (
            <div className="rounded-xl border border-border p-5">
              <h2 className="text-sm font-semibold mb-3">Candidate Profile</h2>
              <div className="space-y-0">
                {Object.entries(profile)
                  .filter(([k]) => !["id", "userId", "createdAt", "updatedAt", "lastAlertSentAt", "boostProfile"].includes(k))
                  .map(([k, v]) => <Field key={k} label={k} value={v as string} />)}
              </div>
            </div>
          )}

          {employerProfile && (
            <div className="rounded-xl border border-border p-5">
              <h2 className="text-sm font-semibold mb-3">Employer Profile</h2>
              <div className="space-y-0">
                {Object.entries(employerProfile)
                  .filter(([k]) => !["id", "userId", "createdAt", "updatedAt"].includes(k))
                  .map(([k, v]) => <Field key={k} label={k} value={v as string} />)}
              </div>
            </div>
          )}
        </div>

        {documents.length > 0 && (
          <div className="rounded-xl border border-border p-5">
            <h2 className="text-sm font-semibold mb-3">Documents ({documents.length})</h2>
            <div className="space-y-2">
              {documents.map((doc) => (
                <div key={doc.id} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
                  <div>
                    <div className="text-sm font-medium">{doc.fileName}</div>
                    <div className="text-xs text-muted-foreground">{doc.fileType} · {new Date(doc.uploadedAt).toLocaleDateString("en-GB")}</div>
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
          </div>
        )}

        {applications.length > 0 && (
          <div className="rounded-xl border border-border p-5">
            <h2 className="text-sm font-semibold mb-3">Applications ({applications.length})</h2>
            <div className="space-y-2">
              {applications.map((app) => (
                <div key={app.id} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
                  <div className="text-sm">Role #{app.roleId}</div>
                  <span className="capitalize text-xs bg-muted px-2 py-0.5 rounded-full">{app.status}</span>
                  <div className="text-xs text-muted-foreground">{new Date(app.appliedAt).toLocaleDateString("en-GB")}</div>
                </div>
              ))}
            </div>
          </div>
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
