import { useState } from "react";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { useGetCandidateMessages, useMarkMessageRead, useArchiveMessage, getGetCandidateMessagesQueryKey, getGetInboxUnreadCountQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Inbox, MailOpen, Archive, Building2, Info } from "lucide-react";
import { cn } from "@/components/ui-enhanced";
import type { CandidateMessage } from "@workspace/api-zod";

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
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const { data, isLoading } = useGetCandidateMessages();
  const messages: CandidateMessage[] = data?.messages ?? [];
  const activeMessages = messages.filter((m) => !m.archivedAt);
  const unread = activeMessages.filter((m) => !m.isRead).length;

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
        setSelectedId(null);
      },
    },
  });

  const selected = activeMessages.find((m) => m.id === selectedId) ?? null;

  function handleSelect(msg: CandidateMessage) {
    setSelectedId(msg.id);
    if (!msg.isRead) {
      markRead({ id: msg.id });
    }
  }

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <AppSidebar />
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="h-16 border-b border-border flex items-center px-6 shrink-0">
          <Inbox className="w-5 h-5 text-primary mr-2" />
          <h1 className="text-lg font-display font-bold text-foreground">Inbox</h1>
          {unread > 0 && (
            <span className="ml-2 inline-flex items-center justify-center px-2 py-0.5 rounded-full text-xs font-bold bg-primary text-primary-foreground">
              {unread}
            </span>
          )}
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Message list */}
          <div className="w-80 border-r border-border flex flex-col overflow-hidden shrink-0">
            {isLoading ? (
              <div className="flex items-center justify-center flex-1 text-muted-foreground text-sm">Loading...</div>
            ) : activeMessages.length === 0 ? (
              <div className="flex flex-col items-center justify-center flex-1 gap-3 text-muted-foreground px-6 text-center">
                <Inbox className="w-10 h-10 opacity-30" />
                <p className="text-sm">Your inbox is empty.</p>
                <p className="text-xs">Employer messages and application updates will appear here.</p>
              </div>
            ) : (
              <div className="overflow-y-auto flex-1">
                {activeMessages.map((msg) => (
                  <button
                    key={msg.id}
                    onClick={() => handleSelect(msg)}
                    className={cn(
                      "w-full text-left px-4 py-3 border-b border-border transition-colors",
                      selectedId === msg.id
                        ? "bg-primary/5 border-l-2 border-l-primary"
                        : "hover:bg-muted/50",
                      !msg.isRead && "bg-primary/[0.03]"
                    )}
                  >
                    <div className="flex items-start gap-2">
                      <div className="mt-0.5 shrink-0">
                        {msg.messageType === "system" ? (
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
                          <p className={cn("text-xs truncate", !msg.isRead ? "font-bold text-foreground" : "font-medium text-muted-foreground")}>
                            {msg.messageType === "system" ? "JOBSAGE" : msg.companyName ?? "Employer"}
                          </p>
                          <span className="text-[10px] text-muted-foreground shrink-0">{formatDate(msg.createdAt)}</span>
                        </div>
                        <p className={cn("text-xs truncate mt-0.5", !msg.isRead ? "font-semibold text-foreground" : "text-muted-foreground")}>
                          {msg.subject}
                        </p>
                        <p className="text-[11px] text-muted-foreground truncate mt-0.5">{msg.messageText}</p>
                      </div>
                      {!msg.isRead && (
                        <div className="w-2 h-2 rounded-full bg-primary mt-1.5 shrink-0" />
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Message detail */}
          <div className="flex-1 overflow-y-auto">
            {selected ? (
              <div className="max-w-2xl mx-auto py-8 px-8">
                <div className="flex items-start justify-between mb-6">
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      "w-10 h-10 rounded-full flex items-center justify-center",
                      selected.messageType === "system" ? "bg-blue-100 dark:bg-blue-900/30" : "bg-primary/10"
                    )}>
                      {selected.messageType === "system"
                        ? <Info className="w-5 h-5 text-blue-500" />
                        : <Building2 className="w-5 h-5 text-primary" />}
                    </div>
                    <div>
                      <p className="font-semibold text-sm text-foreground">
                        {selected.messageType === "system" ? "JOBSAGE" : selected.companyName ?? "Employer"}
                      </p>
                      {selected.messageType === "employer" && selected.industry && (
                        <p className="text-xs text-muted-foreground">{selected.industry}</p>
                      )}
                      <p className="text-xs text-muted-foreground">{formatDate(selected.createdAt)}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => archive({ id: selected.id })}
                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-destructive transition-colors px-3 py-1.5 rounded-lg hover:bg-destructive/10"
                  >
                    <Archive className="w-4 h-4" />
                    Archive
                  </button>
                </div>

                <h2 className="text-xl font-display font-bold text-foreground mb-1">{selected.subject}</h2>
                {selected.isRead && (
                  <div className="flex items-center gap-1 text-[11px] text-muted-foreground mb-4">
                    <MailOpen className="w-3 h-3" />
                    Read
                  </div>
                )}

                <div className="mt-4 bg-muted/30 rounded-xl p-5 border border-border">
                  <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{selected.messageText}</p>
                </div>

                {selected.messageType === "system" && (
                  <p className="text-xs text-muted-foreground mt-4 italic">
                    This is an automated status update from JOBSAGE.
                  </p>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
                <Inbox className="w-12 h-12 opacity-20" />
                <p className="text-sm">Select a message to read it</p>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
