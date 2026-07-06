#!/bin/bash
set -e
pnpm install --frozen-lockfile

# Deduplicate sponsor_licences before pushing schema changes that add a
# unique constraint on organisation_name. Idempotent — safe to run repeatedly.
node -e "
const { Client } = require('pg');
async function run() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const res = await client.query(\`
    DELETE FROM sponsor_licences
    WHERE id NOT IN (
      SELECT MAX(id)
      FROM sponsor_licences
      GROUP BY organisation_name
    )
  \`);
  console.log('[post-merge] Deduped sponsor_licences:', res.rowCount, 'rows removed');
  await client.end();
}
run().catch(e => { console.warn('[post-merge] Dedup skipped:', e.message); });
"

pnpm --filter db push
