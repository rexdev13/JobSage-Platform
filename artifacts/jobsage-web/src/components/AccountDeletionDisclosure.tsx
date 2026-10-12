import { useEffect, useState } from "react";
import { useAuth } from "@workspace/auth-web";
import { ACCOUNT_DELETION_POLICY } from "@workspace/mobile-core";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/** Policy disclosure only. Do not collect passwords or offer a synthetic request receipt while
 * destructive requests are disabled pending verified ownership/provider/restore integration. */
export function AccountDeletionDisclosure() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [user?.id]);
  if (!user) return null;
  return <>
    <button type="button" onClick={() => setOpen(true)} className="mb-2 w-full rounded-md px-3 py-2 text-left text-sm hover:bg-sidebar-accent">
      Account deletion &amp; retention
    </button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Account deletion &amp; retention</DialogTitle>
          <DialogDescription>
            JOBSAGE approved policy, {ACCOUNT_DELETION_POLICY.version}. This build is not accepting permanent deletion requests while the cleanup and restore integrations are being verified. No account data is deleted by viewing this policy.
          </DialogDescription>
        </DialogHeader>
        <section aria-label="Information to delete">
          <h3 className="mb-2 font-semibold">Information to delete</h3>
          <ul className="list-disc space-y-2 pl-5 text-sm">
            {ACCOUNT_DELETION_POLICY.deletedData.map(item => <li key={item}>{item}</li>)}
          </ul>
        </section>
        <section aria-label="Deletion consequences and time limits">
          <h3 className="mb-2 font-semibold">Consequences and time limits</h3>
          <ul className="list-disc space-y-3 pl-5 text-sm">
            {ACCOUNT_DELETION_POLICY.disclosures.map(item => <li key={item}>{item}</li>)}
          </ul>
        </section>
        <section aria-label="Store subscriptions">
          <h3 className="mb-2 font-semibold">Store subscriptions, if applicable</h3>
          <p className="text-sm">Apple: Settings → your name → Subscriptions → choose the subscription → Cancel Subscription.</p>
          <p className="mt-2 text-sm">Google Play: profile icon → Payments &amp; subscriptions → Subscriptions → choose the subscription → Cancel subscription.</p>
        </section>
        <button type="button" onClick={() => setOpen(false)} className="rounded-md border px-4 py-2 text-sm">Close</button>
      </DialogContent>
    </Dialog>
  </>;
}
