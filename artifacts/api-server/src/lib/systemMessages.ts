import { db, candidateMessagesTable } from "@workspace/db";
import { isMessageSenderBlocked } from "./messageSenderBlocks";
import { enqueuePushNotification } from "./pushNotifications";
import { logger } from "./logger";

const STAGE_SUBJECT: Record<string, string> = {
  applied: "Application received",
  shortlisted: "You've been shortlisted!",
  interview: "Interview invitation",
  offer: "Offer made",
  rejected: "Application declined",
  no_response: "Application status update",
};

const STAGE_BODY: Record<string, (roleTitle: string, companyName: string) => string> = {
  applied: (role, _co) => `Your application for ${role} has been received and is under review.`,
  shortlisted: (role, co) => `Great news! ${co} has shortlisted you for the ${role} position.`,
  interview: (role, co) => `${co} would like to invite you for an interview for the ${role} role. They will be in touch with further details.`,
  offer: (role, co) => `Congratulations! ${co} has made you an offer for the ${role} position. Please check your email for details.`,
  rejected: (role, co) => `Thank you for your interest in the ${role} role at ${co}. Unfortunately, on this occasion you have not been successful.`,
  no_response: (role, _co) => `The status of your application for ${role} has been updated.`,
};

export async function createSystemMessage({
  recipientUserId,
  applicationId,
  vacancyId,
  stage,
  roleTitle,
  companyName,
  senderEmployerProfileId,
}: {
  recipientUserId: string;
  applicationId?: number;
  vacancyId?: number;
  stage: string;
  roleTitle: string;
  companyName: string;
  senderEmployerProfileId?: number;
}): Promise<void> {
  if (senderEmployerProfileId && await isMessageSenderBlocked(recipientUserId, { senderEmployerProfileId })) return;
  const subject = STAGE_SUBJECT[stage] ?? "Application update";
  const bodyFn = STAGE_BODY[stage] ?? ((_r: string, _c: string) => `Your application status has been updated to: ${stage}.`);
  const messageText = bodyFn(roleTitle, companyName);

  const [message] = await db.insert(candidateMessagesTable).values({
    senderEmployerProfileId: senderEmployerProfileId ?? null,
    recipientUserId,
    applicationId: applicationId ?? null,
    vacancyId: vacancyId ?? null,
    messageType: "system",
    subject,
    messageText,
  }).returning({ id: candidateMessagesTable.id });
  if (message) {
    const category = ["interview", "interview_invited", "interview_rescheduled", "interview_cancelled"].includes(stage)
      ? "interviews" as const
      : "applications" as const;
    void enqueuePushNotification({
      eventKey: `system-message:${message.id}`,
      userId: recipientUserId,
      category,
    }).catch(() => logger.warn({ category }, "Could not queue a system push notification"));
  }
}

export async function createApplicationReceivedMessage({
  recipientUserId,
  applicationId,
  roleTitle,
}: {
  recipientUserId: string;
  applicationId: number;
  roleTitle: string;
}): Promise<void> {
  const [message] = await db.insert(candidateMessagesTable).values({
    senderEmployerProfileId: null,
    recipientUserId,
    applicationId,
    vacancyId: null,
    messageType: "system",
    subject: "Application received",
    messageText: `Your application for ${roleTitle} has been received and is under review. We'll notify you of any updates here.`,
  }).returning({ id: candidateMessagesTable.id });
  if (message) {
    void enqueuePushNotification({
      eventKey: `application-received:${message.id}`,
      userId: recipientUserId,
      category: "applications",
    }).catch(() => logger.warn({ category: "applications" }, "Could not queue an application push notification"));
  }
}
