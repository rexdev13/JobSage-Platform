/** Titles that are not appropriate for the clinical candidate opportunity feed. */
const MANUAL_LABOUR_BLOCKLIST =
  /\b(housekeep|housework|cleaning|cleaner|domestic|catering|cook\b|kitchen|laundry|porter|construction|groundskeep|janitor|caretaker|security\s*guard|warehouse|driver|delivery|bin\s*collect|refuse|sewage|plumb|electri|carpent|bricklayer|scaffold|painter\s*decorator|barista|bartender|waiter|waitress|retail\s*assistant|shop\s*assistant|sales\s*assistant|receptionist|administrator|accountant|software|developer|chef|pizza\s*(maker|chef)|pizzeria|baker\b|bakery|fast\s*food|food\s*(production|preparation|service)\s*(assistant|worker|operative|staff|team\s*member)|restaurant|takeaway|veterinar|cashier|customer\s*service|front\s*of\s*house|barber|beautician|hairdress|nail\s*tech)/i;

export function isManualLabourTitle(title: string | null | undefined): boolean {
  return !!title && MANUAL_LABOUR_BLOCKLIST.test(title);
}