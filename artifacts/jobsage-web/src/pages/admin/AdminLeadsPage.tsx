import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/AppLayout";
import { Loader2, Search, Users } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type LeadStatus = "new" | "contacted" | "registered" | "unqualified";

interface Lead {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  industrySector: string | null;
  status: LeadStatus;
  source: "chat" | "form";
  createdAt: string;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
}

interface LeadsResponse {
  leads: Lead[];
  total: number;
  page: number;
  limit: number;
}

// ---------------------------------------------------------------------------
// Status badge styles
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

// ---------------------------------------------------------------------------
// Inline status selector
// ---------------------------------------------------------------------------

function StatusSelect({ lead }: { lead: Lead }) {
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-leads"] }),
  });

  return (
    <div className="relative">
      <select
        value={lead.status}
        disabled={saving}
        onChange={(e) => mutation.mutate(e.target.value as LeadStatus)}
        className={`text-xs font-medium rounded-full px-2 py-0.5 border-0 cursor-pointer appearance-none pr-5 focus:outline-none focus:ring-2 focus:ring-primary/30 transition disabled:opacity-60 ${
          STATUS_CLASSES[lead.status]
        }`}
      >
        {STATUS_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {saving && (
        <Loader2 className="absolute right-1 top-1/2 -translate-y-1/2 h-3 w-3 animate-spin opacity-60" />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AdminLeadsPage() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const LIMIT = 25;

  const { data, isLoading, isError } = useQuery<LeadsResponse>({
    queryKey: ["admin-leads", page, search],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
      if (search.trim()) params.set("search", search.trim());
      const res = await fetch(`${BASE}/api/leads?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load leads");
      return res.json() as Promise<LeadsResponse>;
    },
    placeholderData: (prev) => prev,
  });

  const totalPages = data ? Math.ceil(data.total / LIMIT) : 0;

  function handleSearch(e: React.ChangeEvent<HTMLInputElement>) {
    setSearch(e.target.value);
    setPage(1);
  }

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">

        {/* ── Header ── */}
        <div>
          <h1 className="text-2xl font-bold text-foreground font-display">Waitlist Leads</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Contacts from the waitlist page
            {data ? ` · ${data.total.toLocaleString()} total` : ""}
          </p>
        </div>

        {/* ── Search ── */}
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <input
            value={search}
            onChange={handleSearch}
            placeholder="Search by name or email…"
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition"
          />
        </div>

        {/* ── Body ── */}
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-primary/40" />
          </div>
        ) : isError ? (
          <p className="text-sm text-destructive text-center py-12">
            Failed to load leads. Please refresh.
          </p>
        ) : !data?.leads.length ? (
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
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">Name</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">Email</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">Phone</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">Sector</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">Source</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">Status</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.leads.map((lead) => (
                  <tr key={lead.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 font-medium text-foreground whitespace-nowrap">
                      {lead.firstName} {lead.lastName}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{lead.email}</td>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                      {lead.phone || <span className="text-muted-foreground/40 italic">—</span>}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {lead.industrySector ?? (
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
                      <StatusSelect lead={lead} />
                    </td>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                      {new Date(lead.createdAt).toLocaleDateString("en-GB", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                      })}
                    </td>
                  </tr>
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

      </div>
    </AppLayout>
  );
}
