import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect, getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { is, type SQL } from "drizzle-orm";
import * as schema from "@workspace/db/schema";
const fixture = vi.hoisted(() => ({
  enabled: true, role: "candidate", hold: false, fail: false, count: 1,
  rows: {} as Record<string, string[]>,
  queries: [] as Array<{ sql: string; params: unknown[] }>,
}));
vi.mock("../../lib/accountDeletion/releaseReadiness", () => ({
  get DELETION_REQUESTS_ENABLED() { return fixture.enabled; },
}));
vi.mock("../../lib/accountDeletion/cleanupScope", () => ({
  requireClaimedCleanup: vi.fn(async () => ({ requestId: "fixture-request", role: fixture.role })),
}));
vi.mock("@workspace/db", () => ({
  db: { transaction: async (callback: (tx: unknown) => Promise<unknown>) => {
    const before = structuredClone(fixture.rows);
    try {
      return await callback({ execute: async (query: SQL) => {
        const compiled = new PgDialect().sqlToQuery(query);
        fixture.queries.push(compiled);
        if (compiled.sql.includes("FROM legal_retention_records")) return { rows: fixture.hold ? [{ id: "fixture-hold" }] : [] };
        const table = /(?:FROM)\s+"([^"]+)"/.exec(compiled.sql)?.[1];
        if (compiled.sql.startsWith("DELETE")) {
          if (fixture.fail && table === "smart_apply_drafts") throw new Error("fixture transaction failure");
          fixture.rows[table!] = fixture.rows[table!]!.filter(owner => owner !== compiled.params[0]);
        }
        return { rows: [{ n: fixture.count }] };
      } });
    } catch (error) { fixture.rows = before; throw error; }
  } },
}));
import { CANDIDATE_DERIVED_TABLES, candidateOwnedSelections, countCandidateOwnedRows, eraseCandidateDerivedRows } from "../../lib/accountDeletion/candidateData";
const resource = { version: 1 as const, accountId: "fixture-candidate" };

describe("candidate-owned selectors and concrete derived-data partition", () => {
  beforeEach(() => {
    fixture.enabled = true; fixture.role = "candidate"; fixture.hold = false; fixture.fail = false; fixture.count = 1;
    fixture.queries = [];
    fixture.rows = Object.fromEntries(CANDIDATE_DERIVED_TABLES.map(table => [table, ["fixture-candidate", "fixture-other"]]));
  });
  afterEach(() => vi.clearAllMocks());
  it("binds every reviewed selector to exactly one account, never a public catalogue", () => {
    const selections = candidateOwnedSelections(resource.accountId);
    expect(new Set(selections.map(item => item.table)).size).toBe(selections.length);
    for (const item of selections) {
      const compiled = new PgDialect().sqlToQuery(item.predicate);
      expect(compiled.params).toEqual(["fixture-candidate"]);
      expect(compiled.sql).not.toContain("fixture-candidate");
    }
    for (const table of ["users", "employer_profiles", "job_listings", "roles", "sponsor_licences", "learning_videos", "social_leads"]) {
      expect(selections.some(item => item.table === table)).toBe(false);
    }
  });
  it("matches real schema tables and verifies the direct ownership column exists", () => {
    const tables = Object.values(schema).flatMap(value => is(value, PgTable) ? [getTableConfig(value)] : []);
    for (const item of candidateOwnedSelections(resource.accountId)) {
      const table = tables.find(table => table.name === item.table);
      expect(table, item.table).toBeDefined();
      if (item.derivedOnly) expect(table!.columns.some(column => column.name === "user_id")).toBe(true);
    }
  });
  it("scopes indirect remediation/review rows through the candidate-owned parent", () => {
    const selections = candidateOwnedSelections(resource.accountId);
    expect(new PgDialect().sqlToQuery(selections.find(item => item.table === "remediation_steps")!.predicate).sql).toContain("p.user_id");
    expect(new PgDialect().sqlToQuery(selections.find(item => item.table === "review_annotations")!.predicate).sql).toContain("c.user_id");
  });
  it("returns counts only and explicitly does not claim full account coverage", async () => {
    const queries: SQL[] = [];
    const result = await countCandidateOwnedRows({
      execute: async query => { queries.push(query); return { rows: [{ n: "3" }] }; },
    }, resource.accountId);
    expect(result.completeAccountCoverage).toBe(false);
    expect(Object.values(result.counts).every(count => count === 3)).toBe(true);
    expect(queries.every(query => new PgDialect().sqlToQuery(query).sql.startsWith("SELECT count(*)"))).toBe(true);
  });
  it.each([undefined, null, false, "", -1, "invalid", Number.MAX_SAFE_INTEGER + 1])("rejects unverified counts: %s", async n => {
    await expect(countCandidateOwnedRows({ execute: async () => ({ rows: [{ n }] }) }, resource.accountId))
      .rejects.toThrow("candidate_inventory_unverified");
  });
  it("erases only scoped derived rows and preserves unrelated accounts and file-bearing rows", async () => {
    const result = await eraseCandidateDerivedRows(resource, "fixture-task");
    expect(result.completeAccountErasure).toBe(false);
    for (const table of CANDIDATE_DERIVED_TABLES) expect(fixture.rows[table]).toEqual(["fixture-other"]);
    const deletions = fixture.queries.filter(query => query.sql.startsWith("DELETE"));
    expect(deletions).toHaveLength(CANDIDATE_DERIVED_TABLES.length);
    expect(deletions.every(query => JSON.stringify(query.params) === '["fixture-candidate"]')).toBe(true);
    for (const table of ["users", "documents", "profiles", "identity_verifications", "support_tickets", "review_cases", "applications"]) {
      expect(deletions.some(query => query.sql.includes(`"${table}"`))).toBe(false);
    }
    await eraseCandidateDerivedRows(resource, "fixture-task");
    for (const table of CANDIDATE_DERIVED_TABLES) expect(fixture.rows[table]).toEqual(["fixture-other"]);
  });
  it("does no work when the release gate is closed", async () => {
    fixture.enabled = false;
    await expect(eraseCandidateDerivedRows(resource, "fixture-task")).rejects.toThrow("deletion_release_blocked");
    expect(fixture.queries).toEqual([]);
  });
  it.each(["employer", "admin", "marketing", "super_admin"])("never treats %s shared data as candidate-owned", async role => {
    fixture.role = role;
    await expect(eraseCandidateDerivedRows(resource, "fixture-task")).rejects.toThrow("candidate_role_required");
    expect(fixture.queries.some(query => query.sql.startsWith("DELETE"))).toBe(false);
  });
  it("requires review rather than choosing a policy for an active legal hold", async () => {
    fixture.hold = true;
    await expect(eraseCandidateDerivedRows(resource, "fixture-task")).rejects.toThrow("legal_hold_review_required");
    expect(fixture.queries.some(query => query.sql.startsWith("DELETE"))).toBe(false);
  });
  it("rolls back the whole partition if one deletion fails", async () => {
    const original = structuredClone(fixture.rows); fixture.fail = true;
    await expect(eraseCandidateDerivedRows(resource, "fixture-task")).rejects.toThrow("fixture transaction failure");
    expect(fixture.rows).toEqual(original);
  });
  it("requires batching rather than unbounded deletion work", async () => {
    fixture.count = 10_001;
    await expect(eraseCandidateDerivedRows(resource, "fixture-task")).rejects.toThrow("candidate_cleanup_requires_batching");
    expect(fixture.queries.some(query => query.sql.startsWith("DELETE"))).toBe(false);
  });
});
