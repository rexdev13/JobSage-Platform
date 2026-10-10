import type { LearningVideo } from "@workspace/api-client-react";

export type ExamPrepProfession = "doctor" | "nurse" | "dentist";

const PROFESSION_TERMS: Record<ExamPrepProfession, string[]> = {
  doctor: ["doctor", "medical", "gmc", "plab"],
  nurse: ["nurse", "nursing", "nmc", "cbt", "osce"],
  dentist: ["dentist", "dental", "gdc", "ore"],
};

export function normalizeExamPrepProfession(profession: string | null | undefined): ExamPrepProfession | null {
  const normalized = profession?.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  if (!normalized) return null;
  if (["doctor", "medical doctor", "physician"].includes(normalized)) return "doctor";
  if (["nurse", "registered nurse", "nursing"].includes(normalized)) return "nurse";
  if (["dentist", "dental surgeon", "dentistry"].includes(normalized)) return "dentist";
  return null;
}

export function isExamPrepVideoForProfession(
  video: Pick<LearningVideo, "category" | "applicability">,
  profession: ExamPrepProfession,
): boolean {
  if (video.category !== "professional_registration") return false;
  const applicability = video.applicability?.toLowerCase().trim();
  if (!applicability) return false;
  if (/\b(all professions|all healthcare professionals|all medical professionals)\b/.test(applicability)) {
    return true;
  }
  return PROFESSION_TERMS[profession].some((term) =>
    new RegExp(`\\b${term}\\b`, "i").test(applicability),
  );
}
