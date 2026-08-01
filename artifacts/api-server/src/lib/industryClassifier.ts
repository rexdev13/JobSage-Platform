import { openai } from "@workspace/integrations-openai-ai-server";

export const INDUSTRY_LABELS = [
  "Healthcare",
  "Social Care",
  "Education",
  "Engineering",
  "Construction",
  "Technology",
  "Hospitality",
  "Finance",
  "Retail",
  "Transport",
  "Legal & Professional",
  "Public Services",
  "Manufacturing",
  "Other",
] as const;

export type IndustryLabel = (typeof INDUSTRY_LABELS)[number];

type PatternGroup = { label: IndustryLabel; patterns: RegExp[] };

// Order matters — Social Care before Healthcare, Legal before Finance etc.
const PATTERN_GROUPS: PatternGroup[] = [
  {
    label: "Public Services",
    patterns: [
      /\b(borough|city|county|district|town|parish|metropolitan)\s+council\b/i,
      /\b(nhs\s+(trust|foundation|england|scotland|wales|board|commissioning)|national\s+health\s+service)\b/i,
      /\b(government|ministry|department\s+of|hm\s+revenue|hmrc|dvla|dvsa)\b/i,
      /\b(fire\s+(service|brigade|rescue)|police|constabulary)\b/i,
      /\b(royal\s+(navy|air\s+force|marines)|british\s+army|ministry\s+of\s+defence)\b/i,
      /\b(public\s+health|clinical\s+commissioning\s+group|ccg|icb\b)\b/i,
    ],
  },
  {
    label: "Social Care",
    patterns: [
      /\bcare\s+home\b/i,
      /\bnursing\s+home\b/i,
      /\bresidential\s+care\b/i,
      /\bdomiciliary\s+care\b/i,
      /\bhome\s+care\b/i,
      /\bsupported\s+living\b/i,
      /\bsupport\s+services\b/i,
      /\blearning\s+disabilit/i,
      /\bmental\s+health\s+(services|care|support)\b/i,
      /\bdementia\s+care\b/i,
      /\badult\s+social\s+care\b/i,
      /\belderly\s+care\b/i,
      /\bcare\s+provider\b/i,
      /\bcarers?\s+(uk|ltd|limited|group)\b/i,
    ],
  },
  {
    label: "Healthcare",
    patterns: [
      /\b(hospital|clinic|medical\s+(centre|center|practice|group)|health\s+(centre|center|clinic|group|practice|services|solutions|care))\b/i,
      /\b(pharmacy|pharmacies|dispensary)\b/i,
      /\b(dental|dentist|orthodont)\b/i,
      /\b(gp\s+practice|general\s+practice|primary\s+care)\b/i,
      /\b(physiotherap|occupational\s+therap|speech\s+(and\s+language\s+)?therap)\b/i,
      /\b(optician|optometrist|ophthalmolog)\b/i,
      /\b(radiol|oncol|cardiol|pathol|psychiatr|paediatr)\b/i,
      /\b(midwif|obstetric|gynaecol|urology|neurol)\b/i,
      /\b(healthcare|health\s+care)\b/i,
      /\b(pharmaceutical|pharma|biotech|life\s+sciences?)\b/i,
      /\b(ambulance|paramedic|urgent\s+care|a\s*&\s*e)\b/i,
      /\bnhs\b/i,
    ],
  },
  {
    label: "Education",
    patterns: [
      /\b(university|universities|college\s+of|school\s+of|institute\s+of)\b/i,
      /\b(primary\s+school|secondary\s+school|grammar\s+school|high\s+school|junior\s+school|infant\s+school|senior\s+school)\b/i,
      /\b(academy\s+trust|multi.?academy|free\s+school|independent\s+school|prep\s+school)\b/i,
      /\b(further\s+education|higher\s+education|fe\s+college)\b/i,
      /\b(nursery|early\s+years|childcare|pre.?school)\b/i,
      /\b(tuition\s+centre|tutoring|language\s+school|driving\s+school|music\s+school)\b/i,
      /\b(educational|learning\s+(academy|centre|trust))\b/i,
    ],
  },
  {
    label: "Legal & Professional",
    patterns: [
      /\b(solicitor|barrister|chambers\s+of|law\s+(firm|group|office|practice)|legal\s+(services|solutions|group))\b/i,
      /\b(llp\s*$|llp\b.{0,20}(solicitor|law|legal))/i,
      /\b(accountant|accounting\s+firm|chartered\s+accountant|audit|auditor)\b/i,
      /\b(management\s+consult|professional\s+services|advisory\s+(group|services))\b/i,
      /\b(tax\s+(advisor|consultancy|group))\b/i,
    ],
  },
  {
    label: "Finance",
    patterns: [
      /\b(bank|banking|barclays|lloyds\s+bank|hsbc|natwest|santander|metro\s+bank)\b/i,
      /\b(insurance|insurer|underwriter|reinsur)\b/i,
      /\b(financial\s+(services|solutions|planning|advisors?|management)|finance\s+(group|ltd|limited|plc))\b/i,
      /\b(investment\s+(management|fund|trust|group|bank)|asset\s+management|hedge\s+fund)\b/i,
      /\b(mortgage|lending|credit\s+union|building\s+society)\b/i,
      /\b(fintech|payments\s+(group|ltd)|payroll)\b/i,
    ],
  },
  {
    label: "Engineering",
    patterns: [
      /\b(engineering\s+(ltd|limited|plc|group|solutions|services|consultants?))\b/i,
      /\b(mechanical\s+engineer|electrical\s+engineer|civil\s+engineer|structural\s+engineer)\b/i,
      /\b(aerospace|aviation\s+engineer|marine\s+engineer|nuclear\s+engineer)\b/i,
      /\b(process\s+engineer|chemical\s+engineer|systems\s+engineer)\b/i,
      /\b(automation|instrumentation|mechatronics)\b/i,
    ],
  },
  {
    label: "Construction",
    patterns: [
      /\b(construction\s+(ltd|limited|plc|group|services|company))\b/i,
      /\b(building\s+(contractor|services|company)|civil\s+(contractor|engineering\b))\b/i,
      /\b(housebuilder|house\s+builder|property\s+developer|real\s+estate\s+developer)\b/i,
      /\b(surveying|quantity\s+surveyor|building\s+surveyor|architecture\s+firm)\b/i,
      /\b(roofing|scaffolding|groundwork|demolition|fit.?out|fit\s+out)\b/i,
      /\b(plumbing|heating\s+and\s+plumbing|hvac\s+(contractor|services))\b/i,
    ],
  },
  {
    label: "Technology",
    patterns: [
      /\b(software\s+(ltd|limited|solutions|group|house|development))\b/i,
      /\b(technology\s+(ltd|limited|plc|group|solutions|services))\b/i,
      /\b(it\s+(services|solutions|consultancy|support|group))\b/i,
      /\b(digital\s+(agency|solutions|services|transformation))\b/i,
      /\b(cyber\s+(security|solutions)|information\s+security)\b/i,
      /\b(cloud\s+(services|solutions|computing)|data\s+(centre|analytics|solutions))\b/i,
      /\b(artificial\s+intelligence|machine\s+learning|ai\s+(solutions|ltd))\b/i,
      /\b(telecoms?|telecommunications|network\s+(solutions|services))\b/i,
      /\btech\s+(ltd|limited|group|hub|solutions)\b/i,
    ],
  },
  {
    label: "Hospitality",
    patterns: [
      /\b(hotel|hotels\s+ltd|hospitality\s+(group|ltd|services))\b/i,
      /\b(restaurant|catering\s+(company|ltd|services|group)|food\s+(services|group))\b/i,
      /\b(pub\s+(group|company)|public\s+house|inn\s+(ltd|group))\b/i,
      /\b(leisure\s+(centre|group|ltd)|spa\s+and\s+leisure|resort)\b/i,
      /\b(events?\s+(catering|management\s+company)|banqueting)\b/i,
    ],
  },
  {
    label: "Retail",
    patterns: [
      /\b(retail\s+(ltd|group|services|solutions))\b/i,
      /\b(supermarket|hypermarket|convenience\s+store)\b/i,
      /\b(fashion\s+(group|retail|ltd)|clothing\s+(retail|group))\b/i,
      /\b(e.?commerce|online\s+retail|marketplace)\b/i,
    ],
  },
  {
    label: "Transport",
    patterns: [
      /\b(transport\s+(ltd|limited|group|services|solutions|plc))\b/i,
      /\b(logistics\s+(ltd|group|services|solutions))\b/i,
      /\b(freight|haulage|hauler|haulier|road\s+haulage)\b/i,
      /\b(courier\s+(services|ltd)|parcel\s+(delivery|services))\b/i,
      /\b(shipping\s+(company|ltd|group)|maritime\s+services)\b/i,
      /\b(airline|airways|aviation\s+services|airport\s+services)\b/i,
      /\b(taxi|private\s+hire|minicab|coach\s+(hire|operator))\b/i,
      /\b(rail\s+(services|network|freight)|train\s+operator)\b/i,
    ],
  },
  {
    label: "Manufacturing",
    patterns: [
      /\b(manufacturing\s+(ltd|limited|plc|group|co))\b/i,
      /\b(food\s+(manufacturing|production|processing))\b/i,
      /\b(packaging\s+(ltd|group|solutions))\b/i,
      /\b(textiles?|garment\s+(manufacturing|factory)|apparel\s+manufacturing)\b/i,
      /\b(plastics?\s+(manufacturing|group)|rubber\s+(products|manufacturing))\b/i,
      /\b(steel\s+(manufacturing|works|group)|metals?\s+(manufacturing|fabrication))\b/i,
      /\b(print(ing)?\s+(company|group|ltd)|publishing\s+group)\b/i,
    ],
  },
];

