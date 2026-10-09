#!/usr/bin/env node
// Node resolves DNS on a tiny thread pool (4). Raise it before anything else loads.
process.env.UV_THREADPOOL_SIZE = process.env.UV_THREADPOOL_SIZE || '64';
/**
 * Sponsor vacancy pipeline.
 *
 *   node run.js register                         download the Home Office register, split into sector CSVs
 *   node run.js discover --sector healthcare --limit 500
 *   node run.js discover --sector all --concurrency 20      (resumes automatically)
 *   node run.js export                           build output/vacancies.csv + output/companies.csv
 *   node run.js stats                            progress per sector
 *
 * discover flags: --sector a,b|all  --limit N  --offset N  --concurrency N  --route "Skilled Worker"
 *                 --no-site (ATS-name probe only)
 *                 --refresh (re-check everything)  --retry-unknown (redo only the unreachable ones)  --shuffle
 */
const fs = require('fs');
const path = require('path');
const { downloadRegister, parseCsv, toCsv } = require('./lib/register');
const { probeByName, fetchByRef, detectAts } = require('./lib/ats');
const { errorCounts, hostErrors, fetchText } = require('./lib/http');

const DATA = path.join(__dirname, 'data');
const OUT = path.join(__dirname, 'output');
const RESULTS = path.join(DATA, 'results.jsonl');

/* -------------------------------- per company -------------------------------- */
async function processCompany(c, opts = {}) {
  const startedAt = Date.now();
  const { resolveSite, crawlSite } = require('./lib/site');
  const jobs = [];
  const rec = {
    name: c.name, sector: c.sector, industry: c.industry || '', town: c.town,
    ats: null, domain: null, domainMethod: null, careersUrls: [], atsDetected: [], emails: [], emailEvidence: [], verifiedRecruitmentRoutes: [], sourceDiagnostics: {}, jobs: [],
  };
  let netError = false;
  let crawlComplete = true;
  const resolve = opts.resolveSite || resolveSite;
  const referenceHint = opts.referenceHint || null;
  rec.sponsorMatchStatus = referenceHint?.status || '';

  // Stage 1: the website. It reveals the real job system, so it is both the most accurate and the cheapest route.
  const site = opts.noSite ? null : await resolve(c.name, c.town);
  if (site) {
    rec.domain = site.domain;
    rec.domainMethod = site.method;
    const crawl = await crawlSite(site, c.name, referenceHint?.careersUrls || [], referenceHint?.evidenceUrls || []);
    crawlComplete = crawl.complete !== false;
    rec.careersUrls = crawl.careersUrls;
    rec.emails = crawl.emails;
    rec.emailEvidence = crawl.emailEvidence || [];
    rec.verifiedRecruitmentRoutes = crawl.verifiedRecruitmentRoutes || [];
    rec.sourceDiagnostics = crawl.sourceDiagnostics || {};
    jobs.push(...crawl.jobs);

    const { refs, nameOnly } = detectAts(crawl.linkUrls);
    rec.atsDetected = [...new Set([...refs.map((r) => r.ats), ...nameOnly])];
    for (const r of refs.slice(0, 3)) {
      const got = await fetchByRef(r.ats, r.ref, c.name);
      if (got.netError) netError = true;
      if (got.jobs && got.jobs.length) {
        jobs.push(...got.jobs);
        if (!rec.ats) rec.ats = { name: r.ats, ref: r.ref, confidence: 'site-link' };
      }
    }
  }

  // A supplied review file may identify a public ATS board even when the
  // official website is unresolved. Fetch the board live; retain its review
  // flag so this does not become an automatic legal-entity match.
  if (!rec.ats && !jobs.length && referenceHint?.refs?.length) {
    for (const r of referenceHint.refs.slice(0, 3)) {
      const got = await fetchByRef(r.ats, r.ref, c.name);
      if (got.netError) netError = true;
      if (got.jobs?.length) {
        jobs.push(...got.jobs);
        rec.ats = { name: r.ats, ref: r.ref, confidence: 'reference-review' };
        break;
      }
    }
  }

  // Stage 2: only if the site gave us no job feed (or no site was found), guess the board from the company name.
  // A matching slug is not proof that a board belongs to this legal sponsor.
  // Keep name-only probing as an explicit research mode; never export its jobs.
  if (opts.probeUnverified && !rec.ats && !jobs.length) {
    const probe = await probeByName(c.name);
    if (probe.netError) netError = true;
    if (probe.found) {
      rec.ats = { name: probe.ats, ref: probe.ref, confidence: probe.confidence };
      rec.unverifiedBoardJobs = probe.jobs.length;
    }
  }

  const seen = new Set();
  rec.jobs = jobs.filter((j) => {
    const url = normalizeJobUrl(j.url);
    if (!url || seen.has(url)) return false;
    seen.add(url);
    j.url = url;
    j.freshnessStatus = 'current_source_observation';
    j.observedAt = new Date().toISOString();
    return true;
  });
  // UK sponsor board: keep UK-based roles only. Wrong-company matches show up as Athens/Brooklyn/Tokyo jobs.
  const UK = /\b(uk|u\.k\.|united kingdom|england|scotland|wales|northern ireland|great britain|gb|london|manchester|birmingham|leeds|glasgow|edinburgh|bristol|liverpool|sheffield|cardiff|belfast|newcastle|nottingham|leicester|southampton|oxford|cambridge|reading|coventry|aberdeen)\b/i;
  const town = String(c.town || '').toLowerCase();
  const before = rec.jobs.length;
  rec.jobs = rec.jobs.filter((j) => {
    const loc = String(j.location || '').toLowerCase();
    if (UK.test(loc) || (town && loc.includes(town))) return true;
    return !loc && j.ats === 'website';
  });
  if (opts.verifyLinks && rec.jobs.length) {
    const verified = await verifyJobLinks(rec.jobs, Number(opts.maxVerifyLinks || 20));
    rec.jobs = verified.jobs;
    rec.linkVerificationInconclusive = verified.transientFailures;
  }

  rec.droppedNonUk = before - rec.jobs.length;
  if (!rec.jobs.length && rec.ats && rec.ats.confidence !== 'site-link') rec.ats = null;
  // A "found nothing" answer caused by network errors is unreliable: flag it so it gets retried.
  rec.incomplete = !crawlComplete || netError;
  rec.checkedAt = new Date().toISOString();
  rec.durationMs = Date.now() - startedAt;
  return rec;
}

function normalizeJobUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:') return null;
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_.+|source|ref|referrer|tracking|trk)$/i.test(key)) url.searchParams.delete(key);
    }
    url.pathname = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : url.pathname;
    return url.toString();
  } catch { return null; }
}

async function verifyJobLinks(jobs, maxLinks) {
  const limit = Number.isSafeInteger(maxLinks) && maxLinks > 0 ? Math.min(maxLinks, 100) : 20;
  const selected = jobs.slice(0, limit);
  let transientFailures = 0;
  let cursor = 0;
  const checkedAt = new Date().toISOString();
  const closed = /\b(?:job|vacancy|position|role)\b.{0,80}\b(?:closed|filled|expired|no longer (?:available|accepting applications))\b/i;
  const worker = async () => {
    while (cursor < selected.length) {
      const job = selected[cursor++];
      const r = await fetchText(job.url, { timeout: 12000, maxBytes: 350 * 1024 });
      job.linkCheckedAt = checkedAt;
      if (r.ok && !closed.test(r.text)) job.freshnessStatus = 'deep_link_live';
      else if (r.status === 404 || r.status === 410 || (r.ok && closed.test(r.text))) job.freshnessStatus = 'deep_link_dead';
      else {
        job.freshnessStatus = 'deep_link_inconclusive';
        if (r.netError) transientFailures++;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, selected.length) }, worker));
  return { jobs: jobs.filter((job) => job.freshnessStatus !== 'deep_link_dead'), transientFailures };
}

/* ---------------------------------- helpers ---------------------------------- */
function loadCompanies() {
  const f = path.join(DATA, 'companies.json');
  if (!fs.existsSync(f)) throw new Error('No register yet. Run: node run.js register');
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}
const companyKey = (c) => `${String(c.name).trim().toLowerCase()}|${String(c.town).trim().toLowerCase()}`;

function companyMatchesArgs(c, args, sectors) {
  if (sectors && !sectors.includes(c.sector)) return false;
  if (args.industry) {
    const industries = String(args.industry).split(',').map((value) => value.trim().toLowerCase());
    if (!industries.includes(String(c.industry || '').trim().toLowerCase())) return false;
  }
  if (args.name && String(c.name).trim().toLowerCase() !== String(args.name).trim().toLowerCase()) return false;
  if (args.route && !c.routes.toLowerCase().includes(String(args.route).toLowerCase())) return false;
  return true;
}

