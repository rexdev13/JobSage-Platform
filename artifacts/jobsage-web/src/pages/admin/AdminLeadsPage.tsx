import { Fragment, useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@workspace/auth-web";
import { AppLayout } from "@/components/layout/AppLayout";
import { canDeleteLeads } from "@/lib/roleAccess";
import { useGetSponsorLicenceIndustries } from "@workspace/api-client-react";
import { CalendarDays, CheckCircle2, Copy, ExternalLink, Loader2, Search, Users, Trash2, ChevronDown, UserPlus, UserCheck, UserX, PhoneCall } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { MarketerCalendar, type CalendarLead, type CalendarMarketer } from "@/components/admin/MarketerCalendar";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type LeadStatus = "new" | "contacted" | "registered" | "unqualified";

interface Lead {
  id: number;
  firstName?: string;
  lastName?: string;
  name?: string;
  email: string;
  phone: string | null;
  industrySector?: string | null;
  sector?: string | null;
  status: LeadStatus;
  source: "chat" | "form";
  createdAt: string;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  assignee: LeadAssignee | null;
}

interface LeadAssignee {
  id: string;
  email: string | null;
  name: string;
  calendlyUrl: string | null;
}

interface LeadsResponse {
  leads: Lead[];
  total: number;
  page: number;
  limit: number;
  stats?: {
    statusTotals: {
      new: number;
      contacted: number;
      registered: number;
      unqualified: number;
    };
    createdLast7Days: number;
  };
}
interface MyPerformance {
  assignedCount: number;
  contactedCount: number;
  registeredCount: number;
  conversionRate: number;
  averageResponseTimeMinutes: number | null;
}

// ---------------------------------------------------------------------------
// Status config
// ---------------------------------------------------------------------------

const STATUS_CLASSES: Record<LeadStatus, string> = {
  new:         "bg-primary/10 text-primary",
  contacted:   "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  registered:  "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  unqualified: "bg-muted text-muted-foreground",
};

const STATUS_OPTIONS: { value: LeadStatus; label: string }[] = [
  { value: "new",         label: "New" },
  { value: "contacted",   label: "Contacted" },
  { value: "registered",  label: "Registered" },
  { value: "unqualified", label: "Unqualified" },
];

function CalendlyLinkCard({ onUrlChange }: { onUrlChange: (url: string | null) => void }) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const { data, isLoading } = useQuery<{ calendlyUrl: string | null }>({
    queryKey: ["my-marketing-calendly-url"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/me/calendly-url`, { credentials: "include" });
      if (!res.ok) throw new Error("Could not load your Calendly link.");
      return res.json() as Promise<{ calendlyUrl: string | null }>;
    },
  });

  useEffect(() => {
    if (data) {
      setValue(data.calendlyUrl ?? "");
      onUrlChange(data.calendlyUrl);
    }
  }, [data, onUrlChange]);

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${BASE}/api/me/calendly-url`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ calendlyUrl: value.trim() }),
      });
      const body = await res.json().catch(() => ({})) as { calendlyUrl?: string | null; error?: string };
      if (!res.ok) throw new Error(body.error ?? "Could not save your Calendly link.");
      return body;
    },
    onSuccess: async (body) => {
      const savedUrl = body.calendlyUrl ?? null;
      setValue(savedUrl ?? "");
      setMessage(savedUrl ? "Calendly link saved." : "Calendly link cleared.");
      onUrlChange(savedUrl);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["my-marketing-calendly-url"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-leads"] }),
      ]);
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Could not save your Calendly link."),
  });

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <CalendarDays className="mt-0.5 h-5 w-5 text-primary" />
        <div className="flex-1 space-y-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">My Calendly link</h2>
            <p className="text-xs text-muted-foreground">
              Used for unassigned leads and leads assigned to you. Saving or opening it never changes lead status.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="url"
              placeholder="https://calendly.com/your-name"
              value={value}
              disabled={isLoading || mutation.isPending}
              onChange={(event) => {
                setValue(event.target.value);
                setMessage(null);
              }}
              className="min-w-0 flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
            <Button type="button" disabled={isLoading || mutation.isPending} onClick={() => mutation.mutate()}>
              {mutation.isPending ? "Saving..." : "Save link"}
            </Button>
          </div>
          {message && <p className="text-xs text-muted-foreground">{message}</p>}
        </div>
      </div>
    </div>
  );
}

