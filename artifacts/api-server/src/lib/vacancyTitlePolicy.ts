/** Titles that are genuinely manual-labour or clearly non-professional. */
const MANUAL_LABOUR_BLOCKLIST =
  /\b(housekeep|housework|cleaning|cleaner|domestic|catering|cook\b|kitchen|laundry|porter|groundskeep|janitor|caretaker|security\s*guard|warehouse|driver|delivery|bin\s*collect|refuse|sewage|plumber|plumbing\s+(worker|operative)|electrician|carpenter|bricklayer|scaffold|painter\s*decorator|construction\s+(worker|labourer|laborer|operative)|barista|bartender|waiter|waitress|retail\s*assistant|shop\s*assistant|sales\s*assistant|receptionist|chef|pizza\s*(maker|chef)|pizzeria|baker\b|bakery|fast\s*food|food\s*(production|preparation|service)\s*(assistant|worker|operative|staff|team\s*member)|restaurant|takeaway|cashier|customer\s*service|front\s*of\s*house|barber|beautician|hairdress|nail\s*tech)/i;

// These titles are skilled occupations or management roles rather than the
// elementary/support work targeted by the blocklist. Vacancy-level visa
// sponsorship is still evaluated separately and remains unknown unless the
// advert explicitly confirms it.
const SKILLED_ROLE_ALLOWLIST =
  /\b(?:catering\s+(?:and\s+bar\s+)?manager|bar\s+manager|restaurant\s+manager|hotel\s+manager|hospitality\s+manager|food\s+and\s+beverage\s+manager|front\s+of\s+house\s+manager|customer\s+(?:service|support)\s+manager|electrician|electrical\s+fitter|plumber|heating\s+and\s+ventilat(?:ing|ion)\s+(?:installer|engineer)|carpenter|joiner|bricklayer|roofer|stonemason|plasterer|floorer|wall\s+tiler|painter\s+and\s+decorator|construction\s+(?:manager|project\s+manager|supervisor)|building\s+trades?\s+supervisor)\b/i;
const SKILLED_CHEF_ALLOWLIST =
  /(?:^chef\b|\b(?:head|executive|sous|senior|pastry)\s+chef\b|\bchef\s+de\s+partie\b)/i;

export function isManualLabourTitle(title: string | null | undefined): boolean {
  return !!title &&
    !SKILLED_ROLE_ALLOWLIST.test(title) &&
    !SKILLED_CHEF_ALLOWLIST.test(title) &&
    MANUAL_LABOUR_BLOCKLIST.test(title);
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
