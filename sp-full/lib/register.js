// Downloads the Home Office "Register of licensed sponsors: workers" CSV and splits it by sector.
const fs = require('fs');
const path = require('path');
const { fetchText } = require('./http');
const { classify, SECTORS } = require('./sectors');

const PAGE = 'https://www.gov.uk/government/publications/register-of-licensed-sponsors-workers';
const CONTENT_API = 'https://www.gov.uk/api/content/government/publications/register-of-licensed-sponsors-workers';
const DATA = path.join(__dirname, '..', 'data');

/** Minimal RFC4180 CSV parser (handles quotes, commas and newlines inside quotes). */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let q = false;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else q = false;
      } else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function toCsv(rows) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return rows.map((r) => r.map(esc).join(',')).join('\n') + '\n';
}

/** Find the current CSV link. The filename contains the date, so it must be discovered each time. */
async function findCsvUrl() {
  const re = /https:\/\/assets\.publishing\.service\.gov\.uk\/[^"'\s<>\\]+?Worker[^"'\s<>\\]*?\.csv/gi;
  for (const url of [CONTENT_API, PAGE]) {
    const r = await fetchText(url, { polite: false });
    if (!r.ok) continue;
    const m = r.text.replace(/\\\//g, '/').match(re);
    if (m && m.length) return m[0];
  }
  return null;
}

/** Group raw register rows (one per org+route) into one record per organisation. */
function buildCompanies(rows, { requiredRoute = 'Skilled Worker' } = {}) {
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name) => header.findIndex((h) => h.includes(name));
  const iName = col('organisation');
  const iTown = col('town');
  const iCounty = col('county');
  const iType = col('type');
  const iRoute = col('route');
  if (iName < 0) throw new Error('Unexpected CSV header: ' + rows[0].join('|'));

  const map = new Map();
  for (const r of rows.slice(1)) {
    const name = (r[iName] || '').trim();
    if (!name) continue;
    const rowRoute = (r[iRoute] || '').trim();
    if (requiredRoute && rowRoute.toLowerCase() !== String(requiredRoute).trim().toLowerCase()) continue;
    const town = (r[iTown] || '').trim();
    const key = `${name.toLowerCase()}|${town.toLowerCase()}`;
    const rec = map.get(key) || { name, town: '', county: '', ratings: new Set(), routes: new Set() };
    if (!rec.town) rec.town = (r[iTown] || '').trim();
    if (!rec.county) rec.county = (r[iCounty] || '').trim();
    if (r[iType]) rec.ratings.add(r[iType].trim());
    if (rowRoute) rec.routes.add(rowRoute);
    map.set(key, rec);
  }
  return [...map.values()].map((c) => {
    const routes = [...c.routes].join('; ');
    return {
      name: c.name,
      town: c.town,
      county: c.county,
      rating: [...c.ratings].join('; '),
      routes,
      sector: classify(c.name, routes),
    };
  });
}

function applyIndustryEvidence(companies, file) {
  if (!file || !fs.existsSync(file)) return 0;
  const rows = parseCsv(fs.readFileSync(file, 'utf8'));
  const h = rows.shift().map((x) => x.trim().toLowerCase());
  const i = ['organisation_name', 'town_city', 'industry'].map((x) => h.indexOf(x));
  if (i.includes(-1)) throw new Error('Industry file requires organisation_name,town_city,industry');
  const sectors = { Construction: 'engineering_construction', Engineering: 'engineering_construction', Manufacturing: 'engineering_construction', Education: 'education', Finance: 'finance_professional', 'Legal & Professional': 'finance_professional', Hospitality: 'hospitality_food', 'Public Services': 'charity_public', Retail: 'retail_wholesale', 'Social Care': 'healthcare', Technology: 'tech', Transport: 'logistics_transport' };
  const key = (n, t) => `${String(n).trim().toLowerCase()}|${String(t).trim().toLowerCase()}`;
  const known = new Map();
  for (const row of rows) {
    const industry = row[i[2]]?.trim();
    const s = sectors[industry];
    if (!s) continue;
    const k = key(row[i[0]], row[i[1]]);
    const evidence = { sector: s, industry };
    if (known.has(k) && known.get(k)?.sector !== s) known.set(k, null);
    else if (!known.has(k)) known.set(k, evidence);
  }
  let count = 0;
  for (const c of companies) {
    const evidence = known.get(key(c.name, c.town));
    if (evidence) {
      c.sector = evidence.sector;
      c.industry = evidence.industry;
      c.sectorSource = 'local-industry-evidence';
      count++;
    }
  }
  return count;
}

function writeSectors(companies) {
  const dir = path.join(DATA, 'sectors');
  fs.mkdirSync(dir, { recursive: true });
  const head = ['name', 'town', 'county', 'rating', 'routes', 'sector', 'industry', 'sectorSource'];
  const summary = {};
  for (const s of SECTORS) {
    const list = companies.filter((c) => c.sector === s);
    summary[s] = list.length;
    fs.writeFileSync(path.join(dir, `${s}.csv`), toCsv([head, ...list.map((c) => head.map((h) => c[h]))]));
  }
  fs.writeFileSync(path.join(DATA, 'companies.json'), JSON.stringify(companies));
  return summary;
}

async function downloadRegister({ url, file, industryFile, sponsorRoute = 'Skilled Worker' } = {}) {
  fs.mkdirSync(DATA, { recursive: true });
  let text;
  if (file) {
    text = fs.readFileSync(file, 'utf8');
  } else {
    url = url || (await findCsvUrl());
    if (!url) {
      throw new Error(
        'Could not find the CSV link automatically. Open ' + PAGE + ', copy the CSV link, then run:\n  node run.js register --url "<link>"\nor download it and run: node run.js register --file path/to/file.csv'
      );
    }
    console.log('Downloading', url);
    const r = await fetchText(url, { polite: false, timeout: 180000, maxBytes: 200 * 1024 * 1024 });
    if (!r.ok) throw new Error(`Download failed (${r.status})`);
    text = r.text;
  }
  fs.writeFileSync(path.join(DATA, 'register.csv'), text);
  const companies = buildCompanies(parseCsv(text), { requiredRoute: sponsorRoute });
  const classifiedFromEvidence = applyIndustryEvidence(companies, industryFile);
  const summary = writeSectors(companies);
  return { total: companies.length, classifiedFromEvidence, summary, sponsorRoute: sponsorRoute || 'all worker routes' };
}

module.exports = { downloadRegister, parseCsv, toCsv, buildCompanies, applyIndustryEvidence, findCsvUrl };
