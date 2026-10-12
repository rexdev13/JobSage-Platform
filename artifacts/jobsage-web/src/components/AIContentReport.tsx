import { useEffect, useRef, useState } from "react";
import { useAuth } from "@workspace/auth-web";
import { createSupportTicket, getCurrentAuthUser } from "@workspace/api-client-react";
import { AI_REPORT_REASONS, buildAIReportMessage, type AIReportReason } from "@workspace/mobile-core";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function AIContentReport({ content, context, label = "Report this AI answer", kind = "ai" }: { content: string; context: string; label?: string; kind?: "ai" | "message" }) {
  const { user: currentUser } = useAuth();
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState({ content: "", context: "", userId: "" });
  const [reason, setReason] = useState<AIReportReason>("inaccurate");
  const [detail, setDetail] = useState("");
  const [include, setInclude] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
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
      }, { signal: controller.signal, headers: {
        [kind === "message" ? "X-Jobsage-Message-Report" : "X-Jobsage-AI-Report"]: "1", "X-Jobsage-Report-User": user.id,
      } });
      if (active.current === controller) setNotice(`Saved for staff review. Reference: ${saved.ticketId}.`);
    } catch {
      if (active.current === controller) setNotice("Report not confirmed. Check your sign-in and connection. A timed-out report may already have been saved; check support before resending.");
    } finally {
      clearTimeout(timeout);
      if (active.current === controller) { active.current = null; setBusy(false); }
    }
  }
  return <>
    <button type="button" disabled={!currentUser?.id} className="text-xs text-muted-foreground underline py-2 disabled:opacity-50" onClick={() => {
      if (!currentUser?.id) return;
      setSnapshot({ content, context, userId: currentUser.id }); setDetail(""); setInclude(false); setNotice(""); setReason("inaccurate"); setOpen(true);
    }}>{label}</button>
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
        <div className="flex justify-end gap-3"><button type="button" onClick={close}>Close</button>
          <button type="button" disabled={busy || detail.trim().length < 10 || notice.startsWith("Saved")} onClick={() => void submit()} className="bg-primary text-primary-foreground rounded px-4 py-2 disabled:opacity-50">{busy ? "Sending..." : "Send report"}</button></div>
      </DialogContent>
    </Dialog>
  </>;
}
