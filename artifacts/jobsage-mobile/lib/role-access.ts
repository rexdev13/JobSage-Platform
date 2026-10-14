/** The native companion is only for candidates without employer organization access. */
export function canAccessCandidateCompanion(
  role: unknown,
  userId: unknown,
  membership: unknown,
): boolean {
  if (role !== "candidate" || typeof userId !== "string" || userId.trim().length === 0) {
    return false;
  }
  if (!membership || typeof membership !== "object") return false;

  const response = membership as {
    organizations?: unknown;
    archivedOrganizations?: unknown;
  };
  if (!Array.isArray(response.organizations) || !Array.isArray(response.archivedOrganizations)) {
    return false;
  }

  return response.organizations.length === 0 && response.archivedOrganizations.length === 0;
}