/**
 * Fast keyword-based classifier. Returns null when no pattern matches confidently.
 * Priority order: Public Services → Social Care → Healthcare → Education → Legal → Finance → Engineering → Construction → Technology → Hospitality → Retail → Transport → Manufacturing
 */
export function classifyByKeyword(name: string): IndustryLabel | null {
  for (const group of PATTERN_GROUPS) {
    for (const pattern of group.patterns) {
      if (pattern.test(name)) {
        return group.label;
      }
    }
  }
  return null;
}

/**
 * AI batch classifier using GPT-4o. Accepts up to 100 names at a time.
 * Returns a parallel array of industry labels (same length as input).
 * Falls back to "Other" for any names that can't be classified.
 */
export async function classifyBatchWithAI(names: string[]): Promise<IndustryLabel[]> {
  if (names.length === 0) return [];

  const labelsStr = INDUSTRY_LABELS.join(", ");
  const numbered = names.map((n, i) => `${i + 1}. ${n}`).join("\n");

  const prompt = `You are classifying UK organisations by industry sector. For each company name below, return EXACTLY one label from this list: ${labelsStr}

Use context clues in the name. When uncertain, use "Other". Companies with "NHS" in the name are "Public Services".

Companies:
${numbered}

Return ONLY a JSON array of strings (same length, same order), e.g. ["Healthcare","Technology","Other"].`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_completion_tokens: names.length * 12 + 50,
      temperature: 0,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.choices[0]?.message?.content?.trim() ?? "";
    // Extract JSON array — may be wrapped in markdown code fences
    const jsonMatch = /\[[\s\S]*?\]/.exec(text);
    if (!jsonMatch) throw new Error("No JSON array in response");

    const parsed: unknown = JSON.parse(jsonMatch[0]);
    const items: unknown[] = Array.isArray(parsed) ? parsed : [];

    // Accept responses of any length — truncate extras, pad with "Other" for missing
    const results: IndustryLabel[] = names.map((_, i) => {
      const item = items[i];
      if (item === undefined) return "Other";
      const s = String(item).trim();
      return (INDUSTRY_LABELS as readonly string[]).includes(s) ? (s as IndustryLabel) : "Other";
    });

    return results;
  } catch (err) {
    console.warn("[industry-classifier] AI batch failed:", err instanceof Error ? err.message : err);
    return names.map(() => "Other");
  }
}

