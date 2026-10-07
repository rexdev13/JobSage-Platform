// Company website discovery: name -> domain, then crawl for careers page, ATS links, JSON-LD jobs and role mailboxes.
const dns = require('dns').promises;
const cheerio = require('cheerio');
const { fetchPage, fetchJson } = require('./http');
const { significantWords, cleanName } = require('./ats');

const TLDS = ['co.uk', 'com', 'org.uk', 'uk', 'org', 'net'];
const PARKED = /(domain (is )?for sale|buy this domain|this domain may be for sale|parked (free|domain)|godaddy|sedoparking|hugedomains|account suspended|coming soon|under construction|404 not found)/i;
const BAD_DOMAINS = /(facebook|linkedin|twitter|instagram|youtube|wikipedia|companieshouse|gov\.uk|indeed|glassdoor|yell\.com|checkatrade|trustpilot|reed\.co|totaljobs|cv-library|google|bing|duckduckgo|crunchbase|dnb\.com|endole|opencorporates)/i;

const CAREER_HINT = /(career|job|vacanc|recruit|work-?with-?us|join-?(us|our|the)|opportunit|we-?re-?hiring|hiring|employment|working-?(for|at|with))/i;
const CONTACT_HINT = /(contact|about)/i;
// Only role-based mailboxes are collected (never named individuals).
const ROLE_LOCALS = /^(careers?|jobs?|recruit(ment|ing|er|ers)?|hr|people|talent|hiring|vacanc(y|ies)|applications?|apply|resourcing|humanresources|human\.resources|workwithus|joinus|team|hello|info|enquiries|enquiry|contact|admin|office|general|mail|reception|support)$/i;
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

function candidateDomains(name) {
  const words = significantWords(name);
  if (!words.length) return [];
  const bases = new Set([words.join(''), words.join('-')]);
  if (words.length > 1) {
    bases.add(words.slice(0, 2).join(''));
    bases.add(words.slice(0, 2).join('-'));
  }
  const out = [];
  for (const b of bases) if (b.length >= 3) for (const t of TLDS) out.push(`${b}.${t}`);
  return out;
}

function nameMatchesPage(name, html, title, domain = '') {
  // Strict: the company name must be in the page TITLE/H1 (or the domain itself), not just anywhere in the body.
  const words = significantWords(name);
  if (!words.length) return false;
  const head = ' ' + String(title).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ') + ' ';
  const dom = String(domain).toLowerCase().replace(/^www\./, '').split('.')[0].replace(/[^a-z0-9]/g, '');
  if (head.includes(' ' + words.join(' ') + ' ')) return true;
  if (dom && dom.includes(words.join(''))) return true;
  if (words.length === 1) return head.includes(' ' + words[0] + ' ');
  return words.length <= 4 && words.every((w) => head.includes(' ' + w + ' '));
}

