import { db, companySiteHostStatesTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import http, { type IncomingHttpHeaders, type RequestOptions } from "node:http";
import https from "node:https";
import net from "node:net";
import { lookup as dnsLookup } from "node:dns/promises";
import { isPrivateIp } from "./linkHealth";

export const COMPANY_SITE_PAGE_TIMEOUT_MS = 9_000;
export const COMPANY_SITE_EMPLOYER_BUDGET_MS = 25_000;
export const COMPANY_SITE_HOST_DELAY_MS = 1_750;
export const COMPANY_SITE_ROBOTS_TTL_MS = 36 * 60 * 60 * 1000;
export const COMPANY_SITE_DNS_TIMEOUT_MS = 3_000;

const HOST_LEASE_MS = COMPANY_SITE_PAGE_TIMEOUT_MS + 3_000;
const MAX_REDIRECTS = 3;
const MAX_PAGE_BYTES = 1_000_000;
const MAX_ROBOTS_BYTES = 128_000;
const USER_AGENT = "JOBSAGE vacancy discovery/1.0 (+https://jobsage.co.uk)";

const ATS_HOSTS: Array<{ provider: string; suffix: string }> = [
  { provider: "Greenhouse", suffix: "greenhouse.io" },
  { provider: "Lever", suffix: "lever.co" },
  { provider: "Workday", suffix: "myworkdayjobs.com" },
  { provider: "SmartRecruiters", suffix: "smartrecruiters.com" },
  { provider: "Oracle Recruiting", suffix: "oraclecloud.com" },
  { provider: "Taleo", suffix: "taleo.net" },
  { provider: "Pinpoint", suffix: "pinpointhq.com" },
  { provider: "SAP SuccessFactors", suffix: "successfactors.com" },
  { provider: "Ashby", suffix: "ashbyhq.com" },
  { provider: "BambooHR", suffix: "bamboohr.com" },
];

export type CompanySiteFetchFailure =
  | "robots"
  | "rate_limited"
  | "timeout"
  | "unsafe"
  | "http"
  | "network";

export type CompanySiteFailureClass = "permanent" | "temporary";

export type CompanySiteFetchResult =
  | {
      ok: true;
      url: string;
      status: number;
      body: string;
      contentType: string;
    }
  | {
      ok: false;
      kind: CompanySiteFetchFailure;
      reason: string;
      retryAt?: Date;
      status?: number;
      failureClass?: CompanySiteFailureClass;
    };

type HostReservation =
  | { allowed: true; leaseToken: string }
  | { allowed: false; retryAt?: Date; waitMs: number };

type PinnedAddress = { address: string; family: 4 | 6 };
type LookupFunction = NonNullable<RequestOptions["lookup"]>;
type AddressResolver = (
  hostname: string,
) => Promise<Array<{ address: string; family: number }>>;

type PinnedResponse = {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
};

export function classifyCompanySiteFailure(input: {
  kind: CompanySiteFetchFailure;
  reason: string;
  status?: number;
}): CompanySiteFailureClass {
  if (input.kind === "unsafe") return "permanent";
  if (input.status === 404 || input.status === 410) return "permanent";
  if (
    input.kind === "http" &&
    input.status != null &&
    input.status >= 400 &&
    input.status < 500 &&
    input.status !== 403 &&
    input.status !== 429
  ) {
    return "permanent";
  }
  if (
    input.kind === "network" &&
    /(CERT_HAS_EXPIRED|ERR_TLS_CERT_ALTNAME_INVALID|DEPTH_ZERO_SELF_SIGNED_CERT|UNABLE_TO_VERIFY_LEAF_SIGNATURE|ERR_TLS_CERT_INVALID|certificate has expired|certificate.*(name|verify|authority))/i.test(
      input.reason,
    )
  ) {
    return "permanent";
  }
  if (
    input.kind === "network" &&
    /(ENOTFOUND|EAI_NONAME|NXDOMAIN|name or service not known)/i.test(input.reason)
  ) {
    return "permanent";
  }
  return "temporary";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function awaitWithDeadline<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error(message);
          error.name = "AbortError";
          reject(error);
        }, Math.max(1, timeoutMs));
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function resolveAndPinPublicAddress(
  hostname: string,
  resolver: AddressResolver = async (host) => dnsLookup(host, { all: true, verbatim: true }),
): Promise<PinnedAddress> {
  const host = normaliseHostname(hostname).replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    (!net.isIP(host) && !host.includes("."))
  ) {
    throw new Error(`non-public hostname: ${hostname}`);
  }
  const addresses = net.isIP(host)
    ? [{ address: host, family: net.isIPv4(host) ? 4 : 6 }]
    : await resolver(host);
  if (
    addresses.length === 0 ||
    addresses.some(({ address, family }) =>
      (family !== 4 && family !== 6) || isPrivateIp(address)
    )
  ) {
    throw new Error(`non-public DNS result: ${hostname}`);
  }
  const selected = addresses[0]!;
  return { address: selected.address, family: selected.family as 4 | 6 };
}

