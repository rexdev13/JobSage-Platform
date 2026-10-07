// ATS boards: fetchers by exact reference, plus a name-based slug prober.
const { fetchJson } = require('./http');

const J = (title, location, url, ats, company) => ({ title: title || '', location: location || '', url: url || '', ats, company });

/* Each fetcher takes a ref ({slug, ...}) and returns { jobs|null, netError }. null jobs = not a board. */
const FETCHERS = {
  async greenhouse({ slug }, company) {
    const { json, netError } = await fetchJson(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`);
    const jobs = json && Array.isArray(json.jobs) ? json.jobs.map((x) => J(x.title, x.location?.name, x.absolute_url, 'greenhouse', company)) : null;
    return { jobs, netError };
  },
  async lever({ slug }, company) {
    const { json, netError } = await fetchJson(`https://api.lever.co/v0/postings/${slug}?mode=json`);
    const jobs = Array.isArray(json) ? json.map((x) => J(x.text, x.categories?.location, x.hostedUrl, 'lever', company)) : null;
    return { jobs, netError };
  },
  async ashby({ slug }, company) {
    const { json, netError } = await fetchJson(`https://api.ashbyhq.com/posting-api/job-board/${slug}`);
    const jobs = json && Array.isArray(json.jobs) ? json.jobs.map((x) => J(x.title, x.location, x.jobUrl, 'ashby', company)) : null;
    return { jobs, netError };
  },
  async workable({ slug }, company) {
    const { json, netError } = await fetchJson(`https://apply.workable.com/api/v1/widget/accounts/${slug}`);
    const jobs =
      json && Array.isArray(json.jobs)
        ? json.jobs.map((x) => J(x.title, [x.city, x.country].filter(Boolean).join(', '), x.url || x.shortlink, 'workable', company))
        : null;
    return { jobs, netError, boardName: json && json.name };
  },
  async smartrecruiters({ slug }, company) {
    const { json, netError } = await fetchJson(`https://api.smartrecruiters.com/v1/companies/${slug}/postings?limit=100`);
    const jobs =
      json && Array.isArray(json.content) && json.totalFound > 0
        ? json.content.map((x) =>
            J(x.name, [x.location?.city, x.location?.country].filter(Boolean).join(', '), `https://jobs.smartrecruiters.com/${slug}/${x.id}`, 'smartrecruiters', company)
          )
        : null;
    const c0 = json && json.content && json.content[0] && json.content[0].company;
    return { jobs, netError, boardName: c0 && c0.name };
  },
  async recruitee({ slug }, company) {
    const { json, netError } = await fetchJson(`https://${slug}.recruitee.com/api/offers/`);
    const jobs = json && Array.isArray(json.offers) ? json.offers.map((x) => J(x.title, x.location, x.careers_url, 'recruitee', company)) : null;
    return { jobs, netError };
  },
  async bamboohr({ slug }, company) {
    const { json, netError } = await fetchJson(`https://${slug}.bamboohr.com/careers/list`);
    const jobs =
      json && Array.isArray(json.result)
        ? json.result.map((x) => J(x.jobOpeningName, [x.location?.city, x.location?.state].filter(Boolean).join(', '), `https://${slug}.bamboohr.com/careers/${x.id}`, 'bamboohr', company))
        : null;
    return { jobs, netError };
  },
  // Workday: ref = { host, tenant, site }. Public CXS endpoint used by their own careers pages.
  async workday({ host, tenant, site }, company) {
    const base = `https://${host}`;
    const out = [];
    let netErr = false;
    for (let offset = 0; offset < 200; offset += 20) {
      const { fetchText } = require('./http');
      const r = await fetchText(`${base}/wday/cxs/${tenant}/${site}/jobs`, {
        polite: false,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ appliedFacets: {}, limit: 20, offset, searchText: '' }),
      });
      if (r.netError) netErr = true;
      if (!r.ok) return { jobs: out.length ? out : null, netError: netErr };
      let j;
      try {
        j = JSON.parse(r.text);
      } catch {
        return { jobs: out.length ? out : null, netError: netErr };
      }
      const posts = j.jobPostings || [];
      posts.forEach((p) => out.push(J(p.title, p.locationsText, `${base}/${site}${p.externalPath}`, 'workday', company)));
      if (posts.length < 20 || out.length >= (j.total || 0)) break;
    }
    return { jobs: out, netError: netErr };
  },
};

/* ------------------------- name -> slug candidates -------------------------- */
const NOISE = new Set(['ltd', 'limited', 'plc', 'llp', 'llc', 'inc', 'incorporated', 'co', 'company', 'corp', 'corporation', 'group', 'holdings', 'the', 'and', 'of', 'cic', 'lp']);

function cleanName(name) {
  return String(name).toLowerCase().replace(/\(.*?\)/g, ' ').replace(/&/g, ' and ').replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim();
}

function significantWords(name) {
  return cleanName(name).split(' ').filter((w) => w && !NOISE.has(w));
}

function generateSlugs(name) {
  const all = cleanName(name).split(' ').filter(Boolean);
  const words = all.filter((w) => !NOISE.has(w));
  if (!words.length) return [];
  const out = [];
  const add = (slug, confidence) => slug && slug.length >= 3 && !out.some((o) => o.slug === slug) && out.push({ slug, confidence });
  add(words.join(''), 'high');
  add(words.join('-'), 'high');
  add(all.join('-'), 'high');
  add(all.join(''), 'high');
  add(words.join('') + 'uk', 'medium');
  add(words.join('-') + '-uk', 'medium');
  if (words.length > 1) {
    add(words.slice(0, 2).join(''), 'medium');
    add(words.slice(0, 2).join('-'), 'medium');
    add(words[0], 'low');
  }
  return out;
}

