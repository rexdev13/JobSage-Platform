// Shared HTTP helpers: timeouts, size caps, per-host throttling, robots.txt.
const UA = 'Mozilla/5.0 (compatible; SponsorJobBot/1.0; +contact-owner-of-this-site)';
const DEFAULT_TIMEOUT = 12000;
const MAX_BYTES = 1.5 * 1024 * 1024;

// Global cap on simultaneous requests so a high --concurrency can't flood the machine/network.
let MAX_INFLIGHT = parseInt(process.env.MAX_INFLIGHT || '100', 10);
function setMaxInflight(n) {
  if (n > 0) MAX_INFLIGHT = n;
}
let inflight = 0;
const waiters = [];
async function acquire() {
  if (inflight < MAX_INFLIGHT) return void inflight++;
  await new Promise((r) => waiters.push(r));
}
function release() {
  const next = waiters.shift();
  if (next) next(); // hand the slot straight to the next waiter
  else inflight--;
}
// Per-host cap: many parallel connections to the same API host (Lever, Greenhouse...) trigger connect timeouts on slow links.
const MAX_PER_HOST = parseInt(process.env.MAX_PER_HOST || '6', 10);
const hostActive = new Map();
const hostQueue = new Map();
async function acquireHost(host) {
  const n = hostActive.get(host) || 0;
  if (n < MAX_PER_HOST) return void hostActive.set(host, n + 1);
  await new Promise((r) => {
    if (!hostQueue.has(host)) hostQueue.set(host, []);
    hostQueue.get(host).push(r);
  });
}
function releaseHost(host) {
  const q = hostQueue.get(host);
  if (q && q.length) return q.shift()(); // hand the slot straight to the next waiter
  const n = (hostActive.get(host) || 1) - 1;
  if (n <= 0) hostActive.delete(host);
  else hostActive.set(host, n);
}
// Circuit breaker: after 10 transient failures in a row, skip that host for 30s instead of waiting on more timeouts.
const hostFail = new Map();
const breakerOpen = (host) => (hostFail.get(host) || {}).until > Date.now();
function noteFailure(host) {
  const f = hostFail.get(host) || { n: 0, until: 0 };
  if (++f.n >= 10) (f.until = Date.now() + 30000), (f.n = 0);
  hostFail.set(host, f);
}
const errorCounts = {}; // why requests failed, printed at the end of a run
const hostErrors = {}; // which hosts they failed on
// Dead sites are a real answer (retrying won't help); only timeouts/resets/429/5xx are worth retrying.
const PERMANENT = /^(ENOTFOUND|ECONNREFUSED|ENODATA|CERT_|DEPTH_ZERO|SELF_SIGNED|ERR_TLS_CERT|UNABLE_TO_|ERR_SSL_|HPE_)/;

const hostNext = new Map(); // host -> time the next request may start
const HOST_GAP_MS = parseInt(process.env.HOST_GAP_MS || '400', 10);

async function throttle(host) {
  const now = Date.now();
  const at = Math.max(now, hostNext.get(host) || 0);
  hostNext.set(host, at + HOST_GAP_MS);
  if (at > now) await new Promise((r) => setTimeout(r, at - now));
}

/** Returns { ok, status, text, finalUrl, netError }. netError=true => don't trust a "miss". */
async function fetchText(url, { timeout = DEFAULT_TIMEOUT, polite = true, method = 'GET', body, headers = {}, maxBytes = MAX_BYTES } = {}) {
  let host = '';
  try {
    host = new URL(url).host;
  } catch {
    return { ok: false, status: 0, text: '', netError: false };
  }
  if (breakerOpen(host)) {
    errorCounts.BREAKER_SKIPPED = (errorCounts.BREAKER_SKIPPED || 0) + 1;
    return { ok: false, status: 0, text: '', netError: true, error: 'BREAKER_SKIPPED' };
  }
  if (polite) await throttle(host);
  await acquireHost(host);
  await acquire();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      method,
      body,
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': UA, Accept: '*/*', ...headers },
    });
    const netError = res.status === 429 || res.status >= 500;
    if (netError) noteFailure(host);
    else hostFail.delete(host);
    const buf = await res.arrayBuffer();
    const text = new TextDecoder('utf-8').decode(buf.byteLength > maxBytes ? buf.slice(0, maxBytes) : buf);
    return { ok: res.ok, status: res.status, text, finalUrl: res.url, netError };
  } catch (e) {
    const why = (e && e.cause && (e.cause.code || e.cause.message)) || (e && e.name) || 'unknown';
    errorCounts[why] = (errorCounts[why] || 0) + 1;
    hostErrors[host] = (hostErrors[host] || 0) + 1;
    const transient = !PERMANENT.test(String(why));
    if (transient) noteFailure(host);
    return { ok: false, status: 0, text: '', netError: transient, error: String(why) };
  } finally {
    clearTimeout(t);
    release();
    releaseHost(host);
  }
}

async function fetchJson(url, opts = {}) {
  const r = await fetchText(url, { polite: false, timeout: 10000, headers: { Accept: 'application/json' }, ...opts });
  // 403/407 on an API call means we were blocked (proxy/WAF), not that the board is absent.
  if (!r.ok) return { json: null, netError: r.netError || r.status === 403 || r.status === 407 };
  try {
    return { json: JSON.parse(r.text), netError: false };
  } catch {
    return { json: null, netError: false };
  }
}

/* ------------------------------- robots.txt -------------------------------- */
const robotsCache = new Map();

async function loadRobots(origin) {
  if (robotsCache.has(origin)) return robotsCache.get(origin);
  const p = (async () => {
    const r = await fetchText(origin + '/robots.txt', { polite: true, timeout: 6000 });
    const disallow = [];
    if (r.ok) {
      let applies = false;
      for (const raw of r.text.split(/\r?\n/)) {
        const line = raw.split('#')[0].trim();
        const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
        if (!m) continue;
        const k = m[1].toLowerCase();
        const v = m[2].trim();
        if (k === 'user-agent') applies = v === '*' || /sponsorjobbot/i.test(v);
        else if (k === 'disallow' && applies && v) disallow.push(v);
      }
    }
    return disallow;
  })();
  robotsCache.set(origin, p);
  return p;
}

async function allowedByRobots(url) {
  try {
    const u = new URL(url);
    const rules = await loadRobots(u.origin);
    const p = u.pathname + u.search;
    return !rules.some((rule) => rule === '/' || p.startsWith(rule.replace(/\*.*$/, '')));
  } catch {
    return true;
  }
}

/** Polite page fetch for company websites: obeys robots.txt. */
async function fetchPage(url, opts = {}) {
  if (!(await allowedByRobots(url))) return { ok: false, status: 403, text: '', blockedByRobots: true, netError: false };
  return fetchText(url, opts);
}

module.exports = { fetchText, fetchJson, fetchPage, UA, errorCounts, hostErrors, setMaxInflight };
