import { useState } from "react";
import { useLocation } from "wouter";
import { useRecordConsent } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetMyConsentQueryKey } from "@workspace/api-client-react";
import { Button, Card, PageTransition } from "@/components/ui-enhanced";
import { ShieldAlert, Check } from "lucide-react";

export default function ConsentPage() {
  const [checked, setChecked] = useState(false);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const recordConsentMutation = useRecordConsent();

  const handleContinue = async () => {
    try {
      await recordConsentMutation.mutateAsync({
        data: { termsVersion: "1.0.0" }
      });
      // Invalidate to unblock AuthGuard
      queryClient.invalidateQueries({ queryKey: getGetMyConsentQueryKey() });
      setLocation("/");
    } catch (err) {
      console.error("Consent failed", err);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-accent/5" />
      
      <PageTransition className="max-w-xl relative z-10">
        <Card className="p-8 md:p-12 shadow-xl shadow-black/5">
          <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mb-8">
            <ShieldAlert className="w-8 h-8 text-primary" />
          </div>
          
          <h1 className="text-3xl font-display font-bold text-foreground mb-4">
            Data Privacy & Consent
          </h1>
          <p className="text-muted-foreground leading-relaxed mb-8 text-lg">
            JOBSAGE processes your professional details to provide eligibility intelligence. 
            Before we begin, we need your consent to store and analyze this data.
          </p>

          <div className="bg-muted/50 border border-border rounded-xl p-6 mb-8 text-sm text-foreground/80 space-y-4">
            <p><strong>1. Data Processing:</strong> We analyze your declared qualifications and experience against UK regulatory criteria (e.g., GMC, NMC, HCPC).</p>
            <p><strong>2. Document Storage:</strong> Any documents uploaded are stored securely and are not shared with employers or regulators without explicit future action.</p>
            <p><strong>3. Advisory Nature:</strong> This platform provides decision support only. Final decisions rest with the relevant regulator.</p>
          </div>

          <label className="flex items-start space-x-4 p-4 rounded-xl border-2 border-transparent hover:bg-muted/50 cursor-pointer transition-colors group">
            <div className="relative flex items-center justify-center mt-1">
              <input 
                type="checkbox" 
                className="peer w-6 h-6 rounded-md border-2 border-primary/30 appearance-none checked:bg-primary checked:border-primary transition-all cursor-pointer"
                checked={checked}
                onChange={(e) => setChecked(e.target.checked)}
              />
              <Check className="w-4 h-4 text-primary-foreground absolute pointer-events-none opacity-0 peer-checked:opacity-100 transition-opacity" />
            </div>
            <span className="text-sm font-medium text-foreground select-none">
              I have read and agree to the Terms of Service and Privacy Policy. I consent to JOBSAGE processing my professional data for eligibility evaluation.
            </span>
          </label>

          <div className="mt-10">
            <Button 
              size="lg" 
              className="w-full" 
              disabled={!checked || recordConsentMutation.isPending}
              onClick={handleContinue}
            >
              {recordConsentMutation.isPending ? "Recording Consent..." : "Accept & Continue"}
            </Button>
          </div>
        </Card>
      </PageTransition>
    </div>
  );
}
