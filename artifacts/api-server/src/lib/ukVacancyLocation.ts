import { normalizeRegionList, regionsFromLocationText } from "./regionMatching";

export type UkVacancyLocationStatus =
  | "confirmed_uk"
  | "confirmed_non_uk"
  | "unknown";

export interface UkVacancyLocationInput {
  location?: unknown;
  targetRegions?: unknown;
  sourceMetadata?: unknown;
}

const UK_COUNTRIES = new Set([
  "gb",
  "gbr",
  "uk",
  "united kingdom",
  "great britain",
  "england",
  "scotland",
  "wales",
  "northern ireland",
]);

const FOREIGN_COUNTRIES = [
  "united states of america",
  "united states",
  "usa",
  "canada",
  "australia",
  "new zealand",
  "india",
  "singapore",
  "south africa",
  "ireland",
  "france",
  "germany",
  "netherlands",
  "belgium",
  "switzerland",
  "spain",
  "italy",
  "portugal",
  "poland",
  "sweden",
  "norway",
  "denmark",
  "finland",
  "austria",
  "united arab emirates",
  "uae",
  "saudi arabia",
  "japan",
  "china",
  "hong kong",
  "south korea",
  "brazil",
  "mexico",
  "argentina",
  "israel",
  "turkey",
  "czech republic",
  "czechia",
  "romania",
  "ukraine",
  "greece",
  "luxembourg",
  "malta",
  "cyprus",
  "pakistan",
  "bangladesh",
  "philippines",
  "indonesia",
  "thailand",
  "kenya",
  "nigeria",
  "ghana",
  "egypt",
  "qatar",
  "kuwait",
  "bahrain",
  "oman",
  "taiwan",
  "vietnam",
] as const;

const FOREIGN_COUNTRY_CODES = new Set([
  "us", "usa", "ca", "can", "au", "aus", "nz", "nzl", "in", "ind",
  "sg", "sgp", "za", "zaf", "ie", "irl", "fr", "fra", "de", "deu",
  "nl", "nld", "be", "bel", "ch", "che", "es", "esp", "it", "ita",
  "pt", "prt", "pl", "pol", "se", "swe", "no", "nor", "dk", "dnk",
  "fi", "fin", "at", "aut", "ae", "are", "sa", "sau", "jp", "jpn",
  "cn", "chn", "hk", "hkg", "kr", "kor", "br", "bra", "mx", "mex",
  "ar", "arg", "il", "isr", "tr", "tur", "cz", "cze", "ro", "rou",
  "ua", "ukr", "gr", "grc", "lu", "lux", "mt", "mlt", "cy", "cyp",
  "pk", "pak", "bd", "bgd", "ph", "phl", "id", "idn", "th", "tha",
  "ke", "ken", "ng", "nga", "gh", "gha", "eg", "egy", "qa", "qat",
  "kw", "kwt", "bh", "bhr", "om", "omn", "tw", "twn", "vn", "vnm",
]);

const US_STATES = [
  "alabama", "alaska", "arizona", "arkansas", "california", "colorado",
  "connecticut", "delaware", "florida", "georgia", "hawaii", "idaho",
  "illinois", "indiana", "iowa", "kansas", "kentucky", "louisiana",
  "maine", "maryland", "massachusetts", "michigan", "minnesota",
  "mississippi", "missouri", "montana", "nebraska", "nevada",
  "new hampshire", "new jersey", "new mexico", "new york",
  "north carolina", "north dakota", "ohio", "oklahoma", "oregon",
  "pennsylvania", "rhode island", "south carolina", "south dakota",
  "tennessee", "texas", "utah", "vermont", "virginia", "washington",
  "west virginia", "wisconsin", "wyoming", "district of columbia",
] as const;

const US_STATE_CODES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI",
  "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI",
  "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC",
  "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT",
  "VT", "VA", "WA", "WV", "WI", "WY", "DC",
]);

const CANADIAN_PROVINCES = [
  "alberta", "british columbia", "manitoba", "new brunswick",
  "newfoundland and labrador", "nova scotia", "ontario",
  "prince edward island", "quebec", "saskatchewan", "northwest territories",
  "nunavut", "yukon",
] as const;

const CANADIAN_PROVINCE_CODES = new Set([
  "AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC",
  "SK", "YT",
]);

