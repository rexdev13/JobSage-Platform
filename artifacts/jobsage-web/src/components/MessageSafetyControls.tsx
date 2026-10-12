import { useEffect, useRef, useState } from "react";
import { useAuth } from "@workspace/auth-web";
import {
  blockMessageSender, removeMessageSenderBlock, useListMessageSenderBlocks,
  getListMessageSenderBlocksQueryKey, getGetCandidateMessagesQueryKey, getGetInboxUnreadCountQueryKey,
  type CandidateMessage,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AIContentReport } from "./AIContentReport";

function useSenderAction() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const owner = useRef(user?.id); owner.current = user?.id;
  const active = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    active.current?.abort(); active.current = null; setBusy(false); setNotice("");
    return () => { active.current?.abort(); active.current = null; };
  }, [user?.id]);
  async function run(action: (options: RequestInit) => Promise<unknown>) {
    const actor = user?.id;
    if (!actor || active.current) return false;
    const controller = new AbortController(); active.current = controller;
    setBusy(true); setNotice("");
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      await action({ signal: controller.signal, headers: { "X-Jobsage-Expected-Account": actor } });
      if (active.current !== controller || owner.current !== actor) return false;
      await Promise.all([
        qc.invalidateQueries({ queryKey: getGetCandidateMessagesQueryKey() }),
        qc.invalidateQueries({ queryKey: getGetInboxUnreadCountQueryKey() }),
        qc.invalidateQueries({ queryKey: getListMessageSenderBlocksQueryKey() }),
      ]);
      return owner.current === actor && active.current === controller;
    } catch {
      if (active.current === controller && owner.current === actor) setNotice("Action not confirmed. Check your account and connection. Check the blocked-sender list before retrying.");
      return false;
    } finally {
      clearTimeout(timeout);
      if (active.current === controller) { active.current = null; setBusy(false); }
    }
  }
  return { user, busy, notice, run };
}

export function MessageSafetyActions({ message }: { message: CandidateMessage }) {
  const { user, busy, notice, run } = useSenderAction();
  const [confirm, setConfirm] = useState(false);
  useEffect(() => { setConfirm(false); }, [user?.id, message.id]);
  const canBlock = message.messageType !== "support" && !message.supportTicketId && (!!message.senderEmployerProfileId || !!message.senderEmail);
  return <div className="mt-3 flex flex-wrap items-center gap-4">
    <AIContentReport kind="message" messageId={message.id} label="Report message" content={message.messageText} context={`Inbox message ${message.id}: ${message.subject}`} />
    {canBlock && <button type="button" className="text-xs underline text-muted-foreground" disabled={busy || !user?.id} onClick={() => setConfirm(true)}>Block sender</button>}
    <Dialog open={confirm} onOpenChange={setConfirm}>
      <DialogContent className="z-[80]">
        <DialogHeader><DialogTitle>Block this sender?</DialogTitle><DialogDescription>
          {message.senderEmployerProfileId ? "This employer's JOBSAGE account" : "This exact sender email address"} will be blocked for your account.
          Existing messages from this sender will be hidden, not deleted. New messages and JOBSAGE message-notification emails from this sender will be stopped.
          Deliveries already in progress may still arrive. This does not block other accounts or addresses, unsubscribe outside JOBSAGE, or delete applications.
        </DialogDescription></DialogHeader>
        {notice && <p role="status">{notice}</p>}
        <div className="flex justify-end gap-4">
          <button type="button" onClick={() => setConfirm(false)}>Cancel</button>
          <button type="button" disabled={busy} onClick={() => void run(options => blockMessageSender(message.id, options)).then(ok => { if (ok) setConfirm(false); })}>{busy ? "Blocking..." : "Confirm block"}</button>
        </div>
      </DialogContent>
    </Dialog>
  </div>;
}

export function ManageBlockedSenders() {
  const { user, busy, notice, run } = useSenderAction();
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [user?.id]);
  const { data, isLoading, isError } = useListMessageSenderBlocks({
    query: { queryKey: [...getListMessageSenderBlocksQueryKey(), user?.id], enabled: open && !!user?.id },
    request: { headers: { "X-Jobsage-Expected-Account": user?.id ?? "" } },
  });
  return <>
    <button type="button" className="ml-auto text-xs underline" disabled={!user?.id} onClick={() => setOpen(true)}>Blocked senders</button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="z-[80] max-h-[85dvh] overflow-y-auto">
        <DialogHeader><DialogTitle>Blocked senders</DialogTitle><DialogDescription>
          Unblocking restores existing hidden inbox messages and allows new deliveries. Messages rejected while blocked cannot be restored.
          JOBSAGE support and unattributed operational updates cannot be blocked; report a concern instead.
        </DialogDescription></DialogHeader>
        {isLoading ? <p>Loading blocked senders...</p> : isError ? <p role="alert">Could not load blocked senders. Try reopening this dialog.</p> : data?.length === 0 ? <p>No blocked senders.</p> : data?.map(block => <div key={block.id} className="flex justify-between items-center gap-3 border-b py-3">
          <span>{block.senderLabel}</span>
          <button type="button" disabled={busy} onClick={() => void run(options => removeMessageSenderBlock(block.id, options))}>Unblock</button>
        </div>)}
        {notice && <p role="status">{notice}</p>}
      </DialogContent>
    </Dialog>
  </>;
}
