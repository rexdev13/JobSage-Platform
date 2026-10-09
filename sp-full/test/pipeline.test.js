const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildCompanies, applyIndustryEvidence } = require('../lib/register');
const { extractAlgoliaConfig } = require('../lib/site');
const {
  runDiscovery, exportAll, makeReferenceHints, makeWebsiteEvidenceHints,
  mergeReferenceHints, referenceHintFor, normalizeJobUrl,
} = require('../run');
const { hasExplicitCvInstruction } = require('../lib/site');

test('same legal name in separate towns retains both sponsor identities', () => {
  const rows = [
    ['Organisation Name', 'Town/City', 'County', 'Type & Rating', 'Route'],
    ['Example Ltd', 'London', '', 'Worker (A rating)', 'Skilled Worker'],
    ['Example Ltd', 'Bristol', '', 'Worker (A rating)', 'Skilled Worker'],
  ];
  assert.equal(buildCompanies(rows).length, 2);
});

test('register selection excludes worker routes other than Skilled Worker by default', () => {
  const rows = [
    ['Organisation Name', 'Town/City', 'County', 'Type & Rating', 'Route'],
    ['Skilled Sponsor Ltd', 'London', '', 'Worker (A rating)', 'Skilled Worker'],
    ['Temporary Sponsor Ltd', 'London', '', 'Worker (A rating)', 'Creative Worker'],
  ];
  assert.deepEqual(buildCompanies(rows).map((row) => row.name), ['Skilled Sponsor Ltd']);
  assert.equal(buildCompanies(rows, { requiredRoute: null }).length, 2);
});

test('tracking parameters do not create duplicate application URLs', () => {
  assert.equal(
    normalizeJobUrl('https://example.com/jobs/123/?utm_source=feed#apply'),
    'https://example.com/jobs/123',
  );
});

test('public Algolia configuration is discovered from a careers page at runtime', () => {
  const html = '<script>const AG_ID="ABC123"; const AG_KEY="deadbeef"; const AG_INDEX={"default":"jobs_live"};</script>';
  assert.deepEqual(extractAlgoliaConfig(html), { id: 'ABC123', key: 'deadbeef', index: 'jobs_live' });
  assert.equal(extractAlgoliaConfig('<html></html>'), null);
});

