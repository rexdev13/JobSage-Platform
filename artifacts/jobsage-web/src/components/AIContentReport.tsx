import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@workspace/auth-web";
import { appealContentReport, createSupportTicket, getCurrentAuthUser } from "@workspace/api-client-react";
import { AI_REPORT_REASONS, buildAIReportMessage, type AIReportReason } from "@workspace/mobile-core";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type AIContentReportProps = {
  content: string;
  context: string;
  label?: string;
  loginNext?: string;
} & (
  | { kind: "message"; messageId: number }
  | { kind?: "ai"; messageId?: never }
);

export function AIContentReport({ content, context, label = "Report this AI answer", loginNext, kind = "ai", messageId }: AIContentReportProps) {
  const { user: currentUser } = useAuth();
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<{ content: string; context: string; userId: string; messageId?: number }>({ content: "", context: "", userId: "" });
  const [reason, setReason] = useState<AIReportReason>("inaccurate");
  const [detail, setDetail] = useState("");
  const [include, setInclude] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [savedTicketId, setSavedTicketId] = useState("");
  const [appealDetail, setAppealDetail] = useState("");
  const [appealTicketId, setAppealTicketId] = useState("");
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => { active.current?.abort(); active.current = null; }, []);

  function close() {
    active.current?.abort(); active.current = null;
    setBusy(false); setOpen(false);
  }
  useEffect(() => {
    if (open && snapshot.userId !== currentUser?.id) close();
  }, [currentUser?.id, open, snapshot.userId]);
  async function submit() {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true); setNotice("");
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const message = buildAIReportMessage({ reason, detail, ...snapshot, kind, includeContent: include });
      const { user } = await getCurrentAuthUser({ signal: controller.signal, cache: "no-store" });
      if (!user?.id || !user.email || user.id !== snapshot.userId) throw new Error("Sign in with the account that opened this report.");
      const saved = await createSupportTicket({
        name: [user.firstName, user.lastName].filter(Boolean).join(" ").slice(0, 120) || "JOBSAGE user",
        email: user.email, category: "Other", subject: kind === "message" ? "Message content report" : "AI content report", message,
        ...(kind === "message" ? { reportedMessageId: snapshot.messageId } : {}),
      }, { signal: controller.signal, headers: {
        [kind === "message" ? "X-Jobsage-Message-Report" : "X-Jobsage-AI-Report"]: "1", "X-Jobsage-Report-User": user.id,
      } });
      if (active.current === controller) {
        setSavedTicketId(saved.ticketId);
        setNotice(`Saved for staff review. Reference: ${saved.ticketId}.`);
      }
    } catch {
      if (active.current === controller) setNotice("Report not confirmed. Check your sign-in and connection. A timed-out report may already have been saved; check support before resending.");
    } finally {
      clearTimeout(timeout);
      if (active.current === controller) { active.current = null; setBusy(false); }
    }
  }
  async function submitAppeal() {
    if (!savedTicketId || !appealDetail.trim() || active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setNotice("");
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const { user } = await getCurrentAuthUser({ signal: controller.signal, cache: "no-store" });
      if (!user?.id || user.id !== snapshot.userId) throw new Error("Sign in with the account that opened this report.");
      const appeal = await appealContentReport(
        savedTicketId,
        { message: appealDetail.trim() },
        { signal: controller.signal, headers: { "X-Jobsage-Report-User": user.id } },
      );
      if (active.current === controller) {
        setAppealTicketId(appeal.ticketId);
        setNotice(`Review request saved. Reference: ${appeal.ticketId}.`);
      }
    } catch {
      if (active.current === controller) setNotice("Review request not confirmed. Check your sign-in and connection before trying again.");
    } finally {
      clearTimeout(timeout);
      if (active.current === controller) { active.current = null; setBusy(false); }
    }
  }
  return <>
    {currentUser?.id ? <button type="button" className="text-xs text-muted-foreground underline py-2" onClick={() => {
      if (!currentUser?.id) return;
      setSnapshot({ content, context, userId: currentUser.id, ...(kind === "message" ? { messageId } : {}) });
      setDetail(""); setInclude(false); setNotice(""); setReason("inaccurate"); setSavedTicketId(""); setAppealDetail(""); setAppealTicketId(""); setOpen(true);
    }}>{label}</button> : <span className="text-xs text-muted-foreground">
      <Link className="underline" href={loginNext ? `/login?next=${encodeURIComponent(loginNext)}` : "/login"}>Sign in to report</Link>
    </span>}
    <Dialog open={open} onOpenChange={value => { if (!value) close(); }}>
      <DialogContent className="z-[80] max-h-[90dvh] overflow-y-auto">
        <DialogHeader><DialogTitle>{kind === "message" ? "Report message" : "Report AI content"}</DialogTitle><DialogDescription>
          Your account contact details and report go to JOBSAGE support. Content is excluded unless you choose to include it. Do not include passwords, payment details or other people's medical or personal information.
        </DialogDescription></DialogHeader>
        <label className="text-sm">Reason<select className="block w-full border rounded p-2 mt-1 bg-background" value={reason} disabled={busy} onChange={e => setReason(e.target.value as AIReportReason)}>
          {Object.entries(AI_REPORT_REASONS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <label className="text-sm">Describe the issue (10–1,000 characters)<textarea className="block w-full border rounded p-2 mt-1 bg-background" rows={4} maxLength={1000} value={detail} disabled={busy} onChange={e => setDetail(e.target.value)} /></label>
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={include} disabled={busy} onChange={e => setInclude(e.target.checked)} />Include up to 2,000 characters of this content</label>
        {include && <pre className="whitespace-pre-wrap text-xs border rounded p-2 max-h-40 overflow-auto">{snapshot.content.slice(0, 2000)}</pre>}
        {notice && <p role="status" className="text-sm">{notice}</p>}
        {!savedTicketId ? <div className="flex justify-end gap-3"><button type="button" onClick={close}>Close</button>
          <button type="button" disabled={busy || detail.trim().length < 10} onClick={() => void submit()} className="bg-primary text-primary-foreground rounded px-4 py-2 disabled:opacity-50">{busy ? "Sending..." : "Send report"}</button></div>
          : <section className="space-y-2 border-t pt-3" aria-labelledby="report-appeal-title">
            <h3 id="report-appeal-title" className="text-sm font-semibold">Request another review</h3>
            <p className="text-xs text-muted-foreground">The original report stays unchanged. Add what you think staff should reconsider.</p>
            {!appealTicketId && <>
              <textarea aria-label="Review request details" className="block w-full border rounded p-2 bg-background text-sm" rows={3} minLength={10} maxLength={1000} value={appealDetail} disabled={busy} onChange={event => setAppealDetail(event.target.value)} />
              <button type="button" disabled={busy || appealDetail.trim().length < 10} onClick={() => void submitAppeal()} className="bg-primary text-primary-foreground rounded px-4 py-2 disabled:opacity-50">{busy ? "Sending..." : "Request review"}</button>
            </>}
            <button type="button" className="ml-3 underline text-sm" onClick={close}>Close</button>
          </section>}
      </DialogContent>
    </Dialog>
  </>;
}