function BookingActions({ url, guidance, onBookCall }: { url: string | null; guidance: string; onBookCall?: () => void }) {
  const [copied, setCopied] = useState(false);

  if (!url) {
    return (
      <div className="flex items-center gap-1">
        <button
          type="button"
          title="Book a call"
          aria-label="Book a call"
          className="rounded-lg border border-input p-1.5 text-muted-foreground hover:bg-muted hover:text-primary"
          onClick={onBookCall}
        >
          <PhoneCall className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          disabled
          title={guidance}
          className="whitespace-nowrap rounded-lg border border-input px-2 py-1 text-[11px] text-muted-foreground opacity-60"
        >
          No booking link
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1">
      {onBookCall && (
        <button
          type="button"
          title="Book a call"
          aria-label="Book a call"
          className="rounded-lg border border-input p-1.5 text-muted-foreground hover:bg-muted hover:text-primary"
          onClick={onBookCall}
        >
          <PhoneCall className="h-3.5 w-3.5" />
        </button>
      )}
      <button
        type="button"
        title="Copy booking link"
        aria-label="Copy booking link"
        className="rounded-lg border border-input p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        onClick={() => {
          void navigator.clipboard.writeText(url).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        <Copy className="h-3.5 w-3.5" />
      </button>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        title="Open booking page"
        aria-label="Open booking page"
        className="rounded-lg border border-input p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <ExternalLink className="h-3.5 w-3.5" />
      </a>
      {copied && <span className="text-[10px] text-green-600">Copied</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline status selector
// ---------------------------------------------------------------------------

function StatusSelect({ lead, disabled = false, refreshPerformance = false }: { lead: Lead; disabled?: boolean; refreshPerformance?: boolean }) {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);

  const mutation = useMutation({
    mutationFn: async (newStatus: LeadStatus) => {
      const res = await fetch(`${BASE}/api/leads/${lead.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error("Failed to update status");
      return res.json() as Promise<{ id: number; status: LeadStatus }>;
    },
    onMutate: () => setSaving(true),
    onSettled: () => setSaving(false),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["admin-leads"] });
      if (refreshPerformance) await queryClient.invalidateQueries({ queryKey: ["my-performance"] });
    },
  });

  return (
    <div className="relative inline-flex items-center">
      <select
        value={lead.status}
        disabled={saving || disabled}
        onChange={(e) => mutation.mutate(e.target.value as LeadStatus)}
        className={`text-xs font-medium rounded-full pl-2.5 pr-6 py-0.5 border-0 cursor-pointer appearance-none focus:outline-none focus:ring-2 focus:ring-primary/30 transition disabled:opacity-60 ${
          STATUS_CLASSES[lead.status]
        }`}
      >
        {STATUS_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value} className="bg-background text-foreground">
            {opt.label}
          </option>
        ))}
      </select>
      {saving ? (
        <Loader2 className="absolute right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 animate-spin pointer-events-none opacity-60" />
      ) : (
        <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 pointer-events-none opacity-50" />
      )}
    </div>
  );
}

function AssigneeSelect({
  lead,
  assignees,
  canAssign,
  currentUserId,
}: {
  lead: Lead;
  assignees: LeadAssignee[];
  canAssign: boolean;
  currentUserId?: string;
}) {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);

  const mutation = useMutation({
    mutationFn: async (marketingUserId: string | null) => {
      const res = await fetch(`${BASE}/api/leads/${lead.id}/assignee`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ marketingUserId }),
      });
      const body = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Failed to update assignee");
      return body;
    },
    onMutate: () => setSaving(true),
    onSettled: () => setSaving(false),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-leads"] }),
    onError: (error) => alert(error instanceof Error ? error.message : "Failed to update assignee"),
  });

  if (!canAssign) {
    const assignedToYou = Boolean(currentUserId && lead.assignee?.id === currentUserId);
    return (
      <div className="min-w-32">
        <p className={`text-xs font-medium ${assignedToYou ? "text-green-600" : "text-foreground"}`}>
          {assignedToYou ? "Claimed by you" : lead.assignee?.name ?? "Unassigned"}
        </p>
        {lead.assignee?.email && (
          <p className="text-[10px] text-muted-foreground">{lead.assignee.email}</p>
        )}
      </div>
    );
  }

  return (
    <select
      value={lead.assignee?.id ?? "__unassigned__"}
      disabled={saving}
      onChange={(event) => mutation.mutate(
        event.target.value === "__unassigned__" ? null : event.target.value,
      )}
      aria-label={`Assign ${lead.name ?? lead.email}`}
      className="min-w-40 max-w-52 rounded-lg border border-input bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60"
    >
      <option value="__unassigned__">Unassigned</option>
      {assignees.map((assignee) => (
        <option key={assignee.id} value={assignee.id}>
          {assignee.name || assignee.email || assignee.id}
        </option>
      ))}
    </select>
  );
}

function ClaimLeadAction({ lead }: { lead: Lead }) {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${BASE}/api/leads/${lead.id}/claim`, { method: "POST", credentials: "include" });
      const body = await res.json().catch(() => ({})) as { error?: string; message?: string };
      if (!res.ok) throw new Error(body.error ?? body.message ?? "Could not claim this lead.");
      return body;
    },
    onMutate: () => setMessage(null),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-leads"] }),
        queryClient.invalidateQueries({ queryKey: ["my-performance"] }),
      ]);
    },
    onError: async (error) => {
      setMessage(error instanceof Error ? error.message : "Could not claim this lead.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-leads"] }),
        queryClient.invalidateQueries({ queryKey: ["my-performance"] }),
      ]);
    },
  });
  return <div className="flex flex-col items-start gap-1">
    <Button type="button" size="sm" variant="outline" disabled={mutation.isPending}
      onClick={() => mutation.mutate()} className="h-7 px-2.5 text-xs"
      data-testid={`button-claim-lead-${lead.id}`}>
      {mutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Claim"}
    </Button>
    {message && <span className="max-w-40 text-[10px] text-destructive">{message}</span>}
  </div>;
}