test('review evidence yields live-source hints without erasing sponsor review status', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobsage-reference-'));
  try {
    const file = path.join(dir, 'review.csv');
    fs.writeFileSync(file, [
      'sponsor_name,apply_url,application_mode,sponsor_match_status',
      'Example Ltd,https://job-boards.greenhouse.io/example/jobs/123,job_board,group-entity-review',
    ].join('\n'));
    const hint = makeReferenceHints(file).get('example ltd');
    assert.equal(hint.status, 'group-entity-review');
    assert.equal(hint.refs[0].ats, 'greenhouse');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('local sector evidence applies only to the exact sponsor and town', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobsage-sector-'));
  try {
    const file = path.join(dir, 'industry.csv');
    fs.writeFileSync(file, 'organisation_name,town_city,industry\nExample Ltd,London,Technology\n');
    const companies = [{ name: 'Example Ltd', town: 'London', sector: 'other' }, { name: 'Example Ltd', town: 'Bristol', sector: 'other' }];
    assert.equal(applyIndustryEvidence(companies, file), 1);
    assert.deepEqual(companies.map((c) => c.sector), ['tech', 'other']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('transient incomplete scan is retried before recording a sponsor', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobsage-retry-'));
  try {
    let attempts = 0;
    const result = await runDiscovery([{ name: 'Example Ltd', town: 'London', sector: 'tech' }], { concurrency: 1 }, {
      resultsFile: path.join(dir, 'results.jsonl'),
      processCompany: async (c) => ({ ...c, jobs: [], emails: [], incomplete: ++attempts < 2, checkedAt: new Date().toISOString() }),
    });
    assert.equal(attempts, 2);
    assert.equal(result.recorded, 1);
    assert.equal(result.unknown, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('isolated export reads only the requested run state and never promotes role mailboxes to send_cv', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobsage-export-'));
  try {
    const resultsFile = path.join(dir, 'results.jsonl');
    const outDir = path.join(dir, 'output');
    fs.writeFileSync(resultsFile, JSON.stringify({
      name: 'Example Ltd', town: 'London', sector: 'tech', industry: 'Technology',
      domain: 'example.com', domainMethod: 'saved-website-confirmed', ats: null, atsDetected: [],
      careersUrls: ['https://example.com/careers'], emails: ['jobs@example.com'],
      emailEvidence: [{ email: 'jobs@example.com', url: 'https://example.com/careers' }],
      jobs: [
        { title: 'Engineer', location: 'London', url: 'https://example.com/jobs/123', ats: 'website', freshnessStatus: 'deep_link_live' },
        { title: 'Developer', location: 'London', url: 'https://boards.greenhouse.io/example/jobs/456', ats: 'greenhouse', freshnessStatus: 'deep_link_live' },
      ],
      incomplete: false, checkedAt: new Date().toISOString(),
    }) + '\n');
    exportAll({ 'results-file': resultsFile, 'out-dir': outDir, 'max-age-hours': 48 });
    const vacancyCsv = fs.readFileSync(path.join(outDir, 'vacancies.csv'), 'utf8');
    assert.match(vacancyCsv, /company_website/);
    assert.doesNotMatch(vacancyCsv, /job_board/);
    assert.match(vacancyCsv, /employer_level_review_required/);
    assert.doesNotMatch(vacancyCsv, /,send_cv,/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('cross-sector website evidence seeds exact sponsor-town ATS hints without promoting weak confidence', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobsage-evidence-'));
  try {
    const file = path.join(dir, 'evidence.csv');
    fs.writeFileSync(file, [
      'organisation_name,town_city,official_website_url,existing_website,existing_careers_url,website_confidence,existing_contact_email,website_evidence_url',
      'Example Engineering Ltd,Leeds,https://example.test,,https://jobs.ashbyhq.com/example,high,recruitment@example.test,https://example.test/careers',
      'Review Retail Ltd,London,https://retail.test,,https://retail.test/careers,medium,info@retail.test,https://retail.test/contact',
    ].join('\n'));
    const hints = makeWebsiteEvidenceHints(file);
    const exact = referenceHintFor(hints, { name: 'Example Engineering Ltd', town: 'Leeds' });
    const review = referenceHintFor(hints, { name: 'Review Retail Ltd', town: 'London' });
    assert.equal(exact.status, 'exact-name-town-website-confirmed');
    assert.equal(exact.refs[0].ats, 'ashby');
    assert.deepEqual(exact.recruitmentEmails, ['recruitment@example.test']);
    assert.deepEqual(exact.evidenceUrls, ['https://example.test/careers']);
    assert.equal(review.status, 'website-medium-review');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('an explicit sponsor review flag overrides a high-confidence website row', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobsage-review-priority-'));
  try {
    const reviewFile = path.join(dir, 'review.csv');
    const evidenceFile = path.join(dir, 'evidence.csv');
    fs.writeFileSync(reviewFile, [
      'sponsor_name,apply_url,application_mode,sponsor_match_status',
      '9fin Limited,https://jobs.ashbyhq.com/9fin/job,job_board,brand-to-legal-name-review',
    ].join('\n'));
    fs.writeFileSync(evidenceFile, [
      'organisation_name,town_city,official_website_url,existing_website,existing_careers_url,website_confidence',
      '9fin Limited,London,https://9fin.com,,https://jobs.ashbyhq.com/9fin,high',
    ].join('\n'));
    const hints = mergeReferenceHints(makeReferenceHints(reviewFile), makeWebsiteEvidenceHints(evidenceFile));
    const hint = referenceHintFor(hints, { name: '9fin Limited', town: 'London' });
    assert.equal(hint.status, 'brand-to-legal-name-review');
    assert.equal(hint.refs[0].ats, 'ashby');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Send CV proof requires an explicit instruction near the recruitment email', () => {
  assert.equal(hasExplicitCvInstruction(
    '<main><p>To apply, send your CV to careers@example.com.</p></main>',
    'careers@example.com',
  ), true);
  assert.equal(hasExplicitCvInstruction(
    '<main><p>Careers enquiries</p><p>careers@example.com</p></main>',
    'careers@example.com',
  ), false);
});

test('guarded export writes verified Send CV routes separately from vacancies', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobsage-send-cv-'));
  try {
    const resultsFile = path.join(dir, 'results.jsonl');
    const outDir = path.join(dir, 'output');
    fs.writeFileSync(resultsFile, JSON.stringify({
      name: 'Example Ltd', town: 'London', sector: 'tech', industry: 'Technology',
      domain: 'example.com', domainMethod: 'saved-website-confirmed', ats: null, atsDetected: [],
      careersUrls: ['https://example.com/careers'], emails: ['info@example.com'],
      emailEvidence: [{ email: 'info@example.com', url: 'https://example.com/careers' }],
      verifiedRecruitmentRoutes: [{ email: 'info@example.com', url: 'https://example.com/careers', evidenceType: 'explicit_cv_instruction' }],
      jobs: [], incomplete: false, checkedAt: new Date().toISOString(),
    }) + '\n');
    exportAll({ 'results-file': resultsFile, 'out-dir': outDir, 'max-age-hours': 48 });
    const routes = fs.readFileSync(path.join(outDir, 'send-cv-routes.csv'), 'utf8');
    assert.match(routes, /info@example\.com/);
    assert.match(routes, /verified_recruitment_route/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
