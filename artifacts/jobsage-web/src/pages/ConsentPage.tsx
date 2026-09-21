import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useRecordConsent } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@workspace/auth-web";
import { getGetMyConsentQueryKey } from "@workspace/api-client-react";
import { Button, PageTransition } from "@/components/ui-enhanced";
import { Shield, Check, Lock, FileText, AlertCircle } from "lucide-react";
import { motion } from "framer-motion";

const COMMITMENTS = [
  {
    icon: FileText,
    title: "Data Processing",
    body: "We analyse your declared qualifications and experience against UK regulatory criteria (GMC, NMC, HCPC).",
  },
  {
    icon: Lock,
    title: "Secure Storage",
    body: "Documents uploaded are stored securely and never shared with employers or regulators without your explicit action.",
  },
  {
    icon: AlertCircle,
    title: "Advisory Only",
    body: "This platform provides decision support only. Final regulatory decisions rest with the relevant body.",
  },
];

export default function ConsentPage() {
  const [checked, setChecked] = useState(false);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const recordConsentMutation = useRecordConsent();
  const { user } = useAuth();

  const handleContinue = async () => {
    try {
      await recordConsentMutation.mutateAsync({ data: { termsVersion: "1.0.0" } });
      queryClient.invalidateQueries({ queryKey: getGetMyConsentQueryKey() });
      setLocation(user?.role === "employer" ? "/employer/onboarding" : "/");
    } catch (err) {
      console.error("Consent failed", err);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-background to-accent/5" />

      <PageTransition className="w-full max-w-lg relative z-10">
        {/* Logo */}
        <div className="flex items-center justify-center mb-8">
          <img src="/logo.png" alt="JOBSAGE" className="h-12 md:h-14 w-auto object-contain" />
        </div>

        <div className="bg-white/90 backdrop-blur-sm rounded-2xl shadow-xl border border-border/50 p-8">
          <div className="text-center mb-8">
            <div className="w-14 h-14 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Shield className="w-7 h-7 text-primary" />
            </div>
            <h1 className="text-2xl font-display font-bold text-foreground mb-2">
              Data Privacy & Terms
            </h1>
            <p className="text-muted-foreground text-sm leading-relaxed">
              Before accessing JOBSAGE, please review the terms and how we handle your data.
            </p>
          </div>

          <div className="space-y-3 mb-8">
            {COMMITMENTS.map(({ icon: Icon, title, body }, i) => (
              <motion.div
                key={title}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.1 + 0.1 }}
                className="flex items-start gap-3 p-4 rounded-xl bg-muted/40 border border-border/40"
              >
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                  <Icon className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">{title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{body}</p>
                </div>
              </motion.div>
            ))}
          </div>

          {/* Consent checkbox */}
          <label className="flex items-start gap-3 p-4 rounded-xl border-2 border-transparent hover:border-primary/20 hover:bg-primary/5 cursor-pointer transition-all group mb-6">
            <div className="relative flex items-center justify-center mt-0.5 shrink-0">
              <input
                type="checkbox"
                className="peer w-5 h-5 rounded border-2 border-primary/30 appearance-none checked:bg-primary checked:border-primary transition-all cursor-pointer"
                checked={checked}
                onChange={(e) => setChecked(e.target.checked)}
              />
              <Check className="w-3 h-3 text-primary-foreground absolute pointer-events-none opacity-0 peer-checked:opacity-100 transition-opacity" />
            </div>
            <span className="text-sm text-foreground leading-relaxed select-none">
              I have read and agree to the{" "}
              I agree to the{" "}
              <Link href="/terms" target="_blank" rel="noopener noreferrer" className="text-primary underline cursor-pointer">Terms of Service</Link> and acknowledge the{" "}
              <Link href="/privacy" target="_blank" rel="noopener noreferrer" className="text-primary underline cursor-pointer">Privacy Policy</Link>. I ask JOBSAGE to process the professional data I provide to deliver eligibility, matching, and application-support features.
            </span>
          </label>

          <Button
            size="lg"
            className="w-full"
            disabled={!checked || recordConsentMutation.isPending}
            onClick={handleContinue}
          >
            {recordConsentMutation.isPending ? "Recording Agreement..." : "Agree & Continue"}
          </Button>

          <p className="mt-4 text-center text-xs text-muted-foreground">
            You can withdraw consent at any time by contacting us.
          </p>
        </div>
      </PageTransition>
    </div>
  );
}
