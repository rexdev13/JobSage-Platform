import { useState, useEffect, useRef } from "react";
import { Link, useLocation } from "wouter";
import { Eye, EyeOff, AlertCircle, CheckCircle2, RefreshCw } from "lucide-react";
import JobsageLogo from "@/components/JobsageLogo";
import { Button } from "@/components/ui-enhanced";
import { motion } from "framer-motion";

export default function LoginPage() {
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unverified, setUnverified] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [resendSuccess, setResendSuccess] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const cooldownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
    };
  }, []);

  function startCooldown(seconds: number) {
    setResendCooldown(seconds);
    if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
    cooldownTimerRef.current = setInterval(() => {
      setResendCooldown((prev) => {
        if (prev <= 1) {
          clearInterval(cooldownTimerRef.current!);
          cooldownTimerRef.current = null;
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }

  const urlParams = new URLSearchParams(window.location.search);
  const urlError = urlParams.get("error");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setUnverified(false);
    setIsLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json() as { error?: string; code?: string };

      if (!res.ok) {
        if (res.status === 403 && data.code === "email_not_verified") {
          setUnverified(true);
          setError(data.error ?? "Please verify your email before signing in.");
        } else {
          setError(data.error ?? "Sign in failed. Please try again.");
        }
        return;
      }

      window.location.href = "/";
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleResendVerification() {
    setResendLoading(true);
    setResendSuccess(false);
    try {
      const res = await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (res.status === 429) {
        const data = await res.json() as { retryAfter?: number };
        startCooldown(data.retryAfter ?? 60);
      } else {
        setResendSuccess(true);
        startCooldown(60);
      }
    } catch {
    } finally {
      setResendLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background relative overflow-hidden flex flex-col">
      <div className="absolute inset-0 z-0">
        <img
          src={`${import.meta.env.BASE_URL}images/auth-bg.png`}
          alt=""
          className="w-full h-full object-cover opacity-40 mix-blend-multiply"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-background/40 via-background/80 to-background" />
      </div>

      <header className="relative z-10 p-6 md:p-10 flex items-center max-w-7xl mx-auto w-full">
        <button
          onClick={() => setLocation("/")}
          className="flex items-center space-x-3 hover:opacity-80 transition-opacity"
        >
          <JobsageLogo className="h-9" />
        </button>
      </header>

      <main className="relative z-10 flex-1 flex items-center justify-center px-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="w-full max-w-md"
        >
          <div className="bg-white/90 backdrop-blur-sm rounded-2xl shadow-xl border border-border/50 p-8">
            <h2 className="text-2xl font-display font-bold text-foreground mb-1">Sign in</h2>
            <p className="text-muted-foreground text-sm mb-6">
              Welcome back to JOBSAGE
            </p>

            {urlError === "invalid_token" && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm mb-4">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>That verification link is invalid.</span>
              </div>
            )}
            {urlError === "token_expired" && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm mb-4">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <div>
                  <span>That verification link has expired.</span>
                  <div className="mt-2">
                    {resendSuccess ? (
                      <span className="text-green-700 flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" /> Verification email sent — check your inbox.
                        {resendCooldown > 0 && (
                          <span className="text-muted-foreground ml-1">({resendCooldown}s)</span>
                        )}
                      </span>
                    ) : resendCooldown > 0 ? (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <RefreshCw className="w-3 h-3" />
                        Please wait {resendCooldown}s before requesting another email.
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={handleResendVerification}
                        disabled={resendLoading || !email}
                        className="flex items-center gap-1 text-primary underline text-xs hover:opacity-80 disabled:opacity-50"
                      >
                        <RefreshCw className={`w-3 h-3 ${resendLoading ? "animate-spin" : ""}`} />
                        {email ? "Resend verification email" : "Enter your email above to resend"}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Email address</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  placeholder="you@example.com"
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition"
                />
              </div>

              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <label className="block text-sm font-medium text-foreground">Password</label>
                  <Link href="/forgot-password" className="text-xs text-primary hover:underline">
                    Forgot password?
                  </Link>
                </div>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                    placeholder="••••••••"
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition"
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {error && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <div>
                    <span>{error}</span>
                    {unverified && (
                      <div className="mt-2">
                        {resendSuccess ? (
                          <span className="text-green-700 flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" /> Verification email sent — check your inbox.
                            {resendCooldown > 0 && (
                              <span className="text-muted-foreground ml-1">({resendCooldown}s)</span>
                            )}
                          </span>
                        ) : resendCooldown > 0 ? (
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <RefreshCw className="w-3 h-3" />
                            Please wait {resendCooldown}s before requesting another email.
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={handleResendVerification}
                            disabled={resendLoading}
                            className="flex items-center gap-1 text-primary underline text-xs hover:opacity-80 disabled:opacity-50"
                          >
                            <RefreshCw className={`w-3 h-3 ${resendLoading ? "animate-spin" : ""}`} />
                            Resend verification email
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? "Signing in…" : "Sign in"}
              </Button>
            </form>

            <p className="mt-5 text-center text-sm text-muted-foreground">
              Don&apos;t have an account?{" "}
              <Link href="/register" className="text-primary font-medium hover:underline">
                Create account
              </Link>
            </p>
          </div>
        </motion.div>
      </main>
    </div>
  );
}
