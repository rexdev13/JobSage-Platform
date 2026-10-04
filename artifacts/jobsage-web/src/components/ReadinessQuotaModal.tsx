import { useEffect, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { getGetCurrentAuthUserQueryKey, getGetMyProfileQueryKey, getGetReadinessQuotaQueryKey, useCreateCheckoutSession, useGetReadinessQuota } from "@workspace/api-client-react";
import { Button } from "@/components/ui-enhanced";
import { useToast } from "@/hooks/use-toast";
import { Check, ExternalLink, Loader2, ShieldCheck, Sparkles, X } from "lucide-react";

export function ReadinessQuotaModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const quotaQuery = useGetReadinessQuota({
    query: {
      queryKey: getGetReadinessQuotaQueryKey(),
      enabled: open,
      staleTime: 0,
    },
  });
  const checkout = useCreateCheckoutSession({});
  const [sandboxMessage, setSandboxMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSandboxMessage(null);
  }, [open]);

  if (!open) return null;
  const quota = quotaQuery.data;
  const used = quota?.used ?? 0;
  const limit = quota?.limit ?? 3;
  const percent = quota ? Math.min(100, Math.round((used / limit) * 100)) : 0;

  async function beginCheckout(type: "booster_pack" | "pro_subscription") {
    try {
      const result = await checkout.mutateAsync({ data: { type, currency: "gbp" } });
      if (!result.success) {
        toast({ title: "Checkout was not completed", description: "Production checkout is not available right now. No payment or account access was confirmed.", variant: "destructive" });
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
        toast({ title: "Sandbox checkout completed", description: `${type === "booster_pack" ? "+20 checks added." : "Pro unlimited checks activated."} Development only — no live payment was taken.` });
        return;
      }
      toast({ title: "Live checkout is unavailable", description: "Production checkout is not available right now. No payment or account access was confirmed.", variant: "destructive" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Production checkout is not available right now.";
      toast({ title: "Checkout could not start", description: `${message} No payment or access was confirmed.`, variant: "destructive" });
    }
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}>
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay data-testid="button-close-quota-backdrop" className="fixed inset-0 z-[80] cursor-default bg-foreground/35 backdrop-blur-sm" />
      <div className="pointer-events-none fixed inset-0 z-[81] flex items-end justify-center p-3 sm:items-center sm:p-6">
      <DialogPrimitive.Content asChild aria-describedby={undefined}>
      <section className="pointer-events-auto relative max-h-[92dvh] w-full max-w-3xl overflow-y-auto rounded-3xl border border-border bg-background shadow-2xl">
        <div className="flex items-start justify-between border-b border-border/70 p-5 sm:p-7">
          <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">Readiness Checks</p><DialogPrimitive.Title asChild><h2 className="mt-2 text-2xl font-bold">Keep moving with a clearer application</h2></DialogPrimitive.Title><p className="mt-1 text-sm text-muted-foreground">Use checks to compare your profile and CV with the role criteria.</p></div>
          <button type="button" data-testid="button-close-quota" aria-label="Close Readiness Check quota" onClick={onClose} className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-6 p-5 sm:p-7">
          <div className="rounded-2xl border border-border bg-secondary/35 p-4">
             <div className="mb-2 flex items-center justify-between gap-3 text-sm"><span className="font-semibold">Monthly allowance</span><span className="font-mono text-primary" data-testid="text-readiness-usage">{quotaQuery.isLoading ? "Loading…" : quota?.plan === "pro" ? "Unlimited" : quota ? `${used}/${limit}` : "Unavailable"}</span></div>
             {quota?.plan !== "pro" && <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${percent}%` }} /></div>}
             <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs text-muted-foreground"><span>{quota?.plan === "pro" ? "JobSage Pro is active" : quota ? `${Math.max(0, limit - used)} free checks remaining` : "Quota status unavailable"}</span><span>{quota?.bonusRemaining ?? 0} bonus checks</span></div>
             {quota && quota.plan !== "pro" && <p className="mt-2 text-xs text-muted-foreground" data-testid="text-readiness-reset">Free checks reset {new Date(quota.resetsAt).toLocaleDateString(undefined, { month: "long", day: "numeric", timeZone: "UTC" })} at 00:00 UTC.</p>}
          </div>
           {quotaQuery.isError && <p className="rounded-xl border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive" role="alert" data-testid="status-quota-error">We could not refresh your quota. {quota ? "The last available value is shown." : "Please try again."} <button type="button" className="ml-1 font-semibold underline" onClick={() => void quotaQuery.refetch()}>Try again</button></p>}
          {sandboxMessage && <p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm font-semibold text-amber-900" role="status" data-testid="status-sandbox-checkout">{sandboxMessage}</p>}
          <div className="grid gap-4 md:grid-cols-2">
            <article className="rounded-2xl border border-border bg-card p-5">
              <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">One-time</p><h3 className="mt-1 text-xl font-bold">Check Booster Pack</h3></div><span className="text-2xl font-bold">£4.99</span></div>
              <p className="mt-3 text-sm text-muted-foreground">Add 20 additional Readiness Checks when you need a focused burst of applications.</p>
              <ul className="mt-4 space-y-2 text-sm">{["20 additional checks", "One-time purchase", "Use whenever you need them"].map((item) => <li key={item} className="flex items-center gap-2"><Check className="h-4 w-4 text-primary" />{item}</li>)}</ul>
              <Button type="button" data-testid="button-buy-booster" variant="outline" className="mt-5 w-full" onClick={() => void beginCheckout("booster_pack")} disabled={checkout.isPending}>{checkout.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}Upgrade Now</Button>
            </article>
            <article className="relative rounded-2xl border-2 border-primary bg-primary/[0.06] p-5">
              <span className="absolute -top-3 left-5 rounded-full bg-primary px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-primary-foreground">For active applications</span>
              <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wider text-primary">Monthly</p><h3 className="mt-1 text-xl font-bold">JobSage Pro</h3></div><span className="text-2xl font-bold">£15.99<span className="text-sm font-medium text-muted-foreground">/mo</span></span></div>
              <p className="mt-3 text-sm text-muted-foreground">Remove the monthly limit while applications are moving quickly.</p>
              <ul className="mt-4 space-y-2 text-sm">{["Unlimited Readiness Checks", "Priority AI gap analysis", "Monthly subscription"].map((item) => <li key={item} className="flex items-center gap-2"><Check className="h-4 w-4 text-primary" />{item}</li>)}</ul>
              <Button type="button" data-testid="button-buy-pro" className="mt-5 w-full" onClick={() => void beginCheckout("pro_subscription")} disabled={checkout.isPending}>{checkout.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}Upgrade Now</Button>
            </article>
          </div>
          <div className="flex flex-col gap-2 border-t border-border/70 pt-4 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between"><span>Need help with a receipt, cancellation or billing term?</span><Link href="/support#contact" onClick={onClose} className="inline-flex items-center gap-1 font-semibold text-primary hover:underline" data-testid="link-quota-support">Contact support <ExternalLink className="h-3 w-3" /></Link></div>
        </div>
      </section>
      </DialogPrimitive.Content>
      </div>
    </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}