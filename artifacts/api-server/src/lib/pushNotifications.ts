import { createHash, randomUUID } from "node:crypto";
import { and, eq, lte, sql } from "drizzle-orm";
import {
  db,
  pushDevicesTable,
  pushNotificationDeliveriesTable,
  pushNotificationOutboxTable,
} from "@workspace/db";
import type { NotificationCategory } from "@workspace/mobile-core";
import { decryptDeletionResource } from "./accountDeletion/crypto";
import { isPrivacyNotificationAllowed } from "./privacyAccess";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";
const MAX_SEND_BATCH = 100;
const MAX_RECEIPT_BATCH = 300;
const RECEIPT_WAIT_MS = 15 * 60_000;
const MAX_ATTEMPTS = 6;
const categories = new Set<NotificationCategory>([
  "messages", "interviews", "applications", "eligibility", "documents", "jobAlerts",
]);

const eventCopy: Record<NotificationCategory, { title: string; body: string; destination: string }> = {
  messages: { title: "New JOBSAGE message", body: "You have a new message.", destination: "/inbox" },
  interviews: { title: "Interview update", body: "Check your JOBSAGE calendar.", destination: "/calendar" },
  applications: { title: "Application update", body: "Your application has an update.", destination: "/applications" },
  eligibility: { title: "Readiness update", body: "Your eligibility information has an update.", destination: "/eligibility" },
  documents: { title: "Document update", body: "A document in your JOBSAGE account needs attention.", destination: "/documents" },
  jobAlerts: { title: "New job matches", body: "Review your saved job-alert updates.", destination: "/opportunities" },
};

export type ExpoTicket =
  | { status: "ok"; id: string }
  | { status: "error"; message?: string; details?: { error?: string } };
export type ExpoReceipt = { status: "ok" | "error"; details?: { error?: string } };
export const isPushDeliveryEnabled = () =>
  process.env.NODE_ENV === "production" && process.env.JOBSAGE_PUSH_DELIVERY_ENABLED === "true";

export interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  sound: "default";
  data: { destination: string; accountId: string };
  ttl: number;
  channelId: "default";
}

export function pushBackoffMs(attempt: number): number {
  const safeAttempt = Math.max(1, Math.min(MAX_ATTEMPTS, Math.floor(attempt)));
  return Math.min(60 * 60_000, 30_000 * 2 ** (safeAttempt - 1));
}

export function isRetryableExpoError(error: string | undefined): boolean {
  return error === "MessageRateExceeded" || error === "ExpoServerError" || error === "UnknownError";
}

export function buildSafePushMessage(
  category: NotificationCategory,
  token: string,
  accountId: string,
): ExpoPushMessage {
  const copy = eventCopy[category];
  return {
    to: token,
    title: copy.title,
    body: copy.body,
    sound: "default",
    data: { destination: copy.destination, accountId },
    ttl: 60 * 60,
    channelId: "default",
  };
}

