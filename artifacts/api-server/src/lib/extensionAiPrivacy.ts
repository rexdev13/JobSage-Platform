import type { Request, Response } from "express";
import { hasSensitiveValue } from "@workspace/smart-apply-core/privacy";
import { GenerateExtensionSmartApplyAnswerBody, GetExtensionStructuredPrefillBody } from "@workspace/api-zod";

export function isExtensionAiRequest(req: Request): boolean {
  return req.path.startsWith("/smart-apply/extension/");
}

export function rejectUnsafeExtensionAi(req: Request, res: Response): boolean {
  if (!isExtensionAiRequest(req)) return false;
  const schema = req.path.endsWith("/assistant") ? GenerateExtensionSmartApplyAnswerBody : GetExtensionStructuredPrefillBody;
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid extension AI request." });
    return true;
  }
  req.body = parsed.data;
  if (hasSensitiveValue(JSON.stringify(req.body ?? {}))) {
    res.status(422).json({ error: "Remove sensitive health, financial or identity details from this AI request." });
    return true;
  }
  return false;
}

/** Account facts used for exact answers; private notes and sensitive disclosures stay out. */
export function extensionProfessionalEvidence(profile: Record<string, unknown>): string {
  const keys = ["profession", "specialty", "qualificationCountry", "qualificationType",
    "qualificationYear", "experienceYears", "registrationStatus", "languages",
    "preferredStartDate", "phone", "streetAddress", "city", "postcode", "country",
    "requiresSponsorship", "residencyStatus"];
  return keys.flatMap((key) => {
    const value = profile[key];
    if (value == null) return [];
    const text = Array.isArray(value) ? value.join(", ") : String(value);
    return hasSensitiveValue(text) ? [] : [`${key}: ${text.slice(0, 300)}`];
  }).join("\n");
}

/** Keep professional CV evidence while excluding common sensitive disclosure lines. */
export function extensionCvEvidence(text: string): string {
  return text.split(/\r?\n/).filter((line) =>
    !hasSensitiveValue(line)
    && !/\b(?:date of birth|dob|passport|national insurance|marital status|religion|ethnicity|sexual orientation|bank details|medical history)\b/i.test(line),
  ).join("\n").replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email omitted; use JOBSAGE address]")
    .slice(0, 6000);
}
