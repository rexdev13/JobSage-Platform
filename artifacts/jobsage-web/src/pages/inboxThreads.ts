import type { CandidateMessage } from "@workspace/api-client-react";

export interface InboxThread {
  key: string;
  applicationId: number | null;
  messages: CandidateMessage[];
  latestMessage: CandidateMessage;
  unreadCount: number;
  sender: string;
}

export function buildThreads(messages: CandidateMessage[]): InboxThread[] {
  const threadMap = new Map<string, CandidateMessage[]>();

  for (const msg of messages) {
    const isSupport = msg.messageType === "support" || msg.supportTicketId != null;
    const key = isSupport
      ? `support-${msg.supportTicketId ?? msg.id}`
      : msg.applicationId != null
        ? `app-${msg.applicationId}`
        : `msg-${msg.id}`;
    if (!threadMap.has(key)) threadMap.set(key, []);
    threadMap.get(key)!.push(msg);
  }

  const threads: InboxThread[] = [];
  for (const [key, msgs] of threadMap.entries()) {
    const sorted = [...msgs].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const latest = sorted[0];
    const unreadCount = msgs.filter((message) => !message.isRead).length;
    const sender =
      latest.messageType === "support" || latest.supportTicketId != null
        ? "JOBSAGE Support"
        : latest.messageType === "system"
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
