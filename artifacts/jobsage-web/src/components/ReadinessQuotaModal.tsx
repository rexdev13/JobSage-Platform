import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Link } from "wouter";
import { getGetReadinessQuotaQueryKey, useGetReadinessQuota } from "@workspace/api-client-react";
import { ExternalLink, X } from "lucide-react";
import { ReadinessUpgradeOptions } from "@/components/ReadinessUpgradeOptions";

export function ReadinessQuotaModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const quotaQuery = useGetReadinessQuota({
    query: {
      queryKey: getGetReadinessQuotaQueryKey(),
      enabled: open,
      staleTime: 0,
    },
  });
  if (!open) return null;
  const quota = quotaQuery.data;
  const used = quota?.used ?? 0;
  const limit = quota?.limit ?? 3;
  const percent = quota ? Math.min(100, Math.round((used / limit) * 100)) : 0;

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
           <ReadinessUpgradeOptions />
          <div className="flex flex-col gap-2 border-t border-border/70 pt-4 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between"><span>Need help with a receipt, cancellation or billing term?</span><Link href="/support#contact" onClick={onClose} className="inline-flex items-center gap-1 font-semibold text-primary hover:underline" data-testid="link-quota-support">Contact support <ExternalLink className="h-3 w-3" /></Link></div>
        </div>
      </section>
      </DialogPrimitive.Content>
      </div>
    </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}