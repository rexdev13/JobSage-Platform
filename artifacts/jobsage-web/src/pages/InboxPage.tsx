import { useState, useMemo } from "react";
import { AppSidebar } from "@/components/layout/AppSidebar";
import {
  useGetCandidateMessages,
  useMarkMessageRead,
  useArchiveMessage,
  getGetCandidateMessagesQueryKey,
  getGetInboxUnreadCountQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Inbox, MailOpen, Archive, Building2, Info, ChevronRight, Send, Reply, CalendarCheck, Trophy, LifeBuoy } from "lucide-react";
import { cn } from "@/components/ui-enhanced";
import type { CandidateMessage } from "@workspace/api-client-react";
import { buildThreads, type InboxThread } from "./inboxThreads";

const STAGE_BADGE: Record<string, { label: string; className: string }> = {
  "Application received":                   { label: "Applied",       className: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300" },
  "Application submitted via Smart Apply":  { label: "Smart Apply",   className: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300" },
  "You've been shortlisted!":               { label: "Shortlisted",   className: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300" },
  "Interview invitation":                   { label: "Interview",     className: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300" },
  "Offer made":                             { label: "Offer",         className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300" },
  "Application update":                     { label: "Update",        className: "bg-muted text-muted-foreground" },
  "Application status update":              { label: "Update",        className: "bg-muted text-muted-foreground" },
  "Your profile was viewed by an employer": { label: "Profile viewed", className: "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300" },
  "Speculative CV sent":                    { label: "CV Sent",        className: "bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300" },
};

/** Classify an employer reply message for display purposes */
function getEmployerReplyMeta(subject: string): { icon: React.ElementType; badge: { label: string; className: string } } {
  const s = subject.toLowerCase();
  if (s.includes("interview")) return {
    icon: CalendarCheck,
    badge: { label: "Interview", className: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300" },
  };
  if (s.includes("offer")) return {
    icon: Trophy,
    badge: { label: "Offer", className: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300" },
  };
  if (s.includes("update")) return {
    icon: Reply,
    badge: { label: "Update", className: "bg-muted text-muted-foreground" },
  };
  return {
    icon: Reply,
    badge: { label: "Employer Reply", className: "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300" },
  };
}

function formatDate(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diff = (now.getTime() - d.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 172800) return "Yesterday";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export default function InboxPage() {
  const qc = useQueryClient();
  const [selectedThread, setSelectedThread] = useState<string | null>(null);

  const { data, isLoading } = useGetCandidateMessages();
  const messages: CandidateMessage[] = data?.messages ?? [];
  const threads = useMemo(() => buildThreads(messages), [messages]);
  const totalUnread = messages.filter((m) => !m.isRead).length;

  const { mutate: markRead } = useMarkMessageRead({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetCandidateMessagesQueryKey() });
        qc.invalidateQueries({ queryKey: getGetInboxUnreadCountQueryKey() });
      },
    },
  });

  const { mutate: archive } = useArchiveMessage({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetCandidateMessagesQueryKey() });
        qc.invalidateQueries({ queryKey: getGetInboxUnreadCountQueryKey() });
        setSelectedThread(null);
      },
    },
  });

  const activeThread = threads.find((t) => t.key === selectedThread) ?? null;

  function handleSelectThread(thread: InboxThread) {
    setSelectedThread(thread.key);
    thread.messages.filter((m) => !m.isRead).forEach((m) => markRead({ id: m.id }));
  }

  function handleArchiveThread(thread: InboxThread) {
    thread.messages.forEach((m) => archive({ id: m.id }));
  }

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <AppSidebar />
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="h-16 border-b border-border flex items-center px-6 shrink-0">
          <Inbox className="w-5 h-5 text-primary mr-2" />
          <h1 className="text-lg font-display font-bold text-foreground">Messages</h1>
          {totalUnread > 0 && (
            <span className="ml-2 inline-flex items-center justify-center px-2 py-0.5 rounded-full text-xs font-bold bg-primary text-primary-foreground">
              {totalUnread}
            </span>
          )}
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Thread list */}
          <div className="w-80 border-r border-border flex flex-col overflow-hidden shrink-0">
            {isLoading ? (
              <div className="flex items-center justify-center flex-1 text-muted-foreground text-sm">Loading…</div>
            ) : threads.length === 0 ? (
              <div className="flex flex-col items-center justify-center flex-1 gap-3 text-muted-foreground px-6 text-center">
                <Inbox className="w-10 h-10 opacity-30" />
                <p className="text-sm">Your inbox is empty.</p>
                <p className="text-xs">Employer messages and application updates will appear here.</p>
              </div>
            ) : (
              <div className="overflow-y-auto flex-1">
                {threads.map((thread) => {
                  const latest = thread.latestMessage;
                  const isActive = selectedThread === thread.key;
                  const isSupport = latest.messageType === "support" || latest.supportTicketId != null;
                  const badge = STAGE_BADGE[latest.subject];
                  return (
                    <button
                      key={thread.key}
                      onClick={() => handleSelectThread(thread)}
                      className={cn(
                        "w-full text-left px-4 py-3 border-b border-border transition-colors",
                        isActive ? "bg-primary/5 border-l-2 border-l-primary" : "hover:bg-muted/50",
                        thread.unreadCount > 0 && "bg-primary/[0.03]"
                      )}
                    >
                      <div className="flex items-start gap-2">
                        <div className="mt-0.5 shrink-0">
                          {isSupport ? (
                            <div className="w-7 h-7 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                              <LifeBuoy className="w-4 h-4 text-emerald-700 dark:text-emerald-300" />
                            </div>
                          ) : latest.messageType === "system" && latest.subject === "Speculative CV sent" ? (
                            <div className="w-7 h-7 rounded-full bg-teal-100 dark:bg-teal-900/30 flex items-center justify-center">
                              <Send className="w-4 h-4 text-teal-600" />
                            </div>
                          ) : latest.messageType === "employer_reply" ? (() => {
                            const { icon: ReplyIcon } = getEmployerReplyMeta(latest.subject);
                            return (
                              <div className="w-7 h-7 rounded-full bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center">
                                <ReplyIcon className="w-4 h-4 text-violet-600" />
                              </div>
                            );
                          })() : latest.messageType === "system" ? (
                            <div className="w-7 h-7 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                              <Info className="w-4 h-4 text-blue-500" />
                            </div>
                          ) : (
                            <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center">
                              <Building2 className="w-4 h-4 text-primary" />
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-1">
                            <p className={cn("text-xs truncate", thread.unreadCount > 0 ? "font-bold text-foreground" : "font-medium text-muted-foreground")}>
                              {thread.sender}
                            </p>
                            <span className="text-[10px] text-muted-foreground shrink-0">{formatDate(latest.createdAt)}</span>
                          </div>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <p className={cn("text-xs truncate", thread.unreadCount > 0 ? "font-semibold text-foreground" : "text-muted-foreground")}>
                              {latest.subject}
                            </p>
                            {latest.messageType === "system" && badge && (
                              <span className={cn("shrink-0 inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wide", badge.className)}>
                                {badge.label}
                              </span>
                            )}
                            {isSupport && (
                              <span className="shrink-0 inline-flex items-center rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300">
                                JOBSAGE Support
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-muted-foreground truncate mt-0.5">{latest.messageText}</p>
                          {thread.messages.length > 1 && (
                            <p className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-0.5">
                              <ChevronRight className="w-3 h-3" />
                              {thread.messages.length} messages in thread
                            </p>
                          )}
                        </div>
                        {thread.unreadCount > 0 && (
                          <span className="ml-auto shrink-0 mt-1 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold bg-primary text-primary-foreground">
                            {thread.unreadCount}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Thread detail */}
          <div className="flex-1 overflow-y-auto">
            {activeThread ? (
              <div className="max-w-2xl mx-auto py-8 px-8">
                <div className="flex items-start justify-between mb-6">
                  <div>
                    <p className="font-semibold text-base text-foreground">{activeThread.sender}</p>
                    {activeThread.latestMessage.messageType === "employer" && activeThread.latestMessage.industry && (
                      <p className="text-xs text-muted-foreground">{activeThread.latestMessage.industry}</p>
                    )}
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {activeThread.messages.length} message{activeThread.messages.length !== 1 ? "s" : ""}
                    </p>
                  </div>
                  <button
                    onClick={() => handleArchiveThread(activeThread)}
                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-destructive transition-colors px-3 py-1.5 rounded-lg hover:bg-destructive/10"
                  >
                    <Archive className="w-4 h-4" />
                    Archive thread
                  </button>
                </div>

                <div className="space-y-4">
                  {activeThread.messages.map((msg) => {
                    const isSystem = msg.messageType === "system";
                    const isEmployerReply = msg.messageType === "employer_reply";
                    const isSupport = msg.messageType === "support" || msg.supportTicketId != null;
                    const stageBadge = isSystem ? STAGE_BADGE[msg.subject] : undefined;
                    const replyMeta = isEmployerReply ? getEmployerReplyMeta(msg.subject) : null;
                    const ReplyIcon = replyMeta?.icon;
                    return (
                      <div key={msg.id} className={cn(
                        "rounded-xl p-5 border",
                        isSupport
                          ? "bg-emerald-50/60 dark:bg-emerald-900/10 border-emerald-200 dark:border-emerald-800/50"
                          : isEmployerReply
                          ? "bg-violet-50/50 dark:bg-violet-900/10 border-violet-200 dark:border-violet-800/50"
                          : "bg-muted/30 border-border"
                      )}>
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <div className={cn(
                              "w-7 h-7 rounded-full flex items-center justify-center",
                              isSupport
                                ? "bg-emerald-100 dark:bg-emerald-900/30"
                                : isEmployerReply
                                ? "bg-violet-100 dark:bg-violet-900/30"
                                : isSystem && msg.subject === "Speculative CV sent"
                                ? "bg-teal-100 dark:bg-teal-900/30"
                                : isSystem
                                ? "bg-blue-100 dark:bg-blue-900/30"
                                : "bg-primary/10"
                            )}>
                              {isSupport
                                ? <LifeBuoy className="w-4 h-4 text-emerald-700 dark:text-emerald-300" />
                                : isEmployerReply && ReplyIcon
                                ? <ReplyIcon className="w-4 h-4 text-violet-600" />
                                : isSystem && msg.subject === "Speculative CV sent"
                                ? <Send className="w-4 h-4 text-teal-600" />
                                : isSystem
                                ? <Info className="w-4 h-4 text-blue-500" />
                                : <Building2 className="w-4 h-4 text-primary" />
                              }
                            </div>
                            <div>
                              <p className="text-xs font-semibold text-foreground">
                                {isSupport ? "JOBSAGE Support" : isSystem ? "JOBSAGE" : (msg.companyName ?? "Employer")}
                              </p>
                              <p className="text-[10px] text-muted-foreground">{formatDate(msg.createdAt)}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {replyMeta?.badge && (
                              <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wide", replyMeta.badge.className)}>
                                {replyMeta.badge.label}
                              </span>
                            )}
                            {stageBadge && (
                              <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wide", stageBadge.className)}>
                                {stageBadge.label}
                              </span>
                            )}
                            {isSupport && (
                              <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300">
                                JOBSAGE Support
                              </span>
                            )}
                            {msg.isRead && (
                              <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                                <MailOpen className="w-3 h-3" /> Read
                              </span>
                            )}
                          </div>
                        </div>
                        <h4 className="text-sm font-semibold text-foreground mb-2">{msg.subject}</h4>
                        <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{msg.messageText}</p>
                      </div>
                    );
                  })}
                </div>

                {activeThread.latestMessage.messageType === "system" && (
                  <p className="text-xs text-muted-foreground mt-4 italic">
                    System messages are automated updates from JOBSAGE.
                  </p>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
                <Inbox className="w-12 h-12 opacity-20" />
                <p className="text-sm">Select a conversation to read it</p>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
