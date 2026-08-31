export const READINESS_CHECK_LIMIT = 10;

/**
 * Readiness quotas reset at 00:00 UTC on the first day of each calendar month.
 * Using UTC keeps the boundary deterministic across API instances.
 */
export function getReadinessMonthStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export function getNextReadinessReset(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}