export function createPinnedLookup(pinned: PinnedAddress): LookupFunction {
  return ((_hostname: string, options: unknown, callback: (...args: unknown[]) => void) => {
    const wantsAll =
      typeof options === "object" &&
      options !== null &&
      "all" in options &&
      (options as { all?: boolean }).all === true;
    queueMicrotask(() => {
      if (wantsAll) {
        callback(null, [{ address: pinned.address, family: pinned.family }]);
      } else {
        callback(null, pinned.address, pinned.family);
      }
    });
  }) as LookupFunction;
}

export async function requestPinned(
  url: URL,
  pinned: PinnedAddress,
  timeoutMs: number,
  maxBytes: number,
): Promise<PinnedResponse> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let wallTimer: ReturnType<typeof setTimeout> | undefined;
    const resolveOnce = (value: PinnedResponse) => {
      if (settled) return;
      settled = true;
      if (wallTimer) clearTimeout(wallTimer);
      resolve(value);
    };
    const rejectOnce = (error: unknown) => {
      if (settled) return;
      settled = true;
      if (wallTimer) clearTimeout(wallTimer);
      reject(error);
    };
    const client = url.protocol === "https:" ? https : http;
    const request = client.request(
      url,
      {
        method: "GET",
        agent: false,
        lookup: createPinnedLookup(pinned),
        servername: url.protocol === "https:" ? url.hostname : undefined,
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.5",
          "Accept-Language": "en-GB,en;q=0.9",
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on("data", (value: Buffer | string) => {
          if (bytes >= maxBytes) return;
          const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
          const remaining = maxBytes - bytes;
          chunks.push(chunk.byteLength > remaining ? chunk.subarray(0, remaining) : chunk);
          bytes += Math.min(chunk.byteLength, remaining);
          if (bytes >= maxBytes) response.destroy();
        });
        response.on("end", () => {
          resolveOnce({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
        response.on("error", (error) => {
          if (bytes >= maxBytes) {
            resolveOnce({
              status: response.statusCode ?? 0,
              headers: response.headers,
              body: Buffer.concat(chunks).toString("utf8"),
            });
          } else {
            rejectOnce(error);
          }
        });
      },
    );
    wallTimer = setTimeout(() => {
      const error = new Error("request timed out");
      error.name = "AbortError";
      request.destroy(error);
      rejectOnce(error);
    }, Math.max(1, timeoutMs));
    request.setTimeout(timeoutMs, () => {
      const error = new Error("request timed out");
      error.name = "AbortError";
      request.destroy(error);
    });
    request.on("socket", (socket) => {
      socket.on("error", rejectOnce);
    });
    request.on("error", rejectOnce);
    request.end();
  });
}

function headerValue(headers: IncomingHttpHeaders, name: string): string | null {
  const value = headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] ?? null : value?.toString() ?? null;
}

