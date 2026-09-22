import { useState } from "react";
import { useLocation, Link } from "wouter";
import { Card, Button } from "@/components/ui-enhanced";
import { useToast } from "@/hooks/use-toast";
import { Building2, Mail, Lock, User, Eye, EyeOff, ShieldCheck, ArrowRight } from "lucide-react";
import { motion } from "framer-motion";
import { useAuth } from "@workspace/auth-web";

export default function EmployerRegisterPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { refresh } = useAuth();

  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", password: "", confirmPassword: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);

  function validate() {
    const e: Record<string, string> = {};
    if (!form.firstName.trim()) e.firstName = "First name is required.";
    if (!form.lastName.trim()) e.lastName = "Last name is required.";
    if (!form.email.trim() || !form.email.includes("@")) e.email = "Valid email is required.";
    if (form.password.length < 8) e.password = "Password must be at least 8 characters.";
    if (form.password !== form.confirmPassword) e.confirmPassword = "Passwords do not match.";
    return e;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/employer-register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          email: form.email.trim(),
          password: form.password,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast({ title: "Registration failed", description: data.error ?? "An error occurred.", variant: "destructive" });
        return;
      }

      toast({
        title: "Employer account created!",
        description: "Welcome to JOBSAGE. Let's set up your organisation profile.",
      });
      await refresh();
      setLocation("/employer/onboarding");
    } catch {
      toast({ title: "Error", description: "Network error. Please try again.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-accent/5 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-xs font-semibold mb-4">
            <Building2 className="w-3.5 h-3.5" /> Employer Account
          </div>
          <h1 className="text-3xl font-bold text-foreground">Register as an Employer</h1>
          <p className="text-muted-foreground mt-2 text-sm max-w-sm mx-auto">
            Post jobs, access pre-qualified candidates, and manage your hiring pipeline for NHS &amp; healthcare roles.
          </p>
        </div>

        <Card className="p-8">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium mb-1.5">First Name</label>
                <div className="relative">
                  <User className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="text"
                    value={form.firstName}
                    onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                    placeholder="Jane"
                    className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>
                {errors.firstName && <p className="text-xs text-destructive mt-1">{errors.firstName}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">Last Name</label>
                <input
                  type="text"
                  value={form.lastName}
                  onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                  placeholder="Smith"
                  className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
                {errors.lastName && <p className="text-xs text-destructive mt-1">{errors.lastName}</p>}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1.5">Work Email</label>
              <div className="relative">
                <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="j.smith@nhs.co.uk"
                  className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
              {errors.email && <p className="text-xs text-destructive mt-1">{errors.email}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium mb-1.5">Password</label>
              <div className="relative">
                <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type={showPw ? "text" : "password"}
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder="At least 8 characters"
                  className="w-full pl-9 pr-10 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
                 <button type="button" onClick={() => setShowPw((v) => !v)} className="absolute right-1 top-1/2 inline-flex min-h-11 min-w-11 -translate-y-1/2 items-center justify-center text-muted-foreground">
                  {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {errors.password && <p className="text-xs text-destructive mt-1">{errors.password}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium mb-1.5">Confirm Password</label>
              <div className="relative">
                <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="password"
                  value={form.confirmPassword}
                  onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
                  placeholder="Repeat password"
                  className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
              {errors.confirmPassword && <p className="text-xs text-destructive mt-1">{errors.confirmPassword}</p>}
            </div>

            <div className="flex items-start gap-2 p-3 rounded-xl bg-blue-50 border border-blue-100">
              <ShieldCheck className="w-4 h-4 text-blue-700 shrink-0 mt-0.5" />
              <p className="text-xs text-blue-800">
                Your account will be set up as an employer. After registration you'll configure your organisation profile.
              </p>
            </div>

            <div className="text-xs text-muted-foreground leading-relaxed pt-1">
              By creating an employer account, you agree to our{" "}
              <Link href="/terms" className="text-primary hover:underline">Terms of Service</Link> and{" "}
              <Link href="/privacy" className="text-primary hover:underline">Privacy Policy</Link>.
            </div>

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? (
                <><div className="w-4 h-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin mr-2" /> Creating account…</>
              ) : (
                <>Create employer account <ArrowRight className="w-4 h-4 ml-2" /></>
              )}
            </Button>
          </form>
        </Card>

        <div className="mt-4 text-center text-xs text-muted-foreground space-y-2">
          <p>
            Already have an account?{" "}
            <button onClick={() => setLocation("/login")} className="text-primary hover:underline font-medium">
              Sign in
            </button>
          </p>
          <p>
            Looking for a job?{" "}
            <button onClick={() => setLocation("/register")} className="text-primary hover:underline font-medium">
              Register as a candidate
            </button>
          </p>
        </div>
      </motion.div>
    </div>
  );
}
