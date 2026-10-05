import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetCurrentAuthUserQueryKey,
  getGetMyProfileQueryKey,
  getGetReadinessQuotaQueryKey,
  useCreateCheckoutSession,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui-enhanced";
import { useToast } from "@/hooks/use-toast";
import { Check, Loader2, ShieldCheck, Sparkles } from "lucide-react";

export function ReadinessUpgradeOptions({ compact = false }: { compact?: boolean }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const checkout = useCreateCheckoutSession({});
  const [sandboxMessage, setSandboxMessage] = useState<string | null>(null);

  async function beginCheckout(type: "booster_pack" | "pro_subscription") {
    try {
      const result = await checkout.mutateAsync({ data: { type, currency: "gbp" } });
      if (!result.success) {
        toast({
          title: "Checkout was not completed",
          description: "Production checkout is not available right now. No payment or account access was confirmed.",
          variant: "destructive",
        });
        return;
      }
      if (result.checkoutUrl) {
        window.location.assign(result.checkoutUrl);
        return;
      }
      if (result.sandboxCompleted) {
        setSandboxMessage("SANDBOX COMPLETION — development only. No live payment was taken.");
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: getGetReadinessQuotaQueryKey() }),
          queryClient.invalidateQueries({ queryKey: ["gap-analysis-usage"] }),
          queryClient.invalidateQueries({ queryKey: ["my-profile"] }),
          queryClient.invalidateQueries({ queryKey: getGetMyProfileQueryKey() }),
          queryClient.invalidateQueries({ queryKey: getGetCurrentAuthUserQueryKey() }),
        ]);
        window.dispatchEvent(new CustomEvent("jobsage:readiness-upgraded"));
        toast({
          title: "Sandbox checkout completed",
          description: `${type === "booster_pack" ? "+20 checks added." : "Pro unlimited checks activated."} Development only — no live payment was taken.`,
        });
        return;
      }
      toast({
        title: "Live checkout is unavailable",
        description: "Production checkout is not available right now. No payment or account access was confirmed.",
        variant: "destructive",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Production checkout is not available right now.";
      toast({
        title: "Checkout could not start",
        description: `${message} No payment or access was confirmed.`,
        variant: "destructive",
      });
    }
  }

  return (
    <div className={`grid gap-4 ${compact ? "" : "md:grid-cols-2"}`}>
      {sandboxMessage && (
        <p
          className="col-span-full rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm font-semibold text-amber-900"
          role="status"
          data-testid="status-sandbox-checkout"
        >
          {sandboxMessage}
        </p>
      )}
      <article className={`rounded-2xl border border-border bg-card ${compact ? "p-4" : "p-5"}`}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">One-time</p>
            <h3 className="mt-1 text-xl font-bold">Check Booster Pack</h3>
          </div>
          <span className="text-2xl font-bold">£4.99</span>
        </div>
        <p className="mt-3 text-sm text-muted-foreground">Add 20 additional Readiness Checks when you need a focused burst of applications.</p>
        <ul className="mt-4 space-y-2 text-sm">
          {["20 additional checks", "One-time purchase", "Use whenever you need them"].map((item) => (
            <li key={item} className="flex items-center gap-2">
              <Check className="h-4 w-4 text-primary" />
              {item}
            </li>
          ))}
        </ul>
        <Button
          type="button"
          data-testid="button-buy-booster"
          variant="outline"
          className="mt-5 w-full"
          onClick={() => void beginCheckout("booster_pack")}
          disabled={checkout.isPending}
        >
          {checkout.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
          Upgrade Now
        </Button>
      </article>

      <article className="relative rounded-2xl border-2 border-primary bg-primary/[0.06] p-5">
        <span className="absolute -top-3 left-5 rounded-full bg-primary px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-primary-foreground">
          For active applications
        </span>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-primary">Monthly</p>
            <h3 className="mt-1 text-xl font-bold">JobSage Pro</h3>
          </div>
          <span className="text-2xl font-bold">£15.99<span className="text-sm font-medium text-muted-foreground">/mo</span></span>
        </div>
        <p className="mt-3 text-sm text-muted-foreground">Remove the monthly limit while applications are moving quickly.</p>
        <ul className="mt-4 space-y-2 text-sm">
          {["Unlimited Readiness Checks", "Priority AI gap analysis", "Monthly subscription"].map((item) => (
            <li key={item} className="flex items-center gap-2">
              <Check className="h-4 w-4 text-primary" />
              {item}
            </li>
          ))}
        </ul>
        <Button
          type="button"
          data-testid="button-buy-pro"
          className="mt-5 w-full"
          onClick={() => void beginCheckout("pro_subscription")}
          disabled={checkout.isPending}
        >
          {checkout.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
          Upgrade Now
        </Button>
      </article>
    </div>
  );
}
