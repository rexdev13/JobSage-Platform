import { describe, expect, it } from "vitest";
import type { CandidateMessage } from "@workspace/api-client-react";
import { buildThreads } from "./inboxThreads";

function supportMessage(id: number, supportTicketId: number, createdAt: string): CandidateMessage {
  return {
    id,
    recipientUserId: "candidate-1",
    messageText: `Reply ${id}`,
    subject: "Reply to your support inquiry: Password reset",
    isRead: false,
    messageType: "support",
    createdAt,
    supportTicketId,
    applicationId: null,
  } as unknown as CandidateMessage;
}

describe("candidate inbox support threads", () => {
  it("groups support replies by ticket and labels the thread as JOBSAGE Support", () => {
    const threads = buildThreads([
      supportMessage(2, 41, "2026-10-02T10:00:00.000Z"),
      supportMessage(1, 41, "2026-10-01T10:00:00.000Z"),
      supportMessage(3, 42, "2026-10-02T11:00:00.000Z"),
    ]);

    expect(threads).toHaveLength(2);
    const ticket41 = threads.find((thread) => thread.key === "support-41");
    expect(ticket41?.sender).toBe("JOBSAGE Support");
    expect(ticket41?.messages.map((message) => message.id)).toEqual([1, 2]);
    expect(ticket41?.latestMessage.id).toBe(2);
  });
});
