export const OUTPUT_COLUMNS = [
  "organisation_name",
  "town_city",
  "county",
  "industry",
  "website",
  "website_source",
  "website_evidence_url",
  "contact_email",
  "contact_source",
  "contact_evidence_url",
  "confidence",
  "status",
  "found_at",
  "notes",
] as const;

export type OutputColumn = (typeof OUTPUT_COLUMNS)[number];
export type DiscoveryStatus =
  | "verified_email"
  | "website_no_email"
  | "no_website"
  | "unmatched"
  | "no_public_contact"
  | "skipped_existing";
export type Confidence = "high" | "medium" | "";

export type DiscoveryRow = {
  organisation_name: string;
  town_city: string;
  county: string;
  industry: string;
  website: string;
  website_source: string;
  website_evidence_url: string;
  contact_email: string;
  contact_source: string;
  contact_evidence_url: string;
  confidence: Confidence;
  status: DiscoveryStatus;
  found_at: string;
  notes: string;
  [key: string]: string;
};

export type SponsorInput = {
  organisationName: string;
  townCity: string;
  county: string;
  industry: string;
  website: string;
  contactEmail: string;
};

export type OfficialRecord = {
  organisationName: string;
  townCity: string;
  website: string;
  email: string;
  source: string;
  evidenceUrl: string;
};