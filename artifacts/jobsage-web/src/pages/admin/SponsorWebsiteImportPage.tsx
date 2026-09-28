import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  SponsorWebsiteImportPreview,
  SponsorWebsiteImportStageResult,
  SponsorWebsiteImportStagingList,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api";
const PAGE_SIZE = 40;

type PreviewRow = SponsorWebsiteImportPreview["rows"][number];
type PreviewResponse = SponsorWebsiteImportPreview;
type StagingResponse = SponsorWebsiteImportStagingList;

function countLabel(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function safeExternalUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

async function responseError(response: Response): Promise<string> {
  try {
    const body = await response.json() as { error?: string };
    return body.error || `Request failed (${response.status}).`;
  } catch {
    return `Request failed (${response.status}).`;
  }
}

export default function SponsorWebsiteImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [applied, setApplied] = useState<{ websiteUpdates: number; careersUpdates: number } | null>(null);
  const [stagingResult, setStagingResult] = useState<SponsorWebsiteImportStageResult | null>(null);
  const [stagingData, setStagingData] = useState<StagingResponse | null>(null);
  const [stagingLoading, setStagingLoading] = useState(false);
  const [loading, setLoading] = useState<"preview" | "apply" | "stage" | null>(null);
  const [error, setError] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(0);
  const [stagingFilter, setStagingFilter] = useState("pending");
  const [stagingPage, setStagingPage] = useState(0);
  const [selectedTargets, setSelectedTargets] = useState<Record<string, number>>({});
  const [resolvedRows, setResolvedRows] = useState<Record<string, boolean>>({});

  const reviewRows = useMemo(() => {
    if (!preview) return [];
    return preview.rows.filter((row) =>
      !["safe_to_import", "already_matches_production_noop", "duplicate_candidate_same_target_noop"]
        .includes(row.status),
    );
  }, [preview]);

  const filteredRows = useMemo(
    () => statusFilter === "all"
      ? reviewRows
      : reviewRows.filter((row) => row.status === statusFilter),
    [reviewRows, statusFilter],
  );
  const pageRows = filteredRows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const safeCount = preview?.counts.safe_to_import ?? 0;
  const noOpCount = preview?.counts.already_matches_production_noop ?? 0;

  const loadStaging = useCallback(async (status = stagingFilter, offset = 0): Promise<void> => {
    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(offset),
    });
    if (status !== "all") params.set("status", status);
    setStagingLoading(true);
    try {
      const response = await fetch(
        `${API_BASE}/admin/sponsor-website-import/staging?${params.toString()}`,
        { credentials: "include" },
      );
      if (!response.ok) throw new Error(await responseError(response));
      setStagingData(await response.json() as StagingResponse);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load the durable review queue.");
    } finally {
      setStagingLoading(false);
    }
  }, [stagingFilter]);

  useEffect(() => {
    if (!import.meta.env.PROD) {
      setStagingData(null);
      setStagingLoading(false);
      return;
    }
    void loadStaging(stagingFilter, 0);
  }, [loadStaging, stagingFilter]);

  async function runPreview(): Promise<void> {
    if (!file) return;
    setLoading("preview");
    setError("");
    setAcknowledged(false);
    setPage(0);
    const form = new FormData();
    form.append("file", file);
    try {
      const response = await fetch(`${API_BASE}/admin/sponsor-website-import/preview`, {
        method: "POST",
        credentials: "include",
        body: form,
      });
      if (!response.ok) throw new Error(await responseError(response));
      setPreview(await response.json() as PreviewResponse);
    } catch (cause) {
      setPreview(null);
      setError(cause instanceof Error ? cause.message : "Could not prepare the preview.");
    } finally {
      setLoading(null);
    }
  }

  async function saveIdentityResolution(row: PreviewRow): Promise<void> {
    if (!preview || preview.environment !== "production") return;
    const targetId = selectedTargets[row.sourceRef];
    if (!targetId) {
      setError("Select a production sponsor before saving a resolution.");
      return;
    }
    const reason = window.prompt(
      `Why is production sponsor ${targetId} the same sponsor? Include the evidence you checked.`,
    );
    if (!reason || reason.trim().length < 8) return;
    setError("");
    try {
      const response = await fetch(`${API_BASE}/admin/sponsor-website-import/resolve`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identity: row.identity,
          targetSponsorLicenceId: targetId,
          reason: reason.trim(),
        }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      setResolvedRows((previous) => ({ ...previous, [row.sourceRef]: true }));
      await runPreview();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save this identity mapping.");
    }
  }

  async function applySafeRows(): Promise<void> {
    if (!file || !preview || !acknowledged) return;
    if (preview.environment !== "production") {
      setError("Apply is disabled outside the published production application.");
      return;
    }
    if (!window.confirm(
      `Apply ${preview.writeCount} verified, blank-field updates to production? Existing values and unresolved rows will be left unchanged.`,
    )) return;

    setLoading("apply");
    setError("");
    const form = new FormData();
    form.append("file", file);
    form.append("planHash", preview.planHash);
    try {
      const response = await fetch(`${API_BASE}/admin/sponsor-website-import/apply`, {
        method: "POST",
        credentials: "include",
        body: form,
      });
      if (!response.ok) throw new Error(await responseError(response));
      const result = await response.json() as {
        websiteUpdates: number;
        careersUpdates: number;
      };
      setApplied({
        websiteUpdates: result.websiteUpdates,
        careersUpdates: result.careersUpdates,
      });
      setAcknowledged(false);
      await runPreview();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The import could not be applied.");
    } finally {
      setLoading(null);
    }
  }

  async function stageHeldRows(): Promise<void> {
    if (!file || !preview || reviewRows.length === 0) return;
    if (preview.environment !== "production") {
      setError("Durable staging is disabled outside the published production application.");
      return;
    }
    if (!window.confirm(
      `Store ${reviewRows.length} held candidates in the durable review table? This does not change sponsor URLs or vacancy sources.`,
    )) return;

    setLoading("stage");
    setError("");
    const form = new FormData();
    form.append("file", file);
    form.append("planHash", preview.planHash);
    try {
      const response = await fetch(`${API_BASE}/admin/sponsor-website-import/stage`, {
        method: "POST",
        credentials: "include",
        body: form,
      });
      if (!response.ok) throw new Error(await responseError(response));
      setStagingResult(await response.json() as SponsorWebsiteImportStageResult);
      setStagingPage(0);
      await loadStaging(stagingFilter, 0);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not stage held candidates.");
    } finally {
      setLoading(null);
    }
  }

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-8">
      <header className="space-y-2">
        <p className="text-sm font-semibold uppercase tracking-wide text-primary">Super-admin tools</p>
        <h1 className="text-3xl font-bold">Sponsor website and careers import</h1>
        <p className="max-w-3xl text-muted-foreground">
          Upload the row-level production reconciliation CSV. The importer matches against the
          database it is running on, never trusts development IDs, and only writes high-confidence
          values into blank production fields.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>1. Preview the current production match</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="block text-sm font-medium" htmlFor="sponsor-import-file">
            Reconciliation CSV
          </label>
          <input
            id="sponsor-import-file"
            type="file"
            accept=".csv,text/csv"
            className="block w-full rounded-md border border-input bg-background p-2 text-sm"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setPreview(null);
              setApplied(null);
            }}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => void runPreview()} disabled={!file || loading !== null}>
              {loading === "preview" ? "Checking current records…" : "Run read-only preview"}
            </Button>
            {preview && (
              <span className="text-sm text-muted-foreground">
                Database environment: <strong>{preview.environment}</strong>
              </span>
            )}
          </div>
          {error && (
            <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              {error}
            </p>
          )}
          {preview && (
            <div className="rounded-lg border bg-muted/30 p-4">
              <p className="font-medium">
                {preview.rowCount.toLocaleString()} rows checked · {preview.writeCount.toLocaleString()} safe writes · {noOpCount.toLocaleString()} already match
              </p>
              <p className="mt-1 break-all text-xs text-muted-foreground">
                Preview hash: {preview.planHash}
              </p>
              <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {Object.entries(preview.counts).sort(([a], [b]) => a.localeCompare(b)).map(([status, count]) => (
                  <div key={status} className="flex justify-between gap-3 rounded border bg-background px-3 py-2 text-sm">
                    <span>{countLabel(status)}</span>
                    <strong>{count.toLocaleString()}</strong>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {preview && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>2. Resolve identity matches that need review</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {preview.environment !== "production" && (
                <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
                  This preview is against the {preview.environment} database. Open this page in the
                  published production app to save mappings or apply changes.
                </p>
              )}
              <div className="flex flex-wrap items-center gap-3">
                <label className="text-sm font-medium" htmlFor="review-status">Filter held rows</label>
                <select
                  id="review-status"
                  className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={statusFilter}
                  onChange={(event) => {
                    setStatusFilter(event.target.value);
                    setPage(0);
                  }}
                >
                  <option value="all">All held rows ({reviewRows.length.toLocaleString()})</option>
                  {[...new Set(reviewRows.map((row) => row.status))].sort().map((status) => (
                    <option key={status} value={status}>
                      {countLabel(status)} ({preview.counts[status] ?? 0})
                    </option>
                  ))}
                </select>
              </div>
              {pageRows.length === 0 ? (
                <p className="text-sm text-muted-foreground">No held rows in this view.</p>
              ) : (
                <div className="space-y-3">
                  {pageRows.map((row) => (
                    <article key={row.sourceRef} className="rounded-lg border p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h3 className="font-semibold">{row.organisationName}</h3>
                          <p className="text-xs text-muted-foreground">
                            {row.field} · {row.sourceRef} · {countLabel(row.status)}
                          </p>
                        </div>
                        {safeExternalUrl(row.evidenceUrl) ? (
                          <a
                            className="text-sm text-primary underline"
                            href={safeExternalUrl(row.evidenceUrl)!}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Open evidence
                          </a>
                        ) : (
                          <span className="text-sm text-muted-foreground">No valid evidence link</span>
                        )}
                      </div>
                      <p className="mt-2 text-sm text-muted-foreground">{row.reason}</p>
                      <p className="mt-1 break-all text-xs">
                        Candidate: {safeExternalUrl(row.candidateUrl) ? (
                          <a href={safeExternalUrl(row.candidateUrl)!} target="_blank" rel="noopener noreferrer" className="text-primary underline">
                            {row.candidateUrl}
                          </a>
                        ) : (
                          row.candidateUrl || "none"
                        )}
                      </p>
                      {row.currentValue && (
                        <p className="mt-1 break-all text-xs">
                          Existing production value: {row.currentValue}
                        </p>
                      )}
                      {[
                        "manual_review_ambiguous_identity",
                        "manual_review_identity_conflict",
                        "manual_review_incomplete_identity",
                      ].includes(row.status) && row.productionCandidates.length > 0 && (
                        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                          <label className="sr-only" htmlFor={`target-${row.sourceRef}`}>
                            Select the verified production sponsor
                          </label>
                          <select
                            id={`target-${row.sourceRef}`}
                            className="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
                            value={selectedTargets[row.sourceRef] ?? ""}
                            onChange={(event) =>
                              setSelectedTargets((previous) => ({
                                ...previous,
                                [row.sourceRef]: Number(event.target.value) || 0,
                              }))
                            }
                          >
                            <option value="">Choose a production sponsor…</option>
                            {row.productionCandidates.map((candidate) => (
                              <option key={candidate.id} value={candidate.id}>
                                #{candidate.id} · {candidate.organisationName} · {candidate.townCity || "location missing"} · {candidate.industry || "industry missing"} · {candidate.route} / {candidate.subRoute}
                              </option>
                            ))}
                          </select>
                          <Button
                            variant="outline"
                            onClick={() => void saveIdentityResolution(row)}
                            disabled={
                              preview.environment !== "production" ||
                              !selectedTargets[row.sourceRef] ||
                              resolvedRows[row.sourceRef]
                            }
                          >
                            {resolvedRows[row.sourceRef] ? "Mapping saved" : "Save reviewed match"}
                          </Button>
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              )}
              {filteredRows.length > PAGE_SIZE && (
                <div className="flex items-center justify-between border-t pt-4">
                  <span className="text-sm text-muted-foreground">
                    Rows {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filteredRows.length)} of {filteredRows.length}
                  </span>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setPage((value) => Math.max(0, value - 1))} disabled={page === 0}>Previous</Button>
                    <Button variant="outline" onClick={() => setPage((value) => value + 1)} disabled={(page + 1) * PAGE_SIZE >= filteredRows.length}>Next</Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>3. Stage held candidates for durable review</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Held candidates are stored in a separate review table. Staging does not change
                sponsor URLs or any vacancy-discovery source.
              </p>
              {stagingResult && (
                <p role="status" className="rounded-md border bg-muted/30 p-3 text-sm">
                  Staged {stagingResult.stagedCount.toLocaleString()} new candidates;
                  {" "}{stagingResult.alreadyStagedCount.toLocaleString()} were already queued.
                </p>
              )}
              <Button
                variant="outline"
                onClick={() => void stageHeldRows()}
                disabled={
                  preview.environment !== "production" ||
                  reviewRows.length === 0 ||
                  loading !== null
                }
              >
                {loading === "stage"
                  ? "Saving held candidates…"
                  : `Stage ${reviewRows.length.toLocaleString()} held candidates`}
              </Button>
              {preview.environment !== "production" && (
                <p className="text-xs text-muted-foreground">
                  Staging becomes available from the published production app after the schema change is published.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>4. Apply only the reviewed safe rows</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                The apply step rechecks the database and preview hash. It will not use development
                IDs, overwrite a populated field, or include ambiguous, conflicting, or lower-confidence
                rows. Held rows remain visible above for further evidence or identity review.
              </p>
              {applied && (
                <p role="status" className="rounded-md border border-green-600/30 bg-green-600/5 p-3 text-sm">
                  Applied {applied.websiteUpdates} website updates and {applied.careersUpdates} careers updates.
                </p>
              )}
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(event) => setAcknowledged(event.target.checked)}
                  disabled={preview.environment !== "production" || safeCount === 0 || loading !== null}
                  className="mt-1"
                />
                I reviewed the counts and authorize only the {preview.writeCount.toLocaleString()} listed safe blank-field updates.
              </label>
              <Button
                onClick={() => void applySafeRows()}
                disabled={
                  preview.environment !== "production" ||
                  preview.writeCount === 0 ||
                  !acknowledged ||
                  loading !== null
                }
              >
                {loading === "apply" ? "Rechecking and applying…" : `Apply ${preview.writeCount.toLocaleString()} safe updates`}
              </Button>
            </CardContent>
          </Card>
        </>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Durable sponsor URL review queue</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm font-medium" htmlFor="staging-status">
              Queue status
            </label>
            <select
              id="staging-status"
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={stagingFilter}
              onChange={(event) => {
                setStagingPage(0);
                setStagingFilter(event.target.value);
              }}
            >
              <option value="pending">Pending</option>
              <option value="resolved">Resolved</option>
              <option value="rejected">Rejected</option>
              <option value="all">All statuses</option>
            </select>
            <Button
              variant="outline"
              onClick={() => void loadStaging(stagingFilter, stagingPage * PAGE_SIZE)}
              disabled={stagingLoading}
            >
              {stagingLoading ? "Refreshing…" : "Refresh"}
            </Button>
            {stagingData && (
              <span className="text-sm text-muted-foreground">
                {stagingData.total.toLocaleString()} records
              </span>
            )}
          </div>
          {stagingData?.rows.length ? (
            <div className="space-y-3">
              {stagingData.rows.map((row) => (
                <article key={row.id} className="rounded-lg border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold">{row.organisationName || "Unnamed employer"}</h3>
                      <p className="text-xs text-muted-foreground">
                        {row.field} · {row.sourceRef} · {row.reviewStatus} · {row.resolverStatus}
                      </p>
                    </div>
                    <time className="text-xs text-muted-foreground" dateTime={row.createdAt}>
                      {new Date(row.createdAt).toLocaleString()}
                    </time>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">{row.resolverReason}</p>
                  <p className="mt-2 break-all text-xs">
                    Candidate: {safeExternalUrl(row.candidateUrl) ? (
                      <a
                        href={safeExternalUrl(row.candidateUrl)!}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary underline"
                      >
                        {row.candidateUrl}
                      </a>
                    ) : row.candidateUrl || "none"}
                  </p>
                  {safeExternalUrl(row.evidenceUrl) && (
                    <a
                      className="mt-1 inline-block text-xs text-primary underline"
                      href={safeExternalUrl(row.evidenceUrl)!}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Open saved evidence
                    </a>
                  )}
                  <p className="mt-2 text-xs text-muted-foreground">
                    Source identity: {row.identitySnapshot.organisationName || row.organisationName}
                    {row.identitySnapshot.townCity ? ` · ${row.identitySnapshot.townCity}` : ""}
                    {row.identitySnapshot.region ? ` · ${row.identitySnapshot.region}` : ""}
                    {" · "}{row.productionCandidates.length} compatible production candidate(s)
                  </p>
                </article>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {stagingLoading
                ? "Loading the durable review queue…"
                : stagingData
                  ? "No staged candidates match this filter."
                  : import.meta.env.PROD
                    ? "The durable review queue is not available yet."
                    : "The durable review queue is available from the published production app."}
            </p>
          )}
          {stagingData && stagingData.total > PAGE_SIZE && (
            <div className="flex items-center justify-between border-t pt-4">
              <span className="text-sm text-muted-foreground">
                Rows {stagingPage * PAGE_SIZE + 1}–{Math.min((stagingPage + 1) * PAGE_SIZE, stagingData.total)} of {stagingData.total}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    const nextPage = Math.max(0, stagingPage - 1);
                    setStagingPage(nextPage);
                    void loadStaging(stagingFilter, nextPage * PAGE_SIZE);
                  }}
                  disabled={stagingPage === 0 || stagingLoading}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    const nextPage = stagingPage + 1;
                    setStagingPage(nextPage);
                    void loadStaging(stagingFilter, nextPage * PAGE_SIZE);
                  }}
                  disabled={(stagingPage + 1) * PAGE_SIZE >= stagingData.total || stagingLoading}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}