const SLUG_ATS = ['greenhouse', 'lever', 'ashby', 'workable', 'smartrecruiters']; // recruitee/bamboohr are only used when a site links to them

// Workable/SmartRecruiters tell us the board's company name: reject boards that belong to a different company.
function boardNameOk(boardName, words) {
  if (!boardName) return true;
  const b = cleanName(boardName).replace(/\s+/g, '');
  return words.every((x) => b.includes(x));
}

/** Try every slug x ATS from the company name. Returns {found, ats, ref, confidence, jobs, netError}. */
async function probeByName(company) {
  let netError = false;
  // Only full-name slugs: first-word / partial guesses matched unrelated companies' boards.
  const w = significantWords(company);
  const slugList = [...new Set([w.join(''), w.join('-')])].filter((x) => x.length >= 3).map((slug) => ({ slug, confidence: 'high' }));
  for (const { slug, confidence } of slugList) {
    let batchErrors = 0;
    const checks = await Promise.all(
      SLUG_ATS.map(async (ats) => {
        const r = await FETCHERS[ats]({ slug }, company);
        if (r.netError) (netError = true), batchErrors++;
        return r.jobs ? { ats, jobs: r.jobs, boardName: r.boardName } : null;
      })
    );
    const hits = checks.filter(Boolean).filter((h) => boardNameOk(h.boardName, w)).sort((a, b) => b.jobs.length - a.jobs.length);
    if (!hits.length && batchErrors === SLUG_ATS.length) break; // every request failed: network/blocked, stop wasting time
    if (hits.length) return { found: true, ats: hits[0].ats, ref: { slug }, confidence, jobs: hits[0].jobs, netError };
  }
  return { found: false, netError };
}

/* ------------- detect ATS references inside links found on a website -------- */
const LINK_PATTERNS = [
  { ats: 'greenhouse', re: /(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io\/(?:embed\/job_board\?for=)?([a-z0-9_-]+)/i, ref: (m) => ({ slug: m[1] }) },
  { ats: 'greenhouse', re: /greenhouse\.io\/embed\/job_board\/?\?for=([a-z0-9_-]+)/i, ref: (m) => ({ slug: m[1] }) },
  { ats: 'lever', re: /jobs\.(?:eu\.)?lever\.co\/([a-z0-9_-]+)/i, ref: (m) => ({ slug: m[1] }) },
  { ats: 'ashby', re: /jobs\.ashbyhq\.com\/([a-z0-9_.-]+)/i, ref: (m) => ({ slug: m[1] }) },
  { ats: 'workable', re: /apply\.workable\.com\/([a-z0-9_-]+)/i, ref: (m) => ({ slug: m[1] }) },
  { ats: 'smartrecruiters', re: /(?:jobs|careers)\.smartrecruiters\.com\/([a-z0-9_-]+)/i, ref: (m) => ({ slug: m[1] }) },
  { ats: 'recruitee', re: /([a-z0-9-]+)\.recruitee\.com/i, ref: (m) => ({ slug: m[1] }) },
  { ats: 'bamboohr', re: /([a-z0-9-]+)\.bamboohr\.com\/(?:careers|jobs)/i, ref: (m) => ({ slug: m[1] }) },
  {
    ats: 'workday',
    re: /(([a-z0-9-]+)\.wd\d+\.myworkdayjobs\.com)\/(?:[a-z]{2}-[A-Z]{2}\/)?([A-Za-z0-9_-]+)/i,
    ref: (m) => ({ host: m[1], tenant: m[2], site: m[3] }),
  },
];

// Detected but with no simple public JSON API: we still surface the careers URL for the company-websites tab.
const NAME_ONLY = [
  ['teamtailor', /teamtailor\.com/i],
  ['personio', /jobs\.personio\.(?:de|com)/i],
  ['jobvite', /jobs\.jobvite\.com/i],
  ['icims', /icims\.com/i],
  ['taleo', /taleo\.net/i],
  ['successfactors', /successfactors\.(?:com|eu)/i],
  ['oracle-cloud', /oraclecloud\.com\/hcmUI/i],
  ['eploy', /eploy\.net|eploy\.co\.uk/i],
  ['tribepad', /tribepad\.com/i],
  ['pinpoint', /pinpointhq\.com/i],
  ['breezy', /breezy\.hr/i],
  ['jazzhr', /applytojob\.com/i],
  ['cezanne', /cezannehr\.com/i],
  ['nhs-jobs', /jobs\.nhs\.uk|beta\.jobs\.nhs\.uk/i],
  ['civil-service', /civilservicejobs\.service\.gov\.uk/i],
  ['hireful', /hireful\.co\.uk/i],
];

function detectAts(urls) {
  const refs = [];
  const nameOnly = new Set();
  for (const u of urls) {
    let matched = false;
    for (const p of LINK_PATTERNS) {
      const m = u.match(p.re);
      if (m) {
        const slug = (m[1] || '').toLowerCase();
        if (['embed', 'api', 'www', 'jobs'].includes(slug)) continue;
        const ref = p.ref(m);
        const key = p.ats + JSON.stringify(ref);
        if (!refs.some((r) => r.key === key)) refs.push({ key, ats: p.ats, ref });
        matched = true;
        break;
      }
    }
    if (!matched) for (const [name, re] of NAME_ONLY) if (re.test(u)) nameOnly.add(name);
  }
  return { refs, nameOnly: [...nameOnly] };
}

async function fetchByRef(ats, ref, company) {
  const f = FETCHERS[ats];
  if (!f) return { jobs: null, netError: false };
  return f(ref, company);
}

module.exports = { probeByName, fetchByRef, detectAts, generateSlugs, significantWords, cleanName };
