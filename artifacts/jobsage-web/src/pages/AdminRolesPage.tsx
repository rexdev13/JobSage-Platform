import { useState, useRef } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, PageTransition, Button } from "@/components/ui-enhanced";
import { useAdminListRoles, useImportRolesCSV } from "@workspace/api-client-react";
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
} from "lucide-react";

const CSV_TEMPLATE = `title,employer,location,regulator,sponsorshipOffered,requiredRegistration
Consultant Cardiologist,NHS Trust London,London,GMC,true,Full GMC Registration
Staff Nurse (Adult),Barts Health NHS Trust,London,NMC,true,Full NMC Registration
Senior Physiotherapist,Kings College Hospital,London,HCPC,false,Full HCPC Registration`;

function downloadTemplate() {
  const blob = new Blob([CSV_TEMPLATE], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "roles-import-template.csv";
  a.click();
  URL.revokeObjectURL(url);
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

  const { data, isLoading, isError, refetch } = useAdminListRoles();
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
    const formData = new FormData();
    formData.append("file", file);
    importCSV({ data: formData as unknown as { file: Blob } });
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
          </div>
        </div>

        <Card className="p-6 border-primary/20">
          <h2 className="text-base font-semibold text-foreground mb-1">Import Roles via CSV</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Upload a CSV with columns:{" "}
            <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">
              title, employer, location, regulator, sponsorshipOffered, requiredRegistration
            </code>
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
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
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
                        {role.active ? (
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">Active</span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">Inactive</span>
                        )}
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
