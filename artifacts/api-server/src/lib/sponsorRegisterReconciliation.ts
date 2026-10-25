export interface SponsorRegisterRow {
  organisationName: string;
  townCity: string | null;
  county: string | null;
  route: string | null;
  subRoute: string | null;
  rating: string | null;
  industry: string | null;
}

export type ExistingSponsorRegisterRow = Omit<SponsorRegisterRow, "industry"> & {
  id: number;
};

export type ReconciledSponsorRegisterRow = SponsorRegisterRow & {
  existingId: number | null;
};

const normalise = (value: string | null): string => value?.trim().toLowerCase() ?? "";

function recordKey(row: Omit<SponsorRegisterRow, "industry">): string {
  return JSON.stringify([
    row.townCity, row.county, row.route, row.subRoute, row.rating,
  ].map(normalise));
}

/**
 * The register has no row identifier, and a name can occur more than once.
 * Consume existing IDs once each, matching unchanged records before assigning
 * changed records to the remaining IDs for that name. Never deduplicate input.
 */
export function reconcileSponsorRegisterRows(
  incoming: SponsorRegisterRow[],
  existing: ExistingSponsorRegisterRow[],
): { rows: ReconciledSponsorRegisterRow[]; removedCount: number } {
  const rows: ReconciledSponsorRegisterRow[] = incoming.map((row) => ({
    ...row,
    existingId: null,
  }));
  const sourceGroups = new Map<string, number[]>();
  for (const [index, row] of incoming.entries()) {
    const name = normalise(row.organisationName);
    const group = sourceGroups.get(name) ?? [];
    group.push(index);
    sourceGroups.set(name, group);
  }

  const existingGroups = new Map<string, ExistingSponsorRegisterRow[]>();
  for (const row of [...existing].sort((a, b) => a.id - b.id)) {
    const name = normalise(row.organisationName);
    const group = existingGroups.get(name) ?? [];
    group.push(row);
    existingGroups.set(name, group);
  }

  const usedIds = new Set<number>();
  for (const [name, sourceIndexes] of sourceGroups) {
    const candidates = existingGroups.get(name) ?? [];
    const exactMatches = new Map<string, ExistingSponsorRegisterRow[]>();
    for (const candidate of candidates) {
      const key = recordKey(candidate);
      const group = exactMatches.get(key) ?? [];
      group.push(candidate);
      exactMatches.set(key, group);
    }

    // First preserve IDs for unchanged rows, even if the CSV order changes.
    for (const index of sourceIndexes) {
      const row = rows[index]!;
      const match = exactMatches.get(recordKey(row))?.shift();
      if (match) {
        row.existingId = match.id;
        usedIds.add(match.id);
      }
    }

    // No stable source ID exists for changed records. Reuse the remaining IDs
    // deterministically within the same name, rather than deleting enrichment.
    const remaining = candidates.filter((row) => !usedIds.has(row.id));
    let nextCandidate = 0;
    for (const index of sourceIndexes) {
      const row = rows[index]!;
      if (row.existingId !== null) continue;
      const match = remaining[nextCandidate++];
      if (match) {
        row.existingId = match.id;
        usedIds.add(match.id);
      }
    }
  }

  return { rows, removedCount: existing.length - usedIds.size };
}
