import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  useGetRegisterSyncLogs,
  useGetVacancySyncLogs,
  useTriggerRegisterSync,
  useTriggerVacancySync,
  type RegisterSyncLogEntry,
  type VacancySyncLogEntry,
} from "@workspace/api-client-react";
import {
  RefreshCw, CheckCircle2, XCircle, Clock, Zap, Database, Briefcase, AlertTriangle, Play,
  TrendingUp, TrendingDown, Minus,
} from "lucide-react";

function formatDate(dt: string | null | undefined): string {
  if (!dt) return "Never";
  return new Date(dt).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

function StatusBadge({ status }: { status: "success" | "error" }) {
  return status === "success" ? (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700 border border-green-200">
      <CheckCircle2 className="w-3 h-3" /> Success
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700 border border-red-200">
      <XCircle className="w-3 h-3" /> Error
    </span>
  );
}

function TriggeredByBadge({ triggeredBy }: { triggeredBy: "scheduler" | "manual" | null | undefined }) {
  if (!triggeredBy) return <span className="text-muted-foreground">—</span>;
  return triggeredBy === "manual" ? (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-violet-100 text-violet-700 border border-violet-200">
      <Zap className="w-3 h-3" /> Manual
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-sky-100 text-sky-700 border border-sky-200">
      <Clock className="w-3 h-3" /> Scheduled
    </span>
  );
}

function MetricChip({
  label, value, color = "default",
}: {
  label: string;
  value: string | number | null | undefined;
  color?: "default" | "green" | "red" | "sky";
}) {
  const colors = {
    default: "bg-muted text-muted-foreground border-border",
    green: "bg-green-50 text-green-700 border-green-200",
    red: "bg-red-50 text-red-700 border-red-200",
    sky: "bg-sky-50 text-sky-700 border-sky-200",
  };
  return (
    <div className={`flex flex-col items-center px-3 py-2 rounded-lg border text-center ${colors[color]}`}>
      <span className="text-lg font-bold leading-none">{value != null ? String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",") : "—"}</span>
      <span className="text-[10px] font-medium mt-1 uppercase tracking-wide opacity-70">{label}</span>
    </div>
  );
}

