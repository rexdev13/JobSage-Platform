import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const assumptionsPath = path.join(root, "docs", "pricing-assumptions.json");
const outputMarkdownPath = path.join(root, "docs", "pricing-unit-economics.md");
const outputCsvPath = path.join(root, "docs", "pricing-unit-economics.csv");
const assumptions = JSON.parse(fs.readFileSync(assumptionsPath, "utf8"));

const money = (value) => `£${value.toFixed(2)}`;
const number = (value) => new Intl.NumberFormat("en-GB").format(value);
const pct = (value) => `${value.toFixed(1)}%`;
const sum = (values) => values.reduce((total, value) => total + value, 0);
const aiPerMau = sum(Object.values(assumptions.variableMonthlyCostPerMau.ai));
const variablePerMau =
  aiPerMau +
  assumptions.variableMonthlyCostPerMau.email +
  assumptions.variableMonthlyCostPerMau.objectStorage +
  assumptions.variableMonthlyCostPerMau.vacancyIngestionAndCron +
  assumptions.variableMonthlyCostPerMau.support +
  assumptions.variableMonthlyCostPerMau.analyticsAndObservability;
const margins = [0.3, 0.5, 0.7];
const categories = Object.keys(assumptions.fixedMonthlyCostByTier);

const rows = assumptions.scaleTiersMau.map((mau, index) => {
  const payingUsers = mau * assumptions.conversion.payingUsersPercentOfMau / 100;
  const fixed = Object.fromEntries(
    categories.map((category) => [
      category,
      assumptions.fixedMonthlyCostByTier[category][index],
    ]),
  );
  const variable = {
    ai: mau * aiPerMau,
    email: mau * assumptions.variableMonthlyCostPerMau.email,
    objectStorage: mau * assumptions.variableMonthlyCostPerMau.objectStorage,
    vacancyIngestionAndCron:
      mau * assumptions.variableMonthlyCostPerMau.vacancyIngestionAndCron,
    support: mau * assumptions.variableMonthlyCostPerMau.support,
    analyticsAndObservability:
      mau * assumptions.variableMonthlyCostPerMau.analyticsAndObservability,
  };
  const marketingCac = payingUsers *
    assumptions.conversion.marketingCacPerPayingUser /
    assumptions.conversion.cacAmortisationMonths;
  const subtotal = sum(Object.values(fixed)) + sum(Object.values(variable));
  const total = subtotal +
    (assumptions.conversion.includeMarketingCacInSuggestedPrice ? marketingCac : 0);
  const costPerPayingUser = total / Math.max(payingUsers, 1);
  return {
    mau,
    payingUsers,
    fixed,
    variable,
    marketingCac,
    total,
    costPerMau: total / mau,
    costPerPayingUser,
    prices: Object.fromEntries(
      margins.map((margin) => [margin, costPerPayingUser / (1 - margin)]),
    ),
  };
});

const displayCategory = (category) => ({
  hosting: "Hosting",
  postgres: "PostgreSQL",
  objectStorage: "Object storage",
  email: "Email",
  vacancyIngestionAndCron: "Vacancy ingestion / cron",
  analyticsAndObservability: "Analytics / observability",
  support: "Support",
  ai: "AI / LLM",
}[category] ?? category);

const fixedTable = rows.map((row) =>
  `| ${number(row.mau)} | ${number(row.payingUsers)} | ${categories
    .map((category) => money(row.fixed[category])).join(" | ")} | ${money(row.variable.ai)} | ${money(row.variable.email)} | ${money(row.variable.objectStorage)} | ${money(row.variable.vacancyIngestionAndCron)} | ${money(row.variable.support)} | ${money(row.variable.analyticsAndObservability)} | ${money(row.marketingCac)} | **${money(row.total)}** |`,
).join("\n");

const priceTable = rows.map((row) =>
  `| ${number(row.mau)} | ${money(row.costPerMau)} | ${money(row.costPerPayingUser)} | ${money(row.prices[0.3])} | ${money(row.prices[0.5])} | ${money(row.prices[0.7])} |`,
).join("\n");

const stepTable = assumptions.scaleTiersMau.map((mau, index) => {
  const notes = [];
  if (index === 0) notes.push("Autoscale + entry PostgreSQL");
  if (index === 1) notes.push("More database and worker headroom");
  if (index === 2) notes.push("Autoscale remains plausible; review queue and AI rate limits");
  if (index === 3) notes.push("Reserved/always-on capacity assumption");
  if (index === 4) notes.push("Multi-worker architecture; not a single-instance claim");
  return `| ${number(mau)} | ${notes.join("; ")} |`;
}).join("\n");

const aiTable = Object.entries(assumptions.variableMonthlyCostPerMau.ai)
  .map(([name, value]) => `| ${name} | ${money(value)} |`)
  .join("\n");