export async function sendExpoPushBatch(
  messages: ExpoPushMessage[],
  fetcher: typeof fetch = fetch,
  accessToken = process.env.EXPO_ACCESS_TOKEN,
): Promise<ExpoTicket[]> {
  const tickets: ExpoTicket[] = [];
  for (let offset = 0; offset < messages.length; offset += MAX_SEND_BATCH) {
    const batch = messages.slice(offset, offset + MAX_SEND_BATCH);
    const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    const response = await fetcher(EXPO_PUSH_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(batch),
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw new Error("expo_push_http_error");
    const payload = await response.json() as { data?: ExpoTicket[] };
    if (!Array.isArray(payload.data) || payload.data.length !== batch.length) {
      throw new Error("expo_push_response_invalid");
    }
    tickets.push(...payload.data);
  }
  return tickets;
}

export async function fetchExpoReceipts(
  receiptIds: string[],
  fetcher: typeof fetch = fetch,
  accessToken = process.env.EXPO_ACCESS_TOKEN,
): Promise<Record<string, ExpoReceipt>> {
  const receipts: Record<string, ExpoReceipt> = {};
  for (let offset = 0; offset < receiptIds.length; offset += MAX_RECEIPT_BATCH) {
    const batch = receiptIds.slice(offset, offset + MAX_RECEIPT_BATCH);
    const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    const response = await fetcher(EXPO_RECEIPTS_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({ ids: batch }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw new Error("expo_receipt_http_error");
    const payload = await response.json() as { data?: Record<string, ExpoReceipt> };
    if (!payload.data || typeof payload.data !== "object") throw new Error("expo_receipt_response_invalid");
    Object.assign(receipts, payload.data);
  }
  return receipts;
}

export async function enqueuePushNotification(input: {
  eventKey: string;
  userId: string;
  category: NotificationCategory;
}): Promise<boolean> {
  if (!input.eventKey || input.eventKey.length > 180 || !input.userId || !categories.has(input.category)) {
    return false;
  }
  if (!await isPrivacyNotificationAllowed(input.userId, input.category)) return false;
  const [row] = await db.insert(pushNotificationOutboxTable).values({
    id: randomUUID(),
    eventKey: input.eventKey,
    userId: input.userId,
    category: input.category,
    destination: eventCopy[input.category].destination,
  }).onConflictDoNothing({ target: pushNotificationOutboxTable.eventKey }).returning({ id: pushNotificationOutboxTable.id });
  return !!row;
}

type ClaimedNotification = {
  id: string;
  user_id: string;
  category: NotificationCategory;
  destination: string;
  attempts: number;
};

type PushDeviceRecord = { tokenHash: string; tokenCiphertext: string };

async function updateNotification(id: string, values: Partial<typeof pushNotificationOutboxTable.$inferInsert>) {
  await db.update(pushNotificationOutboxTable).set(values).where(eq(pushNotificationOutboxTable.id, id));
}

async function claimPushNotifications(): Promise<ClaimedNotification[]> {
  const result = await db.execute(sql`
    WITH candidates AS (
      SELECT id FROM push_notification_outbox
      WHERE state IN ('queued','retry') AND available_at <= now()
        AND (lease_until IS NULL OR lease_until < now())
      ORDER BY created_at
      LIMIT 40
      FOR UPDATE SKIP LOCKED
    )
    UPDATE push_notification_outbox AS event
    SET state='sending', attempts=event.attempts+1, lease_until=now()+interval '2 minutes'
    FROM candidates
    WHERE event.id=candidates.id
    RETURNING event.id, event.user_id, event.category, event.destination, event.attempts
  `);
  return result.rows as ClaimedNotification[];
}

async function processNotification(event: ClaimedNotification): Promise<void> {
  if (!await isPrivacyNotificationAllowed(event.user_id, event.category)) {
    await updateNotification(event.id, { state: "skipped", leaseUntil: null, lastErrorCode: "preference_or_account_disabled" });
    return;
  }

  const devices = await db.select({
    tokenHash: pushDevicesTable.tokenHash,
    tokenCiphertext: pushDevicesTable.tokenCiphertext,
  }).from(pushDevicesTable).where(eq(pushDevicesTable.userId, event.user_id));
  if (!devices.length) {
    await updateNotification(event.id, { state: "skipped", leaseUntil: null, lastErrorCode: "no_registered_devices" });
    return;
  }

  const previous = await db.select({
    tokenHash: pushNotificationDeliveriesTable.tokenHash,
    state: pushNotificationDeliveriesTable.state,
    availableAt: pushNotificationDeliveriesTable.availableAt,
  }).from(pushNotificationDeliveriesTable)
    .where(eq(pushNotificationDeliveriesTable.notificationId, event.id));
  const priorByHash = new Map(previous.map((delivery) => [delivery.tokenHash, delivery]));
  const sendable: Array<{ device: PushDeviceRecord; token: string }> = [];
  for (const device of devices) {
    const previousDelivery = priorByHash.get(device.tokenHash);
    if (previousDelivery && previousDelivery.state !== "retry") continue;
    if (previousDelivery && previousDelivery.availableAt > new Date()) continue;
    try {
      sendable.push({ device, token: decryptDeletionResource(device.tokenCiphertext) });
    } catch {
      await db.update(pushNotificationDeliveriesTable).set({
        state: "retry",
        attempts: sql`${pushNotificationDeliveriesTable.attempts} + 1`,
        availableAt: new Date(Date.now() + pushBackoffMs(event.attempts)),
        lastErrorCode: "token_decryption_failed",
      }).where(and(
        eq(pushNotificationDeliveriesTable.notificationId, event.id),
        eq(pushNotificationDeliveriesTable.tokenHash, device.tokenHash),
      ));
    }
  }
  if (!sendable.length) {
    const anyPending = previous.some((delivery) => delivery.state === "receipt_pending" || delivery.state === "delivered");
    await updateNotification(event.id, {
      state: anyPending ? "sent" : event.attempts >= MAX_ATTEMPTS ? "failed" : "retry",
      leaseUntil: null,
      availableAt: new Date(Date.now() + pushBackoffMs(event.attempts)),
    });
    return;
  }

  try {
    const tickets = await sendExpoPushBatch(sendable.map(({ token }) =>
      buildSafePushMessage(event.category, token, event.user_id)));
    const retryAt = new Date(Date.now() + pushBackoffMs(event.attempts));
    for (let index = 0; index < tickets.length; index++) {
      const ticket = tickets[index];
      const device = sendable[index].device;
      if (ticket.status === "ok") {
        await db.insert(pushNotificationDeliveriesTable).values({
          id: randomUUID(),
          notificationId: event.id,
          tokenHash: device.tokenHash,
          receiptId: ticket.id,
          state: "receipt_pending",
          attempts: event.attempts,
          availableAt: new Date(Date.now() + RECEIPT_WAIT_MS),
        }).onConflictDoUpdate({
          target: [pushNotificationDeliveriesTable.notificationId, pushNotificationDeliveriesTable.tokenHash],
          set: { receiptId: ticket.id, state: "receipt_pending", availableAt: new Date(Date.now() + RECEIPT_WAIT_MS) },
        });
      } else if (ticket.details?.error === "DeviceNotRegistered") {
        await db.delete(pushDevicesTable).where(and(
          eq(pushDevicesTable.userId, event.user_id),
          eq(pushDevicesTable.tokenHash, device.tokenHash),
        ));
        await db.insert(pushNotificationDeliveriesTable).values({
          id: randomUUID(), notificationId: event.id, tokenHash: device.tokenHash,
          state: "invalid", attempts: event.attempts, availableAt: retryAt,
          lastErrorCode: "DeviceNotRegistered",
        }).onConflictDoUpdate({
          target: [pushNotificationDeliveriesTable.notificationId, pushNotificationDeliveriesTable.tokenHash],
          set: { state: "invalid", checkedAt: new Date(), lastErrorCode: "DeviceNotRegistered" },
        });
      } else {
        await db.insert(pushNotificationDeliveriesTable).values({
          id: randomUUID(), notificationId: event.id, tokenHash: device.tokenHash,
          state: "retry", attempts: event.attempts, availableAt: retryAt,
          lastErrorCode: "expo_ticket_error",
        }).onConflictDoUpdate({
          target: [pushNotificationDeliveriesTable.notificationId, pushNotificationDeliveriesTable.tokenHash],
          set: { state: "retry", attempts: event.attempts, availableAt: retryAt, lastErrorCode: "expo_ticket_error" },
        });
      }
    }
    const latest = await db.select({ state: pushNotificationDeliveriesTable.state })
      .from(pushNotificationDeliveriesTable)
      .where(eq(pushNotificationDeliveriesTable.notificationId, event.id));
    const hasRetry = latest.some((delivery) => delivery.state === "retry");
    await updateNotification(event.id, {
      state: hasRetry ? (event.attempts >= MAX_ATTEMPTS ? "failed" : "retry") : "sent",
      leaseUntil: null,
      availableAt: retryAt,
      sentAt: hasRetry ? null : new Date(),
      lastErrorCode: hasRetry ? "expo_ticket_error" : null,
    });
  } catch {
    await updateNotification(event.id, {
      state: event.attempts >= MAX_ATTEMPTS ? "failed" : "retry",
      leaseUntil: null,
      availableAt: new Date(Date.now() + pushBackoffMs(event.attempts)),
      lastErrorCode: "expo_transport_error",
    });
  }
}

async function processPendingReceipts(): Promise<void> {
  const due = await db.select({
    id: pushNotificationDeliveriesTable.id,
    receiptId: pushNotificationDeliveriesTable.receiptId,
    tokenHash: pushNotificationDeliveriesTable.tokenHash,
    notificationId: pushNotificationDeliveriesTable.notificationId,
    attempts: pushNotificationDeliveriesTable.attempts,
    userId: pushNotificationOutboxTable.userId,
  }).from(pushNotificationDeliveriesTable)
    .innerJoin(pushNotificationOutboxTable, eq(pushNotificationOutboxTable.id, pushNotificationDeliveriesTable.notificationId))
    .where(and(
      eq(pushNotificationDeliveriesTable.state, "receipt_pending"),
      lte(pushNotificationDeliveriesTable.availableAt, new Date()),
    ))
    .limit(MAX_RECEIPT_BATCH);
  const receiptIds = due.flatMap((row) => row.receiptId ? [row.receiptId] : []);
  if (!receiptIds.length) return;

  let receipts: Record<string, ExpoReceipt>;
  try {
    receipts = await fetchExpoReceipts(receiptIds);
  } catch {
    for (const delivery of due) {
      await db.update(pushNotificationDeliveriesTable).set({
        attempts: delivery.attempts + 1,
        availableAt: new Date(Date.now() + RECEIPT_WAIT_MS),
        lastErrorCode: "receipt_transport_error",
      }).where(eq(pushNotificationDeliveriesTable.id, delivery.id));
    }
    return;
  }

  for (const delivery of due) {
    if (!delivery.receiptId) continue;
    const receipt = receipts[delivery.receiptId];
    if (!receipt) {
      await db.update(pushNotificationDeliveriesTable).set({
        availableAt: new Date(Date.now() + RECEIPT_WAIT_MS),
        lastErrorCode: "receipt_not_ready",
      }).where(eq(pushNotificationDeliveriesTable.id, delivery.id));
      continue;
    }
    const invalidToken = receipt.status === "error" && receipt.details?.error === "DeviceNotRegistered";
    const retryable = receipt.status === "error" && isRetryableExpoError(receipt.details?.error);
    if (invalidToken) {
      await db.delete(pushDevicesTable).where(and(
        eq(pushDevicesTable.userId, delivery.userId),
        eq(pushDevicesTable.tokenHash, delivery.tokenHash),
      ));
    }
    const canRetry = retryable && delivery.attempts < MAX_ATTEMPTS;
    await db.update(pushNotificationDeliveriesTable).set({
      state: receipt.status === "ok" ? "delivered" : invalidToken ? "invalid" : canRetry ? "retry" : "failed",
      receiptId: canRetry ? null : delivery.receiptId,
      attempts: canRetry ? delivery.attempts + 1 : delivery.attempts,
      availableAt: canRetry ? new Date(Date.now() + pushBackoffMs(delivery.attempts + 1)) : new Date(),
      checkedAt: new Date(),
      lastErrorCode: invalidToken ? "DeviceNotRegistered" : retryable ? "expo_receipt_retry" : receipt.status === "error" ? "expo_receipt_error" : null,
    }).where(eq(pushNotificationDeliveriesTable.id, delivery.id));
    if (canRetry) {
      await updateNotification(delivery.notificationId, {
        state: "retry",
        leaseUntil: null,
        availableAt: new Date(Date.now() + pushBackoffMs(delivery.attempts + 1)),
        lastErrorCode: "expo_receipt_retry",
      });
    }
  }
}

let worker: ReturnType<typeof setInterval> | null = null;
let running = false;

export async function runPushDeliveryCycle(): Promise<void> {
  if (running || !isPushDeliveryEnabled()) return;
  running = true;
  try {
    await processPendingReceipts();
    const claimed = await claimPushNotifications();
    for (const event of claimed) await processNotification(event);
  } finally {
    running = false;
  }
}

/** Sending is opt-in at deployment; development/test never contacts Expo by default. */
export function startPushDeliveryWorker(): void {
  if (!isPushDeliveryEnabled() || worker) return;
  worker = setInterval(() => {
    void runPushDeliveryCycle().catch(() => {
      // Individual events are retryable; never log tokens, message content, or provider responses.
    });
  }, 30_000);
  worker.unref?.();
}

export function hashPushToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