function makeReferenceHints(file) {
  const hints = new Map();
  if (!file || !fs.existsSync(file)) return hints;
  const rows = parseCsv(fs.readFileSync(file, 'utf8'));
  const headers = rows.shift().map((x) => x.trim().toLowerCase());
  const ix = ['sponsor_name', 'apply_url', 'application_mode', 'sponsor_match_status'].map((field) => headers.indexOf(field));
  if (ix.includes(-1)) throw new Error('Reference file needs sponsor_name,apply_url,application_mode,sponsor_match_status');
  for (const row of rows) {
    const name = row[ix[0]]?.trim();
    const url = row[ix[1]]?.trim();
    const mode = row[ix[2]]?.trim();
    const status = row[ix[3]]?.trim() || 'review-required';
    if (!name || !/^https:\/\//i.test(url || '')) continue;
    const key = name.toLowerCase();
    const hint = hints.get(key) || { name, status, urls: [], refs: [], explicitReview: true };
    if (hint.status !== status) hint.status = 'conflicting-review-status';
    hint.urls.push(url);
    if (mode === 'job_board') {
      const detected = detectAts([url]);
      hint.refs.push(...detected.refs);
    }
    hints.set(key, hint);
  }
  for (const hint of hints.values()) {
    hint.urls = [...new Set(hint.urls)];
    const seen = new Set();
    hint.refs = hint.refs.filter((item) => {
      const key = `${item.ats}:${JSON.stringify(item.ref)}`;
      return !seen.has(key) && seen.add(key);
    });
  }
  console.log(`Loaded ${hints.size} sponsor source hints from review evidence`);
  return hints;
}

function makeWebsiteEvidenceHints(file) {
  const hints = new Map();
  if (!file || !fs.existsSync(file)) return hints;
  const rows = parseCsv(fs.readFileSync(file, 'utf8'));
  const headers = rows.shift().map((x) => x.trim().toLowerCase());
  const index = Object.fromEntries(headers.map((header, i) => [header, i]));
  for (const row of rows) {
    const name = row[index.organisation_name]?.trim();
    const town = row[index.town_city]?.trim();
    const website = row[index.official_website_url]?.trim() || row[index.existing_website]?.trim();
    const careers = row[index.existing_careers_url]?.trim();
    const contactEmail = row[index.existing_contact_email]?.trim();
    const evidenceUrl = row[index.website_evidence_url]?.trim();
    const confidence = (row[index.website_confidence] || 'unverified').trim().toLowerCase();
    if (!name || !town || (!website && !careers)) continue;
    const key = companyKey({ name, town });
    const hint = hints.get(key) || {
      name,
      town,
      status: confidence === 'high' ? 'exact-name-town-website-confirmed' : `website-${confidence}-review`,
      urls: [],
      refs: [],
      website: null,
      explicitReview: false,
      careersUrls: [],
      recruitmentEmails: [],
      evidenceUrls: [],
    };
    if (website && !hint.website) hint.website = website;
    if (careers) hint.careersUrls.push(careers);
    if (contactEmail && /^(?:careers?|jobs?|recruit(?:ment|ing)?|talent|hiring|vacanc(?:y|ies)|applications?|apply|resourcing|workwithus|joinus|hr)@/i.test(contactEmail)) {
      hint.recruitmentEmails.push(contactEmail);
      if (evidenceUrl) hint.evidenceUrls.push(evidenceUrl);
    }
    hint.urls.push(...[website, careers].filter(Boolean));
    const detected = detectAts([careers].filter(Boolean));
    hint.refs.push(...detected.refs);
    hints.set(key, hint);
  }
  for (const hint of hints.values()) {
    hint.urls = [...new Set(hint.urls)];
    hint.careersUrls = [...new Set(hint.careersUrls)];
    hint.recruitmentEmails = [...new Set(hint.recruitmentEmails)];
    hint.evidenceUrls = [...new Set(hint.evidenceUrls)];
    const seen = new Set();
    hint.refs = hint.refs.filter((item) => {
      const key = `${item.ats}:${JSON.stringify(item.ref)}`;
      return !seen.has(key) && seen.add(key);
    });
  }
  return hints;
}

function mergeReferenceHints(...maps) {
  const merged = new Map();
  for (const map of maps) for (const [key, value] of map) {
    const current = merged.get(key);
    if (!current) merged.set(key, { ...value, urls: [...value.urls], refs: [...value.refs] });
    else {
      current.urls = [...new Set([...current.urls, ...value.urls])];
      current.careersUrls = [...new Set([...(current.careersUrls || []), ...(value.careersUrls || [])])];
      current.recruitmentEmails = [...new Set([...(current.recruitmentEmails || []), ...(value.recruitmentEmails || [])])];
      current.evidenceUrls = [...new Set([...(current.evidenceUrls || []), ...(value.evidenceUrls || [])])];
      const refs = [...current.refs, ...value.refs];
      const seen = new Set();
      current.refs = refs.filter((item) => {
        const refKey = `${item.ats}:${JSON.stringify(item.ref)}`;
        return !seen.has(refKey) && seen.add(refKey);
      });
      if (!current.website && value.website) current.website = value.website;
      if (current.status !== 'exact-name-town-website-confirmed' && value.status === 'exact-name-town-website-confirmed') current.status = value.status;
    }
  }
  return merged;
}

function referenceHintFor(hints, company) {
  const exact = hints.get(companyKey(company));
  const name = hints.get(String(company.name).trim().toLowerCase());
  if (!exact) return name;
  if (!name || name === exact) return exact;
  const refs = [...exact.refs, ...name.refs];
  const seen = new Set();
  return {
    ...exact,
    status: name.explicitReview ? name.status : exact.status,
    explicitReview: exact.explicitReview || name.explicitReview,
    urls: [...new Set([...exact.urls, ...name.urls])],
    careersUrls: [...new Set([...(exact.careersUrls || []), ...(name.careersUrls || [])])],
    recruitmentEmails: [...new Set([...(exact.recruitmentEmails || []), ...(name.recruitmentEmails || [])])],
    evidenceUrls: [...new Set([...(exact.evidenceUrls || []), ...(name.evidenceUrls || [])])],
    refs: refs.filter((item) => {
      const key = `${item.ats}:${JSON.stringify(item.ref)}`;
      return !seen.has(key) && seen.add(key);
    }),
  };
}

function makeSiteResolver(files, referenceHints = new Map()) {
  const inputFiles = (Array.isArray(files) ? files : [files]).filter((file) => file && fs.existsSync(file));
  if (!inputFiles.length) return undefined;
  const key = (name, town) => `${String(name).trim().toLowerCase()}|${String(town).trim().toLowerCase()}`;
  const sites = new Map();
  for (const file of inputFiles) {
    const rows = parseCsv(fs.readFileSync(file, 'utf8'));
    const headers = rows.shift().map((x) => x.trim().toLowerCase());
    const index = Object.fromEntries(headers.map((header, i) => [header, i]));
    if (index.organisation_name == null || index.town_city == null) continue;
    for (const row of rows) {
      const url = row[index.website]?.trim() || row[index.official_website_url]?.trim() || row[index.existing_website]?.trim();
      if (!url) continue;
      const k = key(row[index.organisation_name], row[index.town_city]);
      if (!sites.has(k)) sites.set(k, url);
      else if (sites.get(k) !== url) sites.set(k, null); // conflicting mappings need review
    }
  }
  console.log(`Loaded ${[...sites.values()].filter(Boolean).length} unique saved website mappings`);
  const resolver = async (name, town) => {
    const { resolveSite, resolveKnownSite, resolveReferenceSite } = require('./lib/site');
    const saved = sites.get(key(name, town));
    const reviewed = referenceHints.get(key(name, town)) || referenceHints.get(String(name).trim().toLowerCase());
    return (saved && await resolveKnownSite(saved, name)) ||
      (reviewed?.urls?.length && await resolveReferenceSite(reviewed.urls[0], name, reviewed.status)) ||
      resolveSite(name, town);
  };
  resolver.hasSeed = (name, town) => !!sites.get(key(name, town));
  return resolver;
}

function loadDone(resultsFile = RESULTS) {
  const done = new Map();
  if (!fs.existsSync(resultsFile)) return done;
  for (const line of fs.readFileSync(resultsFile, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      const key = companyKey(r);
      // Keep the last complete snapshot if a newer refresh lost network access.
      if (!r.incomplete && !r.unknown || !done.has(key)) done.set(key, r);
    } catch {}
  }
  return done;
}

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const k = argv[i].slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      a[k] = v;
    } else a._.push(argv[i]);
  }
  return a;
}

