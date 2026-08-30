import { afterEach, describe, expect, it } from "vitest";
import { companySiteHostStatesTable, db } from "@workspace/db";
import { inArray, sql } from "drizzle-orm";
import {
  completeHost,
  failHost,
  releaseHost,
  reserveHost,
} from "../../lib/companySiteHttp";

const createdHosts = new Set<string>();

function testHost(): string {
  const host = `lease-${crypto.randomUUID()}.example`;
  createdHosts.add(host);
  return host;
}

async function expireLease(hostname: string): Promise<void> {
  await db.execute(sql`
    UPDATE company_site_host_states
    SET request_lease_until = NOW() - INTERVAL '1 second'
    WHERE hostname = ${hostname}
  `);
}

async function readState(hostname: string): Promise<{
  request_lease_token: string | null;
  request_lease_until: Date | null;
  failure_count: number;
  retry_after: Date | null;
}> {
  const result = await db.execute<{
    request_lease_token: string | null;
    request_lease_until: Date | null;
    failure_count: number;
    retry_after: Date | null;
  }>(sql`
    SELECT request_lease_token, request_lease_until, failure_count, retry_after
    FROM company_site_host_states
    WHERE hostname = ${hostname}
  `);
  const row = result.rows[0];
  if (!row) throw new Error(`Missing host state for ${hostname}`);
  return row;
}

afterEach(async () => {
  if (createdHosts.size === 0) return;
  await db
    .delete(companySiteHostStatesTable)
    .where(inArray(companySiteHostStatesTable.hostname, [...createdHosts]));
  createdHosts.clear();
});

describe.sequential("company-site hostname lease ownership", () => {
  it("does not let an overlapping late completion clear a newer reservation", async () => {
    const hostname = testHost();
    const first = await reserveHost(hostname, Date.now() + 5_000);
    expect(first.allowed).toBe(true);
    if (!first.allowed) return;

    await expireLease(hostname);
    const second = await reserveHost(hostname, Date.now() + 5_000);
    expect(second.allowed).toBe(true);
    if (!second.allowed) return;

    await completeHost(hostname, first.leaseToken);

    const state = await readState(hostname);
    expect(state.request_lease_token).toBe(second.leaseToken);
    expect(state.request_lease_until).not.toBeNull();
  });

  it("applies two concurrent failure reports for one lease at most once", async () => {
    const hostname = testHost();
    const reservation = await reserveHost(hostname, Date.now() + 5_000);
    expect(reservation.allowed).toBe(true);
    if (!reservation.allowed) return;

    const results = await Promise.all([
      failHost(hostname, reservation.leaseToken, null),
      failHost(hostname, reservation.leaseToken, null),
    ]);

    const state = await readState(hostname);
    expect(results.filter((value) => value !== null)).toHaveLength(1);
    expect(state.failure_count).toBe(1);
    expect(state.retry_after).not.toBeNull();
    expect(state.request_lease_token).toBeNull();
  });

  it("does not let a timed-out old request release a newer lease", async () => {
    const hostname = testHost();
    const first = await reserveHost(hostname, Date.now() + 5_000);
    expect(first.allowed).toBe(true);
    if (!first.allowed) return;

    await expireLease(hostname);
    const second = await reserveHost(hostname, Date.now() + 5_000);
    expect(second.allowed).toBe(true);
    if (!second.allowed) return;

    await releaseHost(hostname, first.leaseToken);

    const state = await readState(hostname);
    expect(state.request_lease_token).toBe(second.leaseToken);
    expect(state.request_lease_until).not.toBeNull();
  });
});