const DATE_PATTERNS = [
  /\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/,
  /\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s*,?\s+(\d{4})\b/i,
  /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})\b/i,
];

const MONTHS = new Map([
  ["january", 1], ["february", 2], ["march", 3], ["april", 4],
  ["may", 5], ["june", 6], ["july", 7], ["august", 8],
  ["september", 9], ["october", 10], ["november", 11], ["december", 12],
]);

function londonOffsetMinutes(utcMs: number): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    timeZoneName: "shortOffset",
  }).formatToParts(new Date(utcMs));
  const offset = parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  const match = offset.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!match) return 0;
  return (match[1] === "-" ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3] ?? 0));
}

function londonEndOfDay(year: number, month: number, day: number): Date | null {
  const utcGuess = Date.UTC(year, month - 1, day, 23, 59, 59, 999);
  if (!Number.isFinite(utcGuess)) return null;
  return new Date(utcGuess - londonOffsetMinutes(utcGuess) * 60_000);
}

/** Parse source closing-date text. Date-only values mean the end of that UK day. */
export function parseVacancyClosingDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value !== "string" || !value.trim()) return null;
  const raw = value.trim();
  const isoDateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoDateOnly) {
    const parsed = londonEndOfDay(Number(isoDateOnly[1]), Number(isoDateOnly[2]), Number(isoDateOnly[3]));
    if (!parsed) return null;
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(parsed);
    const actual = Object.fromEntries(parts.map((part) => [part.type, Number(part.value)]));
    return actual.year === Number(isoDateOnly[1]) &&
      actual.month === Number(isoDateOnly[2]) &&
      actual.day === Number(isoDateOnly[3]) ? parsed : null;
  }
  const iso = new Date(raw);
  const hasExplicitTime =
    /T\d{2}:\d{2}|\b\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?\b|Z$/i.test(raw);
  if (hasExplicitTime && !Number.isNaN(iso.getTime())) return iso;
  let year: number | undefined;
  let month: number | undefined;
  let day: number | undefined;
  const numeric = raw.match(DATE_PATTERNS[0]);
  if (numeric) {
    day = Number(numeric[1]); month = Number(numeric[2]); year = Number(numeric[3]);
  } else {
    const dmy = raw.match(DATE_PATTERNS[1]);
    const mdy = raw.match(DATE_PATTERNS[2]);
    if (dmy) {
      day = Number(dmy[1]); month = MONTHS.get(dmy[2].toLowerCase()); year = Number(dmy[3]);
    } else if (mdy) {
      month = MONTHS.get(mdy[1].toLowerCase()); day = Number(mdy[2]); year = Number(mdy[3]);
    }
  }
  if (!year || !month || !day || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const parsed = londonEndOfDay(year, month, day);
  if (!parsed) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", year: "numeric", month: "numeric", day: "numeric",
  }).formatToParts(parsed);
  const actual = Object.fromEntries(parts.map((part) => [part.type, Number(part.value)]));
  return actual.year === year && actual.month === month && actual.day === day ? parsed : null;
}

/** Finds common UK closing-date labels without treating arbitrary page dates as expiry. */
export function extractVacancyClosingDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const match = value.match(
    /(?:closing date|application close date|apply by|closes on|closing|expires?|validThrough)\s*[:\-]?\s*([^|;\n<]{3,80})/i,
  );
  return parseVacancyClosingDate(match?.[1] ?? null);
}

/** True when a field contains a labelled closing-date value, even if it is unknown. */
export function hasVacancyClosingDateLabel(value: string | null | undefined): boolean {
  return /^\s*(?:closing date|application close date|apply by|closes on|closing|expires?|validThrough)\s*[:\-]?\s*/i
    .test(value ?? "");
}

export function hasExplicitClosedPhrase(value: string | null | undefined): boolean {
  return /(?:this vacancy|this job|applications?|role|position)\s+(?:has\s+)?(?:now\s+)?(?:closed|filled)|no longer accepting applications|applications are closed|closing date has passed/i.test(value ?? "");
}