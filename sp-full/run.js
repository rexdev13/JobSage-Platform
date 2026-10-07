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
const { downloadRegister, toCsv } = require('./lib/register');
const { probeByName, fetchByRef, detectAts } = require('./lib/ats');
const { resolveSite, crawlSite } = require('./lib/site');
const { errorCounts, hostErrors, fetchText } = require('./lib/http');

const DATA = path.join(__dirname, 'data');
const OUT = path.join(__dirname, 'output');
const RESULTS = path.join(DATA, 'results.jsonl');

/* -------------------------------- per company -------------------------------- */
async function processCompany(c, opts = {}) {
  const jobs = [];
  const rec = {
    name: c.name, sector: c.sector, town: c.town,
    ats: null, domain: null, domainMethod: null, careersUrls: [], atsDetected: [], emails: [], jobs: [],
  };
  let netError = false;
  const resolve = opts.resolveSite || resolveSite;

  // Stage 1: the website. It reveals the real job system, so it is both the most accurate and the cheapest route.
  const site = opts.noSite ? null : await resolve(c.name, c.town);
  if (site) {
    rec.domain = site.domain;
    rec.domainMethod = site.method;
    const crawl = await crawlSite(site, c.name);
    rec.careersUrls = crawl.careersUrls;
    rec.emails = crawl.emails;
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

  // Stage 2: only if the site gave us no job feed (or no site was found), guess the board from the company name.
  if (!opts.noProbe && !rec.ats && !jobs.length) {
    const probe = await probeByName(c.name);
    if (probe.netError) netError = true;
    if (probe.found) {
      rec.ats = { name: probe.ats, ref: probe.ref, confidence: probe.confidence };
      jobs.push(...probe.jobs);
    }
  }

  const seen = new Set();
  rec.jobs = jobs.filter((j) => j.url && !seen.has(j.url) && seen.add(j.url));
  // UK sponsor board: keep UK-based roles only. Wrong-company matches show up as Athens/Brooklyn/Tokyo jobs.
  const UK = /\b(uk|u\.k\.|united kingdom|england|scotland|wales|northern ireland|great britain|gb|london|manchester|birmingham|leeds|glasgow|edinburgh|bristol|liverpool|sheffield|cardiff|belfast|newcastle|nottingham|leicester|southampton|oxford|cambridge|reading|coventry|aberdeen)\b/i;
  const town = String(c.town || '').toLowerCase();
  const before = rec.jobs.length;
  rec.jobs = rec.jobs.filter((j) => {
    const loc = String(j.location || '').toLowerCase();
    if (UK.test(loc) || (town && loc.includes(town))) return true;
    return !loc && j.ats === 'website';
  });
  rec.droppedNonUk = before - rec.jobs.length;
  if (!rec.jobs.length && rec.ats && rec.ats.confidence !== 'site-link') rec.ats = null;
  // A "found nothing" answer caused by network errors is unreliable: flag it so it gets retried.
  rec.incomplete = netError && !rec.jobs.length && !rec.domain;
  rec.checkedAt = new Date().toISOString();
  return rec;
}

/* ---------------------------------- helpers ---------------------------------- */
function loadCompanies() {
  const f = path.join(DATA, 'companies.json');
  if (!fs.existsSync(f)) throw new Error('No register yet. Run: node run.js register');
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}

function loadDone() {
  const done = new Map();
  if (!fs.existsSync(RESULTS)) return done;
  for (const line of fs.readFileSync(RESULTS, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      done.set(r.name.toLowerCase(), r);
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
  return { name: c.name, sector: c.sector, town: c.town, ats: null, domain: null, domainMethod: null, careersUrls: [], atsDetected: [], emails: [], jobs: [], incomplete: true, checkedAt: new Date().toISOString() };
}

/** Runs the list through a worker pool, retrying network-failed companies at lower speed (2 extra passes). */
async function runDiscovery(list, { concurrency = 20, noSite = false, noProbe = false } = {}, deps = {}) {
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
          rec = await proc(c, { noSite, noProbe, resolveSite: deps.resolveSite });
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
  let list = all.filter((c) => (!sectors || sectors.includes(c.sector)) && (!args.route || c.routes.toLowerCase().includes(String(args.route).toLowerCase())));
  const done = loadDone();
  if (!args.refresh)
    list = list.filter((c) => {
      const d = done.get(c.name.toLowerCase());
      return !d || (args['retry-unknown'] && d.unknown); // --retry-unknown redoes only companies that were unreachable last time
    });
  if (args.shuffle) list.sort(() => Math.random() - 0.5);
  const offset = parseInt(args.offset || '0', 10);
  const limit = parseInt(args.limit || '0', 10);
  list = list.slice(offset, limit ? offset + limit : undefined);

  const concurrency = parseInt(args.concurrency || '12', 10);
  console.log(`Discovering ${list.length} companies (concurrency ${concurrency}). Ctrl+C is safe; rerun to resume.`);
  const r = await runDiscovery(list, { concurrency, noSite: !!args['no-site'] });
  console.log(`Done in ${r.seconds}s. ${r.recorded} recorded (${r.unknown} still unreachable), ${r.withJobs} with vacancies (${r.jobs} jobs), ${r.sites} websites, ${r.emails} with emails. Run: node run.js export`);
  const errs = Object.entries(errorCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (errs.length) console.log('Request failures (cause: count):', errs.map(([k, v]) => `${k}: ${v}`).join(' | '));
  const hosts = Object.entries(hostErrors).sort((a, b) => b[1] - a[1]).slice(0, 6);
  if (hosts.length) console.log('Failing hosts:', hosts.map(([k, v]) => `${k}: ${v}`).join(' | '));
}

function exportAll() {
  const done = [...loadDone().values()];
  fs.mkdirSync(OUT, { recursive: true });
  const vac = [['company', 'sector', 'town', 'title', 'location', 'url', 'source', 'careers_page', 'recruitment_emails']];
  const comp = [['company', 'sector', 'town', 'website', 'ats', 'ats_detected', 'careers_urls', 'recruitment_emails', 'vacancy_count', 'checked_at']];
  const seen = new Set();
  for (const r of done) {
    comp.push([
      r.name, r.sector, r.town, r.domain || '', r.ats ? r.ats.name : '', (r.atsDetected || []).join('|'),
      (r.careersUrls || []).join('|'), (r.emails || []).join('|'), r.jobs.length, r.checkedAt,
    ]);
    for (const j of r.jobs) {
      if (seen.has(j.url)) continue;
      seen.add(j.url);
      vac.push([r.name, r.sector, r.town, j.title, j.location, j.url, j.ats, (r.careersUrls || [])[0] || '', (r.emails || []).join('|')]);
    }
  }
  fs.writeFileSync(path.join(OUT, 'vacancies.csv'), toCsv(vac));
  fs.writeFileSync(path.join(OUT, 'companies.csv'), toCsv(comp));
  console.log(`Wrote ${vac.length - 1} vacancies and ${comp.length - 1} companies to ${OUT}`);
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

function stats() {
  const all = loadCompanies();
  const done = loadDone();
  const rows = {};
  for (const c of all) {
    const s = (rows[c.sector] = rows[c.sector] || { total: 0, done: 0, withJobs: 0, jobs: 0, emails: 0, sites: 0 });
    s.total++;
    const r = done.get(c.name.toLowerCase());
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
    const r = await downloadRegister({ url: args.url, file: args.file });
    console.log(`Register: ${r.total} organisations`);
    console.table(r.summary);
  } else if (cmd === 'discover') await discover(args);
  else if (cmd === 'export') exportAll();
  else if (cmd === 'stats') stats();
  else if (cmd === 'doctor') await doctor();
  else console.log('Commands: register | discover | export | stats | doctor  (see header of run.js)');
}

if (require.main === module) main().catch((e) => (console.error(e.message), process.exit(1)));
module.exports = { processCompany, runDiscovery };