export function normaliseHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/\.$/, "");
}

function withoutWww(hostname: string): string {
  return normaliseHostname(hostname).replace(/^www\./, "");
}

export function knownAtsProvider(urlOrHostname: string): string | null {
  let hostname = urlOrHostname;
  try {
    hostname = new URL(urlOrHostname).hostname;
  } catch {
    // The caller may already have supplied a hostname.
  }
  const host = normaliseHostname(hostname);
  return ATS_HOSTS.find(({ suffix }) => host === suffix || host.endsWith(`.${suffix}`))?.provider ?? null;
}

export function isAllowedCompanyDestination(originHostname: string, candidateUrl: string): boolean {
  let candidate: URL;
  try {
    candidate = new URL(candidateUrl);
  } catch {
    return false;
  }
  if (candidate.protocol !== "http:" && candidate.protocol !== "https:") return false;
  const origin = withoutWww(originHostname);
  const target = withoutWww(candidate.hostname);
  return (
    target === origin ||
    target.endsWith(`.${origin}`) ||
    origin.endsWith(`.${target}`) ||
    knownAtsProvider(target) !== null
  );
}

function parseRetryAfter(value: string | null): Date | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return new Date(Date.now() + Math.min(seconds * 1000, 24 * 60 * 60 * 1000));
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp) : null;
}

export async function reserveHost(hostname: string, deadlineMs: number): Promise<HostReservation> {
  const host = normaliseHostname(hostname);
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + HOST_LEASE_MS);
  const leaseToken = crypto.randomUUID();
  const result = await db.execute<{ hostname: string }>(sql`
    INSERT INTO company_site_host_states (
      hostname, request_lease_until, request_lease_token, created_at, updated_at
    )
    VALUES (${host}, ${leaseUntil}, ${leaseToken}, ${now}, ${now})
    ON CONFLICT (hostname) DO UPDATE
    SET request_lease_until = EXCLUDED.request_lease_until,
        request_lease_token = EXCLUDED.request_lease_token,
        updated_at = EXCLUDED.updated_at
    WHERE
      (
        company_site_host_states.retry_after IS NULL
        OR company_site_host_states.retry_after <= ${now}
      )
      AND (
        company_site_host_states.request_lease_until IS NULL
        OR company_site_host_states.request_lease_until <= ${now}
      )
      AND (
        company_site_host_states.last_request_at IS NULL
        OR company_site_host_states.last_request_at <= ${new Date(now.getTime() - COMPANY_SITE_HOST_DELAY_MS)}
      )
    RETURNING hostname
  `);
  if (result.rows.length > 0) return { allowed: true, leaseToken };

  const [state] = await db
    .select({
      retryAfter: companySiteHostStatesTable.retryAfter,
      requestLeaseUntil: companySiteHostStatesTable.requestLeaseUntil,
      lastRequestAt: companySiteHostStatesTable.lastRequestAt,
    })
    .from(companySiteHostStatesTable)
    .where(eq(companySiteHostStatesTable.hostname, host))
    .limit(1);
  const retryAt = state?.retryAfter ?? state?.requestLeaseUntil ?? undefined;
  const paceUntil = state?.lastRequestAt
    ? state.lastRequestAt.getTime() + COMPANY_SITE_HOST_DELAY_MS
    : 0;
  const nextMs = Math.max(retryAt?.getTime() ?? 0, paceUntil, Date.now() + 50);
  return {
    allowed: false,
    retryAt,
    waitMs: Math.max(50, Math.min(nextMs - Date.now(), Math.max(50, deadlineMs - Date.now()))),
  };
}

