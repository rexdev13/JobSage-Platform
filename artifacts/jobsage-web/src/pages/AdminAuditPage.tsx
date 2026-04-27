import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, PageTransition } from "@/components/ui-enhanced";
import {
  useExportDecisionAudit,
  useListConsentLog,
  useListAdminAuditEvents,
  ExportDecisionAuditFormat,
  type DecisionAuditExport,
} from "@workspace/api-client-react";
import { Shield, Download, ChevronLeft, ChevronRight, Loader2, AlertCircle } from "lucide-react";
import { DisclaimerBanner } from "@/components/ui/DisclaimerBanner";

const DISCLAIMER = "This platform provides decision support only. Final decisions rest with the relevant regulator.";

function DecisionAuditTab() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [queryParams, setQueryParams] = useState<{
    from?: string;
    to?: string;
    format?: typeof ExportDecisionAuditFormat[keyof typeof ExportDecisionAuditFormat];
  }>({ format: ExportDecisionAuditFormat.json });

  const { data: rawData, isLoading, isError } = useExportDecisionAudit(queryParams);
  const data = rawData && typeof rawData !== "string" ? (rawData as DecisionAuditExport) : undefined;

  const handleFilter = () =>
    setQueryParams({ from: from || undefined, to: to || undefined, format: ExportDecisionAuditFormat.json });

  const handleCsvDownload = () => {
    const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");
    const params = new URLSearchParams({ format: "csv" });
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    window.open(`${baseUrl}/api/admin/audit/decisions?${params.toString()}`);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs text-muted-foreground mb-1">From</label>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded border border-border bg-background text-sm px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">To</label>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="rounded border border-border bg-background text-sm px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
        <button
          onClick={handleFilter}
          className="px-4 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          Apply Filter
        </button>
        <button
          onClick={handleCsvDownload}
          className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg border border-border text-sm font-medium hover:bg-muted/50 transition-colors"
        >
          <Download className="w-4 h-4" /> Export CSV
        </button>
      </div>

      {isLoading && (
        <Card className="p-8 text-center">
          <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">Loading audit records…</p>
        </Card>
      )}
      {isError && (
        <Card className="p-6 text-center border-destructive/20">
          <AlertCircle className="w-6 h-6 text-destructive mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">Could not load audit records.</p>
        </Card>
      )}
      {!isLoading && !isError && data && (
        <>
          <p className="text-xs text-muted-foreground">
            {data.total} anonymised records · exported at{" "}
            {new Date(data.exportedAt).toLocaleString()}
          </p>
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted/60">
                <tr>
                  {["User ID (hashed)", "Date", "Ruleset Version", "Outcome", "Reason Codes"].map((h) => (
                    <th key={h} className="px-3 py-2 text-left font-semibold text-muted-foreground">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.records.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                      No records found.
                    </td>
                  </tr>
                )}
                {data.records.map((r, i) => (
                  <tr key={i} className="border-t border-border hover:bg-muted/20">
                    <td className="px-3 py-2 font-mono">{r.userIdHash}</td>
                    <td className="px-3 py-2">
                      {new Date(r.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-3 py-2">{r.rulesetVersion}</td>
                    <td className="px-3 py-2 capitalize">{r.outcome.replace("_", " ")}</td>
                    <td className="px-3 py-2 font-mono text-muted-foreground">
                      {r.reasonCodes.join(", ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function ConsentLogTab() {
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const { data, isLoading, isError } = useListConsentLog({ page, pageSize });

  const totalPages = data ? Math.ceil(data.total / pageSize) : 1;

  return (
    <div className="space-y-4">
      {isLoading && (
        <Card className="p-8 text-center">
          <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">Loading consent log…</p>
        </Card>
      )}
      {isError && (
        <Card className="p-6 text-center border-destructive/20">
          <AlertCircle className="w-6 h-6 text-destructive mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">Could not load consent log.</p>
        </Card>
      )}
      {!isLoading && !isError && data && (
        <>
          <p className="text-xs text-muted-foreground">{data.total} consent records total</p>
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted/60">
                <tr>
                  {["User ID", "Consented At", "Terms Version"].map((h) => (
                    <th key={h} className="px-3 py-2 text-left font-semibold text-muted-foreground">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.entries.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-3 py-6 text-center text-muted-foreground">
                      No records found.
                    </td>
                  </tr>
                )}
                {data.entries.map((e, i) => (
                  <tr key={i} className="border-t border-border hover:bg-muted/20">
                    <td className="px-3 py-2 font-mono">{e.userId}</td>
                    <td className="px-3 py-2">{new Date(e.consentedAt).toLocaleString()}</td>
                    <td className="px-3 py-2">{e.termsVersion}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              Page {page} of {totalPages}
            </span>
            <div className="flex gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="p-1.5 rounded border border-border hover:bg-muted/50 disabled:opacity-40 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="p-1.5 rounded border border-border hover:bg-muted/50 disabled:opacity-40 transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function formatActionName(action: string): string {
  return action
    .replace(/^admin_/, "")
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function AdminActionsTab() {
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const { data, isLoading, isError } = useListAdminAuditEvents({ page, pageSize });

  const totalPages = data ? Math.ceil(data.total / pageSize) : 1;

  return (
    <div className="space-y-4">
      {isLoading && (
        <Card className="p-8 text-center">
          <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">Loading admin actions…</p>
        </Card>
      )}
      {isError && (
        <Card className="p-6 text-center border-destructive/20">
          <AlertCircle className="w-6 h-6 text-destructive mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">Could not load admin actions.</p>
        </Card>
      )}
      {!isLoading && !isError && data && (
        <>
          <p className="text-xs text-muted-foreground">{data.total} admin action records total</p>
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted/60">
                <tr>
                  {["Action", "Actor (Admin ID)", "Target (User ID)", "Email", "Date"].map((h) => (
                    <th key={h} className="px-3 py-2 text-left font-semibold text-muted-foreground">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.events.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                      No admin actions recorded yet.
                    </td>
                  </tr>
                )}
                {data.events.map((e) => (
                  <tr key={e.id} className="border-t border-border hover:bg-muted/20">
                    <td className="px-3 py-2 font-medium">{formatActionName(e.action)}</td>
                    <td className="px-3 py-2 font-mono text-muted-foreground">{e.actor}</td>
                    <td className="px-3 py-2 font-mono text-muted-foreground">{e.target ?? "—"}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {(e.details as Record<string, unknown>)?.email as string ?? "—"}
                    </td>
                    <td className="px-3 py-2">{new Date(e.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              Page {page} of {totalPages}
            </span>
            <div className="flex gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="p-1.5 rounded border border-border hover:bg-muted/50 disabled:opacity-40 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="p-1.5 rounded border border-border hover:bg-muted/50 disabled:opacity-40 transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function AdminAuditPage() {
  const [tab, setTab] = useState<"decisions" | "consents" | "admin-actions">("decisions");

  const tabLabels: Record<typeof tab, string> = {
    decisions: "Decision Audit",
    consents: "Consent Log",
    "admin-actions": "Admin Actions",
  };

  return (
    <AppLayout>
      <PageTransition className="max-w-5xl mx-auto p-6 space-y-6">
        <DisclaimerBanner message={DISCLAIMER} />

        <div>
          <h1 className="text-2xl font-display font-bold text-foreground flex items-center gap-2">
            <Shield className="w-6 h-6 text-primary" /> Compliance &amp; Audit Logs
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Anonymised decision records and consent log for regulatory compliance.
          </p>
        </div>

        <div className="flex gap-2 border-b border-border pb-0">
          {(["decisions", "consents", "admin-actions"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
                tab === t
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {tabLabels[t]}
            </button>
          ))}
        </div>

        {tab === "decisions" && <DecisionAuditTab />}
        {tab === "consents" && <ConsentLogTab />}
        {tab === "admin-actions" && <AdminActionsTab />}
      </PageTransition>
    </AppLayout>
  );
}
