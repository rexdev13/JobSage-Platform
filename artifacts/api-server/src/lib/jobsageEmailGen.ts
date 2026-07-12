/**
 * Generates and manages JOBSAGE communication email aliases.
 * Each candidate gets a unique @mail.jobsage.app address used in place of
 * their personal email when CVs and cover letters are sent to employers.
 */

const JOBSAGE_MAIL_DOMAIN = "mail.jobsage.app";

function slugify(str: string): string {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 20);
}

function randomHex(bytes = 3): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Generate a JOBSAGE email alias from a candidate's name.
 * Format: firstname.lastname.randomhex6@mail.jobsage.app
 * Falls back to a random alias if no name is available.
 */
export function generateJobsageEmail(firstName?: string | null, lastName?: string | null): string {
  const first = firstName ? slugify(firstName) : "";
  const last = lastName ? slugify(lastName) : "";
  const hex = randomHex(3);

  let localPart: string;
  if (first && last) {
    localPart = `${first}.${last}.${hex}`;
  } else if (first || last) {
    localPart = `${first || last}.${hex}`;
  } else {
    localPart = `candidate.${randomHex(6)}`;
  }

  return `${localPart}@${JOBSAGE_MAIL_DOMAIN}`;
}

/**
 * Strips personal email addresses and UK-format phone numbers from a text string,
 * replacing them with the candidate's JOBSAGE alias.
 * Used when preparing CVs and cover letters to send to employers.
 */
export function maskPersonalContactInfo(text: string, jobsageEmail: string): string {
  const emailRegex = /[a-zA-Z0-9._%+\-]+@(?!mail\.jobsage\.app)[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
  const ukPhoneRegex = /(?:(?:\+44\s?|0)(?:7\d{9}|1\d{9}|2\d{9}|3\d{9}|\d{4}\s?\d{6}))/g;

  let masked = text.replace(emailRegex, jobsageEmail);
  masked = masked.replace(ukPhoneRegex, `(contact via ${jobsageEmail})`);
  return masked;
}
