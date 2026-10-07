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
    `function nameMatchesPage(name, html, title) {
  const words = significantWords(name);
  if (!words.length) return false;
  const hay = (title + ' ' + html.slice(0, 40000)).toLowerCase().replace(/[^a-z0-9\\s]/g, ' ');
  const joined = words.join(' ');
  if (hay.includes(joined)) return true;
  if (words.length === 1) return hay.includes(words[0]);
  // Allow all significant words to appear (order-insensitive) for names with 2-4 words.
  return words.length <= 4 && words.every((w) => hay.includes(w));
}`,
    `function nameMatchesPage(name, html, title, domain = '') {
  // Strict: the company name must be in the page TITLE/H1 (or the domain itself), not just anywhere in the body.
  const words = significantWords(name);
  if (!words.length) return false;
  const head = ' ' + String(title).toLowerCase().replace(/[^a-z0-9\\s]/g, ' ').replace(/\\s+/g, ' ') + ' ';
  const dom = String(domain).toLowerCase().replace(/^www\\./, '').split('.')[0].replace(/[^a-z0-9]/g, '');
  if (head.includes(' ' + words.join(' ') + ' ')) return true;
  if (dom && dom.includes(words.join(''))) return true;
  if (words.length === 1) return head.includes(' ' + words[0] + ' ');
  return words.length <= 4 && words.every((w) => head.includes(' ' + w + ' '));
}`,
  ],
  [
    `      if (nameMatchesPage(name, r.text, title)) return`,
    `      const h1 = $('h1').first().text();
      if (nameMatchesPage(name, r.text, title + ' ' + h1, domain)) return`,
  ],
]);

edit('run.js', [
  [
    `  const seen = new Set();
  rec.jobs = jobs.filter((j) => j.url && !seen.has(j.url) && seen.add(j.url));`,
    `  const seen = new Set();
  rec.jobs = jobs.filter((j) => j.url && !seen.has(j.url) && seen.add(j.url));
  // UK sponsor board: keep UK-based roles only. Wrong-company matches show up as Athens/Brooklyn/Tokyo jobs.
  const UK = /\\b(uk|u\\.k\\.|united kingdom|england|scotland|wales|northern ireland|great britain|gb|london|manchester|birmingham|leeds|glasgow|edinburgh|bristol|liverpool|sheffield|cardiff|belfast|newcastle|nottingham|leicester|southampton|oxford|cambridge|reading|coventry|aberdeen)\\b/i;
  const town = String(c.town || '').toLowerCase();
  const before = rec.jobs.length;
  rec.jobs = rec.jobs.filter((j) => {
    const loc = String(j.location || '').toLowerCase();
    if (UK.test(loc) || (town && loc.includes(town))) return true;
    return !loc && j.ats === 'website';
  });
  rec.droppedNonUk = before - rec.jobs.length;
  if (!rec.jobs.length && rec.ats && rec.ats.confidence !== 'site-link') rec.ats = null;`,
  ],
]);
