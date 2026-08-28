import {
  completeNhsVacancyProbe,
  failNhsVacancyProbe,
  reserveNhsVacancyProbe,
  type NhsProbeReservation,
} from "./nhsOutageBackoff";

const REED_KEY_PREFIX = "reed:";

export type ReedProbeReservation = NhsProbeReservation;

export function reserveReedVacancyProbe(
  organisationName: string,
  now = new Date(),
): Promise<ReedProbeReservation> {
  return reserveNhsVacancyProbe(`${REED_KEY_PREFIX}${organisationName}`, now);
}

export function completeReedVacancyProbe(
  reservation: Extract<ReedProbeReservation, { allowed: true }>,
): Promise<void> {
  return completeNhsVacancyProbe(reservation);
}

export function failReedVacancyProbe(
  reservation: Extract<ReedProbeReservation, { allowed: true }>,
  now = new Date(),
): Promise<Date | null> {
  return failNhsVacancyProbe(reservation, now);
}