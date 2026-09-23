# JOBSAGE pricing and unit economics

Generated from [pricing-assumptions.json](./pricing-assumptions.json) by `pnpm pricing:model`.

## Executive summary

This is a planning model, not an invoice. The scale tiers are **monthly active users
(MAU)**. At the default 8% paid conversion, the model suggests these monthly
subscription price bands per paying user:

| MAU | 30% gross margin | 50% gross margin | 70% gross margin |
| ---: | ---: | ---: | ---: |
| 100 | £45.54 | £63.75 | £106.25 |
| 1,000 | £20.54 | £28.75 | £47.92 |
| 10,000 | £16.53 | £23.14 | £38.56 |
| 100,000 | £15.66 | £21.92 | £36.53 |
| 1,000,000 | £15.38 | £21.54 | £35.90 |

The low-scale price is high because fixed hosting, database, support, and
operations costs are spread across few paying users. Reprice only after replacing
the placeholders with invoices and measuring actual AI usage.

## What is measured versus assumed

- **Measured:** The project is configured for a Replit Autoscale deployment target. _(.replit deployment.target)_
- **Measured:** The application uses PostgreSQL through Drizzle ORM. _(replit.md architecture and lib/db)_
- **Measured:** The application uses Replit Object Storage for files. _(replit.md architecture and environment variables)_
- **Measured:** Transactional email is sent through Resend. _(replit.md and API email integration)_
- **Measured:** AI features use the Replit OpenAI integration proxy. _(replit.md and AI integration environment variables)_
- **Measured:** Vacancy ingestion is split across board, company-site, probe, liveness, contact, Reed, and additional-board jobs. _(docs/vacancy-jobs-http-cron.md)_
- **Measured:** The recent production audit found company-site traffic materially above its intended hourly cadence and a high temporary-failure rate. _(read-only production ingestion audit, September 2026)_

**Assumptions:** every amount in `pricing-assumptions.json` is a conservative
planning placeholder unless it appears in the measured list above. The model does
not have access to provider invoices or a reliable production traffic forecast.

- Replace AI unit costs with the actual model, token, cache, and retry mix from invoices or provider usage.
- Replace Replit hosting and PostgreSQL placeholders with the selected deployment/database plan invoices.
- Replace Resend, object-storage, cron, observability, and support placeholders with actual monthly invoices.
- Measure real monthly AI calls per active user by endpoint before committing to a public price.
- Validate the 8% paying conversion and £30 CAC with funnel data.

## Editable formulas

- Paying users = MAU × paid-conversion percentage.
- Monthly AI cost = MAU × sum of the AI unit-cost inputs.
- Monthly variable cost = MAU × all non-fixed unit-cost inputs.
- Monthly marketing CAC allocation = paying users × CAC ÷ amortisation months.
- Total monthly cost = fixed costs + variable costs + marketing CAC allocation when
  `includeMarketingCacInSuggestedPrice` is true.
- Cost per paying user = total monthly cost ÷ paying users.
- Suggested price at gross margin (m) = cost per paying user ÷ (1 - m).

## Monthly cost by scale tier

| MAU | Paying users | Hosting | PostgreSQL | Object storage | Email | Vacancy ingestion / cron | AI / LLM | Support | Analytics / observability | CAC allocation | **Total** |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 8 | £60.00 | £30.00 | £16.00 | £22.00 | £11.00 | £40.00 | £45.00 | £11.00 | £20.00 | **£255.00** |
| 1,000 | 80 | £120.00 | £60.00 | £30.00 | £45.00 | £25.00 | £400.00 | £240.00 | £30.00 | £200.00 | **£1150.00** |
| 10,000 | 800 | £300.00 | £180.00 | £140.00 | £245.00 | £130.00 | £4000.00 | £2100.00 | £160.00 | £2000.00 | **£9255.00** |
| 100,000 | 8,000 | £1000.00 | £750.00 | £1120.00 | £2120.00 | £1090.00 | £40000.00 | £20350.00 | £1250.00 | £20000.00 | **£87680.00** |
| 1,000,000 | 80,000 | £4200.00 | £3600.00 | £10500.00 | £20400.00 | £10300.00 | £400000.00 | £201500.00 | £11000.00 | £200000.00 | **£861500.00** |

The category totals include the cost of the selected deployment assumptions. They
do not imply that Replit, OpenAI, Resend, cron-job.org, or any other provider
will charge these exact amounts.

## Cost per active user and price bands

| MAU | Fully loaded cost / MAU | Fully loaded cost / paying user | 30% margin price | 50% margin price | 70% margin price |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | £2.55 | £31.88 | £45.54 | £63.75 | £106.25 |
| 1,000 | £1.15 | £14.38 | £20.54 | £28.75 | £47.92 |
| 10,000 | £0.93 | £11.57 | £16.53 | £23.14 | £38.56 |
| 100,000 | £0.88 | £10.96 | £15.66 | £21.92 | £36.53 |
| 1,000,000 | £0.86 | £10.77 | £15.38 | £21.54 | £35.90 |

## AI cost breakdown per MAU

| AI flow | Monthly placeholder cost / MAU |
| --- | ---: |
| cvAndProfileExtraction | £0.08 |
| eligibilityOrRulesAssist | £0.04 |
| remediationAndWriting | £0.10 |
| opportunityScoring | £0.12 |
| otherAiAllowance | £0.06 |
| **Total AI / MAU** | **£0.40** |

AI is the largest traffic-sensitive risk. Eligibility itself is primarily a
database-backed rules evaluation today, but CV/profile extraction, remediation
writing, gap analysis, and opportunity scoring can create model calls. Cached
results, idempotency, per-user quotas, and measured token usage should be added
to the forecast before promising enterprise-scale pricing.

## Step changes and infrastructure interpretation

| MAU | Expected step or review |
| ---: | --- |
| 100 | Autoscale + entry PostgreSQL |
| 1,000 | More database and worker headroom |
| 10,000 | Autoscale remains plausible; review queue and AI rate limits |
| 100,000 | Reserved/always-on capacity assumption |
| 1,000,000 | Multi-worker architecture; not a single-instance claim |

- **100–10,000 MAU:** Autoscale is a reasonable development and early-production
  assumption, subject to the k6 smoke and staged tests in the companion document.
- **100,000 MAU:** do not infer capacity from a single preview run. Use a
  Reserved VM or equivalent always-on worker capacity, connection-pool review,
  background queues, rate limits, and a separately measured database tier.
- **1,000,000 MAU:** Replit preview tooling cannot certify this tier. Plan for
  multiple API instances, queue workers, read replicas or equivalent database
  scaling, dedicated observability, load generation outside the app runtime, and
  a staged capacity program.

## Vacancy-ingestion cost and contention

Vacancy ingestion is not priced as one request per user. Board, Reed,
additional-board, company-site, liveness, contact, and probe jobs have their own
cadences and share writer coordination. The recent production audit found
company-site over-firing and a high temporary-failure rate, so the editable
placeholder deliberately has a separate cost line. User traffic should not be
allowed to increase ingestion batch sizes or bypass the existing safety rules.

At scale, measure:

1. cron requests and successful batches per day by kind;
2. 409 responses and lock wait time;
3. database writes per vacancy and per user-facing opportunity request; and
4. whether user-triggered board refreshes are coalesced and cached.

## Recalculate

```sh
node scripts/generate-pricing-model.mjs
```

The generated CSV is [pricing-unit-economics.csv](./pricing-unit-economics.csv).

