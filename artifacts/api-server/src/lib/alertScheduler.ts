import cron from "node-cron";
import { db } from "@workspace/db";
import {
  profilesTable,
  rolesTable,
  decisionRecordsTable,
  usersTable,
  jobAlertVacancyDeliveriesTable,
} from "@workspace/db";
import { eq, desc, and, gt, inArray, isNull } from "drizzle-orm";
import { sendJobAlertEmail, type AlertRole } from "./email";
import {
  fetchSponsorVacanciesAsRoles,
  roleDedupKey,
  SPONSOR_VACANCY_ID_OFFSET,
} from "./sponsorVacancyRoles";

const REGISTERED_STATUSES = ["registered", "fully_registered", "full_registration"];

function regulatorForProfession(profession: string | null | undefined): "GMC" | "NMC" | "HCPC" | null {
  const p = profession?.toLowerCase().trim() ?? "";
  if (p === "doctor" || p === "clinical_academic") return "GMC";
  if (p === "nurse" || p === "midwife") return "NMC";
  if (p === "allied_health_professional") return "HCPC";
  return null;
}

export async function processUserAlert(
  userId: string,
  email: string,
  firstName: string,
  profile: typeof profilesTable.$inferSelect,
  lastAlertAt: Date | null,
): Promise<boolean> {
  const regulator = regulatorForProfession(profile.profession);
  if (!regulator) return false;

  // Claim the slot only if no concurrent worker has already advanced this
  // profile's alert checkpoint. The old checkpoint is restored when no email
  // is sent or delivery fails, so a failed send remains eligible for retry.
  const claimedAt = new Date();
  const claimCondition = lastAlertAt
    ? and(eq(profilesTable.userId, userId), eq(profilesTable.lastAlertSentAt, lastAlertAt))
    : and(eq(profilesTable.userId, userId), isNull(profilesTable.lastAlertSentAt));
  const [claim] = await db
    .update(profilesTable)
    .set({ lastAlertSentAt: claimedAt })
    .where(claimCondition)
    .returning({ userId: profilesTable.userId });
  if (!claim) return false;

  const restoreCheckpoint = async (): Promise<void> => {
    await db
      .update(profilesTable)
      .set({ lastAlertSentAt: lastAlertAt })
      .where(and(eq(profilesTable.userId, userId), eq(profilesTable.lastAlertSentAt, claimedAt)));
  };

  const [latestDecision] = await db
    .select()
    .from(decisionRecordsTable)
    .where(eq(decisionRecordsTable.userId, userId))
    .orderBy(desc(decisionRecordsTable.createdAt))
    .limit(1);

  const newRoles = lastAlertAt
    ? await db.select().from(rolesTable).where(and(eq(rolesTable.active, true), gt(rolesTable.importedAt, lastAlertAt)))
    : await db.select().from(rolesTable).where(eq(rolesTable.active, true));
  const regulatorRoles = newRoles.filter((r) => r.regulator === regulator);
  const sponsorVacancyRoles = await fetchSponsorVacanciesAsRoles(regulator, {
    since: lastAlertAt,
    requireSpecificVacancyUrl: true,
  });

  const isRegistered =
    profile.registrationStatus != null &&
    REGISTERED_STATUSES.includes(profile.registrationStatus.toLowerCase());
  const isLicenceReady = profile.licenceReady === true;
  const userIsEligible = latestDecision?.outcome === "eligible";

  const eligibleRoles: AlertRole[] = [];
  const workTowardsRoles: AlertRole[] = [];

  const roleKeys = new Set<string>();
  const roleUrls = new Set<string>();

  for (const role of regulatorRoles) {
    const reqReg = role.requiredRegistration.toLowerCase();
    const roleRequiresFull = reqReg.includes("full") || reqReg.includes("registered");
    const meetsRegistration = roleRequiresFull ? isRegistered || isLicenceReady : true;

    const isEligible = userIsEligible && meetsRegistration;

    const alertRole: AlertRole = {
      title: role.title,
      employer: role.employer,
      location: role.location,
      sponsorshipOffered: role.sponsorshipOffered,
      isEligible,
      applyUrl: role.applyUrl ?? null,
    };
    roleKeys.add(roleDedupKey(role.employer, role.title));
    if (role.applyUrl?.trim()) roleUrls.add(role.applyUrl.trim());

    if (isEligible) {
      eligibleRoles.push(alertRole);
    } else {
      workTowardsRoles.push(alertRole);
    }
  }

  // Sponsor rows use the same quality gate as GET /roles, with the additional
  // alert-only requirement that the advert has a specific URL. Snapshot IDs
  // are not stable, so URL is the durable identity for alert deduplication.
  const sponsorCandidates = sponsorVacancyRoles.filter((role) => {
    if (!role.classifiedRelevant) return false;
    if (!role.applyUrl) return false;
    if (roleUrls.has(role.applyUrl)) return false;
    if (roleKeys.has(roleDedupKey(role.employer, role.title))) return false;
    roleKeys.add(roleDedupKey(role.employer, role.title));
    roleUrls.add(role.applyUrl);
    return true;
  });

  const sponsorUrls = sponsorCandidates.map((role) => role.applyUrl).filter((url): url is string => Boolean(url));
  let claimedSponsorUrls = new Set<string>();
  if (sponsorUrls.length > 0) {
    const alreadyDelivered = await db
      .select({ vacancyUrl: jobAlertVacancyDeliveriesTable.vacancyUrl })
      .from(jobAlertVacancyDeliveriesTable)
      .where(
        and(
          eq(jobAlertVacancyDeliveriesTable.userId, userId),
          inArray(jobAlertVacancyDeliveriesTable.vacancyUrl, sponsorUrls),
        ),
      );
    const deliveredUrls = new Set(alreadyDelivered.map((row) => row.vacancyUrl));
    const unseenSponsors = sponsorCandidates.filter((role) => role.applyUrl && !deliveredUrls.has(role.applyUrl));

    if (unseenSponsors.length > 0) {
      const claimed = await db
        .insert(jobAlertVacancyDeliveriesTable)
        .values(
          unseenSponsors.map((role) => ({
            userId,
            vacancyId: role.id - SPONSOR_VACANCY_ID_OFFSET,
            vacancyUrl: role.applyUrl!,
          })),
        )
        .onConflictDoNothing()
        .returning({ vacancyUrl: jobAlertVacancyDeliveriesTable.vacancyUrl });
      claimedSponsorUrls = new Set(claimed.map((row) => row.vacancyUrl));
    }
  }

  for (const role of sponsorCandidates) {
    if (!role.applyUrl || !claimedSponsorUrls.has(role.applyUrl)) continue;
    const alertRole: AlertRole = {
      title: role.title,
      employer: role.employer,
      location: role.location,
      sponsorshipOffered: role.sponsorshipOffered,
      isEligible: userIsEligible,
      applyUrl: role.applyUrl,
    };
    if (alertRole.isEligible) eligibleRoles.push(alertRole);
    else workTowardsRoles.push(alertRole);
  }

  if (eligibleRoles.length === 0 && workTowardsRoles.length === 0) {
    await restoreCheckpoint();
    return false;
  }

  const frequency = profile.alertFrequency === "weekly" ? "weekly" : "daily";
  try {
    await sendJobAlertEmail(email, firstName || "Candidate", eligibleRoles, workTowardsRoles, frequency);
  } catch (error) {
    // Release claims when delivery fails so a later sweep can retry them.
    if (claimedSponsorUrls.size > 0) {
      await db
        .delete(jobAlertVacancyDeliveriesTable)
        .where(
          and(
            eq(jobAlertVacancyDeliveriesTable.userId, userId),
            inArray(jobAlertVacancyDeliveriesTable.vacancyUrl, [...claimedSponsorUrls]),
          ),
        );
    }
    await restoreCheckpoint();
    throw error;
  }
  return true;
}

