import { useState } from "react";
import { useLocation } from "wouter";
import { Shield, Eye, EyeOff, AlertCircle, Lock } from "lucide-react";
import { Button } from "@/components/ui-enhanced";
import { motion } from "framer-motion";

export default function AdminLoginPage() {
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json() as { error?: string; code?: string; user?: { role?: string } };

      if (!res.ok) {
        if (data.code === "account_suspended") {
          setError("Your account has been suspended. Contact support@jobsage.co.uk if you believe this is an error.");
        } else if (data.code === "email_not_verified") {
          setError("Please verify your email address before signing in.");
        } else {
          setError(data.error ?? "Sign in failed. Please check your credentials and try again.");
        }
        return;
      }

      const meRes = await fetch("/api/auth/me", { credentials: "include" });
      const meData = await meRes.json() as { role?: string };

      if (meData.role !== "super_admin") {
        await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
        setError("Access denied — this login is for administrators only.");
        return;
      }

      window.location.href = "/admin/super";
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 relative overflow-hidden flex flex-col">
      <div className="absolute inset-0 z-0 pointer-events-none">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/10 via-transparent to-transparent" />
        <div className="absolute bottom-0 inset-x-0 h-64 bg-gradient-to-t from-slate-950 to-transparent" />
      </div>

      <header className="relative z-10 p-6 md:p-10 flex items-center justify-between max-w-7xl mx-auto w-full">
        <button
          onClick={() => setLocation("/")}
          className="hover:opacity-80 transition-opacity"
        >
          <img src="/logo.png" alt="JOBSAGE" className="h-11 md:h-12 w-auto object-contain brightness-150" />
        </button>
        <div className="flex items-center gap-1.5 text-slate-400 text-xs">
          <Lock className="w-3 h-3" />
          <span>Secure Admin Access</span>
        </div>
      </header>

      <main className="relative z-10 flex-1 flex items-center justify-center px-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="w-full max-w-sm"
        >
          <div className="mb-6 text-center">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 mb-4">
              <Shield className="w-7 h-7 text-primary" />
            </div>
            <h2 className="text-2xl font-display font-bold text-white">Admin Portal</h2>
            <p className="text-slate-400 text-sm mt-1">Sign in to access the administration panel</p>
          </div>

          <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-7 shadow-2xl">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">Email address</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  autoFocus
                  placeholder="admin@example.com"
                  className="w-full rounded-lg border border-white/10 bg-white/5 text-white placeholder:text-slate-500 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/40 transition"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                    placeholder="••••••••"
                    className="w-full rounded-lg border border-white/10 bg-white/5 text-white placeholder:text-slate-500 px-3 py-2.5 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/40 transition"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 transition"
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {error && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 text-sm">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <Button type="submit" className="w-full mt-1" disabled={isLoading}>
                {isLoading ? "Signing in…" : "Sign in to Admin Portal"}
              </Button>
            </form>

            <p className="mt-5 text-center text-xs text-slate-500">
              Forgot your password?{" "}
              <button
                onClick={() => setLocation("/forgot-password")}
                className="text-slate-400 hover:text-slate-200 underline transition"
              >
                Reset it here
              </button>
            </p>
          </div>

          <p className="mt-5 text-center text-xs text-slate-600">
            Not an administrator?{" "}
            <button onClick={() => setLocation("/login")} className="text-slate-500 hover:text-slate-300 underline transition">
              Go to regular sign in
            </button>
          </p>
        </motion.div>
      </main>
    </div>
  );
}