export async function completeHost(hostname: string, leaseToken: string): Promise<void> {
  await db
    .update(companySiteHostStatesTable)
    .set({
      requestLeaseUntil: null,
      requestLeaseToken: null,
      lastRequestAt: new Date(),
      failureCount: 0,
      retryAfter: null,
      updatedAt: new Date(),
    })
    .where(
      sql`${companySiteHostStatesTable.hostname} = ${normaliseHostname(hostname)}
        AND ${companySiteHostStatesTable.requestLeaseToken} = ${leaseToken}`,
    );
}

export async function releaseHost(hostname: string, leaseToken: string): Promise<void> {
  await db
    .update(companySiteHostStatesTable)
    .set({
      requestLeaseUntil: null,
      requestLeaseToken: null,
      lastRequestAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      sql`${companySiteHostStatesTable.hostname} = ${normaliseHostname(hostname)}
        AND ${companySiteHostStatesTable.requestLeaseToken} = ${leaseToken}`,
    )
    .catch(() => {});
}

export async function failHost(
  hostname: string,
  leaseToken: string,
  explicitRetryAt: Date | null,
): Promise<Date | null> {
  const host = normaliseHostname(hostname);
  const result = await db.execute<{ retry_after: Date | string | null }>(sql`
    UPDATE company_site_host_states
    SET request_lease_until = NULL,
        request_lease_token = NULL,
        last_request_at = NOW(),
        failure_count = LEAST(failure_count + 1, 8),
        retry_after = CASE
          WHEN ${explicitRetryAt}::timestamptz IS NOT NULL
            AND ${explicitRetryAt}::timestamptz > NOW()
            THEN ${explicitRetryAt}::timestamptz
          ELSE NOW() + LEAST(
            INTERVAL '24 hours',
            INTERVAL '15 minutes' * POWER(2, LEAST(failure_count + 1, 8) - 1)
          )
        END,
        updated_at = NOW()
    WHERE hostname = ${host}
      AND request_lease_token = ${leaseToken}
    RETURNING retry_after
  `);
  const retryAfter = result.rows[0]?.retry_after;
  return retryAfter ? new Date(retryAfter) : null;
}

async function fetchWithoutRobots(
  inputUrl: string,
  originHostname: string,
  deadlineMs: number,
  maxBytes = MAX_PAGE_BYTES,
  checkRedirectRobots = false,
): Promise<CompanySiteFetchResult> {
  let currentUrl = inputUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (Date.now() >= deadlineMs) {
      return { ok: false, kind: "timeout", reason: "employer request budget exhausted" };
    }
    let parsed: URL;
    try {
      parsed = new URL(currentUrl);
    } catch {
      return { ok: false, kind: "unsafe", reason: "malformed URL" };
    }
    if (!isAllowedCompanyDestination(originHostname, currentUrl)) {
      return { ok: false, kind: "unsafe", reason: `redirect outside employer or approved ATS: ${parsed.hostname}` };
    }
    if (checkRedirectRobots && hop > 0) {
      const redirectedPolicy = await robotsPolicy(currentUrl, originHostname, deadlineMs);
      if (!redirectedPolicy.allowed) {
        return {
          ok: false,
          kind: "robots",
          reason: redirectedPolicy.reason ?? "robots.txt disallows redirected path",
          retryAt: redirectedPolicy.retryAt,
        };
      }
    }
    let pinned: PinnedAddress;
    try {
      pinned = await awaitWithDeadline(
        resolveAndPinPublicAddress(parsed.hostname),
        Math.min(COMPANY_SITE_DNS_TIMEOUT_MS, Math.max(1, deadlineMs - Date.now())),
        "DNS lookup timed out",
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (/(timed out|EAI_AGAIN|ETIMEOUT)/i.test(reason)) {
        return {
          ok: false,
          kind: "timeout",
          reason,
          failureClass: "temporary",
        };
      }
      return {
        ok: false,
        kind: "unsafe",
        reason: /(?:ENOTFOUND|EAI_NONAME|NXDOMAIN|name or service not known)/i.test(reason)
          ? `DNS lookup failed for ${parsed.hostname}: ${reason}`
          : `non-public hostname: ${parsed.hostname}`,
        failureClass: "permanent",
      };
    }

    let reservation = await reserveHost(parsed.hostname, deadlineMs);
    while (!reservation.allowed && Date.now() + reservation.waitMs < deadlineMs) {
      await sleep(reservation.waitMs);
      reservation = await reserveHost(parsed.hostname, deadlineMs);
    }
    if (!reservation.allowed) {
      return {
        ok: false,
        kind: "rate_limited",
        reason: "hostname is paced or in backoff",
        retryAt: reservation.retryAt,
      };
    }

    const leaseToken = reservation.leaseToken;
    const timeoutMs = Math.max(1, Math.min(COMPANY_SITE_PAGE_TIMEOUT_MS, deadlineMs - Date.now()));
    try {
      const response = await requestPinned(parsed, pinned, timeoutMs, maxBytes);
      if (response.status >= 300 && response.status < 400) {
        const location = headerValue(response.headers, "location");
        await completeHost(parsed.hostname, leaseToken);
        if (!location) {
          return {
            ok: false,
            kind: "http",
            status: response.status,
            reason: "redirect without Location",
            failureClass: "permanent",
          };
        }
        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }
      if (response.status === 403 || response.status === 429 || response.status >= 500) {
        const retryAt = await failHost(
          parsed.hostname,
          leaseToken,
          parseRetryAfter(headerValue(response.headers, "retry-after")),
        );
        return {
          ok: false,
          kind: "rate_limited",
          status: response.status,
          reason: `HTTP ${response.status}`,
          retryAt: retryAt ?? undefined,
          failureClass: "temporary",
        };
      }
      await completeHost(parsed.hostname, leaseToken);
      if (response.status < 200 || response.status >= 300) {
        const failure = {
          kind: "http" as const,
          status: response.status,
          reason: `HTTP ${response.status}`,
        };
        return {
          ok: false,
          ...failure,
          failureClass: classifyCompanySiteFailure(failure),
        };
      }
      return {
        ok: true,
        url: currentUrl,
        status: response.status,
        body: response.body,
        contentType: headerValue(response.headers, "content-type") ?? "",
      };
    } catch (error) {
      const retryAt = await failHost(parsed.hostname, leaseToken, null);
      return {
        ok: false,
        kind: error instanceof Error && error.name === "AbortError" ? "timeout" : "network",
        reason: error instanceof Error ? error.message : "network failure",
        retryAt: retryAt ?? undefined,
        failureClass: classifyCompanySiteFailure({
          kind: error instanceof Error && error.name === "AbortError" ? "timeout" : "network",
          reason: error instanceof Error ? error.message : "network failure",
        }),
      };
    } finally {
      await releaseHost(parsed.hostname, leaseToken);
    }
  }
  return {
    ok: false,
    kind: "unsafe",
    reason: "too many redirects",
    failureClass: "permanent",
  };
}

type RobotsPolicy = {
  allowed: boolean;
  body: string | null;
  retryAt?: Date;
  reason?: string;
  failureClass?: CompanySiteFailureClass;
};

type RobotsRule = { allow: boolean; pattern: string };
type RobotsGroup = { agents: string[]; rules: RobotsRule[] };

function robotsPatternMatches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const source = anchored ? pattern.slice(0, -1) : pattern;
  const escaped = source
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  try {
    return new RegExp(`^${escaped}${anchored ? "$" : ""}`).test(path);
  } catch {
    return false;
  }
}

