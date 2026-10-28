/**
 * Infer `sponsor_licences.industry` for sponsors whose register row carries no
 * industry label, from the vacancies they actually post. Dominant label wins;
 * requires >= 2 matching titles so a single odd listing cannot mislabel.
 * Never overwrites an existing label. Run: tsx src/tools/labelSponsorIndustries.ts [--dry]
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const RULES: Array<[string, RegExp]> = [
  ["Manufacturing", /\b(cnc|welder|fabricator|machinist|machine operator|production (operative|engineer|manager|supervisor|planner)|manufactur|assembler|toolmaker|sheet metal|factory|packing|packaging|process engineer|injection mould|print operator)/i],
  ["Technology", /\b(software|developer|devops|cloud engineer|cyber ?security|data (scientist|engineer|analyst)|it support|product manager|frontend|backend|full ?stack|machine learning|ai engineer|platform engineer|qa engineer|sdet|system administrator|network engineer|scrum|technical lead)/i],
  ["Healthcare", /\b(nurse|nursing|midwif|doctor|physician|consultant (medicine|surgeon|anaesth)|radiograph|physiotherap|occupational therapist|paramedic|pharmacist|pharmacy|dentist|dental|optom|clinical|care home manager|gp |surgeon|anaesth|psychiatr|medical|health visitor|speech (and|&) language|dietitian|podiatr)/i],
  ["Social Care", /\b(care worker|care assistant|support worker|senior carer|care coordinator|social worker|domiciliary|home care|learning disabilities support)/i],
  ["Education", /\b(teacher|lecturer|teaching assistant|headteacher|head teacher|professor|tutor|senco|sen teacher|early years|nursery|class teacher|curriculum|academic|school)/i],
  ["Construction", /\b(quantity surveyor|site manager|site engineer|bricklayer|carpenter|joiner|scaff|plumber|electrician|construction|civil engineer|structural engineer|surveyor|estimator|groundworker|plant operator|roofer|plasterer|demolition|building services|m&e|bim )/i],
  ["Hospitality", /\b(chef|cook|kitchen|waiter|waitress|barista|bartender|hotel|restaurant|hospitality|catering|front of house|housekeeping|sous chef|commis|pastry)/i],
  ["Finance", /\b(accountant|accounting|auditor|audit|payroll|bookkeeper|finance analyst|financial|actuar|tax |credit controller|accounts (assistant|payable|receivable)|cfo|finance manager|underwriter|mortgage)/i],
  ["Legal & Professional", /\b(solicitor|paralegal|lawyer|legal counsel|barrister|conveyanc|legal assistant|compliance|notary)/i],
  ["Engineering", /\b(maintenance engineer|electrical engineer|mechanical engineer|field engineer|design engineer|project engineer|engineer(ing)? (manager|technician)|cad |hvac|lift engineer|service engineer|commissioning engineer)/i],
  ["Transport", /\b(hgv|lgv|driver|lorry|truck|bus driver|logistics|warehouse|supply chain|fleet|courier|delivery driver|transport)/i],
  ["Retail", /\b(retail|store manager|shop|sales assistant|merchandis|checkout|supermarket|branch manager|visual merchandis)/i],
  ["Media & Creative", /\b(designer|graphic|marketing|social media|content (writer|creator|editor)|copywriter|video|media|pr |journalist|creative|brand|seo|communications|public relations|editor)/i],
  ["Recruitment", /\b(recruiter|recruitment (consultant|resourcer)|talent acquisition|resourcer|head ?hunt)/i],
  ["Agriculture", /\b(farm|agricultur|horticultur|poultry|dairy|harvest|agronom|livestock|veterin|vet )/i],
  ["Energy", /\b(solar|renewable|wind turbine|oil and gas|energy|utilities|power (engineer|plant)|electricity|substation)/i],
  ["Property", /\b(estate agent|letting|property (manager|management)|surveyor|facilities manager|estates|block management|leasehold)/i],
  ["Security", /\b(security (guard|officer|supervisor)|door supervisor|cctv|loss prevention)/i],
  ["Beauty", /\b(hairdress|barber|beauty|salon|nail|aesthet|spa|massage|makeup|cosmetic)/i],
  ["Public Services", /\b(civil servant|local authorit|council|government|police|firefighter|probation|prison|mod |ministry|nhs trust admin|councillor)/i],
];

type Row = { organisation_name: string; industry: string | null; titles: string[] };

const dry = process.argv.includes("--dry");

const rows = (await db.execute(sql`
  SELECT sl.organisation_name, sl.industry, array_agg(v.title) AS titles
  FROM sponsor_licences sl
  JOIN sponsor_licence_vacancies v
    ON lower(btrim(v.organisation_name)) = lower(btrim(sl.organisation_name))
  GROUP BY sl.organisation_name, sl.industry
`)) as unknown as { rows: Row[] };

const candidates = rows.rows.filter((r) => !r.industry || r.industry.trim() === "");
let labeled = 0;
const bySector = new Map<string, number>();

for (const row of candidates) {
  const scores = new Map<string, number>();
  for (const title of row.titles) {
    for (const [label, re] of RULES) if (re.test(title)) scores.set(label, (scores.get(label) ?? 0) + 1);
  }
  if (scores.size === 0) continue;
  const [best, hits] = [...scores.entries()].sort((a, b) => b[1] - a[1])[0];
  if (hits < 2) continue;
  if (dry) { console.log(`${row.organisation_name} -> ${best} (${hits} hits)`); continue; }
  await db.execute(sql`UPDATE sponsor_licences SET industry = ${best} WHERE organisation_name = ${row.organisation_name}`);
  labeled++;
  bySector.set(best, (bySector.get(best) ?? 0) + 1);
}

console.log(`candidates=${candidates.length} labeled=${dry ? 0 : labeled}`);
for (const [k, v] of [...bySector.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`);
process.exit(0);
