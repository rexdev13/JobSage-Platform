import type { Request, Response } from "express";
import { EXTENSION_AI_CONSENT_VERSION, hasSensitiveValue } from "@workspace/smart-apply-core/privacy";
import { GenerateExtensionSmartApplyAnswerBody, GetExtensionStructuredPrefillBody } from "@workspace/api-zod";

export function isExtensionAiRequest(req: Request): boolean {
  return req.path.startsWith("/smart-apply/extension/");
}

export function rejectUnsafeExtensionAi(req: Request, res: Response): boolean {
  if (!isExtensionAiRequest(req)) return false;
  if (req.get("X-Jobsage-AI-Consent") !== EXTENSION_AI_CONSENT_VERSION) {
    res.status(403).json({ error: "Affirmative extension AI consent is required." });
    return true;
  }
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

/** Only these professional facts may enter extension AI prompts. Never raw CV/notes. */
export function extensionProfessionalEvidence(profile: Record<string, unknown>): string {
  const keys = ["profession", "specialty", "qualificationCountry", "qualificationType",
    "qualificationYear", "experienceYears", "registrationStatus", "languages",
    "preferredStartDate"];
  return keys.flatMap((key) => {
    const value = profile[key];
    if (value == null) return [];
    const text = Array.isArray(value) ? value.join(", ") : String(value);
    return hasSensitiveValue(text) ? [] : [`${key}: ${text.slice(0, 300)}`];
  }).join("\n");
}
