import { describe, expect, it } from "vitest";
import { calculateBehaviouralRanking } from "../../lib/behavioralRanking";

const role = {
  id: 42,
  title: "Cardiology Specialty Doctor",
  employer: "Northshire NHS Trust",
  regulator: "GMC",
};

describe("calculateBehaviouralRanking", () => {
  it("uses bounded deterministic boosts with a direct favourite explanation", () => {
    const ranking = calculateBehaviouralRanking(role, {
      favouriteRoleIds: new Set([42]),
      bookmarkedEmployers: new Set(["northshire nhs trust"]),
      engagements: [{
        roleId: 42,
        title: role.title,
        employer: role.employer,
        regulator: "GMC",
        kind: "link_clicked",
        occurredAt: new Date(),
      }],
    });

    expect(ranking).toEqual({ boost: 30, reason: "You favourited this opportunity" });
  });

  it("explains title similarity to a recently opened role", () => {
    const ranking = calculateBehaviouralRanking(role, {
      favouriteRoleIds: new Set(),
      bookmarkedEmployers: new Set(),
      engagements: [{
        roleId: 7,
        title: "Cardiology Registrar",
        employer: "Another Trust",
        regulator: "NMC",
        kind: "link_clicked",
        occurredAt: new Date(),
      }],
    });

    expect(ranking).toEqual({ boost: 10, reason: "Similar to roles you opened" });
  });

  it("ignores stale engagement activity", () => {
    const ranking = calculateBehaviouralRanking(role, {
      favouriteRoleIds: new Set(),
      bookmarkedEmployers: new Set(),
      engagements: [{
        roleId: 7,
        title: "Cardiology Registrar",
        employer: "Another Trust",
        regulator: "GMC",
        kind: "applied",
        occurredAt: new Date(Date.now() - 91 * 24 * 60 * 60 * 1000),
      }],
    });

    expect(ranking).toEqual({ boost: 0, reason: null });
  });
});