function LeadContactProcessStatusBar({ lead }: { lead: Lead }) {
  const isUnqualified = lead.status === "unqualified";
  const isRegistered = lead.status === "registered";
  const isContacted = lead.status === "contacted" || isRegistered;
  const isClaimed = Boolean(lead.assignee);
  const activeStep = isRegistered ? 4 : isContacted ? 3 : isClaimed ? 2 : 1;
  const progress = isUnqualified ? 0 : (activeStep - 1) * 33.33;
  const firstName = lead.assignee?.name?.trim().split(/\s+/)[0];
  const createdAt = new Date(lead.createdAt).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  const stages = [
    {
      title: "Captured",
      subtitle: `${lead.source === "chat" ? "AI Chat Lead" : "Inbound Form"} · ${createdAt}`,
      completed: true,
    },
    {
      title: "Claimed",
      subtitle: isClaimed ? `Owned by ${firstName || "marketer"}` : "Unassigned",
      completed: isClaimed,
    },
    {
      title: "Contacted",
      subtitle: isContacted
        ? lead.status === "registered" ? "Booking link shared" : "Outreach initiated"
        : "Pending outreach",
      completed: isContacted,
    },
    {
      title: "Registered",
      subtitle: isRegistered ? "Converted to User" : "Awaiting registration",
      completed: isRegistered,
    },
  ];

  return (
    <div className={`border-t px-2 py-4 sm:px-8 ${isUnqualified ? "bg-rose-50/50 dark:bg-rose-950/10" : "bg-muted/20"}`}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-semibold sm:text-xs ${
          isUnqualified
            ? "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300"
            : isRegistered
              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
              : "bg-primary/10 text-primary"
        }`}>
          {isUnqualified
            ? "Unqualified / Disqualified"
            : isRegistered
              ? "✓ Converted to User"
              : activeStep === 3
                ? "In Contact / Follow-up"
                : activeStep === 2
                  ? "Claimed • Pending First Outreach"
                  : "New Inbound • Ready to Claim"}
        </span>
      </div>

      <div className="relative grid grid-cols-4 gap-1 sm:gap-4">
        <div className="pointer-events-none absolute left-[12.5%] right-[12.5%] top-4 h-0.5 bg-border sm:left-[10%] sm:right-[10%]">
          <div
            className={`h-full transition-all ${isUnqualified ? "bg-rose-400" : "bg-emerald-500"}`}
            style={{ width: `${progress}%` }}
          />
        </div>
        {stages.map((stage, index) => {
          const step = index + 1;
          const isActive = !stage.completed && step === activeStep;
          return (
            <div key={stage.title} className="relative z-10 flex min-w-0 flex-col items-center text-center">
              <div className={`flex h-8 w-8 items-center justify-center rounded-full border-2 bg-background text-[11px] font-semibold ${
                isUnqualified
                  ? stage.completed ? "border-rose-400 text-rose-600" : isActive ? "border-rose-500 ring-4 ring-rose-100 dark:ring-rose-900/30" : "border-border text-muted-foreground"
                  : stage.completed ? "border-emerald-500 text-emerald-600" : isActive ? "border-primary text-primary ring-4 ring-primary/10" : "border-border text-muted-foreground"
              }`}>
                {stage.completed ? <CheckCircle2 className="h-4 w-4" /> : step}
              </div>
              <p className="mt-2 text-[10px] font-semibold text-foreground sm:text-[11px]">{stage.title}</p>
              <p className="mt-0.5 max-w-20 truncate text-[9px] text-muted-foreground sm:max-w-40 sm:text-[10px]" title={stage.subtitle}>
                {stage.subtitle}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AdminLeadsPage() {
  const { user } = useAuth();
  const canDelete = canDeleteLeads(user?.role);
  const canAssign = user?.role === "admin" || user?.role === "super_admin";
  const isMarketing = user?.role === "marketing";
  const [myCalendlyUrl, setMyCalendlyUrl] = useState<string | null>(null);
  const [calendarLeadId, setCalendarLeadId] = useState<number | null>(null);
  const [search, setSearch]           = useState("");
  const [sector, setSector]           = useState("");
  const [assignedTo, setAssignedTo]   = useState("");
  const [includeUnassigned, setIncludeUnassigned] = useState(true);
  const [page, setPage]               = useState(1);
  const [selected, setSelected]       = useState<Set<number>>(new Set());
  const [deleting, setDeleting]         = useState(false);
  const [confirmOpen, setConfirmOpen]   = useState(false);
  const [bulkStatus, setBulkStatus]     = useState<LeadStatus | "">("");
  const [applyingBulk, setApplyingBulk] = useState(false);
  const [bulkAssignee, setBulkAssignee] = useState("");
  const [applyingBulkAssignee, setApplyingBulkAssignee] = useState(false);
  const [bulkAssignmentMessage, setBulkAssignmentMessage] = useState<string | null>(null);
  const LIMIT = 25;

  const queryClient = useQueryClient();
  const { data: industryData } = useGetSponsorLicenceIndustries();
  const industries = industryData?.industries ?? [];
  const { data: myPerformance } = useQuery<MyPerformance>({
    queryKey: ["my-performance"], enabled: isMarketing, refetchInterval: 30_000,
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/leads/my-performance`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load your lead performance");
      return res.json() as Promise<MyPerformance>;
    },
  });

  const { data: assigneeData } = useQuery<{ assignees: LeadAssignee[] }>({
    queryKey: ["lead-assignees"],
    enabled: canAssign,
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/leads/assignees`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load lead assignees");
      return res.json() as Promise<{ assignees: LeadAssignee[] }>;
    },
    staleTime: 60_000,
  });
  const assignees = assigneeData?.assignees ?? [];

  const effectiveAssignedTo = isMarketing
    ? (includeUnassigned ? "" : user?.id ?? "")
    : assignedTo;

  const { data, isLoading, isError } = useQuery<LeadsResponse>({
    queryKey: ["admin-leads", page, search, sector, effectiveAssignedTo],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
      if (search.trim()) params.set("search", search.trim());
      if (sector)        params.set("sector", sector);
      if (effectiveAssignedTo) params.set("assignedTo", effectiveAssignedTo);
      const res = await fetch(`${BASE}/api/leads?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load leads");
      return res.json() as Promise<LeadsResponse>;
    },
    placeholderData: (prev) => prev,
  });

  const totalPages = data ? Math.ceil(data.total / LIMIT) : 0;
  const leads = data?.leads ?? [];
  const selectableLeads = isMarketing ? leads.filter((lead) => lead.assignee?.id === user?.id) : leads;
  const allSelected = selectableLeads.length > 0 && selectableLeads.every((l) => selected.has(l.id));
  const someSelected = selected.size > 0;

  function handleSearch(e: React.ChangeEvent<HTMLInputElement>) {
    setSearch(e.target.value);
    setPage(1);
    setSelected(new Set());
  }

  function toggleOne(id: number) {
    if (isMarketing && !selectableLeads.some((lead) => lead.id === id)) return;
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(selectableLeads.map((l) => l.id)));
    }
  }

  async function confirmDelete() {
    if (!canDelete) return;
    setDeleting(true);
    setConfirmOpen(false);
    try {
      const res = await fetch(`${BASE}/api/leads`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ids: Array.from(selected) }),
      });
      if (!res.ok) throw new Error("Delete failed");
      setSelected(new Set());
      setBulkStatus("");
      setBulkAssignee("");
      setBulkAssignmentMessage(null);
      await queryClient.invalidateQueries({ queryKey: ["admin-leads"] });
      if (isMarketing) await queryClient.invalidateQueries({ queryKey: ["my-performance"] });
    } catch {
      // silent — user stays on the page
    } finally {
      setDeleting(false);
    }
  }

  async function handleBulkStatus() {
    if (!someSelected || !bulkStatus) return;
    setApplyingBulk(true);
    try {
      const res = await fetch(`${BASE}/api/leads/bulk-status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ids: Array.from(selected), status: bulkStatus }),
      });
      if (!res.ok) throw new Error("Bulk update failed");
      setSelected(new Set());
      setBulkStatus("");
      setBulkAssignee("");
      setBulkAssignmentMessage(null);
      await queryClient.invalidateQueries({ queryKey: ["admin-leads"] });
      if (isMarketing) await queryClient.invalidateQueries({ queryKey: ["my-performance"] });
    } catch {
      alert("Failed to update statuses. Please try again.");
    } finally {
      setApplyingBulk(false);
    }
  }

  async function handleBulkAssignee() {
    if (!someSelected || !bulkAssignee) return;

    setApplyingBulkAssignee(true);
    setBulkAssignmentMessage(null);
    try {
      const marketingUserId = bulkAssignee === "__unassigned__" ? null : bulkAssignee;
      const res = await fetch(`${BASE}/api/leads/bulk-assignee`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ids: Array.from(selected), marketingUserId }),
      });
      const body = await res.json().catch(() => ({})) as {
        updated?: number;
        error?: string;
        assignee?: { name?: string | null; email?: string | null } | null;
      };
      if (!res.ok) throw new Error(body.error ?? "Bulk assignment failed");

      setSelected(new Set());
      setBulkStatus("");
      setBulkAssignee("");
      setBulkAssignmentMessage(
        marketingUserId === null
          ? `Unassigned ${body.updated ?? selected.size} lead${(body.updated ?? selected.size) === 1 ? "" : "s"}.`
          : `Assigned ${body.updated ?? selected.size} lead${(body.updated ?? selected.size) === 1 ? "" : "s"} to ${body.assignee?.name ?? body.assignee?.email ?? "the selected marketer"}.`,
      );
      await queryClient.invalidateQueries({ queryKey: ["admin-leads"] });
    } catch (error) {
      setBulkAssignmentMessage(error instanceof Error ? error.message : "Failed to assign leads. Please try again.");
    } finally {
      setApplyingBulkAssignee(false);
    }
  }

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">

        {/* ── Header ── */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-foreground font-display">Waitlist Leads</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Contacts from the waitlist page
              {data ? ` · ${data.total.toLocaleString()} total` : ""}
            </p>
          </div>

          {someSelected && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-muted-foreground font-medium">
                {selected.size} selected
              </span>

              {/* Bulk status change */}
              <div className="flex items-center gap-1.5">
                <div className="relative inline-flex items-center">
                  <select
                    value={bulkStatus}
                    onChange={(e) => setBulkStatus(e.target.value as LeadStatus | "")}
                    className="text-xs rounded-lg border border-input bg-background pl-2.5 pr-7 py-1.5 appearance-none focus:outline-none focus:ring-2 focus:ring-primary/30 cursor-pointer"
                  >
                    <option value="">Set status…</option>
                    {STATUS_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 pointer-events-none opacity-50" />
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleBulkStatus}
                  disabled={!bulkStatus || applyingBulk}
                  className="h-7 text-xs px-2.5"
                >
                  {applyingBulk ? <Loader2 className="h-3 w-3 animate-spin" /> : "Apply"}
                </Button>
              </div>

              {canAssign && (
                <div className="flex items-center gap-1.5">
                  <select
                    value={bulkAssignee}
                    onChange={(event) => {
                      setBulkAssignee(event.target.value);
                      setBulkAssignmentMessage(null);
                    }}
                    aria-label="Assign selected leads"
                    className="text-xs rounded-lg border border-input bg-background px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary/30 cursor-pointer"
                  >
                    <option value="">Assign selected…</option>
                    <option value="__unassigned__">Unassign selected</option>
                    {assignees.map((assignee) => (
                      <option key={assignee.id} value={assignee.id}>
                        {assignee.name || assignee.email || assignee.id}
                      </option>
                    ))}
                  </select>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleBulkAssignee}
                    disabled={!bulkAssignee || applyingBulkAssignee}
                    className="h-7 text-xs px-2.5"
                  >
                    {applyingBulkAssignee ? <Loader2 className="h-3 w-3 animate-spin" /> : "Assign"}
                  </Button>
                </div>
              )}

              {canDelete && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setConfirmOpen(true)}
                  disabled={deleting}
                  className="flex items-center gap-1.5 h-7 text-xs px-2.5"
                >
                  {deleting ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Trash2 className="h-3 w-3" />
                  )}
                  Delete
                </Button>
              )}
            </div>
          )}
        </div>
        {bulkAssignmentMessage && (
          <p className="text-xs text-muted-foreground" role="status">
            {bulkAssignmentMessage}
          </p>
        )}

        {isMarketing && <CalendlyLinkCard onUrlChange={setMyCalendlyUrl} />}
        {isMarketing && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5" data-testid="banner-my-performance">
            {[
              { label: "Assigned to Me", value: myPerformance?.assignedCount ?? "—" },
              { label: "Contacted", value: myPerformance?.contactedCount ?? "—" },
              { label: "Registered", value: myPerformance?.registeredCount ?? "—" },
              { label: "Conversion Rate", value: myPerformance ? `${myPerformance.conversionRate.toFixed(1)}%` : "—" },
              { label: "Avg Response Time", value: myPerformance?.averageResponseTimeMinutes == null ? "—" : `${myPerformance.averageResponseTimeMinutes.toFixed(1)} min` },
            ].map(({ label, value }) => (
              <div key={label} className="rounded-xl border border-border bg-card p-3">
                <p className="text-lg font-bold leading-none text-foreground">{value}</p>
                <p className="mt-1 truncate text-[10px] text-muted-foreground">{label}</p>
              </div>
            ))}
          </div>
        )}

        {/* ── Search + filters ── */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <input
              value={search}
              onChange={handleSearch}
              placeholder="Search by name or email…"
              className="w-64 pl-9 pr-3 py-2 text-sm rounded-lg border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition"
            />
          </div>
          <Select
            value={sector || "__all__"}
            onValueChange={(val) => {
              setSector(val === "__all__" ? "" : val);
              setPage(1);
              setSelected(new Set());
            }}
          >
            <SelectTrigger className="w-48 text-sm h-[38px]">
              <SelectValue placeholder="Filter by Sector" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All Industries</SelectItem>
              {industries.map((industry) => (
                <SelectItem key={industry} value={industry}>{industry}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {isMarketing ? (
            <label className="inline-flex h-[38px] items-center gap-2 rounded-lg border border-input bg-background px-3 text-sm text-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={includeUnassigned}
                onChange={(event) => {
                  setIncludeUnassigned(event.target.checked);
                  setPage(1);
                  setSelected(new Set());
                }}
                className="rounded border-input accent-primary"
              />
              Including unassigned
            </label>
          ) : (
            <Select
              value={assignedTo || "__all__"}
              onValueChange={(val) => {
                setAssignedTo(val === "__all__" ? "" : val);
                setPage(1);
                setSelected(new Set());
              }}
            >
              <SelectTrigger className="w-52 text-sm h-[38px]">
                <SelectValue placeholder="Filter by assignee" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All assignees</SelectItem>
                <SelectItem value="unassigned">Unassigned</SelectItem>
                {assignees.map((assignee) => (
                  <SelectItem key={assignee.id} value={assignee.id}>
                    {assignee.name || assignee.email || assignee.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {!isMarketing && data?.stats && (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {[
              { label: "New", value: data.stats.statusTotals.new, icon: UserPlus, color: "text-primary" },
              { label: "Contacted", value: data.stats.statusTotals.contacted, icon: Users, color: "text-amber-600" },
              { label: "Registered", value: data.stats.statusTotals.registered, icon: UserCheck, color: "text-green-600" },
              { label: "Unqualified", value: data.stats.statusTotals.unqualified, icon: UserX, color: "text-muted-foreground" },
              { label: "New in 7 days", value: data.stats.createdLast7Days, icon: UserPlus, color: "text-blue-600" },
            ].map(({ label, value, icon: Icon, color }) => (
              <div key={label} className="rounded-xl border border-border bg-card p-3 flex items-center gap-2.5">
                <Icon className={`h-4 w-4 shrink-0 ${color}`} />
                <div className="min-w-0">
                  <p className="text-lg font-bold text-foreground leading-none">{value}</p>
                  <p className="text-[10px] text-muted-foreground mt-1 truncate">{label}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Body ── */}
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-primary/40" />
          </div>
        ) : isError ? (
          <p className="text-sm text-destructive text-center py-12">
            Failed to load leads. Please refresh.
          </p>
        ) : !leads.length ? (
          <div className="text-center py-16 text-muted-foreground">
            <Users className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">
              {search ? "No leads match your search." : "No leads yet."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  {/* Select-all checkbox */}
                  <th className="px-4 py-3 w-10">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      className="rounded border-input accent-primary cursor-pointer"
                    />
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">Name</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">Email</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">Phone</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">Sector</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">Source</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">Booking</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">Assigned</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">Status</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {leads.map((lead) => (
                  <Fragment key={lead.id}>
                    <tr
                      className={`transition-colors ${
                        selected.has(lead.id) ? "bg-primary/5" : "hover:bg-muted/30"
                      }`}
                    >
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selected.has(lead.id)}
                          disabled={isMarketing && lead.assignee?.id !== user?.id}
                          onChange={() => toggleOne(lead.id)}
                          className="rounded border-input accent-primary cursor-pointer"
                        />
                      </td>
                      <td className="px-4 py-3 font-medium text-foreground whitespace-nowrap">
                        {lead.name ?? `${lead.firstName ?? ""} ${lead.lastName ?? ""}`.trim()}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{lead.email}</td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        {lead.phone || <span className="text-muted-foreground/40 italic">—</span>}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {lead.sector ?? lead.industrySector ?? (
                          <span className="text-muted-foreground/40 italic">Not provided</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                            lead.source === "chat"
                              ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                              : "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                          }`}
                        >
                          {lead.source === "chat" ? "AI Chat" : "Form"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <BookingActions
                          url={lead.assignee?.calendlyUrl ?? (!lead.assignee && isMarketing ? myCalendlyUrl : null)}
                          onBookCall={() => setCalendarLeadId(lead.id)}
                          guidance={
                            lead.assignee
                              ? "The assigned marketer has not added a Calendly link."
                              : isMarketing
                                ? "Add your Calendly link above."
                                : "Assign a marketer first."
                          }
                        />
                      </td>
                      <td className="px-4 py-3">
                        {isMarketing && !lead.assignee ? <ClaimLeadAction lead={lead} /> : (
                          <AssigneeSelect lead={lead} assignees={assignees} canAssign={canAssign} currentUserId={user?.id} />
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <StatusSelect lead={lead} disabled={isMarketing && !lead.assignee} refreshPerformance={isMarketing} />
                      </td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        {new Date(lead.createdAt).toLocaleDateString("en-GB", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                        })}
                      </td>
                    </tr>
                    <tr>
                      <td colSpan={10} className="p-0">
                        <LeadContactProcessStatusBar lead={lead} />
                      </td>
                    </tr>
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Pagination ── */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between text-sm">
            <p className="text-muted-foreground">
              Page {page} of {totalPages} &middot; {data?.total.toLocaleString()} total
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1.5 rounded-lg border border-input bg-background hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition text-xs font-medium"
              >
                Previous
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-1.5 rounded-lg border border-input bg-background hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition text-xs font-medium"
              >
                Next
              </button>
            </div>
          </div>
        )}

        <MarketerCalendar
          leads={leads as CalendarLead[]}
          assignees={assignees as CalendarMarketer[]}
          isAdmin={canAssign}
          currentUserId={user?.id}
          myCalendlyUrl={myCalendlyUrl}
          initialLeadId={calendarLeadId}
          onInitialLeadHandled={() => setCalendarLeadId(null)}
        />

      </div>

      {canDelete && (
        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {selected.size} lead{selected.size === 1 ? "" : "s"}?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently remove {selected.size === 1 ? "this lead" : `these ${selected.size} leads`} from the system. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={confirmDelete}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Delete"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

    </AppLayout>
  );
}
