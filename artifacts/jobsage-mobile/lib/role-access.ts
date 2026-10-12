/** Candidate-only native companion screens must not be opened by other roles. */
export function canAccessCandidateCompanion(role: unknown): boolean {
  return role === "candidate";
}
