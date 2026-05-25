import { useEffect, useState } from "react";
import { useSearch } from "wouter";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api";

interface ActivateResponse {
  user: {
    id: string;
    email?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    role?: string | null;
  };
  adminId: string | null;
}

export default function ImpersonatePage() {
  const searchStr = useSearch();
  const token = new URLSearchParams(searchStr).get("token") ?? "";
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setError("No impersonation token provided.");
      return;
    }

    fetch(`${API_BASE}/admin/super/impersonate/activate?token=${encodeURIComponent(token)}`, {
      credentials: "include",
    })
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error((body as { error?: string }).error ?? "Invalid or expired token.");
        }
        return r.json() as Promise<ActivateResponse>;
      })
      .then((data) => {
        const { user, adminId } = data;
        const displayName = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email || user.id;

        sessionStorage.setItem(
          "impersonation",
          JSON.stringify({ displayName, email: user.email ?? "", role: user.role ?? "", adminId }),
        );

        const base = import.meta.env.BASE_URL.replace(/\/$/, "");
        const dashboardPath = user.role === "employer" ? "/employer/dashboard" : "/";
        window.location.href = base + dashboardPath;
      })
      .catch((e: Error) => setError(e.message));
  }, [token]);

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-4">
        <div className="text-2xl font-bold text-destructive">Access Denied</div>
        <p className="text-muted-foreground">{error}</p>
        <button onClick={() => window.close()} className="text-sm text-primary hover:underline">
          Close this tab
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-10 h-10 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
    </div>
  );
}
