import { useState, useRef } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, PageTransition, Button } from "@/components/ui-enhanced";
import {
  useAdminListRoles,
  useImportRolesCSV,
  useGetApplyUrlBackfillStatus,
  useTriggerApplyUrlBackfill,
  useGetSponsorVacancyBackfillStatus,
  useTriggerSponsorVacancyBackfill,
  useDeleteAllRoles,
  useDeleteRole,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { getAdminListRolesQueryKey } from "@workspace/api-client-react";
import {
  Upload,
  Download,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Building2,
  MapPin,
  RefreshCw,
  Sparkles,
  Clock,
  Trash2,
} from "lucide-react";

const CSV_TEMPLATE = `title,employer,location,regulator,sponsorshipOffered,requiredRegistration,targetRegions,applyUrl,requiredDbsClearanceLevel,requiredSafeguardingLevel
Consultant Cardiologist,NHS Trust London,London,GMC,true,Full GMC Registration,London,https://jobs.nhstrustlondon.nhs.uk/consultant-cardiologist,enhanced,level_2
Staff Nurse (Adult),Barts Health NHS Trust,London,NMC,true,Full NMC Registration,London,,,
Senior Physiotherapist,Kings College Hospital,London,HCPC,false,Full HCPC Registration,London,,,`;

function friendlyErrorMessage(err: unknown, fallback: string): string {
  const message = err instanceof Error ? err.message : "";
  if (!message) return fallback;
  // If the server returned raw HTML (e.g. an Express 404 page), don't dump markup into the banner.
  if (/<[a-z!][\s\S]*>/i.test(message)) {
    return "Server returned an unexpected error. Please try again.";
  }
  return message;
}

function downloadTemplate() {
  const blob = new Blob([CSV_TEMPLATE], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "roles-import-template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
}

function SponsorVacancyBackfillPanel() {
  const { data: statusData } = useGetSponsorVacancyBackfillStatus();
  const { mutate: triggerBackfill, isPending: triggering } = useTriggerSponsorVacancyBackfill();
  const [triggered, setTriggered] = useState(false);

  const lastRun = statusData?.lastRun ?? null;

  const handleTrigger = () => {
    setTriggered(true);
    triggerBackfill();
  };

  return (
    <Card className="p-6 border-primary/20">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-base font-semibold text-foreground flex items-center gap-2 mb-1">
            <Sparkles className="w-4 h-4 text-primary" />
            AI Apply URL Backfill — Sponsor Vacancies
          </h2>
          <p className="text-sm text-muted-foreground max-w-xl">
            Finds direct apply links for AI-discovered sponsor vacancies that don't have one yet.
            Uses the same employer-site-only policy as the roles backfill — aggregator URLs are
            rejected. New links are immediately queued for liveness verification. Runs automatically
            every night alongside the roles pass; trigger manually to process a batch now.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={handleTrigger}
          disabled={triggering || triggered}
          className="shrink-0"
        >
          {triggering || triggered ? (
            <>
              <RefreshCw className="w-4 h-4 mr-1.5 animate-spin" /> Running…
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4 mr-1.5" /> Run Now
            </>
          )}
        </Button>
      </div>

      {triggered && !lastRun && (
        <div className="mt-4 p-3 rounded-lg bg-blue-50 border border-blue-200 text-sm text-blue-700">
          Backfill queued — this runs in the background. Refresh this page or wait for the summary
          below to update.
        </div>
      )}

      {lastRun && (
        <div className="mt-4 p-4 rounded-lg bg-muted/40 border border-border space-y-2">
          <div className="flex flex-wrap gap-4 text-sm">
            <span className="flex items-center gap-1.5 text-green-700 font-semibold">
              <CheckCircle2 className="w-4 h-4" /> {lastRun.found} URLs found &amp; saved
            </span>
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <XCircle className="w-4 h-4" /> {lastRun.skipped} skipped
            </span>
            {lastRun.failed > 0 && (
              <span className="flex items-center gap-1.5 text-red-600">
                <AlertCircle className="w-4 h-4" /> {lastRun.failed} failed
              </span>
            )}
            <span className="flex items-center gap-1.5 text-muted-foreground text-xs">
              <Clock className="w-3.5 h-3.5" />
              {new Date(lastRun.ranAt).toLocaleString()} · {formatDuration(lastRun.durationMs)} ·{" "}
              {lastRun.triggeredBy === "manual" ? "Manual run" : "Scheduled run"} ·{" "}
              {lastRun.total} vacancies processed
            </span>
          </div>
        </div>
      )}
    </Card>
  );
}

function BackfillPanel() {
  const { data: statusData } = useGetApplyUrlBackfillStatus();
  const { mutate: triggerBackfill, isPending: triggering } = useTriggerApplyUrlBackfill();
  const [triggered, setTriggered] = useState(false);

  const lastRun = statusData?.lastRun ?? null;

  const handleTrigger = () => {
    setTriggered(true);
    triggerBackfill();
  };

  return (
    <Card className="p-6 border-primary/20">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-base font-semibold text-foreground flex items-center gap-2 mb-1">
            <Sparkles className="w-4 h-4 text-primary" />
            AI Apply URL Backfill
          </h2>
          <p className="text-sm text-muted-foreground max-w-xl">
            Automatically finds direct apply URLs for roles that don't have one yet using AI web
            search. Only employer-site URLs are saved — aggregator sites like Indeed or LinkedIn are
            rejected. Runs automatically every night; trigger manually to process a batch now.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={handleTrigger}
          disabled={triggering || triggered}
          className="shrink-0"
        >
          {triggering || triggered ? (
            <>
              <RefreshCw className="w-4 h-4 mr-1.5 animate-spin" /> Running…
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4 mr-1.5" /> Run Now
            </>
          )}
        </Button>
      </div>

      {triggered && !lastRun && (
        <div className="mt-4 p-3 rounded-lg bg-blue-50 border border-blue-200 text-sm text-blue-700">
          Backfill queued — this runs in the background and may take a few minutes depending on batch
          size. Refresh this page or wait for the summary below to update.
        </div>
      )}

      {lastRun && (
        <div className="mt-4 p-4 rounded-lg bg-muted/40 border border-border space-y-2">
          <div className="flex flex-wrap gap-4 text-sm">
            <span className="flex items-center gap-1.5 text-green-700 font-semibold">
              <CheckCircle2 className="w-4 h-4" /> {lastRun.found} URLs found &amp; saved
            </span>
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <XCircle className="w-4 h-4" /> {lastRun.skipped} skipped
            </span>
            {lastRun.failed > 0 && (
              <span className="flex items-center gap-1.5 text-red-600">
                <AlertCircle className="w-4 h-4" /> {lastRun.failed} failed
              </span>
            )}
            <span className="flex items-center gap-1.5 text-muted-foreground text-xs">
              <Clock className="w-3.5 h-3.5" />
              {new Date(lastRun.ranAt).toLocaleString()} · {formatDuration(lastRun.durationMs)} ·{" "}
              {lastRun.triggeredBy === "manual" ? "Manual run" : "Scheduled run"} ·{" "}
              {lastRun.total} roles processed
            </span>
          </div>
        </div>
      )}
    </Card>
  );
}

export default function AdminRolesPage() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importResult, setImportResult] = useState<{
    imported: number;
    skipped: number;
    errors: Array<{ row: number; message: string }>;
  } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const [showDeleteAllConfirm, setShowDeleteAllConfirm] = useState(false);
  const [deleteFeedback, setDeleteFeedback] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);

  const { data, isLoading, isError, refetch } = useAdminListRoles();
  const { mutate: deleteAllRoles, isPending: deletingAll } = useDeleteAllRoles({
    mutation: {
      onSuccess: (result) => {
        setShowDeleteAllConfirm(false);
        setDeleteFeedback({ kind: "success", message: `Deleted ${result.deleted} role${result.deleted === 1 ? "" : "s"} and their related records.` });
        queryClient.invalidateQueries({ queryKey: getAdminListRolesQueryKey() });
      },
      onError: (err) => {
        setShowDeleteAllConfirm(false);
        setDeleteFeedback({ kind: "error", message: friendlyErrorMessage(err, "Failed to delete roles.") });
      },
    },
  });
  const { mutate: deleteRole } = useDeleteRole({
    mutation: {
      onSuccess: () => {
        setPendingDeleteId(null);
        setDeleteFeedback({ kind: "success", message: "Role deleted." });
        queryClient.invalidateQueries({ queryKey: getAdminListRolesQueryKey() });
      },
      onError: (err) => {
        setPendingDeleteId(null);
        setDeleteFeedback({ kind: "error", message: friendlyErrorMessage(err, "Failed to delete role.") });
      },
    },
  });
  const { mutate: importCSV, isPending: importing } = useImportRolesCSV({
    mutation: {
      onSuccess: (result) => {
        setImportResult(result);
        setImportError(null);
        queryClient.invalidateQueries({ queryKey: getAdminListRolesQueryKey() });
      },
      onError: (err) => {
        setImportError(err instanceof Error ? err.message : "Import failed");
        setImportResult(null);
      },
    },
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportResult(null);
    setImportError(null);
    importCSV({ data: { file } });
    e.target.value = "";
  };

  const roles = data?.roles ?? [];

  return (
    <AppLayout>
      <PageTransition className="max-w-5xl mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-display font-bold text-foreground">Role Catalogue</h1>
            <p className="text-muted-foreground mt-1 text-sm">
              Import and manage the opportunity catalogue for candidates.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="w-4 h-4 mr-1.5" /> Refresh
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowDeleteAllConfirm(true)}
              disabled={roles.length === 0 || deletingAll}
              className="text-red-600 border-red-200 hover:bg-red-50"
              data-testid="button-delete-all-roles"
            >
              <Trash2 className="w-4 h-4 mr-1.5" /> Delete all
            </Button>
          </div>
        </div>

        {showDeleteAllConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="bg-background rounded-xl border border-border shadow-xl max-w-md w-full p-6 space-y-4">
              <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-red-600" /> Delete all roles?
              </h3>
              <p className="text-sm text-muted-foreground">
                This will permanently remove <strong>{roles.length} role{roles.length === 1 ? "" : "s"}</strong> from
                the catalogue, along with their applications, match scores, dismissals, and smart-apply drafts. This
                cannot be undone.
              </p>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowDeleteAllConfirm(false)}
                  disabled={deletingAll}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={() => deleteAllRoles()}
                  disabled={deletingAll}
                  className="bg-red-600 hover:bg-red-700 text-white"
                  data-testid="button-confirm-delete-all"
                >
                  {deletingAll ? (
                    <>
                      <RefreshCw className="w-4 h-4 mr-1.5 animate-spin" /> Deleting…
                    </>
                  ) : (
                    <>
                      <Trash2 className="w-4 h-4 mr-1.5" /> Delete {roles.length} role{roles.length === 1 ? "" : "s"}
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}

        {deleteFeedback && (
          <div
            className={`p-3 rounded-lg border text-sm flex items-start gap-2 ${
              deleteFeedback.kind === "success"
                ? "bg-green-50 border-green-200 text-green-700"
                : "bg-red-50 border-red-200 text-red-700"
            }`}
          >
            {deleteFeedback.kind === "success" ? (
              <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            )}
            {deleteFeedback.message}
          </div>
        )}

        <Card className="p-6 border-primary/20">
          <h2 className="text-base font-semibold text-foreground mb-1">Import Roles via CSV</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Upload a CSV with columns:{" "}
            <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">
              title, employer, location, regulator, sponsorshipOffered, requiredRegistration
            </code>
            <span className="text-muted-foreground"> and optional </span>
            <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">targetRegions, applyUrl, requiredDbsClearanceLevel, requiredSafeguardingLevel</code>
            <span className="text-muted-foreground">. targetRegions is optional; use known UK region names separated by commas or |. Leave it blank for an unrestricted/unknown location. Leave the safeguarding columns blank unless the requirement is explicitly stated (DBS: none/basic/standard/enhanced; safeguarding: none/level_1/level_2).</span>
          </p>

          <div className="flex gap-3 flex-wrap">
            <Button variant="outline" size="sm" onClick={downloadTemplate}>
              <Download className="w-4 h-4 mr-1.5" /> Download Template
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={handleFileChange}
              className="hidden"
            />
            <Button
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={importing}
            >
              {importing ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-1.5 animate-spin" /> Importing…
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4 mr-1.5" /> Upload CSV
                </>
              )}
            </Button>
          </div>

          {importError && (
            <div className="mt-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              {importError}
            </div>
          )}

          {importResult && (
            <div className="mt-4 p-4 rounded-lg bg-muted/40 border border-border space-y-3">
              <div className="flex gap-6 text-sm">
                <span className="flex items-center gap-1.5 text-green-700 font-semibold">
                  <CheckCircle2 className="w-4 h-4" /> {importResult.imported} imported
                </span>
                {importResult.skipped > 0 && (
                  <span className="flex items-center gap-1.5 text-red-600 font-semibold">
                    <XCircle className="w-4 h-4" /> {importResult.skipped} skipped
                  </span>
                )}
              </div>
              {importResult.errors.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">Row-level errors:</p>
                  <div className="max-h-40 overflow-y-auto space-y-1">
                    {importResult.errors.map((e) => (
                      <div key={e.row} className="flex items-start gap-2 text-xs text-red-700 bg-red-50 px-2 py-1.5 rounded">
                        <span className="font-mono font-bold shrink-0">Row {e.row}:</span>
                        {e.message}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </Card>

        <BackfillPanel />
        <SponsorVacancyBackfillPanel />

        <div>
          <h2 className="text-base font-semibold text-foreground mb-3">
            All Roles ({roles.length})
          </h2>

          {isLoading && (
            <Card className="p-8 text-center">
              <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">Loading roles…</p>
            </Card>
          )}

          {isError && (
            <Card className="p-8 text-center border-destructive/20">
              <AlertCircle className="w-8 h-8 text-destructive mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">Could not load roles.</p>
            </Card>
          )}

          {!isLoading && !isError && roles.length === 0 && (
            <Card className="p-8 text-center">
              <p className="text-sm text-muted-foreground">
                No roles imported yet. Upload a CSV to get started.
              </p>
            </Card>
          )}

          {!isLoading && !isError && roles.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Title</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Employer</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Location</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Reg.</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Sponsorship</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Apply URL</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {roles.map((role) => (
                    <tr key={role.id} className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-3 font-medium text-foreground">{role.title}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Building2 className="w-3.5 h-3.5" /> {role.employer}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <MapPin className="w-3.5 h-3.5" /> {role.location}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-0.5 rounded bg-muted font-mono text-xs">{role.regulator}</span>
                      </td>
                      <td className="px-4 py-3">
                        {role.sponsorshipOffered ? (
                          <span className="flex items-center gap-1 text-green-700 text-xs font-medium">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Yes
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-muted-foreground text-xs">
                            <XCircle className="w-3.5 h-3.5" /> No
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {role.applyUrl ? (
                          <a
                            href={role.applyUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-primary hover:underline max-w-[180px] truncate"
                            title={role.applyUrl}
                          >
                            {role.applyUrl.replace(/^https?:\/\//, "").substring(0, 30)}…
                          </a>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {role.active ? (
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">Active</span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">Inactive</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => {
                            setPendingDeleteId(role.id);
                            deleteRole({ roleId: role.id });
                          }}
                          disabled={pendingDeleteId === role.id}
                          className="p-1.5 rounded-md text-muted-foreground hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
                          title="Delete role"
                          data-testid={`button-delete-role-${role.id}`}
                        >
                          {pendingDeleteId === role.id ? (
                            <RefreshCw className="w-4 h-4 animate-spin" />
                          ) : (
                            <Trash2 className="w-4 h-4" />
                          )}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </PageTransition>
    </AppLayout>
  );
}