const FOREIGN_CITIES = [
  "san francisco", "new york", "austin", "los angeles", "chicago",
  "boston", "seattle", "houston", "dallas", "atlanta", "miami",
  "toronto", "montreal", "ottawa", "vancouver", "calgary", "edmonton",
  "winnipeg", "quebec city", "waterloo",
] as const;

const UK_CITIES = [
  "london", "manchester", "birmingham", "edinburgh", "glasgow", "cardiff",
  "belfast", "leeds", "liverpool", "bristol", "sheffield", "newcastle",
  "nottingham", "leicester", "coventry", "oxford", "cambridge", "york",
  "southampton", "portsmouth", "brighton", "reading", "derby", "plymouth",
  "exeter", "aberdeen", "dundee", "swansea", "newport", "derry",
] as const;

const COUNTRY_KEYS = new Set([
  "country",
  "countrycode",
  "country_code",
  "countryname",
  "country_name",
  "addresscountry",
  "address_country",
  "addresscountrycode",
  "address_country_code",
  "locationcountry",
  "location_country",
]);

const LOCATION_KEYS = new Set([
  "joblocation",
  "job_location",
  "location",
  "address",
  "addresslocality",
  "addressregion",
]);

function normalizeText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function containsPhrase(text: string, phrase: string): boolean {
  const normalized = normalizeText(phrase);
  return new RegExp(`(?:^| )${normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?: |$)`).test(text);
}

function foreignCountryInText(text: string): boolean {
  const withoutNorthernIreland = normalizeText(text).replace(/\bnorthern ireland\b/g, " ");
  return FOREIGN_COUNTRIES.some((country) => containsPhrase(withoutNorthernIreland, country));
}

function hasForeignStateOrProvinceContext(text: string): boolean {
  const normalized = normalizeText(text);
  if (US_STATES.some((state) => containsPhrase(normalized, state))) return true;
  if (CANADIAN_PROVINCES.some((province) => containsPhrase(normalized, province))) return true;

  const originalLocation = text;
  const suffixes = originalLocation.matchAll(/(?:,|\s)\s*([A-Z]{2})\b/gi);
  for (const match of suffixes) {
    const code = match[1]!.toUpperCase();
    if (US_STATE_CODES.has(code) || CANADIAN_PROVINCE_CODES.has(code)) return true;
  }
  return false;
}

function hasUkPostcode(text: string): boolean {
  return /\bGIR\s*0AA\b|\b(?:AB|AL|B|BA|BB|BD|BH|BL|BN|BR|BS|BT|CA|CB|CF|CH|CM|CO|CR|CT|CV|CW|DA|DD|DE|DG|DH|DL|DN|DT|DY|E|EC|EH|EN|EX|FK|FY|G|GL|GU|GY|HA|HD|HG|HP|HR|HS|HU|HX|IG|IM|IP|IV|JE|KA|KT|KW|KY|L|LA|LD|LE|LL|LN|LS|LU|M|ME|MK|ML|N|NE|NG|NN|NP|NR|NW|OL|OX|PA|PE|PH|PL|PO|PR|RG|RH|RM|S|SA|SE|SG|SK|SL|SM|SN|SO|SP|SR|SS|ST|SW|SY|TA|TD|TF|TN|TQ|TR|TS|TW|UB|W|WA|WC|WD|WF|WN|WR|WS|WV|YO|ZE)\d[A-Z\d]?\s*\d[A-Z]{2}\b/i.test(text);
}

function hasExplicitUkAvailability(text: string): boolean {
  const phrases =
    "(?:uk|u\\.?k\\.?|united kingdom|great britain|england|scotland|wales|northern ireland)";
  return new RegExp(
    `(?:available|based|located|working|work|open to candidates|for candidates|across|anywhere in|within|remote in)[^.;]{0,60}${phrases}|${phrases}[^.;]{0,60}(?:available|based|located|working|work|open to candidates|for candidates|across|anywhere in|within|remote)`,
    "i",
  ).test(text);
}

