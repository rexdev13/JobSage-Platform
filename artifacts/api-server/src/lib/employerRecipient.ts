import { db } from "@workspace/db";
import {
  employerProfilesTable,
  sponsorLicencesTable,
  usersTable,
} from "@workspace/db";
import { eq, ilike, inArray, or } from "drizzle-orm";
import { OPS_INBOX } from "./email";

export type DeliveryRoute =
  | "employer_contact_email"
  | "employer_account"
  | "sponsor_contact_email"
  | "ops_fallback";

export interface RecipientResolution {
  email: string;
  route: DeliveryRoute;
}

/** Keep the candidate-facing eligibility check aligned with the send lookup. */
export function isUsableEmployerEmail(value: string | null | undefined): value is string {
  return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function normalizedCompanyName(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Resolve the employer recipient in the same priority order used by Send CV:
 * sponsor contact, employer-profile contact, registered employer account,
 * then the legacy operations fallback.
 *
 * This deliberately performs no enrichment. It only uses persisted contact
 * details, so the direct-contact gate cannot disagree with delivery.
 */
export async function resolveEmployerRecipient(
  companyName: string,
  sponsorLicenceId: number | null | undefined,
  _legacyEnrichmentTimeoutMs?: number,
): Promise<RecipientResolution> {
  try {
    const [licenceRow] = await db
      .select({ contactEmail: sponsorLicencesTable.contactEmail })
      .from(sponsorLicencesTable)
      .where(
        sponsorLicenceId
          ? eq(sponsorLicencesTable.id, sponsorLicenceId)
          : ilike(sponsorLicencesTable.organisationName, companyName),
      )
      .limit(1);
    if (isUsableEmployerEmail(licenceRow?.contactEmail)) {
      return { email: licenceRow.contactEmail.trim(), route: "sponsor_contact_email" };
    }
  } catch {
    // Best-effort. Employer profile lookup and ops fallback remain available.
  }

  try {
    const [empRow] = await db
      .select({
        empUserId: employerProfilesTable.userId,
        contactEmail: employerProfilesTable.contactEmail,
      })
      .from(employerProfilesTable)
      .where(ilike(employerProfilesTable.companyName, companyName))
      .limit(1);
    if (isUsableEmployerEmail(empRow?.contactEmail)) {
      return { email: empRow.contactEmail.trim(), route: "employer_contact_email" };
    }
    if (empRow?.empUserId) {
      const [empUser] = await db
        .select({ email: usersTable.email })
        .from(usersTable)
        .where(eq(usersTable.id, empRow.empUserId));
      if (isUsableEmployerEmail(empUser?.email)) {
        return { email: empUser.email.trim(), route: "employer_account" };
      }
    }
  } catch {
    // Best-effort. Ops fallback is intentionally still available to legacy sends.
  }

  return { email: OPS_INBOX, route: "ops_fallback" };
}

export interface EmployerContactReference {
  companyName: string;
  sponsorLicenceId?: number | null;
}

/**
 * Bulk direct-contact eligibility for candidate-facing lists.
 *
 * The returned booleans mirror resolveEmployerRecipient's persisted lookup,
 * without returning any private email address to the client.
 */
export async function getDirectContactEligibility(
  references: readonly EmployerContactReference[],
): Promise<boolean[]> {
  if (references.length === 0) return [];

  const names = [...new Set(
    references
      .map((reference) => reference.companyName.trim())
      .filter(Boolean),
  )];
  if (names.length === 0) return references.map(() => false);

  const sponsorNameWhere = or(...names.map((name) => ilike(sponsorLicencesTable.organisationName, name)));
  const profileNameWhere = or(...names.map((name) => ilike(employerProfilesTable.companyName, name)));

  const [sponsorRows, profileRows] = await Promise.all([
    db
      .select({
        id: sponsorLicencesTable.id,
        organisationName: sponsorLicencesTable.organisationName,
        contactEmail: sponsorLicencesTable.contactEmail,
      })
      .from(sponsorLicencesTable)
      .where(sponsorNameWhere),
    db
      .select({
        companyName: employerProfilesTable.companyName,
        userId: employerProfilesTable.userId,
        contactEmail: employerProfilesTable.contactEmail,
      })
      .from(employerProfilesTable)
      .where(profileNameWhere),
  ]);

  const accountIds = [...new Set(profileRows.map((row) => row.userId).filter(Boolean))] as string[];
  const accountRows = accountIds.length > 0
    ? await db
      .select({ id: usersTable.id, email: usersTable.email })
      .from(usersTable)
      .where(inArray(usersTable.id, accountIds))
    : [];
  const accountEmails = new Map(accountRows.map((row) => [row.id, row.email]));

  const sponsorById = new Map(sponsorRows.map((row) => [row.id, row]));
  const sponsorByName = new Map<string, (typeof sponsorRows)[number]>();
  for (const row of sponsorRows) {
    const key = normalizedCompanyName(row.organisationName);
    if (!sponsorByName.has(key)) sponsorByName.set(key, row);
  }

  const profileByName = new Map<string, (typeof profileRows)[number]>();
  for (const row of profileRows) {
    const key = normalizedCompanyName(row.companyName);
    if (!profileByName.has(key)) profileByName.set(key, row);
  }

  return references.map((reference) => {
    const sponsor = reference.sponsorLicenceId
      ? sponsorById.get(reference.sponsorLicenceId)
      : sponsorByName.get(normalizedCompanyName(reference.companyName));
    if (isUsableEmployerEmail(sponsor?.contactEmail)) return true;

    const profile = profileByName.get(normalizedCompanyName(reference.companyName));
    if (isUsableEmployerEmail(profile?.contactEmail)) return true;
    return isUsableEmployerEmail(profile?.userId ? accountEmails.get(profile.userId) : null);
  });
}