export function robotsAllows(body: string | null, path: string): boolean {
  if (!body) return true;
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (key === "user-agent") {
      if (!current || current.rules.length > 0) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if (current && (key === "allow" || key === "disallow") && value) {
      current.rules.push({ allow: key === "allow", pattern: value });
    }
  }
  const userAgent = "jobsage";
  const matching = groups
    .map((group) => ({
      group,
      specificity: Math.max(
        -1,
        ...group.agents.map((agent) => agent === "*" ? 0 : userAgent.includes(agent) ? agent.length : -1),
      ),
    }))
    .filter(({ specificity }) => specificity >= 0);
  if (matching.length === 0) return true;
  const bestSpecificity = Math.max(...matching.map(({ specificity }) => specificity));
  const matchingRules = matching
    .filter(({ specificity }) => specificity === bestSpecificity)
    .flatMap(({ group }) => group.rules)
    .filter((rule) => robotsPatternMatches(rule.pattern, path))
    .sort((a, b) => b.pattern.length - a.pattern.length || Number(b.allow) - Number(a.allow));
  return matchingRules[0]?.allow ?? true;
}

async function robotsPolicy(targetUrl: string, originHostname: string, deadlineMs: number): Promise<RobotsPolicy> {
  const target = new URL(targetUrl);
  const host = normaliseHostname(target.hostname);
  const [cached] = await db
    .select({
      body: companySiteHostStatesTable.robotsBody,
      checkedAt: companySiteHostStatesTable.robotsCheckedAt,
    })
    .from(companySiteHostStatesTable)
    .where(eq(companySiteHostStatesTable.hostname, host))
    .limit(1);
  if (
    cached?.checkedAt &&
    cached.checkedAt.getTime() >= Date.now() - COMPANY_SITE_ROBOTS_TTL_MS
  ) {
    const allowed = robotsAllows(cached.body, `${target.pathname}${target.search}`);
    return {
      allowed,
      body: cached.body,
      failureClass: allowed ? undefined : "temporary",
    };
  }

  const robotsUrl = `${target.protocol}//${target.host}/robots.txt`;
  const result = await fetchWithoutRobots(robotsUrl, originHostname, deadlineMs, MAX_ROBOTS_BYTES);
  if (!result.ok) {
    if (result.status === 404 || result.status === 410) {
      await db
        .insert(companySiteHostStatesTable)
        .values({ hostname: host, robotsBody: "", robotsCheckedAt: new Date(), updatedAt: new Date() })
        .onConflictDoUpdate({
          target: companySiteHostStatesTable.hostname,
          set: { robotsBody: "", robotsCheckedAt: new Date(), updatedAt: new Date() },
        });
      return { allowed: true, body: "" };
    }
    return {
      allowed: false,
      body: null,
      retryAt: result.retryAt,
      reason: `robots.txt could not be checked: ${result.reason}`,
      failureClass: result.failureClass ?? classifyCompanySiteFailure(result),
    };
  }
  const body = result.body;
  await db
    .insert(companySiteHostStatesTable)
    .values({ hostname: host, robotsBody: body, robotsCheckedAt: new Date(), updatedAt: new Date() })
    .onConflictDoUpdate({
      target: companySiteHostStatesTable.hostname,
      set: { robotsBody: body, robotsCheckedAt: new Date(), updatedAt: new Date() },
    });
  const allowed = robotsAllows(body, `${target.pathname}${target.search}`);
  return {
    allowed,
    body,
    failureClass: allowed ? undefined : "temporary",
  };
}

export async function fetchCompanySitePage(
  url: string,
  originHostname: string,
  deadlineMs: number,
): Promise<CompanySiteFetchResult> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, kind: "unsafe", reason: "malformed URL" };
  }
  const robots = await robotsPolicy(url, originHostname, deadlineMs);
  if (!robots.allowed) {
    return {
      ok: false,
      kind: "robots",
      reason: robots.reason ?? "robots.txt disallows this path",
      retryAt: robots.retryAt,
      failureClass: robots.failureClass ?? "temporary",
    };
  }
  return fetchWithoutRobots(parsed.toString(), originHostname, deadlineMs, MAX_PAGE_BYTES, true);
}