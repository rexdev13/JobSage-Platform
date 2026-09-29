export const STRICT_ROLE_PAGE_SECTORS = [
  "healthcare",
  "education",
  "engineering",
  "it",
  "legal",
  "accounting",
  "architecture",
  "business_development",
] as const;

export type StrictRolePageSector = (typeof STRICT_ROLE_PAGE_SECTORS)[number];

export type StrictRolePageSectorConfig = {
  titlePattern: RegExp;
  titleSqlPattern: string;
  sponsorIndustries: string[];
  defaultSocCode: string;
};

export const STRICT_ROLE_PAGE_SECTOR_CONFIG: Record<StrictRolePageSector, StrictRolePageSectorConfig> = {
  healthcare: {
    titlePattern:
      /\b(?:registered nurses?|staff nurses?|nurses?|midwi(?:fe|ves)|carers?|care assistants?|support workers?|healthcare assistants?|health care assistants?|social workers?|physiotherapists?|occupational therapists?|radiographers?|pharmacists?|dental nurses?|dentists?|paramedics?|nursing associates?|care workers?|domiciliary|clinical leads?|healthcare support workers?|home managers?|registered managers?|deputy managers?|ward managers?)\b/i,
    titleSqlPattern:
      "\\m(registered nurses?|staff nurses?|nurses?|midwi(fe|ves)|carers?|care assistants?|support workers?|healthcare assistants?|health care assistants?|social workers?|physiotherapists?|occupational therapists?|radiographers?|pharmacists?|dental nurses?|dentists?|paramedics?|nursing associates?|care workers?|domiciliary|clinical leads?|healthcare support workers?|home managers?|registered managers?|deputy managers?|ward managers?)\\M",
    sponsorIndustries: ["Healthcare", "Social Care"],
    defaultSocCode: "6135",
  },
  education: {
    titlePattern:
      /\b(?:teachers?|teaching assistants?|lecturers?|professors?|headteachers?|head teachers?|curriculum leads?|education leads?|early years(?:\s+teachers?)?|learning support|research fellows?|postdoctoral|postdocs?)\b/i,
    titleSqlPattern:
      "\\m(teachers?|teaching assistants?|lecturers?|professors?|headteachers?|head teachers?|curriculum leads?|education leads?|early years( teachers?)?|learning support|research fellows?|postdoctoral|postdocs?)\\M",
    sponsorIndustries: ["Education"],
    defaultSocCode: "2314",
  },
  engineering: {
    titlePattern:
      /\b(?:civil|mechanical|electrical|electronic|structural|chemical|manufacturing|design|project|process|quality|site)\s+engineers?\b|\bengineering technicians?\b|\bconstruction(?:\s+project)?\s+managers?\b/i,
    titleSqlPattern:
      "\\m(civil|mechanical|electrical|electronic|structural|chemical|manufacturing|design|project|process|quality|site)[[:space:]]+engineers?\\M|\\mengineering technicians?\\M|\\mconstruction( project)? managers?\\M",
    sponsorIndustries: ["Engineering", "Construction"],
    defaultSocCode: "2121",
  },
  it: {
    titlePattern:
      /\b(?:software (?:engineers?|developers?)|web developers?|application developers?|programmers?|devops|site reliability|cyber ?security|information technology|it (?:support|engineers?|managers?|analysts?|consultants?)|network (?:engineers?|administrators?|analysts?)|cloud (?:engineers?|administrators?|architects?)|systems? (?:engineers?|administrators?|analysts?)|database administrators?|data (?:analysts?|engineers?|scientists?)|technical support|help desk|service desk)\b/i,
    titleSqlPattern:
      "\\m(software (engineers?|developers?)|web developers?|application developers?|programmers?|devops|site reliability|cyber ?security|information technology|it (support|engineers?|managers?|analysts?|consultants?)|network (engineers?|administrators?|analysts?)|cloud (engineers?|administrators?|architects?)|systems? (engineers?|administrators?|analysts?)|database administrators?|data (analysts?|engineers?|scientists?)|technical support|help desk|service desk)\\M",
    sponsorIndustries: ["Technology"],
    defaultSocCode: "2133",
  },
  legal: {
    titlePattern:
      /\b(?:lawyers?|solicitors?|barristers?|legal (?:counsel|advisers?|advisors?|executives?)|paralegals?|attorneys?)\b/i,
    titleSqlPattern:
      "\\m(lawyers?|solicitors?|barristers?|legal (counsel|advisers?|advisors?|executives?)|paralegals?|attorneys?)\\M",
    sponsorIndustries: ["Legal & Professional"],
    defaultSocCode: "2413",
  },
  accounting: {
    titlePattern:
      /\b(?:accountants?|accounting|auditors?|audit (?:managers?|officers?)|finance (?:officers?|accountants?)|accounts? (?:payable|receivable)|financial controllers?|chartered accountants?)\b/i,
    titleSqlPattern:
      "\\m(accountants?|accounting|auditors?|audit (managers?|officers?)|finance (officers?|accountants?)|accounts? (payable|receivable)|financial controllers?|chartered accountants?)\\M",
    sponsorIndustries: ["Finance"],
    defaultSocCode: "2421",
  },
  architecture: {
    titlePattern:
      /\b(?:architects?|architectural|architecture)\b/i,
    titleSqlPattern:
      "\\m(architects?|architectural|architecture)\\M",
    sponsorIndustries: ["Construction"],
    defaultSocCode: "2431",
  },
  business_development: {
    titlePattern:
      /\b(?:business[\s-]+development(?:\s+managers?|\s+executives?|\s+officers?)?|business[\s-]+development\s+and\s+partnerships)\b/i,
    titleSqlPattern:
      "\\m(business[-[:space:]]+development( managers?| executives?| officers?)?|business[-[:space:]]+development[[:space:]]+and[[:space:]]+partnerships)\\M",
    sponsorIndustries: ["Legal & Professional", "Finance", "Technology"],
    defaultSocCode: "3545",
  },
};

