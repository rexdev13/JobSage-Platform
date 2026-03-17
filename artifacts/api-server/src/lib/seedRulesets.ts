import { db } from "@workspace/db";
import { rulesetsTable, rulesetRulesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { RuleCondition } from "@workspace/db";

interface RuleSeedData {
  ruleKey: string;
  conditions: RuleCondition[];
  outcome: "eligible" | "not_eligible" | "ineligible";
  reasonCode: string;
  explanationText: string;
  pathways?: string[];
  sortOrder: number;
}

interface RulesetSeedData {
  regulator: "GMC" | "NMC" | "HCPC";
  version: string;
  changelog: string;
  rules: RuleSeedData[];
}

const GMC_APPROVED_QUALIFICATION_COUNTRIES = [
  "United Kingdom",
  "Ireland",
  "Australia",
  "Canada",
  "New Zealand",
  "South Africa",
  "United States",
  "India",
  "Pakistan",
  "Nigeria",
  "Ghana",
  "Zimbabwe",
  "Zambia",
  "Jamaica",
  "Trinidad and Tobago",
  "Barbados",
];

const ENGLISH_SPEAKING_COUNTRIES = [
  "United Kingdom",
  "Ireland",
  "Australia",
  "Canada",
  "New Zealand",
  "United States",
  "Jamaica",
  "Trinidad and Tobago",
  "Barbados",
  "South Africa",
  "Ghana",
  "Nigeria",
  "Zimbabwe",
  "Zambia",
];

const EU_EEA_COUNTRIES = [
  "Austria", "Belgium", "Bulgaria", "Croatia", "Cyprus", "Czech Republic",
  "Denmark", "Estonia", "Finland", "France", "Germany", "Greece", "Hungary",
  "Iceland", "Ireland", "Italy", "Latvia", "Liechtenstein", "Lithuania",
  "Luxembourg", "Malta", "Netherlands", "Norway", "Poland", "Portugal",
  "Romania", "Slovakia", "Slovenia", "Spain", "Sweden",
];

const NMC_APPROVED_COUNTRIES = [
  "United Kingdom",
  "Ireland",
  "Australia",
  "Canada",
  "New Zealand",
  "United States",
  "South Africa",
  "Nigeria",
  "India",
  "Philippines",
  "Kenya",
  "Zimbabwe",
  "Zambia",
  "Ghana",
];

const HCPC_APPROVED_COUNTRIES = [
  "United Kingdom",
  "Ireland",
  "Australia",
  "Canada",
  "New Zealand",
  "United States",
  "South Africa",
  "India",
];

const rulesetSeedData: RulesetSeedData[] = [
  {
    regulator: "GMC",
    version: "1.0.0",
    changelog:
      "Initial GMC ruleset v1.0.0 — encodes publicly available GMC eligibility criteria for UK medical registration. Covers primary qualification recognition, English language requirements, and registration pathways. Source: GMC guidance (www.gmc-uk.org).",
    rules: [
      {
        ruleKey: "GMC_WRONG_PROFESSION",
        conditions: [
          { field: "profession", operator: "not_in", value: ["doctor", "clinical_academic"] },
        ],
        outcome: "ineligible",
        reasonCode: "GMC_PROFESSION_MISMATCH",
        explanationText:
          "GMC registration is only available to doctors and clinical academics. Your declared profession does not qualify for GMC registration. Nurses should apply to the NMC; allied health professionals should apply to the HCPC.",
        sortOrder: 1,
      },
      {
        ruleKey: "GMC_ALREADY_REGISTERED",
        conditions: [
          { field: "profession", operator: "in", value: ["doctor", "clinical_academic"] },
          { field: "registrationStatus", operator: "eq", value: "registered" },
        ],
        outcome: "eligible",
        reasonCode: "GMC_ALREADY_REGISTERED",
        explanationText:
          "You are already registered with a medical regulator. You may be eligible to apply for GMC registration via the Certificate of Good Standing pathway. The GMC will verify your existing registration before granting a licence to practise.",
        pathways: ["Certificate of Good Standing", "Specialist Register Application"],
        sortOrder: 2,
      },
      {
        ruleKey: "GMC_IN_PROCESS",
        conditions: [
          { field: "profession", operator: "in", value: ["doctor", "clinical_academic"] },
          { field: "registrationStatus", operator: "eq", value: "in_process" },
          { field: "qualificationCountry", operator: "in", value: GMC_APPROVED_QUALIFICATION_COUNTRIES },
        ],
        outcome: "not_eligible",
        reasonCode: "GMC_REGISTRATION_IN_PROGRESS",
        explanationText:
          "Your medical registration is currently in progress. Once your application is approved by your home regulator, you can apply for GMC registration via the primary qualification route. Continue gathering supporting documents in the meantime.",
        pathways: ["Primary Qualification Route", "PLAB (if primary qualification not recognised)"],
        sortOrder: 3,
      },
      {
        ruleKey: "GMC_ELIGIBLE_PRIMARY_QUAL_ENGLISH",
        conditions: [
          { field: "profession", operator: "in", value: ["doctor", "clinical_academic"] },
          { field: "registrationStatus", operator: "eq", value: "not_registered" },
          { field: "qualificationCountry", operator: "in", value: GMC_APPROVED_QUALIFICATION_COUNTRIES },
          { field: "qualificationCountry", operator: "in", value: ENGLISH_SPEAKING_COUNTRIES },
          { field: "experienceYears", operator: "gte", value: 0 },
        ],
        outcome: "eligible",
        reasonCode: "GMC_PRIMARY_QUALIFICATION_ELIGIBLE",
        explanationText:
          "Your primary medical qualification from an approved country and English language background means you are likely eligible to apply for GMC registration via the primary qualification route. You will need to provide your primary medical qualification certificate, proof of good standing, and ID documents.",
        pathways: ["Primary Qualification Route", "Specialist Register (if applicable)"],
        sortOrder: 4,
      },
      {
        ruleKey: "GMC_ELIGIBLE_PRIMARY_QUAL_NON_ENGLISH",
        conditions: [
          { field: "profession", operator: "in", value: ["doctor", "clinical_academic"] },
          { field: "registrationStatus", operator: "eq", value: "not_registered" },
          { field: "qualificationCountry", operator: "in", value: GMC_APPROVED_QUALIFICATION_COUNTRIES },
          { field: "qualificationCountry", operator: "not_in", value: ENGLISH_SPEAKING_COUNTRIES },
        ],
        outcome: "not_eligible",
        reasonCode: "GMC_ENGLISH_LANGUAGE_REQUIRED",
        explanationText:
          "Your primary qualification is from a GMC-approved country, but you will need to demonstrate English language proficiency before applying for GMC registration. Accepted tests include IELTS Academic (minimum 7.5 overall), OET (minimum grade B in all areas), or TOEFL iBT.",
        pathways: ["IELTS Academic Route", "OET Route", "TOEFL iBT Route"],
        sortOrder: 5,
      },
      {
        ruleKey: "GMC_PLAB_PATHWAY",
        conditions: [
          { field: "profession", operator: "in", value: ["doctor", "clinical_academic"] },
          { field: "registrationStatus", operator: "eq", value: "not_registered" },
          { field: "qualificationCountry", operator: "not_in", value: GMC_APPROVED_QUALIFICATION_COUNTRIES },
          { field: "qualificationCountry", operator: "not_in", value: EU_EEA_COUNTRIES },
        ],
        outcome: "not_eligible",
        reasonCode: "GMC_PLAB_REQUIRED",
        explanationText:
          "Your primary medical qualification is not from a GMC-recognised country. To apply for GMC registration, you will need to pass the Professional and Linguistic Assessments Board (PLAB) test. PLAB 1 is a written exam; PLAB 2 is a clinical assessment held in the UK.",
        pathways: ["PLAB 1 and PLAB 2", "Primary Qualification Route (after PLAB)"],
        sortOrder: 6,
      },
      {
        ruleKey: "GMC_EU_EEA_PATHWAY",
        conditions: [
          { field: "profession", operator: "in", value: ["doctor", "clinical_academic"] },
          { field: "registrationStatus", operator: "eq", value: "not_registered" },
          { field: "qualificationCountry", operator: "in", value: EU_EEA_COUNTRIES },
        ],
        outcome: "not_eligible",
        reasonCode: "GMC_EU_EEA_PATHWAY",
        explanationText:
          "Post-Brexit, EU/EEA qualifications are no longer automatically recognised for GMC registration. You will need to apply via the primary qualification route or PLAB pathway depending on your specific qualification. Please check the GMC website for the latest guidance on your country's recognition status.",
        pathways: ["Primary Qualification Route", "PLAB Pathway"],
        sortOrder: 7,
      },
    ],
  },
  {
    regulator: "NMC",
    version: "1.0.0",
    changelog:
      "Initial NMC ruleset v1.0.0 — encodes publicly available NMC eligibility criteria for UK nursing and midwifery registration. Covers education programme recognition, English language, and registration pathways. Source: NMC guidance (www.nmc.org.uk).",
    rules: [
      {
        ruleKey: "NMC_WRONG_PROFESSION",
        conditions: [
          { field: "profession", operator: "not_in", value: ["nurse", "midwife"] },
        ],
        outcome: "ineligible",
        reasonCode: "NMC_PROFESSION_MISMATCH",
        explanationText:
          "NMC registration is available to nurses and midwives. Your declared profession does not qualify for NMC registration. Doctors should apply to the GMC; allied health professionals should apply to the HCPC.",
        sortOrder: 1,
      },
      {
        ruleKey: "NMC_ALREADY_REGISTERED",
        conditions: [
          { field: "profession", operator: "in", value: ["nurse", "midwife"] },
          { field: "registrationStatus", operator: "eq", value: "registered" },
        ],
        outcome: "eligible",
        reasonCode: "NMC_ALREADY_REGISTERED",
        explanationText:
          "You are already registered with a nursing or midwifery regulator. You can apply for NMC registration via the overseas nurses pathway, providing a Certificate of Current Professional Status from your home regulator.",
        pathways: ["Overseas Registration Route", "Certificate of Current Professional Status"],
        sortOrder: 2,
      },
      {
        ruleKey: "NMC_IN_PROCESS",
        conditions: [
          { field: "profession", operator: "in", value: ["nurse", "midwife"] },
          { field: "registrationStatus", operator: "eq", value: "in_process" },
          { field: "qualificationCountry", operator: "in", value: NMC_APPROVED_COUNTRIES },
        ],
        outcome: "not_eligible",
        reasonCode: "NMC_REGISTRATION_IN_PROGRESS",
        explanationText:
          "Your nursing registration is currently in progress. Once approved, you will be able to apply for NMC registration via the overseas route. Begin preparing your supporting documentation now.",
        pathways: ["Overseas Registration Route"],
        sortOrder: 3,
      },
      {
        ruleKey: "NMC_ELIGIBLE_APPROVED_COUNTRY_ENGLISH",
        conditions: [
          { field: "profession", operator: "in", value: ["nurse", "midwife"] },
          { field: "registrationStatus", operator: "eq", value: "not_registered" },
          { field: "qualificationCountry", operator: "in", value: NMC_APPROVED_COUNTRIES },
          { field: "qualificationCountry", operator: "in", value: ENGLISH_SPEAKING_COUNTRIES },
        ],
        outcome: "eligible",
        reasonCode: "NMC_APPROVED_QUALIFICATION_ELIGIBLE",
        explanationText:
          "Your nursing qualification from an NMC-recognised country and English language background means you are likely eligible for NMC registration. You will need to complete the NMC's Computer-Based Test (CBT) and Objective Structured Clinical Examination (OSCE) as part of the process.",
        pathways: ["CBT + OSCE Pathway", "Overseas Registration Route"],
        sortOrder: 4,
      },
      {
        ruleKey: "NMC_APPROVED_COUNTRY_ENGLISH_REQUIRED",
        conditions: [
          { field: "profession", operator: "in", value: ["nurse", "midwife"] },
          { field: "registrationStatus", operator: "eq", value: "not_registered" },
          { field: "qualificationCountry", operator: "in", value: NMC_APPROVED_COUNTRIES },
          { field: "qualificationCountry", operator: "not_in", value: ENGLISH_SPEAKING_COUNTRIES },
        ],
        outcome: "not_eligible",
        reasonCode: "NMC_ENGLISH_LANGUAGE_REQUIRED",
        explanationText:
          "Your nursing qualification is from an NMC-recognised country, but you must demonstrate English language proficiency before applying. Accepted tests are IELTS Academic (minimum 7.0 overall with minimum 6.5 in each component) or OET (minimum grade B in reading and listening, grade C+ in writing and speaking).",
        pathways: ["IELTS Academic Route", "OET Route"],
        sortOrder: 5,
      },
      {
        ruleKey: "NMC_UNAPPROVED_COUNTRY",
        conditions: [
          { field: "profession", operator: "in", value: ["nurse", "midwife"] },
          { field: "qualificationCountry", operator: "not_in", value: NMC_APPROVED_COUNTRIES },
        ],
        outcome: "not_eligible",
        reasonCode: "NMC_QUALIFICATION_REQUIRES_ASSESSMENT",
        explanationText:
          "Your nursing qualification is from a country not on the NMC's approved list. Your qualification will need to be assessed by the NMC. You may be asked to undertake additional testing or supervised practice before being granted registration.",
        pathways: ["NMC Qualification Assessment", "Adaptation Programme (if directed)"],
        sortOrder: 6,
      },
    ],
  },
  {
    regulator: "HCPC",
    version: "1.0.0",
    changelog:
      "Initial HCPC ruleset v1.0.0 — encodes publicly available HCPC eligibility criteria for UK allied health profession registration. Covers approved programme recognition, English language, and registration pathways. Source: HCPC guidance (www.hcpc-uk.org).",
    rules: [
      {
        ruleKey: "HCPC_WRONG_PROFESSION",
        conditions: [
          { field: "profession", operator: "not_in", value: ["allied_health_professional"] },
        ],
        outcome: "ineligible",
        reasonCode: "HCPC_PROFESSION_MISMATCH",
        explanationText:
          "HCPC registration covers allied health professionals across 15 professions (physiotherapy, occupational therapy, radiography, etc.). Your declared profession does not qualify for HCPC registration. Doctors should apply to the GMC; nurses should apply to the NMC.",
        sortOrder: 1,
      },
      {
        ruleKey: "HCPC_ALREADY_REGISTERED",
        conditions: [
          { field: "profession", operator: "eq", value: "allied_health_professional" },
          { field: "registrationStatus", operator: "eq", value: "registered" },
        ],
        outcome: "eligible",
        reasonCode: "HCPC_ALREADY_REGISTERED",
        explanationText:
          "You are already registered with an allied health regulator. You can apply for HCPC registration by providing a Certificate of Good Standing from your home regulator, evidence of your qualifications, and proof of English language proficiency if required.",
        pathways: ["International Application Route", "Certificate of Good Standing"],
        sortOrder: 2,
      },
      {
        ruleKey: "HCPC_IN_PROCESS",
        conditions: [
          { field: "profession", operator: "eq", value: "allied_health_professional" },
          { field: "registrationStatus", operator: "eq", value: "in_process" },
          { field: "qualificationCountry", operator: "in", value: HCPC_APPROVED_COUNTRIES },
        ],
        outcome: "not_eligible",
        reasonCode: "HCPC_REGISTRATION_IN_PROGRESS",
        explanationText:
          "Your allied health registration is currently in progress. Once approved, you will be able to apply for HCPC registration via the international route. Prepare your portfolio of supporting documents in the meantime.",
        pathways: ["International Application Route"],
        sortOrder: 3,
      },
      {
        ruleKey: "HCPC_ELIGIBLE_APPROVED_ENGLISH",
        conditions: [
          { field: "profession", operator: "eq", value: "allied_health_professional" },
          { field: "registrationStatus", operator: "eq", value: "not_registered" },
          { field: "qualificationCountry", operator: "in", value: HCPC_APPROVED_COUNTRIES },
          { field: "qualificationCountry", operator: "in", value: ENGLISH_SPEAKING_COUNTRIES },
          { field: "experienceYears", operator: "gte", value: 1 },
        ],
        outcome: "eligible",
        reasonCode: "HCPC_APPROVED_QUALIFICATION_ELIGIBLE",
        explanationText:
          "Your allied health qualification from an HCPC-recognised country, English language background, and professional experience make you eligible to apply for HCPC registration. Submit a complete application including qualification certificates, professional references, and a personal statement.",
        pathways: ["International Application Route"],
        sortOrder: 4,
      },
      {
        ruleKey: "HCPC_ELIGIBLE_APPROVED_LOW_EXPERIENCE",
        conditions: [
          { field: "profession", operator: "eq", value: "allied_health_professional" },
          { field: "registrationStatus", operator: "eq", value: "not_registered" },
          { field: "qualificationCountry", operator: "in", value: HCPC_APPROVED_COUNTRIES },
          { field: "qualificationCountry", operator: "in", value: ENGLISH_SPEAKING_COUNTRIES },
          { field: "experienceYears", operator: "lte", value: 0 },
        ],
        outcome: "not_eligible",
        reasonCode: "HCPC_INSUFFICIENT_EXPERIENCE",
        explanationText:
          "Your qualification is from a recognised country, but you do not yet have sufficient post-qualification experience. The HCPC requires evidence of recent practice. Gaining at least one year of post-qualification experience in your home country is recommended before applying.",
        pathways: ["Supervised Practice Programme", "International Application Route (after experience)"],
        sortOrder: 5,
      },
      {
        ruleKey: "HCPC_APPROVED_COUNTRY_ENGLISH_REQUIRED",
        conditions: [
          { field: "profession", operator: "eq", value: "allied_health_professional" },
          { field: "registrationStatus", operator: "eq", value: "not_registered" },
          { field: "qualificationCountry", operator: "in", value: HCPC_APPROVED_COUNTRIES },
          { field: "qualificationCountry", operator: "not_in", value: ENGLISH_SPEAKING_COUNTRIES },
        ],
        outcome: "not_eligible",
        reasonCode: "HCPC_ENGLISH_LANGUAGE_REQUIRED",
        explanationText:
          "Your allied health qualification is from a recognised country, but you must provide evidence of English language proficiency. Accepted tests include IELTS Academic (minimum 7.0 overall), OET, or equivalent. You will also need to demonstrate your qualification is equivalent to a UK approved programme.",
        pathways: ["IELTS Academic Route", "OET Route", "Qualification Assessment"],
        sortOrder: 6,
      },
      {
        ruleKey: "HCPC_UNAPPROVED_COUNTRY",
        conditions: [
          { field: "profession", operator: "eq", value: "allied_health_professional" },
          { field: "qualificationCountry", operator: "not_in", value: HCPC_APPROVED_COUNTRIES },
        ],
        outcome: "not_eligible",
        reasonCode: "HCPC_QUALIFICATION_REQUIRES_ASSESSMENT",
        explanationText:
          "Your allied health qualification is from a country not on the HCPC's recognised list. You will need to have your qualification formally assessed for equivalence to a UK-approved programme. This process can take several months and may require additional study or supervised practice.",
        pathways: ["International Qualification Assessment", "Adaptation Programme (if directed)", "Aptitude Test (if directed)"],
        sortOrder: 7,
      },
    ],
  },
];

export async function seedRulesets(): Promise<void> {
  for (const data of rulesetSeedData) {
    const existing = await db
      .select()
      .from(rulesetsTable)
      .where(eq(rulesetsTable.regulator, data.regulator));

    if (existing.length > 0) {
      console.log(`[seed] Ruleset for ${data.regulator} already exists — skipping.`);
      continue;
    }

    const [ruleset] = await db
      .insert(rulesetsTable)
      .values({
        regulator: data.regulator,
        version: data.version,
        status: "published",
        effectiveDate: new Date("2025-01-01"),
        changelog: data.changelog,
        createdBy: "system",
      })
      .returning();

    await db.insert(rulesetRulesTable).values(
      data.rules.map((r) => ({
        rulesetId: ruleset.id,
        ruleKey: r.ruleKey,
        conditions: r.conditions,
        outcome: r.outcome,
        reasonCode: r.reasonCode,
        explanationText: r.explanationText,
        pathways: r.pathways ?? null,
        sortOrder: r.sortOrder,
      }))
    );

    console.log(`[seed] Seeded ruleset ${data.regulator} v${data.version} with ${data.rules.length} rules.`);
  }
}