/**
 * Classify a single name using keyword first, then AI if needed.
 * For bulk classification prefer classifyBatch() for efficiency.
 */
export async function classifyOne(name: string): Promise<IndustryLabel> {
  const kw = classifyByKeyword(name);
  if (kw) return kw;
  const [result] = await classifyBatchWithAI([name]);
  return result ?? "Other";
}

/**
 * Classify an array of names using keyword first, then AI for the remainder.
 * Returns a parallel array of labels.
 */
export async function classifyBatch(names: string[]): Promise<IndustryLabel[]> {
  const results: (IndustryLabel | null)[] = names.map(classifyByKeyword);
  const unknownIdxs = results.reduce<number[]>((acc, r, i) => {
    if (r === null) acc.push(i);
    return acc;
  }, []);

  if (unknownIdxs.length === 0) return results as IndustryLabel[];

  const AI_BATCH = 100;
  for (let i = 0; i < unknownIdxs.length; i += AI_BATCH) {
    const batchIdxs = unknownIdxs.slice(i, i + AI_BATCH);
    const batchNames = batchIdxs.map((idx) => names[idx]!);
    const aiLabels = await classifyBatchWithAI(batchNames);
    batchIdxs.forEach((idx, j) => {
      results[idx] = aiLabels[j] ?? "Other";
    });
  }

  return results.map((r) => r ?? "Other");
}