function blankRec(c) {
  return { name: c.name, sector: c.sector, industry: c.industry || '', town: c.town, ats: null, domain: null, domainMethod: null, careersUrls: [], atsDetected: [], emails: [], emailEvidence: [], verifiedRecruitmentRoutes: [], jobs: [], incomplete: true, checkedAt: new Date().toISOString() };
}

/** Runs the list through a worker pool, retrying network-failed companies at lower speed (2 extra passes). */
async function runDiscovery(list, { concurrency = 20, noSite = false, probeUnverified = false } = {}, deps = {}) {
  const proc = deps.processCompany || processCompany;
  const resultsFile = deps.resultsFile || RESULTS;
  fs.mkdirSync(path.dirname(resultsFile), { recursive: true });
  const out = fs.createWriteStream(resultsFile, { flags: 'a' });
  const st = { recorded: 0, withJobs: 0, jobs: 0, sites: 0, emails: 0, unknown: 0 };
  const started = Date.now();
  const total = list.length;

  const record = (rec, final) => {
    if (rec.incomplete) {
      if (!final) return false;
      rec.unknown = true; // still unreachable after retries: store it so reruns skip it (use --refresh to redo)
      st.unknown++;
    }
    out.write(JSON.stringify(rec) + '\n');
    st.recorded++;
    if (rec.jobs.length) st.withJobs++;
    st.jobs += rec.jobs.length;
    if (rec.domain) st.sites++;
    if (rec.emails.length) st.emails++;
    return true;
  };
  const line = (label) => {
    const secs = (Date.now() - started) / 1000;
    const rate = st.recorded / Math.max(secs, 1);
    const left = Math.max(total - st.recorded, 0);
    const eta = rate > 0 ? Math.round(left / rate / 60) : '?';
    console.log(`${label} ${st.recorded}/${total} | ${rate.toFixed(2)}/s | ETA ~${eta} min | vacancies ${st.withJobs} cos (${st.jobs} jobs) | sites ${st.sites} | emails ${st.emails}`);
  };
  const timer = setInterval(() => line('...'), 15000);

  let pending = list;
  for (let pass = 0; pass <= 2 && pending.length; pass++) {
    const conc = pass === 0 ? concurrency : Math.max(2, Math.floor(concurrency / 3));
    if (pass > 0) console.log(`Retry pass ${pass}: ${pending.length} companies that hit network errors, at concurrency ${conc}`);
    const next = [];
    let i = 0;
    const worker = async () => {
      while (i < pending.length) {
        const c = pending[i++];
        let rec;
        try {
          rec = await proc(c, {
            noSite, probeUnverified, resolveSite: deps.resolveSite, verifyLinks: deps.verifyLinks,
            maxVerifyLinks: deps.maxVerifyLinks,
            referenceHint: deps.referenceHints && referenceHintFor(deps.referenceHints, c),
          });
        } catch {
          rec = blankRec(c);
        }
        if (!record(rec, pass === 2)) next.push(c);
      }
    };
    await Promise.all(Array.from({ length: Math.min(conc, pending.length) }, worker));
    pending = next;
  }
  clearInterval(timer);
  await new Promise((r) => out.end(r));
  return { ...st, total, seconds: Math.round((Date.now() - started) / 1000) };
}