function RegisterSyncStatusCard({
  lastSuccess,
  lastFailure,
  onTrigger,
  triggering,
  queued,
}: {
  lastSuccess: RegisterSyncLogEntry | null;
  lastFailure: RegisterSyncLogEntry | null;
  onTrigger: () => void;
  triggering: boolean;
  queued: boolean;
}) {
  const hasFailed = !!lastFailure && (!lastSuccess || new Date(lastFailure.createdAt) > new Date(lastSuccess.createdAt));

  return (
    <Card className={hasFailed ? "border-destructive/40" : ""}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${hasFailed ? "bg-destructive/10" : "bg-primary/10"}`}>
              <Database className={`w-4 h-4 ${hasFailed ? "text-destructive" : "text-primary"}`} />
            </div>
            <CardTitle className="text-sm font-semibold">Register Sync</CardTitle>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={onTrigger}
            disabled={triggering || queued}
            className="gap-1.5 text-xs"
          >
            {triggering || queued ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Play className="w-3.5 h-3.5" />
            )}
            {queued ? "Queued..." : triggering ? "Running..." : "Run Now"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {hasFailed && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-destructive/10 border border-destructive/20 text-xs text-destructive">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>{lastFailure?.errorMessage ?? "Unknown error"}</span>
          </div>
        )}

        {/* Latest sync counts from most recent successful run */}
        {lastSuccess && (
           <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <MetricChip label="Total" value={lastSuccess.recordCount} />
            <MetricChip label="Added" value={lastSuccess.addedCount != null ? `+${lastSuccess.addedCount}` : null} color="green" />
            <MetricChip label="Updated" value={lastSuccess.updatedCount} color="sky" />
            <MetricChip label="Removed" value={lastSuccess.removedCount != null ? `-${lastSuccess.removedCount}` : null} color="red" />
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 rounded-lg bg-green-50 border border-green-100">
            <p className="text-xs text-green-700 font-medium mb-1">Last Success</p>
            <p className="text-xs text-green-900 font-semibold">{formatDate(lastSuccess?.createdAt)}</p>
            {lastSuccess && <p className="text-[10px] text-green-700 mt-0.5">{formatDuration(lastSuccess.durationMs)}</p>}
          </div>
          <div className={`p-3 rounded-lg ${lastFailure ? "bg-red-50 border border-red-100" : "bg-muted border border-border"}`}>
            <p className={`text-xs font-medium mb-1 ${lastFailure ? "text-red-700" : "text-muted-foreground"}`}>Last Failure</p>
            <p className={`text-xs font-semibold ${lastFailure ? "text-red-900" : "text-muted-foreground"}`}>{formatDate(lastFailure?.createdAt)}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function VacancySyncStatusCard({
  lastSuccess,
  lastFailure,
  onTrigger,
  triggering,
  queued,
}: {
  lastSuccess: VacancySyncLogEntry | null;
  lastFailure: VacancySyncLogEntry | null;
  onTrigger: () => void;
  triggering: boolean;
  queued: boolean;
}) {
  const hasFailed = !!lastFailure && (!lastSuccess || new Date(lastFailure.createdAt) > new Date(lastSuccess.createdAt));

  return (
    <Card className={hasFailed ? "border-destructive/40" : ""}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${hasFailed ? "bg-destructive/10" : "bg-primary/10"}`}>
              <Briefcase className={`w-4 h-4 ${hasFailed ? "text-destructive" : "text-primary"}`} />
            </div>
            <CardTitle className="text-sm font-semibold">Vacancy Check Sync</CardTitle>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={onTrigger}
            disabled={triggering || queued}
            className="gap-1.5 text-xs"
          >
            {triggering || queued ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Play className="w-3.5 h-3.5" />
            )}
            {queued ? "Queued..." : triggering ? "Running..." : "Run Now"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {hasFailed && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-destructive/10 border border-destructive/20 text-xs text-destructive">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>{lastFailure?.errorMessage ?? "Unknown error"}</span>
          </div>
        )}

        {/* Latest vacancy check counts from most recent successful run */}
        {lastSuccess && (
           <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <MetricChip label="Batch" value={lastSuccess.batchSize} />
            <MetricChip label="Checked" value={lastSuccess.checkedCount} color="green" />
            <MetricChip label="Cache Hits" value={lastSuccess.cacheHitCount} color="sky" />
            <MetricChip label="Errors" value={lastSuccess.errorCount} color={lastSuccess.errorCount ? "red" : "default"} />
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 rounded-lg bg-green-50 border border-green-100">
            <p className="text-xs text-green-700 font-medium mb-1">Last Success</p>
            <p className="text-xs text-green-900 font-semibold">{formatDate(lastSuccess?.createdAt)}</p>
            {lastSuccess && <p className="text-[10px] text-green-700 mt-0.5">{formatDuration(lastSuccess.durationMs)}</p>}
          </div>
          <div className={`p-3 rounded-lg ${lastFailure ? "bg-red-50 border border-red-100" : "bg-muted border border-border"}`}>
            <p className={`text-xs font-medium mb-1 ${lastFailure ? "text-red-700" : "text-muted-foreground"}`}>Last Failure</p>
            <p className={`text-xs font-semibold ${lastFailure ? "text-red-900" : "text-muted-foreground"}`}>{formatDate(lastFailure?.createdAt)}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function RegisterLogTable({ logs }: { logs: RegisterSyncLogEntry[] }) {
  if (logs.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-6">No register sync history yet.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border text-muted-foreground">
            <th className="text-left py-2 pr-3 font-medium">Time</th>
            <th className="text-left py-2 pr-3 font-medium">Status</th>
            <th className="text-right py-2 pr-3 font-medium">Records</th>
            <th className="text-right py-2 pr-3 font-medium">
              <span className="inline-flex items-center gap-0.5"><TrendingUp className="w-3 h-3 text-green-600" />Added</span>
            </th>
            <th className="text-right py-2 pr-3 font-medium">
              <span className="inline-flex items-center gap-0.5"><Minus className="w-3 h-3 text-sky-600" />Same</span>
            </th>
            <th className="text-right py-2 pr-3 font-medium">
              <span className="inline-flex items-center gap-0.5"><TrendingDown className="w-3 h-3 text-red-600" />Removed</span>
            </th>
            <th className="text-right py-2 pr-3 font-medium">Duration</th>
            <th className="text-left py-2 font-medium">Source</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">
          {logs.map((log) => (
            <tr key={log.id} className={log.status === "error" ? "bg-red-50/50" : ""}>
              <td className="py-2 pr-3 text-muted-foreground whitespace-nowrap">{formatDate(log.createdAt)}</td>
              <td className="py-2 pr-3"><StatusBadge status={log.status} /></td>
              <td className="py-2 pr-3 text-right font-mono">{log.recordCount?.toLocaleString() ?? "—"}</td>
              <td className="py-2 pr-3 text-right font-mono text-green-700">{log.addedCount != null ? `+${log.addedCount.toLocaleString()}` : "—"}</td>
              <td className="py-2 pr-3 text-right font-mono text-sky-700">{log.updatedCount?.toLocaleString() ?? "—"}</td>
              <td className="py-2 pr-3 text-right font-mono text-red-600">{log.removedCount != null ? `-${log.removedCount.toLocaleString()}` : "—"}</td>
              <td className="py-2 pr-3 text-right font-mono">{formatDuration(log.durationMs)}</td>
              <td className="py-2"><TriggeredByBadge triggeredBy={log.triggeredBy} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      {logs.some((l) => l.status === "error") && (
        <div className="mt-3 space-y-2">
          {logs.filter((l) => l.status === "error" && l.errorMessage).slice(0, 3).map((log) => (
            <div key={log.id} className="px-3 py-2 rounded-lg bg-red-50 border border-red-100 text-xs text-red-800">
              <span className="font-medium">{formatDate(log.createdAt)}:</span> {log.errorMessage}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function VacancyLogTable({ logs }: { logs: VacancySyncLogEntry[] }) {
  if (logs.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-6">No vacancy sync history yet.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border text-muted-foreground">
            <th className="text-left py-2 pr-3 font-medium">Time</th>
            <th className="text-left py-2 pr-3 font-medium">Status</th>
            <th className="text-right py-2 pr-3 font-medium">Batch</th>
            <th className="text-right py-2 pr-3 font-medium">Checked</th>
            <th className="text-right py-2 pr-3 font-medium">Cache Hits</th>
            <th className="text-right py-2 pr-3 font-medium">Errors</th>
            <th className="text-right py-2 pr-3 font-medium">Duration</th>
            <th className="text-left py-2 font-medium">Source</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">
          {logs.map((log) => (
            <tr key={log.id} className={log.status === "error" ? "bg-red-50/50" : ""}>
              <td className="py-2 pr-3 text-muted-foreground whitespace-nowrap">{formatDate(log.createdAt)}</td>
              <td className="py-2 pr-3"><StatusBadge status={log.status} /></td>
              <td className="py-2 pr-3 text-right font-mono">{log.batchSize ?? "—"}</td>
              <td className="py-2 pr-3 text-right font-mono text-green-700">{log.checkedCount ?? "—"}</td>
              <td className="py-2 pr-3 text-right font-mono text-sky-700">{log.cacheHitCount ?? "—"}</td>
              <td className="py-2 pr-3 text-right font-mono text-red-600">{log.errorCount ?? "—"}</td>
              <td className="py-2 pr-3 text-right font-mono">{formatDuration(log.durationMs)}</td>
              <td className="py-2"><TriggeredByBadge triggeredBy={log.triggeredBy} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      {logs.some((l) => l.status === "error") && (
        <div className="mt-3 space-y-2">
          {logs.filter((l) => l.status === "error" && l.errorMessage).slice(0, 3).map((log) => (
            <div key={log.id} className="px-3 py-2 rounded-lg bg-red-50 border border-red-100 text-xs text-red-800">
              <span className="font-medium">{formatDate(log.createdAt)}:</span> {log.errorMessage}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AdminSyncPage() {
  const { toast } = useToast();
  const [registerQueued, setRegisterQueued] = useState(false);
  const [vacancyQueued, setVacancyQueued] = useState(false);

  const { data: registerData, isLoading: registerLoading, refetch: refetchRegister } = useGetRegisterSyncLogs();
  const { data: vacancyData, isLoading: vacancyLoading, refetch: refetchVacancy } = useGetVacancySyncLogs();

  const triggerRegister = useTriggerRegisterSync();
  const triggerVacancy = useTriggerVacancySync();

  function handleTriggerRegister() {
    triggerRegister.mutate(undefined, {
      onSuccess: () => {
        setRegisterQueued(true);
        toast({ title: "Register sync queued", description: "The sync will run in the background. Logs will update shortly." });
        setTimeout(() => {
          setRegisterQueued(false);
          void refetchRegister();
        }, 15_000);
      },
      onError: (err) => {
        toast({ title: "Failed to trigger sync", description: err.message, variant: "destructive" });
      },
    });
  }

  function handleTriggerVacancy() {
    triggerVacancy.mutate(undefined, {
      onSuccess: () => {
        setVacancyQueued(true);
        toast({ title: "Vacancy check queued", description: "The batch will run in the background. Logs will update shortly." });
        setTimeout(() => {
          setVacancyQueued(false);
          void refetchVacancy();
        }, 15_000);
      },
      onError: (err) => {
        toast({ title: "Failed to trigger check", description: err.message, variant: "destructive" });
      },
    });
  }

  return (
    <AppLayout>
      <div className="p-6 max-w-5xl mx-auto space-y-8">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <RefreshCw className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Sync Management</h1>
            <p className="text-sm text-muted-foreground">Monitor and control automated data syncs</p>
          </div>
        </div>

        {/* Status cards with latest counts */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {registerLoading ? (
            <Card className="animate-pulse h-52" />
          ) : (
            <RegisterSyncStatusCard
              lastSuccess={registerData?.lastSuccess ?? null}
              lastFailure={registerData?.lastFailure ?? null}
              onTrigger={handleTriggerRegister}
              triggering={triggerRegister.isPending}
              queued={registerQueued}
            />
          )}
          {vacancyLoading ? (
            <Card className="animate-pulse h-52" />
          ) : (
            <VacancySyncStatusCard
              lastSuccess={vacancyData?.lastSuccess ?? null}
              lastFailure={vacancyData?.lastFailure ?? null}
              onTrigger={handleTriggerVacancy}
              triggering={triggerVacancy.isPending}
              queued={vacancyQueued}
            />
          )}
        </div>

        {/* Schedule info */}
        <Card>
          <CardContent className="pt-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <div className="flex items-start gap-3">
                <Clock className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium text-foreground">Register Sync Schedule</p>
                  <p className="text-muted-foreground text-xs mt-0.5">Once daily at 02:00 Europe/London. Up to 2 automatic retries on failure. Existing data is never deleted on failure.</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Clock className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium text-foreground">Vacancy Check Schedule</p>
                  <p className="text-muted-foreground text-xs mt-0.5">Every 8 hours at 06:00, 14:00, 22:00 Europe/London. Prioritises bookmarked companies, then recently checked, then unchecked.</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Register sync history */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Database className="w-4 h-4 text-muted-foreground" />
              Register Sync History (last 20)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {registerLoading ? (
              <div className="flex justify-center py-6"><div className="w-6 h-6 border-4 border-primary/20 border-t-primary rounded-full animate-spin" /></div>
            ) : (
              <RegisterLogTable logs={registerData?.logs ?? []} />
            )}
          </CardContent>
        </Card>

        {/* Vacancy sync history */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Briefcase className="w-4 h-4 text-muted-foreground" />
              Vacancy Check History (last 20)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {vacancyLoading ? (
              <div className="flex justify-center py-6"><div className="w-6 h-6 border-4 border-primary/20 border-t-primary rounded-full animate-spin" /></div>
            ) : (
              <VacancyLogTable logs={vacancyData?.logs ?? []} />
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