const facts = assumptions.measuredFacts
  .map((item) => `- **Measured:** ${item.fact} _(${item.source})_`)
  .join("\n");
const todos = assumptions.todoInputs.map((item) => `- ${item}`).join("\n");

const markdown = `# JOBSAGE pricing and unit economics

Generated from [pricing-assumptions.json](./pricing-assumptions.json) by \`pnpm pricing:model\`.

## Executive summary

This is a planning model, not an invoice. The scale tiers are **monthly active users
(MAU)**. At the default 8% paid conversion, the model suggests these monthly
subscription price bands per paying user:

| MAU | 30% gross margin | 50% gross margin | 70% gross margin |
| ---: | ---: | ---: | ---: |
${rows.map((row) => `| ${number(row.mau)} | ${money(row.prices[0.3])} | ${money(row.prices[0.5])} | ${money(row.prices[0.7])} |`).join("\n")}

The low-scale price is high because fixed hosting, database, support, and
operations costs are spread across few paying users. Reprice only after replacing
the placeholders with invoices and measuring actual AI usage.

## What is measured versus assumed

${facts}

**Assumptions:** every amount in \`pricing-assumptions.json\` is a conservative
planning placeholder unless it appears in the measured list above. The model does
not have access to provider invoices or a reliable production traffic forecast.

${todos}

## Editable formulas

- Paying users = MAU × paid-conversion percentage.
- Monthly AI cost = MAU × sum of the AI unit-cost inputs.
- Monthly variable cost = MAU × all non-fixed unit-cost inputs.
- Monthly marketing CAC allocation = paying users × CAC ÷ amortisation months.
- Total monthly cost = fixed costs + variable costs + marketing CAC allocation when
  \`includeMarketingCacInSuggestedPrice\` is true.
- Cost per paying user = total monthly cost ÷ paying users.
- Suggested price at gross margin \(m\) = cost per paying user ÷ \(1 - m\).

## Monthly cost by scale tier

| MAU | Paying users | Hosting | PostgreSQL | Object storage | Email | Vacancy ingestion / cron | AI / LLM | Support | Analytics / observability | CAC allocation | **Total** |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${fixedTable}

The category totals include the cost of the selected deployment assumptions. They
do not imply that Replit, OpenAI, Resend, cron-job.org, or any other provider
will charge these exact amounts.

## Cost per active user and price bands

| MAU | Fully loaded cost / MAU | Fully loaded cost / paying user | 30% margin price | 50% margin price | 70% margin price |
| ---: | ---: | ---: | ---: | ---: | ---: |
${priceTable}

## AI cost breakdown per MAU

| AI flow | Monthly placeholder cost / MAU |
| --- | ---: |
${aiTable}
| **Total AI / MAU** | **${money(aiPerMau)}** |

AI is the largest traffic-sensitive risk. Eligibility itself is primarily a
database-backed rules evaluation today, but CV/profile extraction, remediation
writing, gap analysis, and opportunity scoring can create model calls. Cached
results, idempotency, per-user quotas, and measured token usage should be added
to the forecast before promising enterprise-scale pricing.

## Step changes and infrastructure interpretation

| MAU | Expected step or review |
| ---: | --- |
${stepTable}

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

\`\`\`sh
node scripts/generate-pricing-model.mjs
\`\`\`

The generated CSV is [pricing-unit-economics.csv](./pricing-unit-economics.csv).
`;

const csvHeader = [
  "mau",
  "paying_users",
  "hosting",
  "postgres",
  "object_storage",
  "email",
  "vacancy_ingestion_cron",
  "ai_llm",
  "support",
  "analytics_observability",
  "marketing_cac_allocation",
  "total_monthly_cost",
  "cost_per_mau",
  "cost_per_paying_user",
  "price_30_margin",
  "price_50_margin",
  "price_70_margin",
].join(",");
const csvRows = rows.map((row) => [
  row.mau,
  row.payingUsers,
  row.fixed.hosting,
  row.fixed.postgres,
  row.fixed.objectStorage,
  row.fixed.email,
  row.fixed.vacancyIngestionAndCron,
  row.variable.ai,
  row.variable.support,
  row.variable.analyticsAndObservability,
  row.marketingCac,
  row.total,
  row.costPerMau,
  row.costPerPayingUser,
  row.prices[0.3],
  row.prices[0.5],
  row.prices[0.7],
].map((value) => Number(value).toFixed(2)).join(","));

fs.writeFileSync(outputMarkdownPath, `${markdown}\n`);
fs.writeFileSync(outputCsvPath, `${csvHeader}\n${csvRows.join("\n")}\n`);
console.log(`Wrote ${path.relative(root, outputMarkdownPath)}`);
console.log(`Wrote ${path.relative(root, outputCsvPath)}`);