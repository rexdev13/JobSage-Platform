// Exact eligibility patterns extracted from the original extension.
export const NEVER_REMEMBER_PATTERN =
  /\b(password|passcode|one[\s-]?time|otp|verification code|security code|national insurance|ni number|ssn|social security|passport|identity document|bank|sort code|account number|tax|payroll|health|medical|disab|criminal|conviction|caution|dbs|disclosure|ethnic|race|religion|sexual orientation|gender|sex|equal opportunit|diversity|right to work|work authori[sz]ation|visa|immigration|sponsor(?:ship)?|consent|declaration|declare|agreement|agree to|attest|terms and conditions|next of kin|emergency contact|reference contact|date of birth|dob)\b/i;
export const SAFE_FREE_TEXT_PATTERN =
  /\b(supporting statement|supporting information|personal statement|why .*(?:role|position|job|apply|join)|motivat[a-z]*|experience|skills?|achievements?|strengths?|suitable|interest in|challenge|teamwork|leadership|communication|values|career goals?|what .* bring|tell us about)\b/i;
export const SAFE_STRUCTURED_PATTERN =
  /\b(availability|available from|start date|notice period|years? of experience|professional registration(?: status)?|registration status|highest qualification|qualification gained|qualification type|languages?|driving licen[cs]e|willing to relocate|shift pattern|work pattern|preferred hours?)\b/i;
