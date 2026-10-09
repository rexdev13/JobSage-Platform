// Company website discovery: name -> domain, then crawl for careers page, ATS links, JSON-LD jobs and role mailboxes.
const dns = require('dns').promises;
const cheerio = require('cheerio');
const { fetchText, fetchPage, fetchJson } = require('./http');
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

async function resolveKnownSite(url, name) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (u.username || u.password || u.port || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(u.hostname)) return null;
    const r = await fetchPage(u.toString());
    if (!r.ok || !r.text) return null;
    const $ = cheerio.load(r.text);
    const title = $('title').first().text() + ' ' + ($('meta[property="og:site_name"]').attr('content') || '') + ' ' + $('h1').first().text();
    if (PARKED.test(title) || (r.text.length < 3000 && PARKED.test(r.text))) return null;
    const final = new URL(r.finalUrl || url);
    if (!nameMatchesPage(name, r.text, title, final.hostname)) return null;
    return { url: final.toString(), html: r.text, domain: final.hostname.replace(/^www\./, ''), method: 'saved-website-confirmed' };
  } catch { return null; }
}

async function resolveReferenceSite(url, name, reviewStatus) {
  try {
    const origin = new URL(url).origin + '/';
    const r = await fetchPage(origin);
    if (!r.ok || !r.text) return null;
    const final = new URL(r.finalUrl || origin);
    if (BAD_DOMAINS.test(final.hostname)) return null;
    const words = significantWords(name);
    const identityText = `${final.hostname} ${r.text.slice(0, 200000)}`.toLowerCase().replace(/[^a-z0-9]+/g, ' ');
    const required = words.slice(0, Math.min(2, words.length));
    if (!required.length || !required.every((word) => identityText.includes(word))) return null;
    return {
      url: final.toString(), html: r.text, domain: final.hostname.replace(/^www\./, ''),
      method: `reference-${reviewStatus || 'review-required'}`,
    };
  } catch { return null; }
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
      if (n.validThrough && Number.isFinite(Date.parse(n.validThrough)) && Date.parse(n.validThrough) < Date.now()) return;
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

function extractLinkedJobs(html, pageUrl, company) {
  const $ = cheerio.load(html);
  const host = new URL(pageUrl).hostname;
  const jobs = [];
  $('a[href]').each((_, el) => {
    const a = $(el);
    const url = absolute(a.attr('href'), pageUrl);
    if (!url || new URL(url).hostname !== host) return;
    const path = new URL(url).pathname;
    // Detail path and job-specific markup, never a generic job search or category page.
    if (!/\/(?:job|jobs|vacancies|postings)\/[^/?#]+(?:\/[^/?#]+)*/i.test(path)) return;
    const title = (a.attr('data-track-title') || a.find('h2,h3,h4').first().text() || a.attr('aria-label') || '').replace(/^View\s+/i, '').replace(/\s+job role$/i, '').trim();
    if (!title || title.length > 180 || /^(jobs?|apply|view|careers?|vacancies)$/i.test(title)) return;
    const location = (a.attr('data-track-text') || a.find('p').first().text() || '').trim();
    jobs.push({ title, location, url, ats: 'website', company });
  });
  return jobs;
}

function extractAlgoliaConfig(html) {
  const id = html.match(/\bAG_ID\s*=\s*["']([A-Z0-9]+)["']/i)?.[1];
  const key = html.match(/\bAG_KEY\s*=\s*["']([a-z0-9]+)["']/i)?.[1];
  const index = html.match(/\bAG_INDEX\s*=\s*\{[^}]*["']default["']\s*:\s*["']([^"']+)["']/i)?.[1];
  return id && key && index ? { id, key, index } : null;
}

function closingDateExpired(value) {
  const match = String(value || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return false;
  const end = Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1]), 23, 59, 59, 999);
  return Number.isFinite(end) && end < Date.now();
}

async function fetchAlgoliaJobs(html, pageUrl, company) {
  const config = extractAlgoliaConfig(html);
  if (!config) return { jobs: [], netError: false, diagnostics: null };
  const endpoint = `https://${config.id}-dsn.algolia.net/1/indexes/${encodeURIComponent(config.index)}/query`;
  const origin = new URL(pageUrl).origin;
  const response = await fetchText(endpoint, {
    polite: false,
    timeout: 30000,
    maxBytes: 25 * 1024 * 1024,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Algolia-Application-Id': config.id,
      'X-Algolia-API-Key': config.key,
      Origin: origin,
      Referer: pageUrl,
    },
    body: JSON.stringify({ params: 'hitsPerPage=1000&page=0' }),
  });
  if (!response.ok) return { jobs: [], netError: response.netError || response.status === 403, diagnostics: { status: response.status, raw: 0, accepted: 0, expired: 0, missingRequired: 0 } };
  try {
    const payload = JSON.parse(response.text);
    const hits = Array.isArray(payload.hits) ? payload.hits : [];
    const expired = hits.filter((hit) => closingDateExpired(hit.closing_date)).length;
    const missingRequired = hits.filter((hit) => !hit.title || !hit.jd_url).length;
    const jobs = hits.filter((hit) => hit.title && hit.jd_url && !closingDateExpired(hit.closing_date)).map((hit) => ({
      title: String(hit.title).trim(),
      location: String(hit.location || hit.town_city || '').trim(),
      url: new URL(hit.jd_url, origin).toString(),
      ats: 'website',
      source: 'algolia',
      company,
      posted: hit.opening_date || '',
      closes: hit.closing_date || '',
      externalId: String(hit.ats_requisition_id || hit.objectID || ''),
    }));
    return { jobs, netError: false, diagnostics: { status: response.status, raw: hits.length, accepted: jobs.length, expired, missingRequired } };
  } catch {
    return { jobs: [], netError: false, diagnostics: { status: response.status, raw: 0, accepted: 0, expired: 0, missingRequired: 0, parseError: true } };
  }
}

function nextListingPage(html, base) {
  const $ = cheerio.load(html);
  const next = $('a[rel="next"]').first().attr('href') || $('a[href]').filter((_, a) => /^(next|next page|›)$/i.test($(a).text().trim())).first().attr('href');
  const url = next && absolute(next, base);
  return url && new URL(url).hostname === new URL(base).hostname && url !== base ? url : null;
}

function hasExplicitCvInstruction(html, email) {
  const text = cheerio.load(html).root().text().replace(/\s+/g, ' ').trim();
  const index = text.toLowerCase().indexOf(String(email).toLowerCase());
  if (index < 0) return false;
  const context = text.slice(Math.max(0, index - 320), Math.min(text.length, index + email.length + 320));
  return /(?:send|submit|email|forward|attach)\s+(?:us\s+)?(?:your\s+)?(?:cv|résumé|resume)|(?:cv|résumé|resume)\s+(?:to|at)|applications?\s+(?:to|at|by\s+email)|apply\s+(?:by\s+)?email/i.test(context);
}

/**
 * Crawl one website (max ~6 pages): homepage -> careers pages -> contact page.
 * Returns { careersUrls, linkUrls, jobs, emails }.
 */
async function crawlSite(site, company, seedCareersUrls = [], seedEvidenceUrls = []) {
  const base = site.url;
  const host = new URL(base).hostname.replace(/^www\./, '');
  const seen = new Set([base]);
  const pages = [{ url: base, html: site.html }];
  let complete = true;
  const allLinks = extractLinks(site.html, base);

  const pick = (re, max) => {
    const out = [];
    for (const l of allLinks) {
      let sameSite = false;
      try {
        const linkHost = new URL(l.url).hostname.replace(/^www\./, '');
        sameSite = linkHost === host || linkHost.endsWith('.' + host);
      } catch {}
      if (!sameSite || seen.has(l.url) || /\.(pdf|jpg|png|zip|docx?)$/i.test(l.url)) continue;
      const parsed = new URL(l.url);
      // Do not test the hostname: on a domain such as *careers.com every
      // stylesheet and image would otherwise look like a careers route.
      if (re.test(`${parsed.pathname}${parsed.search}`) || re.test(l.text)) {
        seen.add(l.url);
        out.push(l.url);
        if (out.length >= max) break;
      }
    }
    return out;
  };

  const careerTargets = [...new Set(seedCareersUrls.filter((url) => /^https:\/\//i.test(url)))].slice(0, 3);
  if (careerTargets.length < 2) {
    for (const url of pick(CAREER_HINT, 2 - careerTargets.length)) {
      if (!careerTargets.includes(url)) careerTargets.push(url);
    }
  }
  // Common fallbacks if nothing is linked from the homepage.
  if (!careerTargets.length) for (const p of ['/careers', '/jobs', '/vacancies', '/join-us']) careerTargets.push(new URL(p, base).toString());
  const contactTargets = [...new Set(seedEvidenceUrls.filter((url) => /^https:\/\//i.test(url)))].slice(0, 2);
  if (!contactTargets.length) contactTargets.push(...pick(CONTACT_HINT, 1));
  if (!contactTargets.length) contactTargets.push(new URL('/contact', base).toString());

  const careersUrls = [];
  for (const u of [...careerTargets, ...contactTargets]) {
    const r = await fetchPage(u);
    if (r.ok && r.text) {
      pages.push({ url: r.finalUrl || u, html: r.text });
      if (careerTargets.includes(u)) careersUrls.push(r.finalUrl || u);
      allLinks.push(...extractLinks(r.text, u));
    } else if (r.netError) complete = false;
  }

  // Follow career pages linked directly by the confirmed employer site, including
  // separate careers domains, then walk explicit Next links with a hard page cap.
  const external = allLinks.filter((l) => CAREER_HINT.test(l.text) && /^https:\/\//i.test(l.url))
    .filter((l) => {
      const h = new URL(l.url).hostname.replace(/^www\./, '');
      return h !== host && !h.endsWith('.' + host);
    }).slice(0, 2);
  for (const link of external) {
    const r = await fetchPage(link.url);
    if (r.ok && r.text) {
      const careerPage = { url: r.finalUrl || link.url, html: r.text };
      pages.push(careerPage);
      const linked = extractLinks(r.text, careerPage.url);
      allLinks.push(...linked);
      if (!extractLinkedJobs(r.text, careerPage.url, company).length) {
        const listing = linked.find((x) => /\b(job search|search jobs|view (all )?jobs|current vacancies|browse jobs)\b/i.test(x.text));
        if (listing && new URL(listing.url).hostname === new URL(careerPage.url).hostname) {
          const next = await fetchPage(listing.url);
          if (next.ok && next.text) pages.push({ url: next.finalUrl || listing.url, html: next.text });
          else if (next.netError) complete = false;
        }
      }
    } else if (r.netError) complete = false;
  }
  const listingStarts = pages.filter((p) => extractLinkedJobs(p.html, p.url, company).length);
  for (const start of listingStarts.slice(0, 2)) {
    let current = start;
    const paged = new Set([current.url]);
    for (let page = 1; page < 50; page++) {
      const next = nextListingPage(current.html, current.url);
      if (!next || paged.has(next)) break;
      paged.add(next);
      const r = await fetchPage(next);
      if (!r.ok || !r.text) { if (r.netError) complete = false; break; }
      current = { url: r.finalUrl || next, html: r.text };
      pages.push(current);
    }
  }

  // Off-site links that look like a careers destination (e.g. company.wd3.myworkdayjobs.com).
  for (const l of allLinks) {
    const linkHost = new URL(l.url).hostname.replace(/^www\./, '');
    if (CAREER_HINT.test(l.text) && !seen.has(l.url) && linkHost !== host && !linkHost.endsWith('.' + host)) careersUrls.push(l.url);
  }

  const jobs = [];
  const emails = new Set();
  const emailEvidence = [];
  const verifiedRecruitmentRoutes = [];
  const sourceDiagnostics = {};
  for (const p of pages) {
    jobs.push(...extractJsonLdJobs(p.html, p.url, company));
    jobs.push(...extractLinkedJobs(p.html, p.url, company));
    extractEmails(p.html, host).forEach((e) => {
      emails.add(e);
      emailEvidence.push({ email: e, url: p.url });
      if (hasExplicitCvInstruction(p.html, e)) {
        verifiedRecruitmentRoutes.push({ email: e, url: p.url, evidenceType: 'explicit_cv_instruction' });
      }
    });
  }
  const algoliaPage = pages.find((p) => extractAlgoliaConfig(p.html));
  if (algoliaPage) {
    const algolia = await fetchAlgoliaJobs(algoliaPage.html, algoliaPage.url, company);
    jobs.push(...algolia.jobs);
    sourceDiagnostics.algolia = algolia.diagnostics;
    if (algolia.netError) complete = false;
  }
  return {
    careersUrls: [...new Set(careersUrls)].slice(0, 5),
    linkUrls: [...new Set(allLinks.map((l) => l.url))],
    jobs,
    emails: [...emails].slice(0, 6),
    emailEvidence: emailEvidence.filter((item, index, all) =>
      all.findIndex((candidate) => candidate.email === item.email && candidate.url === item.url) === index
    ).slice(0, 20),
    verifiedRecruitmentRoutes: verifiedRecruitmentRoutes.filter((item, index, all) =>
      all.findIndex((candidate) => candidate.email === item.email && candidate.url === item.url) === index
    ).slice(0, 20),
    sourceDiagnostics,
    complete,
  };
}

module.exports = { resolveSite, resolveKnownSite, resolveReferenceSite, crawlSite, candidateDomains, extractEmails, extractJsonLdJobs, extractLinkedJobs, extractAlgoliaConfig, extractLinks, nameMatchesPage, hasExplicitCvInstruction };