async function discover(args) {
  const all = loadCompanies();
  const { setMaxInflight } = require('./lib/http');
  setMaxInflight(parseInt(args.inflight || '60', 10));
  const sectors = !args.sector || args.sector === 'all' ? null : String(args.sector).split(',');
  let list = all.filter((c) => companyMatchesArgs(c, args, sectors));
  const resultsFile = args['results-file'] ? path.resolve(String(args['results-file'])) : RESULTS;
  const done = loadDone(resultsFile);
  if (!args.refresh)
    list = list.filter((c) => {
      const d = done.get(companyKey(c));
      return !d || (args['retry-unknown'] && d.unknown); // --retry-unknown redoes only companies that were unreachable last time
    });
  if (args.shuffle) list.sort(() => Math.random() - 0.5);
  const offset = parseInt(args.offset || '0', 10);
  const limit = parseInt(args.limit || '0', 10);
  list = list.slice(offset, limit ? offset + limit : undefined);

  const concurrency = parseInt(args.concurrency || '12', 10);
  console.log(`Discovering ${list.length} companies (concurrency ${concurrency}). Ctrl+C is safe; rerun to resume.`);
  const siteFile = args['sites-file'] || path.join(__dirname, '..', 'exports', 'sponsor-websites-production.csv');
  const evidenceFile = args['evidence-file'] || path.join(__dirname, '..', 'artifacts', 'non-healthcare-company-websites-all-sectors.csv');
  const referenceHints = mergeReferenceHints(makeReferenceHints(args['reference-file']), makeWebsiteEvidenceHints(evidenceFile));
  const r = await runDiscovery(list, { concurrency, noSite: !!args['no-site'], probeUnverified: !!args['probe-unverified'] }, {
    resolveSite: makeSiteResolver([siteFile, evidenceFile], referenceHints), referenceHints, resultsFile,
    verifyLinks: !!args['verify-links'], maxVerifyLinks: Number(args['max-verify-links'] || 20),
  });
  console.log(`Done in ${r.seconds}s. ${r.recorded} recorded (${r.unknown} still unreachable), ${r.withJobs} with vacancies (${r.jobs} jobs), ${r.sites} websites, ${r.emails} with emails. Run: node run.js export`);
  const errs = Object.entries(errorCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (errs.length) console.log('Request failures (cause: count):', errs.map(([k, v]) => `${k}: ${v}`).join(' | '));
  const hosts = Object.entries(hostErrors).sort((a, b) => b[1] - a[1]).slice(0, 6);
  if (hosts.length) console.log('Failing hosts:', hosts.map(([k, v]) => `${k}: ${v}`).join(' | '));
}

/** Bounded, resumable scheduled scan. A second cron invocation exits without overlap. */
async function cron(args) {
  const resultsFile = args['results-file'] ? path.resolve(String(args['results-file'])) : RESULTS;
  fs.mkdirSync(path.dirname(resultsFile), { recursive: true });
  const lockPath = args['lock-file'] ? path.resolve(String(args['lock-file'])) : path.join(path.dirname(resultsFile), 'cron.lock');
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  let lock;
  try {
    lock = fs.openSync(lockPath, 'wx');
  } catch (e) {
    if (e.code === 'EEXIST') {
      const pid = Number(fs.readFileSync(lockPath, 'utf8'));
      let active = false;
      try { if (pid > 0) { process.kill(pid, 0); active = true; } } catch (err) { if (err.code === 'EPERM') active = true; }
      if (active) return console.log('Previous cron scan is still running; skipping.');
      fs.unlinkSync(lockPath);
      lock = fs.openSync(lockPath, 'wx');
    } else throw e;
  }
  try {
    fs.writeFileSync(lock, String(process.pid));
    const limit = Number(args.limit || 500);
    const hours = Number(args['max-age-hours'] || 48);
    if (!Number.isSafeInteger(limit) || limit < 1 || !Number.isFinite(hours) || hours <= 0) throw new Error('Invalid --limit or --max-age-hours');
    const done = loadDone(resultsFile);
    const sectors = !args.sector || args.sector === 'all' ? null : String(args.sector).split(',');
    const siteFile = args['sites-file'] || path.join(__dirname, '..', 'exports', 'sponsor-websites-production.csv');
    const evidenceFile = args['evidence-file'] || path.join(__dirname, '..', 'artifacts', 'non-healthcare-company-websites-all-sectors.csv');
    const referenceHints = mergeReferenceHints(makeReferenceHints(args['reference-file']), makeWebsiteEvidenceHints(evidenceFile));
    const resolver = makeSiteResolver([siteFile, evidenceFile], referenceHints);
    let priorityPattern = null;
    if (args['priority-pattern']) {
      if (String(args['priority-pattern']).length > 300) throw new Error('--priority-pattern is too long');
      priorityPattern = new RegExp(String(args['priority-pattern']), 'i');
    }
    const ordered = loadCompanies().filter((c) => companyMatchesArgs(c, args, sectors))
      .filter((c) => !args['careers-evidence-only'] || referenceHintFor(referenceHints, c)?.careersUrls?.length)
      .filter((c) => !args['recruitment-email-evidence-only'] || referenceHintFor(referenceHints, c)?.recruitmentEmails?.length)
      .sort((a, b) => {
        const priority = Number(priorityPattern?.test(b.name) || false) - Number(priorityPattern?.test(a.name) || false);
        return priority || (Date.parse(done.get(companyKey(a))?.checkedAt || '') || 0) - (Date.parse(done.get(companyKey(b))?.checkedAt || '') || 0);
      });
    // Refresh employers with saved official sites regularly while retaining a
    // bounded lane for the much larger unsourced register cohort.
    const known = ordered.filter((c) => resolver?.hasSeed(c.name, c.town));
    const unknown = ordered.filter((c) => !resolver?.hasSeed(c.name, c.town));
    const knownQuota = unknown.length
      ? Math.min(known.length, Math.floor(limit * 0.8))
      : Math.min(known.length, limit);
    const list = [...known.slice(0, knownQuota), ...unknown.slice(0, limit - knownQuota)];
    if (list.length < limit) list.push(...known.slice(knownQuota, knownQuota + (limit - list.length)));
    const { setMaxInflight } = require('./lib/http');
    setMaxInflight(Math.min(60, Math.max(1, Number(args.inflight || 30))));
    const result = await runDiscovery(list, {
      concurrency: Math.min(20, Math.max(1, Number(args.concurrency || 8))),
      noSite: !!args['no-site'],
      probeUnverified: !!args['probe-unverified'],
    }, {
      resolveSite: resolver, referenceHints, resultsFile, verifyLinks: true, maxVerifyLinks: Number(args['max-verify-links'] || 20),
    });
    exportAll({ ...args, 'results-file': resultsFile, 'max-age-hours': hours });
    console.log('Cron scan:', result);
  } finally {
    fs.closeSync(lock);
    fs.unlinkSync(lockPath);
  }
}

function exportAll(args = {}) {
  const resultsFile = args['results-file'] ? path.resolve(String(args['results-file'])) : RESULTS;
  const outDir = args['out-dir'] ? path.resolve(String(args['out-dir'])) : OUT;
  const done = [...loadDone(resultsFile).values()];
  fs.mkdirSync(outDir, { recursive: true });
  const hours = Number(args['max-age-hours'] || 48);
  if (!Number.isFinite(hours) || hours <= 0) throw new Error('--max-age-hours must be positive');
  const cutoff = Date.now() - hours * 3600000;
  const vac = [['sponsor_name', 'sector', 'industry', 'title', 'location', 'apply_url', 'application_mode', 'source', 'observed_at', 'sponsor_match_status', 'import_eligible', 'sponsorship_status', 'careers_page', 'public_role_emails', 'contact_evidence_urls', 'send_cv_status', 'freshness_status', 'link_checked_at']];
  const comp = [['sponsor_name', 'sector', 'industry', 'town', 'website', 'website_verification', 'sponsor_match_status', 'import_eligible', 'ats', 'ats_detected', 'careers_urls', 'public_role_emails', 'contact_evidence_urls', 'send_cv_status', 'vacancy_count', 'checked_at', 'runtime_ms', 'source_diagnostics', 'application_modes']];
  const sendCv = [['sponsor_name', 'sector', 'industry', 'town', 'recruitment_email', 'evidence_url', 'verification_method', 'send_cv_status', 'checked_at']];
  const seen = new Set();
  for (const r of done) {
    if (r.incomplete || r.unknown || !Number.isFinite(Date.parse(r.checkedAt)) || Date.parse(r.checkedAt) < cutoff) continue;
    const jobs = (r.jobs || []).filter((j) => j.title && /^https:\/\//i.test(j.url || '') && j.ats !== 'unverified');
    const explicitRouteEmails = new Set((r.verifiedRecruitmentRoutes || []).map((route) => route.email));
    const roleEmails = (r.emails || []).filter((email) =>
      explicitRouteEmails.has(email) || /^(?:careers?|jobs?|recruit(?:ment|ing)?|talent|hiring|vacanc(?:y|ies)|applications?|apply|resourcing|workwithus|joinus|hr)@/i.test(email)
    );
    const evidenceUrls = [...new Set((r.emailEvidence || []).filter((item) => roleEmails.includes(item.email)).map((item) => item.url))];
    const verifiedRoutes = (r.verifiedRecruitmentRoutes || []).filter((route) => roleEmails.includes(route.email));
    // Every job discovered here comes from an employer-specific website or ATS
    // tenant. Hosted ATS pages are first-party application routes, not generic
    // multi-employer job boards.
    const modes = jobs.length ? 'company_website' : '';
    const sponsorMatchStatus = r.sponsorMatchStatus || (r.domainMethod === 'saved-website-confirmed' ? 'exact-name-town-website-confirmed' : 'register-name-town');
    const importEligible = ['exact-register-name', 'exact-name-town-website-confirmed'].includes(sponsorMatchStatus) ? 'true' : 'false';
    const sendCvStatus = verifiedRoutes.length && importEligible === 'true'
      ? 'verified_recruitment_route'
      : roleEmails.length ? 'employer_level_review_required' : '';
    comp.push([
      r.name, r.sector, r.industry || '', r.town, r.domain || '', r.domainMethod || '', sponsorMatchStatus, importEligible, r.ats ? r.ats.name : '', (r.atsDetected || []).join('|'),
      (r.careersUrls || []).join('|'), roleEmails.join('|'), evidenceUrls.join('|'), sendCvStatus, jobs.length, r.checkedAt, r.durationMs || '', JSON.stringify({ ...(r.sourceDiagnostics || {}), droppedNonUk: r.droppedNonUk || 0, linkVerificationInconclusive: r.linkVerificationInconclusive || 0 }), modes,
    ]);
    for (const route of verifiedRoutes) {
      if (importEligible !== 'true') continue;
      sendCv.push([r.name, r.sector, r.industry || '', r.town, route.email, route.url, route.evidenceType, 'verified_recruitment_route', r.checkedAt]);
    }
    for (const j of jobs) {
      if (seen.has(j.url)) continue;
      seen.add(j.url);
      vac.push([r.name, r.sector, r.industry || '', j.title, j.location, j.url, 'company_website', j.source || j.ats, j.observedAt || r.checkedAt,
        sponsorMatchStatus, importEligible, 'unknown', (r.careersUrls || [])[0] || '', roleEmails.join('|'), evidenceUrls.join('|'), sendCvStatus,
        j.freshnessStatus || 'current_source_observation', j.linkCheckedAt || '']);
    }
  }
  fs.writeFileSync(path.join(outDir, 'vacancies.csv'), toCsv(vac));
  fs.writeFileSync(path.join(outDir, 'companies.csv'), toCsv(comp));
  fs.writeFileSync(path.join(outDir, 'send-cv-routes.csv'), toCsv(sendCv));
  console.log(`Wrote ${vac.length - 1} vacancies and ${comp.length - 1} companies to ${outDir}`);
}


async function doctor() {
  const targets = [
    ['gov.uk register page', 'https://www.gov.uk/government/publications/register-of-licensed-sponsors-workers'],
    ['Greenhouse API', 'https://boards-api.greenhouse.io/v1/boards/stripe/jobs'],
    ['Lever API', 'https://api.lever.co/v0/postings/spotify?mode=json'],
    ['Ashby API', 'https://api.ashbyhq.com/posting-api/job-board/ashby'],
    ['Workable API', 'https://apply.workable.com/api/v1/widget/accounts/workable'],
    ['SmartRecruiters API', 'https://api.smartrecruiters.com/v1/companies/smartrecruiters/postings'],
    ['Recruitee API', 'https://recruitee.recruitee.com/api/offers/'],
    ['BambooHR API', 'https://bamboohr.bamboohr.com/careers/list'],
    ['Workday', 'https://workday.wd5.myworkdayjobs.com/'],
    ['Example UK company site', 'https://www.bbc.co.uk/'],
  ];
  console.log('Testing connections from this computer (any HTTP status = reachable)...');
  await Promise.all(
    targets.map(async ([name, url]) => {
      const t0 = Date.now();
      const r = await fetchText(url, { polite: false, timeout: 12000 });
      const ms = Date.now() - t0;
      console.log(`${(r.status ? 'OK    HTTP ' + r.status : 'FAIL  ' + (r.error || 'error')).padEnd(34)} ${String(ms).padStart(5)}ms  ${name}`);
    })
  );
}

function stats(args = {}) {
  const all = loadCompanies();
  const resultsFile = args['results-file'] ? path.resolve(String(args['results-file'])) : RESULTS;
  const done = loadDone(resultsFile);
  const rows = {};
  for (const c of all) {
    const s = (rows[c.sector] = rows[c.sector] || { total: 0, done: 0, withJobs: 0, jobs: 0, emails: 0, sites: 0 });
    s.total++;
    const r = done.get(companyKey(c));
    if (r) {
      s.done++;
      if (r.jobs.length) s.withJobs++;
      s.jobs += r.jobs.length;
      if (r.emails.length) s.emails++;
      if (r.domain) s.sites++;
    }
  }
  console.table(rows);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  if (cmd === 'register') {
    const industryFile = args['industry-file'] || path.join(__dirname, '..', 'artifacts', 'non-healthcare-company-websites-all-sectors.csv');
    const sponsorRoute = args['all-worker-routes'] ? null : String(args['sponsor-route'] || 'Skilled Worker');
    const r = await downloadRegister({ url: args.url, file: args.file, industryFile, sponsorRoute });
    console.log(`Register: ${r.total} ${r.sponsorRoute} organisations; ${r.classifiedFromEvidence} sectors from local industry evidence`);
    console.table(r.summary);
  } else if (cmd === 'discover') await discover(args);
  else if (cmd === 'cron') await cron(args);
  else if (cmd === 'export') exportAll(args);
  else if (cmd === 'stats') stats(args);
  else if (cmd === 'doctor') await doctor();
  else console.log('Commands: register | discover | cron | export | stats | doctor  (see header of run.js)');
}

if (require.main === module) {
  main()
    // Some remote HTTP stacks retain idle keep-alive handles on Windows. All
    // files and locks are closed before main resolves, so explicitly end the
    // one-shot CLI instead of letting scheduled jobs hang indefinitely.
    .then(() => process.exit(0))
    .catch((e) => (console.error(e.message), process.exit(1)));
}
module.exports = {
  processCompany, runDiscovery, exportAll, makeReferenceHints, makeWebsiteEvidenceHints,
  mergeReferenceHints, referenceHintFor, makeSiteResolver, normalizeJobUrl, verifyJobLinks,
};
