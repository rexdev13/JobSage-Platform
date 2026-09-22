/** Titles that are genuinely manual-labour or clearly non-professional. */
const MANUAL_LABOUR_BLOCKLIST =
  /\b(housekeep|housework|cleaning|cleaner|domestic|catering|cook\b|kitchen|laundry|porter|groundskeep|janitor|caretaker|security\s*guard|warehouse|driver|delivery|bin\s*collect|refuse|sewage|plumber|plumbing\s+(worker|operative)|electrician|carpenter|bricklayer|scaffold|painter\s*decorator|construction\s+(worker|labourer|laborer|operative)|barista|bartender|waiter|waitress|retail\s*assistant|shop\s*assistant|sales\s*assistant|receptionist|chef|pizza\s*(maker|chef)|pizzeria|baker\b|bakery|fast\s*food|food\s*(production|preparation|service)\s*(assistant|worker|operative|staff|team\s*member)|restaurant|takeaway|cashier|customer\s*service|front\s*of\s*house|barber|beautician|hairdress|nail\s*tech)/i;

export function isManualLabourTitle(title: string | null | undefined): boolean {
  return !!title && MANUAL_LABOUR_BLOCKLIST.test(title);
}

/**
 * Company-site crawlers sometimes mistake an article card or educational
 * explainer for a job advert. A real job title should not contain a paragraph
 * of editorial prose or a sentence explaining a topic.
 */
const EDITORIAL_TITLE_PATTERNS = [
  /\bmost people know\b/i,
  /\b(?:many|some|few) people (?:are|aren't|are not|know|think|wonder)\b/i,
  /\b(?:find out|learn more|read more|read about|discover)\b/i,
  /\bwhat (?:do|does|is|are|makes|makes?)\b.+\b(?:do|does|is|are)\b/i,
  /^(?:school\s*(?:&|and)\s*college\s*studies)\b/i,
];

export function isLikelyEditorialTitle(title: string | null | undefined): boolean {
  if (!title) return false;
  const text = title.replace(/\s+/g, " ").trim();
  if (!text) return false;

  const sentenceCount = (text.match(/[.!?](?:\s|$)/g) ?? []).length;
  const wordCount = text.split(/\s+/).length;

  return (
    EDITORIAL_TITLE_PATTERNS.some((pattern) => pattern.test(text)) ||
    (sentenceCount >= 1 && (text.length >= 90 || wordCount >= 16)) ||
    (sentenceCount >= 2 && wordCount >= 12)
  );
}