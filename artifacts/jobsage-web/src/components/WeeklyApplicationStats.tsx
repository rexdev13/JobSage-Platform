import { Card } from "@/components/ui-enhanced";

export type WeeklyApplicationStatsData = {
  total: number;
  link_clicked: number;
  applied: number;
  interview: number;
  offer: number;
};

const ITEMS: { key: keyof WeeklyApplicationStatsData; label: string; color: string }[] = [
  { key: "link_clicked", label: "Clicked", color: "text-slate-600" },
  { key: "applied", label: "Applied", color: "text-blue-600" },
  { key: "interview", label: "Interview", color: "text-purple-600" },
  { key: "offer", label: "Offers", color: "text-amber-600" },
];

export function WeeklyApplicationStats({
  stats,
  isLoading,
}: {
  stats?: WeeklyApplicationStatsData;
  isLoading?: boolean;
}) {
  if (!stats && !isLoading) return null;

  return (
    <Card className="p-4 mb-6 border-primary/10">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Applications started</h2>
          <p className="text-[11px] text-muted-foreground mt-0.5">Last 7 days · current status</p>
        </div>
        {isLoading ? (
          <span className="text-xs text-muted-foreground">Loading…</span>
        ) : (
          <span className="text-xs font-semibold text-primary">
            {stats?.total ?? 0} total
          </span>
        )}
      </div>
      {isLoading && !stats ? (
        <div className="grid grid-cols-4 gap-2">
          {ITEMS.map((item) => <div key={item.key} className="h-12 rounded-lg bg-muted animate-pulse" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {ITEMS.map(({ key, label, color }) => (
            <div key={key} className="rounded-lg bg-muted/40 px-3 py-2 text-center">
              <p className={`text-lg font-bold ${color}`}>{stats?.[key] ?? 0}</p>
              <p className="text-[10px] text-muted-foreground">{label}</p>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}