export function isStrictRolePageSector(value: unknown): value is StrictRolePageSector {
  return typeof value === "string" && (STRICT_ROLE_PAGE_SECTORS as readonly string[]).includes(value);
}

export function parseStrictRolePageSector(value: unknown): StrictRolePageSector {
  if (value == null || value === "") return "healthcare";
  if (isStrictRolePageSector(value)) return value;
  throw new Error(`sector must be one of: ${STRICT_ROLE_PAGE_SECTORS.join(", ")}.`);
}

export function titleSqlPatternForSector(sector: StrictRolePageSector): string {
  return STRICT_ROLE_PAGE_SECTOR_CONFIG[sector].titleSqlPattern;
}

export function sponsorIndustriesForSector(sector: StrictRolePageSector): string[] {
  return STRICT_ROLE_PAGE_SECTOR_CONFIG[sector].sponsorIndustries;
}

export function socForRoleTitle(title: string, sector: StrictRolePageSector): string {
  const value = title.toLowerCase();
  if (sector === "healthcare") {
    if (/\bsocial workers?\b/.test(value)) return "2461";
    if (/\bphysiotherapists?\b/.test(value)) return "2221";
    if (/\boccupational therapists?\b/.test(value)) return "2222";
    if (/\bradiographers?\b/.test(value)) return "2254";
    if (/\bpharmacists?\b/.test(value)) return "2251";
    if (/\b(?:dentists?|dental nurses?)\b/.test(value)) return "2253";
    if (/\bmidwi(?:fe|ves)\b/.test(value)) return "2232";
    if (/\bparamedics?\b/.test(value)) return "2255";
    if (/\b(?:doctors?|consultants?|general practitioners?)\b/.test(value)) return "2211";
    if (/\b(?:nurses?|nursing associates?|nursing)\b/.test(value)) return "2231";
    if (/\bhealthcare assistants?|health care assistants?\b/.test(value)) return "6131";
  }
  if (sector === "education") {
    if (/\b(?:lecturers?|professors?|research fellows?|postdoctoral|postdocs?)\b/.test(value)) return "2311";
    if (/\b(?:headteachers?|head teachers?)\b/.test(value)) return "2317";
    if (/\bteaching assistants?\b/.test(value)) return "6125";
  }
  if (sector === "legal") {
    if (/\bbarristers?\b/.test(value)) return "2412";
    if (/\bparalegals?\b/.test(value)) return "3520";
  }
  return STRICT_ROLE_PAGE_SECTOR_CONFIG[sector].defaultSocCode;
}
