import cron from "node-cron";
import { db } from "@workspace/db";
import {
  profilesTable,
  rolesTable,
  decisionRecordsTable,
  usersTable,
} from "@workspace/db";
import { eq, desc, and, gt } from "drizzle-orm";
import { sendJobAlertEmail, type AlertRole } from "./email";

const REGISTERED_STATUSES = ["registered", "fully_registered", "full_registration"];

function regulatorForProfession(profession: string): "GMC" | "NMC" | "HCPC" | null {
  if (profession === "doctor" || profession === "clinical_academic") return "GMC";
  if (profession === "nurse" || profession === "midwife") return "NMC";
  if (profession === "allied_health_professional") return "HCPC";
  return null;
}

async function processUserAlert(
  userId: string,
  email: string,
  firstName: string,
  profile: typeof profilesTable.$inferSelect,
  lastAlertAt: Date | null,
): Promise<void> {
  const regulator = regulatorForProfession(profile.profession);
  if (!regulator) return;

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

  const isRegistered =
    profile.registrationStatus != null &&
    REGISTERED_STATUSES.includes(profile.registrationStatus.toLowerCase());
  const isLicenceReady = profile.licenceReady === true;
  const userIsEligible = latestDecision?.outcome === "eligible";

  const eligibleRoles: AlertRole[] = [];
  const workTowardsRoles: AlertRole[] = [];

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
    };

    if (isEligible) {
      eligibleRoles.push(alertRole);
    } else {
      workTowardsRoles.push(alertRole);
    }
  }

  await sendJobAlertEmail(email, firstName || "Candidate", eligibleRoles, workTowardsRoles);

  await db
    .update(profilesTable)
    .set({ lastAlertSentAt: new Date() })
    .where(eq(profilesTable.userId, userId));
}

async function runAlerts(): Promise<void> {
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
      await processUserAlert(
        profile.userId,
        userRow.email,
        userRow.firstName ?? "Candidate",
        profile,
        lastSent ?? null,
      );
      console.log(`[alert-scheduler] Alert sent to ${userRow.email}`);
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
