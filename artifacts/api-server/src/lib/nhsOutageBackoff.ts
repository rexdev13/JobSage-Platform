import { randomUUID } from "node:crypto";
import { db, nhsVacancyOutageBackoffsTable } from "@workspace/db";
import { and, eq, isNull, lte, or } from "drizzle-orm";

export const NHS_OUTAGE_BACKOFF_MS = 45 * 60 * 1000;
export const NHS_PROBE_LEASE_MS = 2 * 60 * 1000;

export type NhsProbeReservation =
  | { allowed: true; organisationKey: string; probeToken: string }
  | { allowed: false; retryAt: Date };

function organisationKey(organisationName: string): string {
  return organisationName.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Atomically reserve the one allowed NHS probe for an employer. An active
 * outage or in-flight probe returns a retry time without making another NHS
 * request, including when another API worker owns the reservation.
 */
export async function reserveNhsVacancyProbe(
  organisationName: string,
  now = new Date(),
): Promise<NhsProbeReservation> {
  const key = organisationKey(organisationName);
  const probeToken = randomUUID();
  const leaseUntil = new Date(now.getTime() + NHS_PROBE_LEASE_MS);
  const activeOutageOrLease = and(
    or(isNull(nhsVacancyOutageBackoffsTable.retryAfter), lte(nhsVacancyOutageBackoffsTable.retryAfter, now)),
    or(isNull(nhsVacancyOutageBackoffsTable.probeLeaseUntil), lte(nhsVacancyOutageBackoffsTable.probeLeaseUntil, now)),
  );

  const [reserved] = await db
    .insert(nhsVacancyOutageBackoffsTable)
    .values({
      organisationKey: key,
      probeToken,
      probeLeaseUntil: leaseUntil,
      retryAfter: null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: nhsVacancyOutageBackoffsTable.organisationKey,
      set: {
        probeToken,
        probeLeaseUntil: leaseUntil,
        retryAfter: null,
        updatedAt: now,
      },
      where: activeOutageOrLease,
    })
    .returning({ organisationKey: nhsVacancyOutageBackoffsTable.organisationKey });

  if (reserved) return { allowed: true, organisationKey: key, probeToken };

  const [active] = await db
    .select({
      retryAfter: nhsVacancyOutageBackoffsTable.retryAfter,
      probeLeaseUntil: nhsVacancyOutageBackoffsTable.probeLeaseUntil,
    })
    .from(nhsVacancyOutageBackoffsTable)
    .where(eq(nhsVacancyOutageBackoffsTable.organisationKey, key));

  return {
    allowed: false,
    retryAt: active?.retryAfter ?? active?.probeLeaseUntil ?? leaseUntil,
  };
}

export async function completeNhsVacancyProbe(
  reservation: Extract<NhsProbeReservation, { allowed: true }>,
): Promise<void> {
  await db
    .update(nhsVacancyOutageBackoffsTable)
    .set({ probeToken: null, probeLeaseUntil: null, retryAfter: null, updatedAt: new Date() })
    .where(
      and(
        eq(nhsVacancyOutageBackoffsTable.organisationKey, reservation.organisationKey),
        eq(nhsVacancyOutageBackoffsTable.probeToken, reservation.probeToken),
      ),
    );
}

/**
 * Promote the owned probe lease to the durable 45-minute outage cooldown.
 * Returning null means another worker has already replaced this expired lease,
 * so this worker must not emit a duplicate outage log.
 */
export async function failNhsVacancyProbe(
  reservation: Extract<NhsProbeReservation, { allowed: true }>,
  now = new Date(),
): Promise<Date | null> {
  const retryAfter = new Date(now.getTime() + NHS_OUTAGE_BACKOFF_MS);
  const [updated] = await db
    .update(nhsVacancyOutageBackoffsTable)
    .set({ probeToken: null, probeLeaseUntil: null, retryAfter, updatedAt: now })
    .where(
      and(
        eq(nhsVacancyOutageBackoffsTable.organisationKey, reservation.organisationKey),
        eq(nhsVacancyOutageBackoffsTable.probeToken, reservation.probeToken),
      ),
    )
    .returning({ retryAfter: nhsVacancyOutageBackoffsTable.retryAfter });
  return updated?.retryAfter ?? null;
}