function inspectStructuredMetadata(value: unknown): {
  ukCountry: boolean;
  foreignCountry: boolean;
  locationText: string[];
} {
  let ukCountry = false;
  let foreignCountry = false;
  const locationText: string[] = [];
  const visited = new Set<object>();

  const visit = (item: unknown, parentKey = "", depth = 0): void => {
    if (depth > 5 || item == null) return;
    if (typeof item === "string") {
      const normalized = normalizeText(item);
      if (!normalized) return;
      if (COUNTRY_KEYS.has(parentKey)) {
        if (UK_COUNTRIES.has(normalized)) {
          ukCountry = true;
        } else if (
          FOREIGN_COUNTRY_CODES.has(normalized) ||
          foreignCountryInText(normalized) ||
          /^[a-z]{2,3}$/.test(normalized)
        ) {
          foreignCountry = true;
        }
      } else if (LOCATION_KEYS.has(parentKey)) {
        locationText.push(item);
      }
      return;
    }
    if (Array.isArray(item)) {
      for (const child of item) visit(child, parentKey, depth + 1);
      return;
    }
    if (typeof item !== "object") return;
    if (visited.has(item)) return;
    visited.add(item);
    for (const [key, child] of Object.entries(item as Record<string, unknown>)) {
      visit(child, key.toLowerCase().replace(/[^a-z0-9_]/g, ""), depth + 1);
    }
  };

  visit(value);
  return { ukCountry, foreignCountry, locationText };
}

function locationEvidence(location: string): {
  uk: boolean;
  foreign: boolean;
} {
  const normalized = normalizeText(location);
  if (!normalized) return { uk: false, foreign: false };

  const foreign =
    foreignCountryInText(normalized) ||
    hasForeignStateOrProvinceContext(location) ||
    FOREIGN_CITIES.some((city) => containsPhrase(normalized, city)) ||
    /(?:^| )(?:us|usa|united states|canada|can)(?: |$)/i.test(normalized) ||
    /(?:,|\s)\s*(?:US|USA|CAN|AU|NZ|IN|SG|ZA|IE|FR|DE|NL|BE|CH|ES|IT|PT|PL|SE|NO|DK|FI|AT|AE|SA|JP|CN|HK|KR|BR|MX|AR|IL|TR|CZ|RO|UA|GR|LU|MT|CY|PK|BD|PH|ID|TH|KE|NG|GH|EG|QA|KW|BH|OM|TW|VN)\s*$/i.test(location);
  const uk =
    UK_CITIES.some((city) => containsPhrase(normalized, city)) ||
    regionsFromLocationText(location).length > 0 ||
    hasUkPostcode(location) ||
    /\b(?:united kingdom|u\.?k\.?|great britain|england|scotland|wales|northern ireland|remote uk|uk remote|gb|gbr)\b/i.test(location);

  return { uk, foreign };
}

export function classifyUkVacancyLocation(
  input: UkVacancyLocationInput,
): UkVacancyLocationStatus {
  const storedPolicy = input.sourceMetadata && typeof input.sourceMetadata === "object"
    ? (input.sourceMetadata as Record<string, unknown>)["jobsageLocationEligibility"]
    : null;
  if (storedPolicy && typeof storedPolicy === "object") {
    const storedStatus = (storedPolicy as Record<string, unknown>)["status"];
    if (storedStatus === "confirmed_non_uk" || storedStatus === "unknown") return storedStatus;
  }

  const location = typeof input.location === "string" ? input.location.trim() : "";
  const metadata = inspectStructuredMetadata(input.sourceMetadata);
  const targetRegions = Array.isArray(input.targetRegions)
    ? input.targetRegions.filter((item): item is string => typeof item === "string")
    : [];
  const normalizedTargetRegions = normalizeRegionList(targetRegions);
  const hasSpecificUkRegion = normalizedTargetRegions.some(
    (region) => normalizeText(region) !== "national multiple regions",
  );

  const evidenceTexts = [location, ...metadata.locationText];
  const locationFacts = evidenceTexts.map(locationEvidence);
  const foreignEvidence =
    metadata.foreignCountry ||
    locationFacts.some((facts) => facts.foreign);
  const ukEvidence =
    metadata.ukCountry ||
    hasSpecificUkRegion ||
    locationFacts.some((facts) => facts.uk);

  if (foreignEvidence) {
    const combinedText = evidenceTexts.join(" ");
    return ukEvidence && hasExplicitUkAvailability(combinedText)
      ? "confirmed_uk"
      : "confirmed_non_uk";
  }
  if (ukEvidence) return "confirmed_uk";
  return "unknown";
}

