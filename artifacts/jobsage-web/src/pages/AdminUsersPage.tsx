import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, PageTransition, Button } from "@/components/ui-enhanced";
import {
  Search,
  UserCheck,
  UserX,
  Mail,
  KeyRound,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Clock,
  ShieldCheck,
  History,
} from "lucide-react";

interface AdminUser {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  role: string;
  emailVerified: boolean;
  hasPassword: boolean;
  emailVerifyTokenExpires: string | null;
  passwordResetTokenExpires: string | null;
  createdAt: string;
  updatedAt: string;
}

interface AuditEvent {
  id: number;
  actor: string;
  actorEmail: string | null;
  action: string;
  details: Record<string, unknown>;
  createdAt: string;
}

function getBaseUrl(): string {
  return import.meta.env.BASE_URL.replace(/\/$/, "");
}

async function searchUser(email: string): Promise<AdminUser> {
  const base = getBaseUrl();
  const res = await fetch(`${base}/api/admin/users/search?email=${encodeURIComponent(email)}`, {
    credentials: "include",
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Request failed");
  return data as AdminUser;
}

async function resendVerification(userId: string): Promise<{ message: string }> {
  const base = getBaseUrl();
  const res = await fetch(`${base}/api/admin/users/${userId}/resend-verification`, {
    method: "POST",
    credentials: "include",
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Request failed");
  return data as { message: string };
}

async function markVerified(userId: string): Promise<{ message: string }> {
  const base = getBaseUrl();
  const res = await fetch(`${base}/api/admin/users/${userId}/mark-verified`, {
    method: "POST",
    credentials: "include",
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Request failed");
  return data as { message: string };
}

async function unverifyAccount(userId: string): Promise<{ message: string }> {
  const base = getBaseUrl();
  const res = await fetch(`${base}/api/admin/users/${userId}/unverify`, {
    method: "POST",
    credentials: "include",
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Request failed");
  return data as { message: string };
}

async function sendPasswordReset(userId: string): Promise<{ message: string }> {
  const base = getBaseUrl();
  const res = await fetch(`${base}/api/admin/users/${userId}/send-password-reset`, {
    method: "POST",
    credentials: "include",
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Request failed");
  return data as { message: string };
}

async function fetchAuditEvents(userId: string): Promise<AuditEvent[]> {
  const base = getBaseUrl();
  const res = await fetch(`${base}/api/admin/users/${userId}/audit-events?limit=5`, {
    credentials: "include",
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Request failed");
  return (data as { events: AuditEvent[] }).events;
}

const ACTION_LABELS: Record<string, string> = {
  admin_mark_verified: "Marked as verified",
  admin_unverify: "Revoked verification",
  admin_resend_verification: "Sent verification email",
  admin_send_password_reset: "Sent password reset",
};

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

function isExpired(iso: string | null): boolean {
  if (!iso) return true;
  return new Date(iso) < new Date();
}

function TokenStatus({ label, expires }: { label: string; expires: string | null }) {
  if (!expires) {
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Clock className="w-3.5 h-3.5" /> {label}: none
      </span>
    );
  }
  const expired = isExpired(expires);
  return (
    <span
      className={`flex items-center gap-1 text-xs ${expired ? "text-muted-foreground" : "text-amber-600"}`}
    >
      <Clock className="w-3.5 h-3.5" />
      {label}: {expired ? "expired" : "active"} · {formatDate(expires)}
    </span>
  );
}

function UserCard({
  user,
  onRefresh,
}: {
  user: AdminUser;
  onRefresh: () => void;
}) {
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const {
    data: auditEvents,
    isLoading: auditLoading,
    refetch: refetchAudit,
  } = useQuery({
    queryKey: ["admin", "user-audit-events", user.id],
    queryFn: () => fetchAuditEvents(user.id),
    retry: false,
  });

  const showResult = (msg: string, isError = false) => {
    if (isError) {
      setErrorMsg(msg);
      setSuccessMsg(null);
    } else {
      setSuccessMsg(msg);
      setErrorMsg(null);
    }
    setTimeout(() => {
      setSuccessMsg(null);
      setErrorMsg(null);
    }, 5000);
    onRefresh();
    void refetchAudit();
  };

  const { mutate: doMarkVerified, isPending: markingVerified } = useMutation({
    mutationFn: () => markVerified(user.id),
    onSuccess: (data) => showResult(data.message),
    onError: (err: Error) => showResult(err.message, true),
  });

  const { mutate: doUnverify, isPending: unverifying } = useMutation({
    mutationFn: () => unverifyAccount(user.id),
    onSuccess: (data) => showResult(data.message),
    onError: (err: Error) => showResult(err.message, true),
  });

  const { mutate: doResendVerification, isPending: sendingVerification } = useMutation({
    mutationFn: () => resendVerification(user.id),
    onSuccess: (data) => showResult(data.message),
    onError: (err: Error) => showResult(err.message, true),
  });

  const { mutate: doSendPasswordReset, isPending: sendingReset } = useMutation({
    mutationFn: () => sendPasswordReset(user.id),
    onSuccess: (data) => showResult(data.message),
    onError: (err: Error) => showResult(err.message, true),
  });

  const displayName =
    [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email || "Unknown";

  return (
    <Card className="p-6 space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">{displayName}</h2>
          <p className="text-sm text-muted-foreground">{user.email}</p>
        </div>
        <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-muted text-muted-foreground capitalize">
          {user.role}
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="flex items-center gap-2 text-sm">
          {user.emailVerified ? (
            <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
          ) : (
            <UserX className="w-4 h-4 text-destructive shrink-0" />
          )}
          <span className={user.emailVerified ? "text-green-700" : "text-destructive"}>
            Email {user.emailVerified ? "verified" : "not verified"}
          </span>
        </div>

        <div className="flex items-center gap-2 text-sm">
          {user.hasPassword ? (
            <UserCheck className="w-4 h-4 text-green-600 shrink-0" />
          ) : (
            <UserX className="w-4 h-4 text-muted-foreground shrink-0" />
          )}
          <span className={user.hasPassword ? "text-green-700" : "text-muted-foreground"}>
            {user.hasPassword ? "Has password" : "No password set"}
          </span>
        </div>

        <TokenStatus label="Verify token" expires={user.emailVerifyTokenExpires} />
        <TokenStatus label="Reset token" expires={user.passwordResetTokenExpires} />
      </div>

      <div className="text-xs text-muted-foreground space-y-0.5">
        <p>Created: {formatDate(user.createdAt)}</p>
        <p>Updated: {formatDate(user.updatedAt)}</p>
        <p className="font-mono">ID: {user.id}</p>
      </div>

      <div className="flex flex-wrap gap-3 pt-1 border-t border-border">
        {!user.emailVerified && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => doMarkVerified()}
            disabled={markingVerified}
            title="Immediately mark this account as verified without sending an email"
            className="text-green-700 border-green-300 hover:bg-green-50"
          >
            {markingVerified ? (
              <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
            ) : (
              <UserCheck className="w-4 h-4 mr-1.5" />
            )}
            Mark as Verified
          </Button>
        )}

        {user.emailVerified && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => doUnverify()}
            disabled={unverifying}
            title="Revoke email verification — sets emailVerified back to false"
            className="text-amber-700 border-amber-300 hover:bg-amber-50"
          >
            {unverifying ? (
              <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
            ) : (
              <UserX className="w-4 h-4 mr-1.5" />
            )}
            Unverify Account
          </Button>
        )}

        <Button
          size="sm"
          variant="outline"
          onClick={() => doResendVerification()}
          disabled={sendingVerification || user.emailVerified}
          title={user.emailVerified ? "Account is already verified" : "Send a fresh verification email"}
        >
          {sendingVerification ? (
            <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
          ) : (
            <Mail className="w-4 h-4 mr-1.5" />
          )}
          Resend Verification Email
        </Button>

        <Button
          size="sm"
          variant="outline"
          onClick={() => doSendPasswordReset()}
          disabled={sendingReset}
          title="Send a password reset link"
        >
          {sendingReset ? (
            <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
          ) : (
            <KeyRound className="w-4 h-4 mr-1.5" />
          )}
          Send Password Reset Email
        </Button>
      </div>

      {successMsg && (
        <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-4 py-2.5">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          {successMsg}
        </div>
      )}

      {errorMsg && (
        <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/5 border border-destructive/20 rounded-lg px-4 py-2.5">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {errorMsg}
        </div>
      )}

      <div className="pt-1 border-t border-border">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
          <History className="w-3.5 h-3.5" /> Recent Admin Actions
        </h3>
        {auditLoading && (
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Loader2 className="w-3 h-3 animate-spin" /> Loading history…
          </p>
        )}
        {!auditLoading && (!auditEvents || auditEvents.length === 0) && (
          <p className="text-xs text-muted-foreground">No admin actions recorded for this account yet.</p>
        )}
        {!auditLoading && auditEvents && auditEvents.length > 0 && (
          <ul className="space-y-1.5">
            {auditEvents.map((event) => (
              <li key={event.id} className="text-xs text-muted-foreground flex items-start gap-1.5">
                <Clock className="w-3 h-3 shrink-0 mt-0.5" />
                <span>
                  <span className="font-medium text-foreground">
                    {ACTION_LABELS[event.action] ?? event.action}
                  </span>
                  {" · "}
                  {relativeTime(event.createdAt)}
                  {event.actorEmail && (
                    <span className="text-muted-foreground"> by {event.actorEmail}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

export default function AdminUsersPage() {
  const [emailInput, setEmailInput] = useState("");
  const [searchEmail, setSearchEmail] = useState("");
  const queryClient = useQueryClient();

  const {
    data: user,
    isLoading,
    isError,
    error,
    isFetching,
  } = useQuery({
    queryKey: ["admin", "user-search", searchEmail],
    queryFn: () => searchUser(searchEmail),
    enabled: searchEmail.length > 0,
    retry: false,
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = emailInput.trim();
    if (trimmed) setSearchEmail(trimmed);
  };

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ["admin", "user-search", searchEmail] });
  };

  const errorMessage = isError
    ? (error instanceof Error ? error.message : "Could not find that account.")
    : null;

  return (
    <AppLayout>
      <PageTransition className="max-w-2xl mx-auto p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-primary" /> User Account Management
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Look up any user by email to view their account state and send verification or password
            reset emails.
          </p>
        </div>

        <Card className="p-5">
          <form onSubmit={handleSearch} className="flex gap-3">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <input
                type="email"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                placeholder="user@example.com"
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                autoComplete="off"
              />
            </div>
            <Button type="submit" size="sm" disabled={!emailInput.trim() || isFetching}>
              {isFetching ? <Loader2 className="w-4 h-4 animate-spin" /> : "Search"}
            </Button>
          </form>
        </Card>

        {isLoading && (
          <Card className="p-8 text-center">
            <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">Looking up account…</p>
          </Card>
        )}

        {!isLoading && isError && (
          <Card className="p-6 flex items-center gap-3 border-destructive/20">
            <AlertCircle className="w-5 h-5 text-destructive shrink-0" />
            <p className="text-sm text-muted-foreground">{errorMessage}</p>
          </Card>
        )}

        {!isLoading && !isError && user && (
          <UserCard user={user} onRefresh={handleRefresh} />
        )}
      </PageTransition>
    </AppLayout>
  );
}
