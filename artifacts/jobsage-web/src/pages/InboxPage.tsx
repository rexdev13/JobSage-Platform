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
import { Inbox, MailOpen, Archive, Building2, Info, ChevronRight } from "lucide-react";
import { cn } from "@/components/ui-enhanced";
import type { CandidateMessage } from "@workspace/api-client-react";

const STAGE_BADGE: Record<string, { label: string; className: string }> = {
  "Application received":                   { label: "Applied",       className: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300" },
  "Application submitted via Smart Apply":  { label: "Smart Apply",   className: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300" },
  "You've been shortlisted!":               { label: "Shortlisted",   className: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300" },
  "Interview invitation":                   { label: "Interview",     className: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300" },
  "Offer made":                             { label: "Offer",         className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300" },
  "Application update":                     { label: "Update",        className: "bg-muted text-muted-foreground" },
  "Application status update":              { label: "Update",        className: "bg-muted text-muted-foreground" },
  "Your profile was viewed by an employer": { label: "Profile viewed", className: "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300" },
};

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

interface Thread {
  key: string;
  applicationId: number | null;
  messages: CandidateMessage[];
  latestMessage: CandidateMessage;
  unreadCount: number;
  sender: string;
}

function buildThreads(messages: CandidateMessage[]): Thread[] {
  const threadMap = new Map<string, CandidateMessage[]>();

  for (const msg of messages) {
    const key = msg.applicationId != null ? `app-${msg.applicationId}` : `msg-${msg.id}`;
    if (!threadMap.has(key)) threadMap.set(key, []);
    threadMap.get(key)!.push(msg);
  }

  const threads: Thread[] = [];
  for (const [key, msgs] of threadMap.entries()) {
    const sorted = [...msgs].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const latest = sorted[0];
    const unreadCount = msgs.filter((m) => !m.isRead).length;
    const sender =
      latest.messageType === "system"
        ? "JOBSAGE"
        : latest.companyName ?? "Employer";

    threads.push({
      key,
      applicationId: latest.applicationId ?? null,
      messages: [...msgs].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
      latestMessage: latest,
      unreadCount,
      sender,
    });
  }

  threads.sort((a, b) => {
    if (a.unreadCount > 0 && b.unreadCount === 0) return -1;
    if (a.unreadCount === 0 && b.unreadCount > 0) return 1;
    return new Date(b.latestMessage.createdAt).getTime() - new Date(a.latestMessage.createdAt).getTime();
  });

  return threads;
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

  function handleSelectThread(thread: Thread) {
    setSelectedThread(thread.key);
    thread.messages.filter((m) => !m.isRead).forEach((m) => markRead({ id: m.id }));
  }

  function handleArchiveThread(thread: Thread) {
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
                          {latest.messageType === "system" ? (
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
                    const stageBadge = isSystem ? STAGE_BADGE[msg.subject] : undefined;
                    return (
                      <div key={msg.id} className="bg-muted/30 rounded-xl p-5 border border-border">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <div className={cn(
                              "w-7 h-7 rounded-full flex items-center justify-center",
                              isSystem ? "bg-blue-100 dark:bg-blue-900/30" : "bg-primary/10"
                            )}>
                              {isSystem ? <Info className="w-4 h-4 text-blue-500" /> : <Building2 className="w-4 h-4 text-primary" />}
                            </div>
                            <div>
                              <p className="text-xs font-semibold text-foreground">
                                {isSystem ? "JOBSAGE" : msg.companyName ?? "Employer"}
                              </p>
                              <p className="text-[10px] text-muted-foreground">{formatDate(msg.createdAt)}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {stageBadge && (
                              <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wide", stageBadge.className)}>
                                {stageBadge.label}
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
