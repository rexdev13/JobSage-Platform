import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@workspace/auth-web";
import { appealContentReport, createSupportTicket, getCurrentAuthUser } from "@workspace/api-client-react";
import type { SupportTicketInput } from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type ReportableType = Extract<
  NonNullable<SupportTicketInput["reportedContentType"]>,
  "candidate_profile" | "job_listing" | "attachment" | "support_request" | "employer_feedback" | "other"
>;

type ReportSnapshot = {
  contentType: ReportableType;
  contentId: string;
  contextId?: number;
  context: string;
  content?: string;
  userId: string;
};

type ContentReportDialogProps = {
  contentType: ReportableType;
  contentId: string;
  contextId?: number;
  context: string;
  content?: string;
  label: string;
};

const REASONS = [
  "Inaccurate or misleading",
  "Harassment or discrimination",
  "Unsafe or inappropriate",
  "Privacy or personal data concern",
  "Other",
] as const;

const REPORT_TITLES: Record<ReportableType, string> = {
  candidate_profile: "Candidate profile report",
  job_listing: "Job listing report",
  attachment: "Attachment report",
  support_request: "Support request report",
  employer_feedback: "Employer feedback report",
  other: "Other content report",
};

export function ContentReportDialog({
  contentType,
  contentId,
  contextId,
  context,
  content,
  label,
}: ContentReportDialogProps) {
  const { user: currentUser } = useAuth();
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<ReportSnapshot | null>(null);
  const [reason, setReason] = useState<(typeof REASONS)[number]>(REASONS[0]);
  const [detail, setDetail] = useState("");
  const [includeContent, setIncludeContent] = useState(false);
  const [notice, setNotice] = useState("");
  const [savedTicketId, setSavedTicketId] = useState("");
  const [appealDetail, setAppealDetail] = useState("");
  const [appealTicketId, setAppealTicketId] = useState("");
  const [busy, setBusy] = useState(false);
  const active = useRef<AbortController | null>(null);

  useEffect(() => () => {
    active.current?.abort();
    active.current = null;
  }, []);

  function close() {
    active.current?.abort();
    active.current = null;
    setBusy(false);
    setOpen(false);
  }

  useEffect(() => {
    if (open && snapshot?.userId !== currentUser?.id) close();
  }, [currentUser?.id, open, snapshot?.userId]);

  async function submit() {
    if (!snapshot || active.current || detail.trim().length < 10) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setNotice("");
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    try {
      const { user } = await getCurrentAuthUser({ signal: controller.signal, cache: "no-store" });
      if (!user?.id || !user.email || user.id !== snapshot.userId) {
        throw new Error("Sign in with the account that opened this report.");
      }
      const message = [
        `Reason: ${reason}`,
        `Where it appeared: ${snapshot.context}`,
        `Issue details: ${detail.trim()}`,
        ...(includeContent && snapshot.content
          ? [`Reporter-selected excerpt:\n${snapshot.content.slice(0, 2000)}`]
          : []),
      ].join("\n\n");
      const saved = await createSupportTicket({
        name: [user.firstName, user.lastName].filter(Boolean).join(" ").slice(0, 120) || "JOBSAGE user",
        email: user.email,
        category: "Other",
        subject: REPORT_TITLES[snapshot.contentType],
        message,
        reportedContentType: snapshot.contentType,
        reportedContentId: snapshot.contentId,
        ...(snapshot.contextId ? { reportedContextId: snapshot.contextId } : {}),
      }, {
        signal: controller.signal,
        headers: { "X-Jobsage-Report-User": user.id },
      });
      if (active.current === controller) {
        setSavedTicketId(saved.ticketId);
        setNotice(`Saved for staff review. Reference: ${saved.ticketId}.`);
      }
    } catch (error) {
      if (active.current === controller) {
        setNotice(error instanceof Error && error.message.startsWith("Sign in")
          ? error.message
          : "Report not confirmed. Check your connection before trying again.");
      }
    } finally {
      window.clearTimeout(timeout);
      if (active.current === controller) {
        active.current = null;
        setBusy(false);
      }
    }
  }

  async function submitAppeal() {
    if (!snapshot || !savedTicketId || appealDetail.trim().length < 10 || active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setNotice("");
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    try {
      const { user } = await getCurrentAuthUser({ signal: controller.signal, cache: "no-store" });
      if (!user?.id || user.id !== snapshot.userId) {
        throw new Error("Sign in with the account that opened this report.");
      }
      const appeal = await appealContentReport(savedTicketId, { message: appealDetail.trim() }, {
        signal: controller.signal,
        headers: { "X-Jobsage-Report-User": user.id },
      });
      if (active.current === controller) {
        setAppealTicketId(appeal.ticketId);
        setNotice(`Review request saved. Reference: ${appeal.ticketId}.`);
      }
    } catch {
      if (active.current === controller) {
        setNotice("Review request not confirmed. Check your sign-in and connection before trying again.");
      }
    } finally {
      window.clearTimeout(timeout);
      if (active.current === controller) {
        active.current = null;
        setBusy(false);
      }
    }
  }

  return <>
    {currentUser?.id ? (
      <button
        type="button"
        className="min-h-9 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
        onClick={() => {
          if (!currentUser?.id) return;
          setSnapshot({
            contentType,
            contentId,
            ...(contextId ? { contextId } : {}),
            context,
            ...(content ? { content } : {}),
            userId: currentUser.id,
          });
          setReason(REASONS[0]);
          setDetail("");
          setIncludeContent(false);
          setNotice("");
          setSavedTicketId("");
          setAppealDetail("");
          setAppealTicketId("");
          setOpen(true);
        }}
      >{label}</button>
    ) : (
      <span className="text-xs text-muted-foreground">
        <Link className="underline" href="/login">Sign in to report</Link>
      </span>
    )}
    <Dialog open={open} onOpenChange={value => { if (!value) close(); }}>
      <DialogContent className="z-[80] max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Report content</DialogTitle>
          <DialogDescription>
            Your account details and report go to JOBSAGE support. Source evidence is limited to the assigned reviewer. Do not include passwords, payment details, or unrelated personal information.
          </DialogDescription>
        </DialogHeader>
        <label className="text-sm">
          Reason
          <select className="mt-1 block w-full rounded border bg-background p-2" value={reason} disabled={busy}
            onChange={event => setReason(event.target.value as (typeof REASONS)[number])}>
            {REASONS.map(value => <option key={value}>{value}</option>)}
          </select>
        </label>
        <label className="text-sm">
          Describe the issue (10–1,000 characters)
          <textarea className="mt-1 block w-full rounded border bg-background p-2" rows={4} maxLength={1000}
            value={detail} disabled={busy} onChange={event => setDetail(event.target.value)} />
        </label>
        {snapshot?.content && <>
          <label className="flex gap-2 text-sm">
            <input type="checkbox" checked={includeContent} disabled={busy}
              onChange={event => setIncludeContent(event.target.checked)} />
            Include up to 2,000 characters of the visible content
          </label>
          {includeContent && <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded border p-2 text-xs">
            {snapshot.content.slice(0, 2000)}
          </pre>}
        </>}
        {notice && <p role="status" className="text-sm">{notice}</p>}
        {!savedTicketId ? (
          <div className="flex justify-end gap-3">
            <button type="button" onClick={close} className="min-h-10 px-3 text-sm">Close</button>
            <button type="button" disabled={busy || detail.trim().length < 10} onClick={() => void submit()}
              className="min-h-10 rounded bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50">
              {busy ? "Sending…" : "Send report"}
            </button>
          </div>
        ) : (
          <section className="space-y-2 border-t pt-3" aria-labelledby="content-report-appeal-title">
            <h3 id="content-report-appeal-title" className="text-sm font-semibold">Request another review</h3>
            <p className="text-xs text-muted-foreground">The original report stays unchanged. Add what you think staff should reconsider.</p>
            {!appealTicketId && <>
              <textarea aria-label="Review request details" className="block w-full rounded border bg-background p-2 text-sm"
                rows={3} maxLength={1000} value={appealDetail} disabled={busy}
                onChange={event => setAppealDetail(event.target.value)} />
              <button type="button" disabled={busy || appealDetail.trim().length < 10} onClick={() => void submitAppeal()}
                className="min-h-10 rounded bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50">
                {busy ? "Sending…" : "Request review"}
              </button>
            </>}
            <button type="button" className="ml-3 min-h-10 text-sm underline" onClick={close}>Close</button>
          </section>
        )}
      </DialogContent>
    </Dialog>
  </>;
}