export async function runAlerts(): Promise<void> {
  console.log("[alert-scheduler] Running job alert sweep...");

  const profiles = await db.select().from(profilesTable);

  for (const profile of profiles) {
    if (profile.alertFrequency === "off") continue;

    const now = new Date();
    const lastSent = profile.lastAlertSentAt;

    const intervalMs =
      profile.alertFrequency === "weekly"
        ? 7 * 24 * 60 * 60 * 1000
        : 24 * 60 * 60 * 1000;

    if (lastSent && now.getTime() - lastSent.getTime() < intervalMs) {
      continue;
    }

    const [userRow] = await db
      .select({ email: usersTable.email, firstName: usersTable.firstName })
      .from(usersTable)
      .where(eq(usersTable.id, profile.userId));

    if (!userRow?.email) continue;

    try {
        const sent = await processUserAlert(
        profile.userId,
        userRow.email,
        userRow.firstName ?? "Candidate",
        profile,
        lastSent ?? null,
      );
        if (sent) console.log(`[alert-scheduler] Alert sent to ${userRow.email}`);
    } catch (err) {
      console.error(`[alert-scheduler] Failed to send alert to ${userRow.email}:`, err);
    }
  }

  console.log("[alert-scheduler] Sweep complete.");
}

export function startAlertScheduler(): void {
  cron.schedule("0 7 * * *", () => {
    runAlerts().catch((err) => {
      console.error("[alert-scheduler] Unhandled error in runAlerts:", err);
    });
  }, {
    timezone: "Europe/London",
  });

  console.log("[alert-scheduler] Scheduler registered: daily at 07:00 Europe/London");
}
