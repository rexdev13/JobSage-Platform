import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Check, ChevronRight, LoaderCircle, RotateCw, ShieldAlert } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui-enhanced";

type ReportRow = {
  id: number;
  ticketId: string;
  category: string;
  status: "new" | "in_review" | "attended" | "resolved";
  severity: "low" | "normal" | "high" | "urgent";
  assignedToMe: boolean;
  createdAt: string;
};

type ReportDetail = {
  id: number;
  ticketId: string;
  category: string;
  subject: string;
  message: string;
  reportedMessageId: number | null;
  sourceEvidence: {
    label: string;
    fields: Array<{ label: string; value: string }>;
    unavailable?: boolean;
  } | null;
  appealOfTicketId: number | null;
  status: "new" | "in_review" | "attended" | "resolved";
  severity: "low" | "normal" | "high" | "urgent";
  moderationDecision: "pending" | "no_action" | "escalated";
  adminNotes: string | null;
  escalatedAt: string | null;
  createdAt: string;
};

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const data = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? "The request could not be completed.");
  return data;
}

export default function ModeratorReportsPage() {
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [selected, setSelected] = useState<ReportDetail | null>(null);
  const [status, setStatus] = useState<ReportDetail["status"]>("in_review");
  const [severity, setSeverity] = useState<ReportDetail["severity"]>("normal");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setReports(await requestJson<ReportRow[]>("/api/moderation/reports"));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Reports could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function claim(id: number) {
    setBusy(true);
    setError(null);
    try {
      await requestJson(`/api/moderation/reports/${id}/claim`, { method: "POST", body: "{}" });
      await refresh();
      await openReport(id);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "The report could not be claimed.");
    } finally {
      setBusy(false);
    }
  }

  async function openReport(id: number) {
    setError(null);
    try {
      const report = await requestJson<ReportDetail>(`/api/moderation/reports/${id}`);
      setSelected(report);
      setStatus(report.status);
      setSeverity(report.severity);
      setNote("");
    } catch (requestError) {
      setSelected(null);
      setError(requestError instanceof Error ? requestError.message : "The report could not be opened.");
    }
  }

  async function save(update: Record<string, unknown>) {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await requestJson(`/api/moderation/reports/${selected.id}`, {
        method: "PATCH",
        body: JSON.stringify(update),
      });
      await openReport(selected.id);
      await refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "The moderation update could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppLayout>
      <main className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="mb-1 flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-primary" aria-hidden="true" />
              <h1 className="text-2xl font-semibold">Assigned reports</h1>
            </div>
            <p className="text-sm text-muted-foreground">Review reported content, record internal notes, and escalate cases that need an administrator.</p>
          </div>
          <Button type="button" variant="outline" onClick={() => void refresh()} disabled={loading} aria-label="Refresh reports">
            <RotateCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
            Refresh
          </Button>
        </header>

        {error && <p role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{error}
        </p>}

        <div className="grid gap-4 lg:grid-cols-[minmax(260px,0.8fr)_minmax(0,1.4fr)]">
          <section aria-label="Report queue" className="rounded-xl border bg-card">
            <div className="border-b px-4 py-3">
              <h2 className="font-semibold">Queue <span className="text-sm font-normal text-muted-foreground">({reports.length})</span></h2>
            </div>
            {loading ? (
              <p role="status" className="flex items-center gap-2 p-5 text-sm text-muted-foreground"><LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />Loading reports…</p>
            ) : reports.length === 0 ? (
              <p className="p-5 text-sm text-muted-foreground">No unassigned or assigned reports need review.</p>
            ) : (
              <ul className="divide-y">
                {reports.map(report => (
                  <li key={report.id} className="p-3">
                    <div className="flex items-center justify-between gap-2">
                      <button type="button" onClick={() => void openReport(report.id)} disabled={!report.assignedToMe}
                        className="min-h-11 min-w-0 flex-1 rounded-md px-2 text-left hover:bg-muted disabled:cursor-default"
                        aria-label={report.assignedToMe ? `Open assigned report ${report.ticketId}` : `Unassigned report ${report.ticketId}`}>
                        <span className="block font-medium">{report.ticketId}</span>
                        <span className="block text-xs text-muted-foreground">{report.category} · {report.severity} · {report.status.replace("_", " ")}</span>
                      </button>
                      {report.assignedToMe ? (
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      ) : (
                        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void claim(report.id)}>Claim</Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-label="Report details" className="min-h-72 rounded-xl border bg-card p-4 sm:p-5">
            {!selected ? (
              <div className="flex h-full min-h-64 flex-col items-center justify-center text-center text-sm text-muted-foreground">
                <ShieldAlert className="mb-2 h-6 w-6" aria-hidden="true" />
                Select a report assigned to you to review its details.
              </div>
            ) : (
              <div className="space-y-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{selected.ticketId} · {selected.category}</p>
                    <h2 className="mt-1 text-lg font-semibold">{selected.subject}</h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {selected.reportedMessageId ? `Reported message #${selected.reportedMessageId}` : "Content report"}
                      {selected.appealOfTicketId ? ` · Appeal of case #${selected.appealOfTicketId}` : ""}
                    </p>
                  </div>
                  <span className="rounded-full border px-2.5 py-1 text-xs capitalize">{selected.moderationDecision.replace("_", " ")}</span>
                </div>

                <div className="rounded-lg bg-muted/50 p-3">
                  <h3 className="mb-1 text-sm font-medium">Report details</h3>
                  <p className="whitespace-pre-wrap break-words text-sm">{selected.message}</p>
                </div>

                {selected.sourceEvidence && <section className="rounded-lg border p-3" aria-label="Reported source evidence">
                  <h3 className="mb-2 text-sm font-medium">{selected.sourceEvidence.label}</h3>
                  {selected.sourceEvidence.unavailable || selected.sourceEvidence.fields.length === 0 ? (
                    <p className="text-sm text-muted-foreground">The original source is no longer available. Use the reporter’s description above.</p>
                  ) : (
                    <dl className="space-y-2">
                      {selected.sourceEvidence.fields.map((field, index) => (
                        <div key={`${field.label}-${index}`} className="grid gap-1 sm:grid-cols-[140px_minmax(0,1fr)]">
                          <dt className="text-xs font-medium text-muted-foreground">{field.label}</dt>
                          <dd className="whitespace-pre-wrap break-words text-sm">{field.value}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </section>}

                {selected.adminNotes && <div>
                  <h3 className="mb-1 text-sm font-medium">Internal notes</h3>
                  <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{selected.adminNotes}</p>
                </div>}

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-sm font-medium">
                    Triage status
                    <select value={status} onChange={event => setStatus(event.target.value as ReportDetail["status"])}
                      className="mt-1 block min-h-11 w-full rounded-md border bg-background px-3 font-normal">
                      <option value="in_review">In review</option><option value="attended">Attended</option><option value="resolved">Resolved</option>
                    </select>
                  </label>
                  <label className="text-sm font-medium">
                    Severity
                    <select value={severity} onChange={event => setSeverity(event.target.value as ReportDetail["severity"])}
                      className="mt-1 block min-h-11 w-full rounded-md border bg-background px-3 font-normal">
                      <option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option>
                    </select>
                  </label>
                </div>
                <label className="block text-sm font-medium">
                  Internal note
                  <textarea value={note} onChange={event => setNote(event.target.value)} maxLength={2000} rows={3}
                    className="mt-1 block w-full rounded-md border bg-background p-3 font-normal" placeholder="Record relevant review context (do not include unrelated personal data)." />
                </label>
                <p className="text-xs text-muted-foreground">
                  No-action and escalation decisions email the reporter a generic status and report reference only. Internal notes and source evidence are not included. If email delivery fails, the decision is not saved.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" disabled={busy} onClick={() => void save({
                    status, severity, ...(note.trim() ? { internalNote: note.trim() } : {}),
                  })}>
                    <Check className="mr-2 h-4 w-4" aria-hidden="true" />Save triage
                  </Button>
                  <Button type="button" variant="outline" disabled={busy || !note.trim()} onClick={() => void save({
                    decision: "no_action", internalNote: note.trim(),
                  })}>Resolve: no action</Button>
                  <Button type="button" variant="outline" disabled={busy} onClick={() => void save({
                    decision: "escalate", ...(note.trim() ? { internalNote: note.trim() } : {}),
                  })}>Request escalation</Button>
                </div>
              </div>
            )}
          </section>
        </div>
      </main>
    </AppLayout>
  );
}