/** Optional search fallback. Set SERPER_API_KEY (serper.dev) or BRAVE_API_KEY. */
async function searchDomain(name, town) {
  const q = `${name} ${town || ''} official website UK`.trim();
  const urls = [];
  if (process.env.SERPER_API_KEY) {
    const { fetchText } = require('./http');
    const r = await fetchText('https://google.serper.dev/search', {
      polite: false,
      method: 'POST',
      headers: { 'X-API-KEY': process.env.SERPER_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q, gl: 'uk', num: 8 }),
    });
    try {
      JSON.parse(r.text).organic?.forEach((o) => urls.push(o.link));
    } catch {}
  } else if (process.env.BRAVE_API_KEY) {
    const { json } = await fetchJson(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&country=gb&count=8`, {
      headers: { 'X-Subscription-Token': process.env.BRAVE_API_KEY, Accept: 'application/json' },
    });
    json?.web?.results?.forEach((o) => urls.push(o.url));
  }
  const domains = [];
  for (const u of urls) {
    try {
      const h = new URL(u).hostname.replace(/^www\./, '');
      if (!BAD_DOMAINS.test(h) && !domains.includes(h)) domains.push(h);
    } catch {}
  }
  return domains.slice(0, 3);
}

// DNS gets rate-limited under load (EAI_AGAIN): cap concurrent lookups, cache answers, retry.
const dnsCache = new Map();
let dnsActive = 0;
const dnsWait = [];
async function dnsSlot() {
  if (dnsActive < 16) return void dnsActive++;
  await new Promise((r) => dnsWait.push(r));
}
function dnsFree() {
  const n = dnsWait.shift();
  if (n) n();
  else dnsActive--;
}
function lookupDomain(domain) {
  if (dnsCache.has(domain)) return dnsCache.get(domain);
  const p = (async () => {
    await dnsSlot();
    try {
      for (let i = 0; i < 3; i++) {
        try {
          await dns.lookup(domain);
          return 'ok';
        } catch (e) {
          if (e.code === 'ENOTFOUND' || e.code === 'ENODATA') return 'none';
          await new Promise((r) => setTimeout(r, 300 * (i + 1)));
        }
      }
      return 'unknown';
    } finally {
      dnsFree();
    }
  })();
  dnsCache.set(domain, p);
  p.then((v) => v === 'unknown' && dnsCache.delete(domain));
  return p;
}

async function tryDomain(name, domain) {
  // Cheap pre-check: most guessed domains don't exist, so skip them without any HTTP request.
  if ((await lookupDomain(domain)) === 'none') return null;
  for (const scheme of ['https://', 'http://']) {
    const r = await fetchPage(scheme + domain);
    if (r.blockedByRobots) return { blocked: true };
    if (r.ok && r.text) {
      const $ = cheerio.load(r.text);
      const title = $('title').first().text() + ' ' + ($('meta[property="og:site_name"]').attr('content') || '');
      if (PARKED.test(title) || (r.text.length < 3000 && PARKED.test(r.text))) return null;
      const h1 = $('h1').first().text();
      if (nameMatchesPage(name, r.text, title + ' ' + h1, domain)) return { url: r.finalUrl || scheme + domain, html: r.text };
      return null;
    }
    if (!r.netError && r.status) break; // real HTTP answer, no need to try plain http
  }
  return null;
}

/** Find the official site. Guesses first (free), search API only if configured. */
async function resolveSite(name, town) {
  const cands = candidateDomains(name);
  for (let i = 0; i < cands.length; i += 6) {
    // 6 candidates at a time (different hosts), but keep priority order when picking the winner.
    const batch = cands.slice(i, i + 6);
    const hits = await Promise.all(batch.map((d) => tryDomain(name, d)));
    const idx = hits.findIndex((h) => h && !h.blocked);
    if (idx >= 0) return { ...hits[idx], domain: batch[idx], method: 'guess' };
  }
  for (const d of await searchDomain(name, town)) {
    const hit = await tryDomain(name, d);
    if (hit && !hit.blocked) return { ...hit, domain: d, method: 'search' };
  }
  return null;
}

/* --------------------------------- parsing --------------------------------- */
function absolute(href, base) {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

function extractLinks(html, base) {
  const $ = cheerio.load(html);
  const links = [];
  $('a[href], iframe[src], script[src], link[href]').each((_, el) => {
    const raw = $(el).attr('href') || $(el).attr('src');
    const u = raw && absolute(raw, base);
    if (u && /^https?:/i.test(u)) links.push({ url: u, text: $(el).text().trim().slice(0, 80) });
  });
  // ATS embeds are often only referenced in inline scripts / data attributes.
  const inline = html.match(/https?:\/\/[a-z0-9.-]+\/[^\s"'<>\\)]*/gi) || [];
  for (const u of inline) links.push({ url: u, text: '' });
  return links;
}

function extractEmails(html, siteDomain) {
  const $ = cheerio.load(html);
  const found = new Set();
  $('a[href^="mailto:"]').each((_, el) => {
    const e = ($(el).attr('href') || '').replace(/^mailto:/i, '').split('?')[0].trim().toLowerCase();
    if (e) found.add(e);
  });
  (($.root().text().match(EMAIL_RE)) || []).forEach((e) => found.add(e.toLowerCase()));
  const root = siteDomain.split('.').slice(-3).join('.');
  return [...found].filter((e) => {
    const [local, dom] = e.split('@');
    if (!dom || /\.(png|jpg|jpeg|gif|svg|webp)$/i.test(dom)) return false;
    return ROLE_LOCALS.test(local) && (dom === siteDomain || dom.endsWith('.' + siteDomain) || root.endsWith(dom) || dom.endsWith(root));
  });
}

function extractJsonLdJobs(html, pageUrl, company) {
  const $ = cheerio.load(html);
  const jobs = [];
  const visit = (n) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach(visit);
    const t = [].concat(n['@type'] || []);
    if (t.includes('JobPosting')) {
      const loc = [].concat(n.jobLocation || [])[0];
      const a = loc && loc.address ? loc.address : {};
      jobs.push({
        title: n.title || '',
        location: [a.addressLocality, a.addressRegion, a.addressCountry?.name || a.addressCountry].filter(Boolean).join(', '),
        url: n.url || pageUrl,
        ats: 'website',
        company,
        posted: n.datePosted || '',
      });
    }
    if (n['@graph']) visit(n['@graph']);
    if (n.itemListElement) visit(n.itemListElement);
    if (n.item) visit(n.item);
  };
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      visit(JSON.parse($(el).contents().text()));
    } catch {}
  });
  return jobs;
}

/**
 * Crawl one website (max ~6 pages): homepage -> careers pages -> contact page.
 * Returns { careersUrls, linkUrls, jobs, emails }.
 */
async function crawlSite(site, company) {
  const base = site.url;
  const host = new URL(base).hostname.replace(/^www\./, '');
  const seen = new Set([base]);
  const pages = [{ url: base, html: site.html }];
  const allLinks = extractLinks(site.html, base);

  const pick = (re, max) => {
    const out = [];
    for (const l of allLinks) {
      let sameSite = false;
      try {
        sameSite = new URL(l.url).hostname.replace(/^www\./, '').endsWith(host);
      } catch {}
      if (!sameSite || seen.has(l.url) || /\.(pdf|jpg|png|zip|docx?)$/i.test(l.url)) continue;
      if (re.test(l.url) || re.test(l.text)) {
        seen.add(l.url);
        out.push(l.url);
        if (out.length >= max) break;
      }
    }
    return out;
  };

  const careerTargets = pick(CAREER_HINT, 2);
  // Common fallbacks if nothing is linked from the homepage.
  if (!careerTargets.length) for (const p of ['/careers', '/jobs', '/vacancies', '/join-us']) careerTargets.push(new URL(p, base).toString());
  const contactTargets = pick(CONTACT_HINT, 1);
  if (!contactTargets.length) contactTargets.push(new URL('/contact', base).toString());

  const careersUrls = [];
  for (const u of [...careerTargets, ...contactTargets]) {
    const r = await fetchPage(u);
    if (r.ok && r.text) {
      pages.push({ url: r.finalUrl || u, html: r.text });
      if (careerTargets.includes(u)) careersUrls.push(r.finalUrl || u);
      allLinks.push(...extractLinks(r.text, u));
    }
  }

  // Off-site links that look like a careers destination (e.g. company.wd3.myworkdayjobs.com).
  for (const l of allLinks) if (CAREER_HINT.test(l.text) && !seen.has(l.url) && !new URL(l.url).hostname.endsWith(host)) careersUrls.push(l.url);

  const jobs = [];
  const emails = new Set();
  for (const p of pages) {
    jobs.push(...extractJsonLdJobs(p.html, p.url, company));
    extractEmails(p.html, host).forEach((e) => emails.add(e));
  }
  return {
    careersUrls: [...new Set(careersUrls)].slice(0, 5),
    linkUrls: [...new Set(allLinks.map((l) => l.url))],
    jobs,
    emails: [...emails].slice(0, 6),
  };
}

module.exports = { resolveSite, crawlSite, candidateDomains, extractEmails, extractJsonLdJobs, extractLinks, nameMatchesPage };
