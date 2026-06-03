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
  regulator: string;
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

const RIGHT_TO_WORK_STATUSES = [
  "british_citizen",
  "uk_settled",
  "uk_pre_settled",
  "eea_citizen",
  "other_visa",
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
  {
    regulator: "EDUCATION",
    version: "1.0.0",
    changelog:
      "Initial Education ruleset v1.0.0 — covers UK teacher eligibility requirements including Qualified Teacher Status (QTS), DBS check, and degree requirements. Source: DfE guidance (www.gov.uk/become-teacher).",
    rules: [
      {
        ruleKey: "EDUCATION_QTS_OBTAINED",
        conditions: [
          { field: "registrationStatus", operator: "eq", value: "registered" },
        ],
        outcome: "eligible",
        reasonCode: "EDUCATION_QTS_OBTAINED",
        explanationText:
          "You hold Qualified Teacher Status (QTS) or equivalent professional registration. You are eligible to teach in UK state-maintained schools. Ensure your DBS Enhanced Certificate is current and that you are registered with the Teaching Regulation Agency (TRA).",
        pathways: ["QTS via TRA", "International QTS Recognition", "Induction Period Completion"],
        sortOrder: 1,
      },
      {
        ruleKey: "EDUCATION_QTS_IN_PROGRESS",
        conditions: [
          { field: "registrationStatus", operator: "eq", value: "in_process" },
        ],
        outcome: "not_eligible",
        reasonCode: "EDUCATION_QTS_IN_PROGRESS",
        explanationText:
          "Your QTS application or teacher training programme is in progress. Once you complete your Initial Teacher Training (ITT) and assessment, the Teaching Regulation Agency (TRA) will award QTS. In the meantime, you may work as an unqualified teacher in some settings.",
        pathways: ["Initial Teacher Training (ITT)", "Assessment Only Route", "International QTS Recognition"],
        sortOrder: 2,
      },
      {
        ruleKey: "EDUCATION_RIGHT_TO_WORK",
        conditions: [
          { field: "registrationStatus", operator: "eq", value: "not_registered" },
          { field: "requiresSponsorship", operator: "eq", value: true },
        ],
        outcome: "not_eligible",
        reasonCode: "EDUCATION_VISA_REQUIRED",
        explanationText:
          "You will need a valid UK work visa to teach in UK schools. The Skilled Worker visa is the most common route for qualified international teachers. Your employer (school) must hold a valid sponsor licence. You should also obtain QTS through the Teaching Regulation Agency.",
        pathways: ["Skilled Worker Visa (Teacher route)", "QTS via Teaching Regulation Agency", "DBS Enhanced Check"],
        sortOrder: 3,
      },
      {
        ruleKey: "EDUCATION_NO_QTS",
        conditions: [
          { field: "registrationStatus", operator: "eq", value: "not_registered" },
          { field: "experienceYears", operator: "gte", value: 2 },
        ],
        outcome: "not_eligible",
        reasonCode: "EDUCATION_QTS_REQUIRED",
        explanationText:
          "You have teaching experience but have not yet obtained QTS. You may be eligible for the Assessment Only (AO) route if you can demonstrate you already meet the Teachers' Standards without further training. Alternatively, you can apply for QTS recognition if you have international teaching qualifications.",
        pathways: ["Assessment Only (AO) Route", "International QTS Recognition", "School Direct (Salaried)"],
        sortOrder: 4,
      },
      {
        ruleKey: "EDUCATION_EARLY_CAREER",
        conditions: [
          { field: "registrationStatus", operator: "eq", value: "not_registered" },
        ],
        outcome: "not_eligible",
        reasonCode: "EDUCATION_TRAINING_REQUIRED",
        explanationText:
          "To teach in UK state-maintained schools, you need Qualified Teacher Status (QTS). You can obtain QTS by completing an accredited Initial Teacher Training (ITT) programme such as a PGCE, School Direct, or Teach First. A degree (or equivalent) is required for most ITT routes.",
        pathways: ["PGCE Programme", "School Direct", "Teach First", "Undergraduate ITT"],
        sortOrder: 5,
      },
    ],
  },
  {
    regulator: "HIGHER_EDUCATION",
    version: "1.0.0",
    changelog:
      "Initial Higher Education ruleset v1.0.0 — covers UK academic and researcher eligibility requirements including PhD, research experience, and right-to-work. Source: UCEA and Vitae guidance.",
    rules: [
      {
        ruleKey: "HE_QUALIFIED_SENIOR",
        conditions: [
          { field: "registrationStatus", operator: "eq", value: "registered" },
          { field: "experienceYears", operator: "gte", value: 5 },
        ],
        outcome: "eligible",
        reasonCode: "HE_QUALIFIED_SENIOR",
        explanationText:
          "Your doctoral qualification and significant research experience make you eligible for academic and research positions in UK higher education. Senior roles (Reader, Professor, Principal Investigator) typically require a strong publication record and evidence of research leadership. Ensure your right to work in the UK is in order.",
        pathways: ["Senior Lecturer / Reader Track", "Principal Investigator (PI) Route", "Professorial Appointment"],
        sortOrder: 1,
      },
      {
        ruleKey: "HE_QUALIFIED_EARLY_CAREER",
        conditions: [
          { field: "registrationStatus", operator: "eq", value: "registered" },
        ],
        outcome: "eligible",
        reasonCode: "HE_QUALIFIED_EARLY_CAREER",
        explanationText:
          "Your doctoral qualification makes you eligible for early-career academic and researcher roles in UK higher education, including Postdoctoral Research Associate (PDRA), Research Fellow, and Lecturer positions. Building a publication record and securing funding will strengthen your academic career trajectory.",
        pathways: ["Postdoctoral Research Associate", "Research Fellow", "Lecturer / Teaching Fellow"],
        sortOrder: 2,
      },
      {
        ruleKey: "HE_PHD_IN_PROGRESS",
        conditions: [
          { field: "registrationStatus", operator: "eq", value: "in_process" },
        ],
        outcome: "not_eligible",
        reasonCode: "HE_PHD_IN_PROGRESS",
        explanationText:
          "Your doctoral research is in progress. Most permanent academic positions in UK universities require a completed PhD. You may be eligible for Graduate Teaching Assistant (GTA), Research Assistant, or fixed-term teaching roles while completing your doctorate.",
        pathways: ["Graduate Teaching Assistant (GTA)", "Research Assistant", "Associate Lecturer"],
        sortOrder: 3,
      },
      {
        ruleKey: "HE_VISA_REQUIRED",
        conditions: [
          { field: "requiresSponsorship", operator: "eq", value: true },
          { field: "registrationStatus", operator: "eq", value: "not_registered" },
        ],
        outcome: "not_eligible",
        reasonCode: "HE_VISA_AND_PHD_REQUIRED",
        explanationText:
          "Academic and research roles in UK higher education typically require both a doctoral qualification (PhD or equivalent) and a valid UK work visa. Your employer (university) will need to sponsor your Skilled Worker visa. A PhD is generally essential for permanent academic posts.",
        pathways: ["PhD Programme", "Skilled Worker Visa (Research route)", "Global Talent Visa"],
        sortOrder: 4,
      },
      {
        ruleKey: "HE_NO_PHD",
        conditions: [
          { field: "registrationStatus", operator: "eq", value: "not_registered" },
        ],
        outcome: "not_eligible",
        reasonCode: "HE_PHD_REQUIRED",
        explanationText:
          "A doctoral qualification (PhD or equivalent) is typically required for academic and research roles in UK higher education. Without a PhD, you may be eligible for professional services, teaching support, or industry-partnership roles. Pursuing a doctoral programme is the primary pathway to a UK academic career.",
        pathways: ["PhD Programme (Home or Overseas)", "Professional Doctorate", "Higher Education Administration"],
        sortOrder: 5,
      },
    ],
  },
  {
    regulator: "ENGINEERING",
    version: "1.0.0",
    changelog:
      "Initial Engineering ruleset v1.0.0 — covers UK professional engineering eligibility including CEng, IEng, and EngTech registration via the Engineering Council. Source: Engineering Council guidance (www.engc.org.uk).",
    rules: [
      {
        ruleKey: "ENG_CHARTERED_ENGINEER",
        conditions: [
          { field: "registrationStatus", operator: "eq", value: "registered" },
          { field: "experienceYears", operator: "gte", value: 5 },
        ],
        outcome: "eligible",
        reasonCode: "ENG_CHARTERED_ENGINEER",
        explanationText:
          "Your professional engineering registration and experience indicate you may hold or be eligible for Chartered Engineer (CEng) status. CEng is awarded by a licensed Professional Engineering Institution (PEI) on behalf of the Engineering Council. Ensure your registration is transferable to a UK PEI via mutual recognition agreements.",
        pathways: ["CEng via Licensed Professional Engineering Institution", "International Mutual Recognition Agreement", "Incorporated Engineer (IEng) Route"],
        sortOrder: 1,
      },
      {
        ruleKey: "ENG_REGISTERED_JUNIOR",
        conditions: [
          { field: "registrationStatus", operator: "eq", value: "registered" },
        ],
        outcome: "eligible",
        reasonCode: "ENG_REGISTERED",
        explanationText:
          "You hold professional engineering registration or membership of a recognised engineering institution. In the UK, professional engineers are registered through the Engineering Council via a Licensed Professional Engineering Institution (PEI). You should verify your qualification is recognised and apply through the appropriate PEI for CEng, IEng, or EngTech registration.",
        pathways: ["Incorporated Engineer (IEng)", "Engineering Technician (EngTech)", "CEng (with additional experience)"],
        sortOrder: 2,
      },
      {
        ruleKey: "ENG_REGISTRATION_IN_PROGRESS",
        conditions: [
          { field: "registrationStatus", operator: "eq", value: "in_process" },
        ],
        outcome: "not_eligible",
        reasonCode: "ENG_REGISTRATION_IN_PROGRESS",
        explanationText:
          "Your professional engineering registration application is in progress. Once complete, you can seek recognition from a UK Professional Engineering Institution (PEI). Gather evidence of your competencies aligned to the UK Standard for Professional Engineering Competence (UK-SPEC) while your application is being processed.",
        pathways: ["UK-SPEC Competence Mapping", "Professional Engineering Institution Membership", "CEng Application"],
        sortOrder: 3,
      },
      {
        ruleKey: "ENG_EXPERIENCED_NO_REG",
        conditions: [
          { field: "registrationStatus", operator: "eq", value: "not_registered" },
          { field: "experienceYears", operator: "gte", value: 4 },
          { field: "requiresSponsorship", operator: "eq", value: false },
        ],
        outcome: "not_eligible",
        reasonCode: "ENG_PROFESSIONAL_REG_REQUIRED",
        explanationText:
          "You have substantial engineering experience but do not yet hold formal professional registration. You may be eligible for Incorporated Engineer (IEng) or Chartered Engineer (CEng) status through a Licensed Professional Engineering Institution. Your application will be assessed against the UK Standard for Professional Engineering Competence (UK-SPEC).",
        pathways: ["IEng Application via PEI", "CEng Application via PEI", "UK-SPEC Competence Mapping"],
        sortOrder: 4,
      },
      {
        ruleKey: "ENG_VISA_REQUIRED",
        conditions: [
          { field: "registrationStatus", operator: "eq", value: "not_registered" },
          { field: "requiresSponsorship", operator: "eq", value: true },
        ],
        outcome: "not_eligible",
        reasonCode: "ENG_VISA_AND_REG_REQUIRED",
        explanationText:
          "To work as an engineer in the UK, you will need both a valid UK work visa (typically the Skilled Worker route) and recognition of your engineering qualifications. An engineering degree plus relevant experience is required. Sponsorship from a UK employer holding a valid sponsor licence is needed for the Skilled Worker visa.",
        pathways: ["Skilled Worker Visa (Engineering)", "Global Talent Visa", "Professional Engineering Institution Membership"],
        sortOrder: 5,
      },
      {
        ruleKey: "ENG_EARLY_CAREER",
        conditions: [
          { field: "registrationStatus", operator: "eq", value: "not_registered" },
        ],
        outcome: "not_eligible",
        reasonCode: "ENG_QUALIFICATION_PATHWAY",
        explanationText:
          "To work as a professionally registered engineer in the UK, you will typically need an accredited engineering degree (BEng/MEng), relevant work experience, and registration through a Licensed Professional Engineering Institution (PEI). Engineering Technician (EngTech) status is available for those with HNC/HND-level qualifications.",
        pathways: ["Accredited Engineering Degree", "EngTech (HNC/HND)", "Graduate Engineer Development Programme"],
        sortOrder: 6,
      },
    ],
  },
  {
    regulator: "GENERAL",
    version: "1.0.0",
    changelog:
      "Initial General ruleset v1.0.0 — covers right-to-work, relevant qualifications, and general UK employment eligibility for professions not covered by a specific regulated pathway. Note that sector-specific requirements may apply.",
    rules: [
      {
        ruleKey: "GENERAL_ELIGIBLE_EXPERIENCED",
        conditions: [
          { field: "requiresSponsorship", operator: "eq", value: false },
          { field: "registrationStatus", operator: "eq", value: "registered" },
          { field: "experienceYears", operator: "gte", value: 3 },
        ],
        outcome: "eligible",
        reasonCode: "GENERAL_ELIGIBLE_EXPERIENCED",
        explanationText:
          "Based on your right to work in the UK, professional registration or qualifications, and relevant experience, you appear eligible to pursue employment in your field. Sector-specific requirements (such as DBS checks for roles with vulnerable people) will need to be confirmed with individual employers.",
        pathways: ["Direct Employment", "Professional Body Membership (if applicable)", "DBS Enhanced Check (if required)"],
        sortOrder: 1,
      },
      {
        ruleKey: "GENERAL_ELIGIBLE_QUALIFIED",
        conditions: [
          { field: "requiresSponsorship", operator: "eq", value: false },
          { field: "registrationStatus", operator: "in", value: ["registered", "in_process"] },
        ],
        outcome: "eligible",
        reasonCode: "GENERAL_ELIGIBLE_QUALIFIED",
        explanationText:
          "You have right to work in the UK and hold or are working towards relevant professional qualifications. You are generally eligible to seek employment in your sector. Check whether your specific role requires additional regulatory registration, licensing, or a DBS check.",
        pathways: ["Direct Employment", "Professional Body Membership (if applicable)", "Sector-Specific Licensing (if required)"],
        sortOrder: 2,
      },
      {
        ruleKey: "GENERAL_RIGHT_TO_WORK_ONLY",
        conditions: [
          { field: "requiresSponsorship", operator: "eq", value: false },
          { field: "registrationStatus", operator: "eq", value: "not_registered" },
          { field: "experienceYears", operator: "gte", value: 2 },
        ],
        outcome: "not_eligible",
        reasonCode: "GENERAL_QUALIFICATIONS_RECOMMENDED",
        explanationText:
          "You have right to work in the UK and professional experience, but have not indicated formal qualifications or professional registration. While many roles do not require formal registration, obtaining relevant qualifications or professional body membership can strengthen your applications significantly. A DBS check may also be required for certain roles.",
        pathways: ["Professional Body Membership", "NVQ / Vocational Qualification", "Relevant Degree or Diploma"],
        sortOrder: 3,
      },
      {
        ruleKey: "GENERAL_NEEDS_SPONSORSHIP",
        conditions: [
          { field: "requiresSponsorship", operator: "eq", value: true },
        ],
        outcome: "not_eligible",
        reasonCode: "GENERAL_SPONSORSHIP_REQUIRED",
        explanationText:
          "You will need a UK work visa to take up employment. The Skilled Worker visa is the most common route for overseas professionals. Your employer must hold a valid Skilled Worker sponsor licence. The role must meet the minimum salary threshold (currently £38,700 per year or the 'going rate' for the occupation, whichever is higher).",
        pathways: ["Skilled Worker Visa", "Global Talent Visa (for exceptional talent)", "Graduate Visa (if recently UK-qualified)"],
        sortOrder: 4,
      },
      {
        ruleKey: "GENERAL_DEFAULT",
        conditions: [
          { field: "experienceYears", operator: "gte", value: 0 },
        ],
        outcome: "not_eligible",
        reasonCode: "GENERAL_PROFILE_INCOMPLETE",
        explanationText:
          "Based on your current profile, sector-specific eligibility requirements for your profession are being assessed. JOBSAGE will expand industry-specific guidance for your sector soon. In the meantime, please ensure your profile is fully complete — including qualifications, experience, and residency status — so we can provide the most accurate assessment.",
        pathways: ["Complete Your Profile", "Contact a JOBSAGE Adviser"],
        sortOrder: 5,
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
