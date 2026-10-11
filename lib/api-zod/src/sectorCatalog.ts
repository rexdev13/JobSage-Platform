import { z } from "zod";

export const CANONICAL_SECTORS = [
  "healthcare",
  "education",
  "engineering",
  "it",
  "legal",
  "accounting",
  "architecture",
  "business_development",
] as const;

export type CanonicalSector = (typeof CANONICAL_SECTORS)[number];

export const CANONICAL_SECTOR_OPTIONS: readonly {
  value: CanonicalSector;
  label: string;
}[] = [
  { value: "healthcare", label: "Healthcare" },
  { value: "education", label: "Education" },
  { value: "engineering", label: "Engineering" },
  { value: "it", label: "IT" },
  { value: "legal", label: "Legal" },
  { value: "accounting", label: "Accounting" },
  { value: "architecture", label: "Architecture" },
  { value: "business_development", label: "Business Development" },
];

export const canonicalSectorSchema = z.enum(CANONICAL_SECTORS);

export function isCanonicalSector(value: unknown): value is CanonicalSector {
  return typeof value === "string" && (CANONICAL_SECTORS as readonly string[]).includes(value);
}

export function canonicalSectorLabel(value: CanonicalSector): string {
  return CANONICAL_SECTOR_OPTIONS.find((option) => option.value === value)!.label;
}
