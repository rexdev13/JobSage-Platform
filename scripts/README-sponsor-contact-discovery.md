# Sponsor contact discovery CLI

This is a standalone, review-first batch tool. It does not send email and it does not write to JOBSAGE during discovery.

## Pilot

From the repository root:

```bash
pnpm --filter @workspace/scripts sponsor-contacts pilot \
  --limit 200 \
  --output data/sponsor_contacts_pilot.csv
```

Without `--input`, the CLI downloads the latest Home Office Worker and Temporary Worker sponsor register. You can provide official-register exports for stronger matching:

```bash
pnpm --filter @workspace/scripts sponsor-contacts pilot \
  --cqc data/cqc.csv \
  --gias data/gias.csv \
  --charity data/charity.csv
```

The fallback website fetcher only visits the confirmed employer domain, checks robots.txt, enforces HTTPS/public-DNS/timeout/size limits, paces requests per host, and accepts only published employer-domain emails. It never constructs an address.

If `BING_SEARCH_API_KEY` is present, Bing is used only to discover a candidate official website. The same-domain checks still apply.

## Review and import

Inspect and edit the CSV first. You may add:

```text
review_status
```

Then dry-run:

```bash
pnpm --filter @workspace/scripts sponsor-contacts import \
  --input data/sponsor_contacts_pilot.csv \
  --require-review
```

Apply only after review:

```bash
pnpm --filter @workspace/scripts sponsor-contacts import \
  --input data/sponsor_contacts_pilot.csv \
  --apply \
  --require-review
```

Import never overwrites existing JOBSAGE website or contact-email values. It matches sponsor licence rows by organisation name, using town/city to disambiguate when possible, and stores the accepted evidence in the contact-enrichment record.

## Statuses

- `verified_email`: accepted published employer-domain email with evidence
- `website_no_email`: confirmed website checked, but no accepted public email found
- `no_website`: official match exists but no website is published
- `unmatched`: no unambiguous official match
- `no_public_contact`: website could not be safely fetched
- `skipped_existing`: input already contained a contact email