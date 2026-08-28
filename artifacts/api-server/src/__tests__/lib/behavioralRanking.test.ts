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

    expect(ranking).toEqual({ boost: 8, reason: "Similar to roles you opened" });
  });

  it("weights repeated recent clicks more than one click", () => {
    const oneClick = calculateBehaviouralRanking(role, {
      favouriteRoleIds: new Set(),
      bookmarkedEmployers: new Set(),
      engagements: [{
        roleId: 7,
        title: "Emergency Medicine Registrar",
        employer: role.employer,
        regulator: "NMC",
        kind: "link_clicked",
        occurredAt: new Date(),
      }],
    });
    const repeatedClicks = calculateBehaviouralRanking(role, {
      favouriteRoleIds: new Set(),
      bookmarkedEmployers: new Set(),
      engagements: [
        {
          roleId: 7,
          title: "Emergency Medicine Registrar",
          employer: role.employer,
          regulator: "NMC",
          kind: "link_clicked",
          occurredAt: new Date(),
        },
        {
          roleId: 8,
          title: "Paediatric Registrar",
          employer: role.employer,
          regulator: "NMC",
          kind: "link_clicked",
          occurredAt: new Date(),
        },
      ],
    });

    expect(repeatedClicks.boost).toBeGreaterThan(oneClick.boost);
    expect(repeatedClicks.reason).toBe("Same employer as jobs you clicked");
  });

  it("weights recent clicks and completed applications more strongly", () => {
    const olderClick = calculateBehaviouralRanking(role, {
      favouriteRoleIds: new Set(),
      bookmarkedEmployers: new Set(),
      engagements: [{
        roleId: 7,
        title: "Emergency Medicine Registrar",
        employer: role.employer,
        regulator: "NMC",
        kind: "link_clicked",
        occurredAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      }],
    });
    const recentClick = calculateBehaviouralRanking(role, {
      favouriteRoleIds: new Set(),
      bookmarkedEmployers: new Set(),
      engagements: [{
        roleId: 7,
        title: "Emergency Medicine Registrar",
        employer: role.employer,
        regulator: "NMC",
        kind: "link_clicked",
        occurredAt: new Date(),
      }],
    });
    const recentApplication = calculateBehaviouralRanking(role, {
      favouriteRoleIds: new Set(),
      bookmarkedEmployers: new Set(),
      engagements: [{
        roleId: 7,
        title: "Emergency Medicine Registrar",
        employer: role.employer,
        regulator: "NMC",
        kind: "applied",
        occurredAt: new Date(),
      }],
    });

    expect(recentClick.boost).toBeGreaterThan(olderClick.boost);
    expect(recentApplication.boost).toBeGreaterThan(recentClick.boost);
    expect(recentApplication.reason).toBe("Same employer as jobs you applied for");
  });

  it("boosts a known region shared with an opened role", () => {
    const ranking = calculateBehaviouralRanking(
      { ...role, targetRegions: ["London"] },
      {
        favouriteRoleIds: new Set(),
        bookmarkedEmployers: new Set(),
        engagements: [{
          roleId: 7,
          title: "Emergency Medicine Registrar",
          employer: "Another Trust",
          regulator: "NMC",
          targetRegions: ["London"],
          kind: "link_clicked",
          occurredAt: new Date(),
        }],
      },
    );

    expect(ranking).toEqual({ boost: 4, reason: "Same region as roles you opened" });
  });

  it("recognises short clinical and band title families", () => {
    const ituRanking = calculateBehaviouralRanking(
      { ...role, title: "Band 6 ITU Nurse" },
      {
        favouriteRoleIds: new Set(),
        bookmarkedEmployers: new Set(),
        engagements: [{
          roleId: 7,
          title: "Band 5 ITU Nurse",
          employer: "Another Trust",
          regulator: "NMC",
          kind: "link_clicked",
          occurredAt: new Date(),
        }],
      },
    );

    expect(ituRanking.reason).toBe("Similar to roles you opened");
    expect(ituRanking.boost).toBeGreaterThan(0);
  });

  it("uses a favourited role to boost related employer vacancies", () => {
    const ranking = calculateBehaviouralRanking(role, {
      favouriteRoleIds: new Set(),
      bookmarkedEmployers: new Set(),
      engagements: [{
        roleId: 7,
        title: "Emergency Medicine Registrar",
        employer: role.employer,
        regulator: "NMC",
        kind: "favourited",
        occurredAt: new Date(),
      }],
    });

    expect(ranking.reason).toBe("Same employer as jobs you favourited");
    expect(ranking.boost).toBeGreaterThan(0);
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