import {
  db,
  jobListingsTable,
  rolesTable,
  sponsorLicenceVacanciesTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  EMPLOYER_JOB_ID_OFFSET,
  SPONSOR_VACANCY_ID_OFFSET,
  isEmployerJobRoleId,
  isSponsorVacancyRoleId,
} from "./sponsorVacancyRoles";
import {
  classifyUkVacancyLocation,
  type UkVacancyLocationStatus,
} from "./ukVacancyLocation";

export async function getCandidateRoleLocationStatus(
  roleId: number,
): Promise<UkVacancyLocationStatus> {
  if (!Number.isInteger(roleId) || roleId <= 0) return "unknown";

  if (isSponsorVacancyRoleId(roleId)) {
    const [vacancy] = await db
      .select({
        location: sponsorLicenceVacanciesTable.location,
        targetRegions: sponsorLicenceVacanciesTable.targetRegions,
        sourceMetadata: sponsorLicenceVacanciesTable.sourceMetadata,
      })
      .from(sponsorLicenceVacanciesTable)
      .where(eq(sponsorLicenceVacanciesTable.id, roleId - SPONSOR_VACANCY_ID_OFFSET))
      .limit(1);
    return vacancy
      ? classifyUkVacancyLocation(vacancy)
      : "unknown";
  }

  if (isEmployerJobRoleId(roleId)) {
    const [job] = await db
      .select({
        location: jobListingsTable.location,
        targetRegions: jobListingsTable.targetRegions,
      })
      .from(jobListingsTable)
      .where(eq(jobListingsTable.id, roleId - EMPLOYER_JOB_ID_OFFSET))
      .limit(1);
    return job
      ? classifyUkVacancyLocation(job)
      : "unknown";
  }

  const [role] = await db
    .select({
      location: rolesTable.location,
      targetRegions: rolesTable.targetRegions,
    })
    .from(rolesTable)
    .where(eq(rolesTable.id, roleId))
    .limit(1);
  return role
    ? classifyUkVacancyLocation(role)
    : "unknown";
}

