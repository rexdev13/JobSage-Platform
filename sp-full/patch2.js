const fs = require('fs');
const dir = process.argv[2] || '.';
function edit(file, pairs) {
  const p = dir + '/' + file;
  let s = fs.readFileSync(p, 'utf8');
  for (const [a, b] of pairs) {
    if (s.split(a).length !== 2) throw new Error('Patch target not found exactly once in ' + file + ': ' + a.slice(0, 60));
    s = s.replace(a, () => b);
  }
  fs.writeFileSync(p, s);
  console.log('patched', file);
}

edit('lib/site.js', [
  [
    `async function tryDomain(name, domain) {
  // Cheap pre-check: most guessed domains don't exist, so skip them without any HTTP request.
  try {
    await dns.lookup(domain);
  } catch (e) {
    if (e.code === 'ENOTFOUND' || e.code === 'ENODATA') return null;
  }`,
    `// DNS gets rate-limited under load (EAI_AGAIN): cap concurrent lookups, cache answers, retry.
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
  if ((await lookupDomain(domain)) === 'none') return null;`,
  ],
]);

edit('lib/ats.js', [
  [
    `        : null;
    return { jobs, netError };
  },
  async smartrecruiters(`,
    `        : null;
    return { jobs, netError, boardName: json && json.name };
  },
  async smartrecruiters(`,
  ],
  [
    `        : null;
    return { jobs, netError };
  },
  async recruitee(`,
    `        : null;
    const c0 = json && json.content && json.content[0] && json.content[0].company;
    return { jobs, netError, boardName: c0 && c0.name };
  },
  async recruitee(`,
  ],
  [
    `return r.jobs ? { ats, jobs: r.jobs } : null;`,
    `return r.jobs ? { ats, jobs: r.jobs, boardName: r.boardName } : null;`,
  ],
  [
    `const hits = checks.filter(Boolean).sort(`,
    `const hits = checks.filter(Boolean).filter((h) => boardNameOk(h.boardName, w)).sort(`,
  ],
  [
    `/** Try every slug x ATS from the company name.`,
    `// Workable/SmartRecruiters tell us the board's company name: reject boards that belong to a different company.
function boardNameOk(boardName, words) {
  if (!boardName) return true;
  const b = cleanName(boardName).replace(/\\s+/g, '');
  return words.every((x) => b.includes(x));
}

/** Try every slug x ATS from the company name.`,
  ],
]);
