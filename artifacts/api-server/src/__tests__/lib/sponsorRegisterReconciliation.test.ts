import { describe, expect, it } from "vitest";
import {
  reconcileSponsorRegisterRows,
  type SponsorRegisterRow,
  type ExistingSponsorRegisterRow,
} from "../../lib/sponsorRegisterReconciliation";

const row = (overrides: Partial<SponsorRegisterRow> = {}): SponsorRegisterRow => ({
  organisationName: "Example Limited",
  townCity: "London",
  county: null,
  route: "Worker",
  subRoute: "Skilled Worker",
  rating: "A rating",
  industry: null,
  ...overrides,
});
const existing = (id: number, overrides: Partial<SponsorRegisterRow> = {}): ExistingSponsorRegisterRow => ({
  id,
  ...row(overrides),
});

describe("sponsor register row reconciliation", () => {
  it("keeps every exact duplicate, including occurrences beyond import batch boundaries", () => {
    const incoming = Array.from({ length: 401 }, () => row());
    const result = reconcileSponsorRegisterRows(incoming, []);
    expect(result.rows).toHaveLength(401);
    expect(result.rows.every((item) => item.existingId === null)).toBe(true);
    expect(result.removedCount).toBe(0);
  });

  it("adds missing occurrences rather than updating the same stored row repeatedly", () => {
    const result = reconcileSponsorRegisterRows(
      [row(), row(), row()],
      [existing(1)],
    );
    expect(result.rows.map((item) => item.existingId)).toEqual([1, null, null]);
  });

  it("preserves IDs for unchanged repeated-name rows when source order changes", () => {
    const result = reconcileSponsorRegisterRows(
      [row({ townCity: "Manchester" }), row()],
      [existing(1), existing(2, { townCity: "Manchester" })],
    );
    expect(result.rows.map((item) => item.existingId)).toEqual([2, 1]);
    expect(result.removedCount).toBe(0);
  });

  it("consumes identical stored duplicates once each", () => {
    const result = reconcileSponsorRegisterRows(
      [row(), row(), row()],
      [existing(3), existing(1)],
    );
    expect(result.rows.map((item) => item.existingId)).toEqual([1, 3, null]);
  });

  it("removes surplus occurrences and names missing from the source", () => {
    const result = reconcileSponsorRegisterRows(
      [row()],
      [existing(1), existing(2), existing(3, { organisationName: "Removed Ltd" })],
    );
    expect(result.rows.map((item) => item.existingId)).toEqual([1]);
    expect(result.removedCount).toBe(2);
  });

  it("reuses the remaining same-name ID for a changed record after exact matches", () => {
    const result = reconcileSponsorRegisterRows(
      [row({ townCity: "Bristol" }), row()],
      [existing(1), existing(2, { townCity: "Manchester" })],
    );
    expect(result.rows.map((item) => item.existingId)).toEqual([2, 1]);
  });

  it("matches name case and whitespace changes without creating a new row", () => {
    const result = reconcileSponsorRegisterRows(
      [row({ organisationName: "EXAMPLE LIMITED" })],
      [existing(1, { organisationName: " Example Limited " })],
    );
    expect(result.rows[0]?.existingId).toBe(1);
    expect(result.rows[0]?.organisationName).toBe("EXAMPLE LIMITED");
  });

  it("is idempotent after missing duplicates have been inserted", () => {
    const incoming = [row(), row(), row({ townCity: "Bristol" })];
    const first = reconcileSponsorRegisterRows(incoming, [existing(1)]);
    let nextId = 2;
    const stored = first.rows.map(({ existingId, ...item }) => ({
      ...item, id: existingId ?? nextId++,
    }));
    const second = reconcileSponsorRegisterRows(incoming, stored);
    expect(second.rows.map((item) => item.existingId)).toEqual([1, 2, 3]);
    expect(second.removedCount).toBe(0);
  });
});
