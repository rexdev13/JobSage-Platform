import { useState, useMemo } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, Button, PageTransition } from "@/components/ui-enhanced";
import { useListMyApplications } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { getListMyApplicationsQueryKey } from "@workspace/api-client-react";
import { motion } from "framer-motion";
import {
  CalendarDays,
  Clock,
  MapPin,
  ChevronLeft,
  ChevronRight,
  Plus,
  X,
  CheckCircle2,
  Loader2,
  Pencil,
} from "lucide-react";
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  parseISO,
  isToday,
  isFuture,
  isPast,
} from "date-fns";
import { useToast } from "@/hooks/use-toast";
import type { Application } from "@workspace/api-client-react";

type EnrichedApplication = Application & { roleTitle?: string | null; roleLocation?: string | null };

function useSetInterviewDate() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");

  async function setDate(applicationId: number, interviewDate: string | null, interviewNotes: string | null) {
    const res = await fetch(`${base}/api/applications/${applicationId}/interview-date`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ interviewDate, interviewNotes }),
    });
    if (!res.ok) throw new Error("Failed to update interview date");
    await queryClient.invalidateQueries({ queryKey: getListMyApplicationsQueryKey() });
    toast({ title: "Interview date saved", description: "Your interview schedule has been updated." });
  }

  return { setDate };
}

function SetInterviewDateModal({
  application,
  onClose,
}: {
  application: EnrichedApplication;
  onClose: () => void;
}) {
  const { setDate } = useSetInterviewDate();
  const [date, setDateValue] = useState(
    application.interviewDate ? application.interviewDate.slice(0, 16) : ""
  );
  const [notes, setNotes] = useState(application.interviewNotes ?? "");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      await setDate(application.id, date || null, notes || null);
      onClose();
    } catch {
      setSaving(false);
    }
  }

  const roleLabel = application.roleTitle ?? `Role #${application.roleId}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-sm bg-background rounded-2xl shadow-2xl border border-border overflow-hidden"
      >
        <div className="flex items-start justify-between p-5 border-b border-border">
          <div>
            <h2 className="text-base font-bold text-foreground">Set Interview Date</h2>
            <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-xs">{roleLabel}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="text-xs font-semibold text-foreground mb-1.5 block">Interview date & time</label>
            <input
              type="datetime-local"
              value={date}
              onChange={(e) => setDateValue(e.target.value)}
              className="w-full text-sm rounded-xl border border-border bg-muted/40 px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-foreground mb-1.5 block">Notes (optional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="e.g. Panel interview, bring portfolio, Teams link..."
              className="w-full text-sm rounded-xl border border-border bg-muted/40 px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 px-5 pb-5">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={saving} className="gap-1.5">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
            Save
          </Button>
        </div>
      </motion.div>
    </div>
  );
}

function CalendarGrid({
  currentMonth,
  interviews,
  onDayClick,
}: {
  currentMonth: Date;
  interviews: EnrichedApplication[];
  onDayClick: (app: EnrichedApplication) => void;
}) {
  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(currentMonth), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(currentMonth), { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end });
  }, [currentMonth]);

  const interviewsByDay = useMemo(() => {
    const map: Record<string, EnrichedApplication[]> = {};
    for (const app of interviews) {
      if (!app.interviewDate) continue;
      const key = format(parseISO(app.interviewDate), "yyyy-MM-dd");
      if (!map[key]) map[key] = [];
      map[key].push(app);
    }
    return map;
  }, [interviews]);

  const dayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  return (
    <div>
      <div className="grid grid-cols-7 mb-2">
        {dayLabels.map((d) => (
          <div key={d} className="text-center text-[11px] font-semibold text-muted-foreground py-1">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {days.map((day) => {
          const key = format(day, "yyyy-MM-dd");
          const dayInterviews = interviewsByDay[key] ?? [];
          const inMonth = isSameMonth(day, currentMonth);
          const today = isToday(day);

          return (
            <div
              key={key}
              className={`min-h-[52px] rounded-xl p-1 text-center transition-all ${
                !inMonth ? "opacity-30" : ""
              } ${today ? "ring-2 ring-primary/50 bg-primary/5" : "hover:bg-muted/60"}`}
            >
              <span
                className={`text-xs font-medium block mb-0.5 ${
                  today ? "text-primary font-bold" : "text-foreground"
                }`}
              >
                {format(day, "d")}
              </span>
              <div className="flex flex-col gap-0.5">
                {dayInterviews.map((app) => (
                  <button
                    key={app.id}
                    onClick={() => onDayClick(app)}
                    className="w-full text-[9px] bg-primary/90 hover:bg-primary text-primary-foreground rounded px-1 py-0.5 truncate font-medium text-left leading-tight transition-colors"
                  >
                    {app.roleTitle ?? `#${app.roleId}`}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function InterviewCalendarPage() {
  const { data, isLoading } = useListMyApplications();
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [editingApp, setEditingApp] = useState<EnrichedApplication | null>(null);
  const [addingForApp, setAddingForApp] = useState<EnrichedApplication | null>(null);

  const allApps = (data?.applications ?? []) as EnrichedApplication[];
  const interviewApps = allApps.filter((a) => a.status === "interview");
  const scheduledApps = interviewApps.filter((a) => a.interviewDate);
  const unscheduledApps = interviewApps.filter((a) => !a.interviewDate);

  const upcoming = scheduledApps
    .filter((a) => a.interviewDate && (isFuture(parseISO(a.interviewDate)) || isToday(parseISO(a.interviewDate))))
    .sort((a, b) => new Date(a.interviewDate!).getTime() - new Date(b.interviewDate!).getTime());

  const past = scheduledApps
    .filter((a) => a.interviewDate && isPast(parseISO(a.interviewDate)) && !isToday(parseISO(a.interviewDate)))
    .sort((a, b) => new Date(b.interviewDate!).getTime() - new Date(a.interviewDate!).getTime());

  function prevMonth() {
    setCurrentMonth((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1));
  }
  function nextMonth() {
    setCurrentMonth((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1));
  }

  const modalApp = editingApp ?? addingForApp;

  return (
    <AppLayout>
      <PageTransition>
        {modalApp && (
          <SetInterviewDateModal
            application={modalApp}
            onClose={() => {
              setEditingApp(null);
              setAddingForApp(null);
            }}
          />
        )}

        <header className="mb-8">
          <h1 className="text-3xl font-display font-bold text-foreground flex items-center gap-3">
            <CalendarDays className="w-8 h-8 text-primary" />
            Interview Schedule
          </h1>
          <p className="text-muted-foreground mt-2">
            Track your scheduled interviews and manage upcoming dates.
          </p>
        </header>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Calendar */}
            <div className="lg:col-span-2">
              <Card className="p-6">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-lg font-bold text-foreground">
                    {format(currentMonth, "MMMM yyyy")}
                  </h2>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={prevMonth}
                      className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setCurrentMonth(new Date())}
                      className="text-xs font-medium text-primary hover:underline px-2"
                    >
                      Today
                    </button>
                    <button
                      onClick={nextMonth}
                      className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <CalendarGrid
                  currentMonth={currentMonth}
                  interviews={scheduledApps}
                  onDayClick={(app) => setEditingApp(app)}
                />
                {scheduledApps.length === 0 && (
                  <div className="text-center py-6 text-muted-foreground text-sm mt-4">
                    No interviews scheduled yet. Add dates to your interview-stage applications.
                  </div>
                )}
              </Card>
            </div>

            {/* Sidebar panels */}
            <div className="flex flex-col gap-4">
              {/* Upcoming */}
              <Card className="p-5">
                <h3 className="text-sm font-bold text-foreground mb-4 flex items-center gap-2">
                  <Clock className="w-4 h-4 text-primary" /> Upcoming
                  {upcoming.length > 0 && (
                    <span className="ml-auto px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-semibold">
                      {upcoming.length}
                    </span>
                  )}
                </h3>
                {upcoming.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No upcoming interviews.</p>
                ) : (
                  <div className="space-y-3">
                    {upcoming.map((app) => (
                      <motion.div
                        key={app.id}
                        initial={{ opacity: 0, x: 8 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="rounded-xl border border-border bg-muted/30 p-3"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-foreground truncate">
                              {app.roleTitle ?? `Role #${app.roleId}`}
                            </p>
                            {app.roleLocation && (
                              <p className="flex items-center gap-1 text-[10px] text-muted-foreground mt-0.5">
                                <MapPin className="w-2.5 h-2.5" /> {app.roleLocation}
                              </p>
                            )}
                            <p className="text-[10px] font-semibold text-primary mt-1">
                              {format(parseISO(app.interviewDate!), "EEE d MMM, HH:mm")}
                            </p>
                            {app.interviewNotes && (
                              <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">
                                {app.interviewNotes}
                              </p>
                            )}
                          </div>
                          <button
                            onClick={() => setEditingApp(app)}
                            className="shrink-0 p-1 rounded hover:bg-muted text-muted-foreground transition-colors"
                          >
                            <Pencil className="w-3 h-3" />
                          </button>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                )}
              </Card>

              {/* Unscheduled interviews */}
              {unscheduledApps.length > 0 && (
                <Card className="p-5">
                  <h3 className="text-sm font-bold text-foreground mb-3 flex items-center gap-2">
                    <Plus className="w-4 h-4 text-amber-500" /> Needs Scheduling
                    <span className="ml-auto px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-xs font-semibold">
                      {unscheduledApps.length}
                    </span>
                  </h3>
                  <div className="space-y-2">
                    {unscheduledApps.map((app) => (
                      <div key={app.id} className="flex items-center justify-between gap-2 rounded-xl border border-dashed border-amber-300 bg-amber-50/50 p-2.5">
                        <p className="text-xs font-medium text-foreground truncate flex-1">
                          {app.roleTitle ?? `Role #${app.roleId}`}
                        </p>
                        <Button
                          size="sm"
                          variant="outline"
                          className="shrink-0 h-7 text-[11px] px-2.5"
                          onClick={() => setAddingForApp(app)}
                        >
                          <Plus className="w-3 h-3 mr-1" /> Add date
                        </Button>
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              {/* Past interviews */}
              {past.length > 0 && (
                <Card className="p-5">
                  <h3 className="text-sm font-bold text-foreground mb-3 text-muted-foreground">
                    Past Interviews
                  </h3>
                  <div className="space-y-2">
                    {past.slice(0, 5).map((app) => (
                      <div key={app.id} className="flex items-center justify-between gap-2 opacity-60">
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-foreground truncate">
                            {app.roleTitle ?? `Role #${app.roleId}`}
                          </p>
                          <p className="text-[10px] text-muted-foreground">
                            {format(parseISO(app.interviewDate!), "d MMM yyyy")}
                          </p>
                        </div>
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              {interviewApps.length === 0 && (
                <Card className="p-6 text-center">
                  <CalendarDays className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
                  <p className="text-sm font-medium text-foreground">No interviews yet</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    When your applications move to interview stage, they'll appear here to schedule.
                  </p>
                </Card>
              )}
            </div>
          </div>
        )}
      </PageTransition>
    </AppLayout>
  );
}
