import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";

export interface CareerProfile {
  id: number;
  userId: string;
  name: string;
  focusArea: string;
  aiCvContent: string | null;
  aiCvReviewedAt: string | null;
  aiCvSourceDocumentId: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CareerProfileListResponse {
  profiles: CareerProfile[];
}

export interface CreateCareerProfileBody {
  name: string;
  focusArea: string;
}

export interface UpdateCareerProfileBody {
  name?: string;
  focusArea?: string;
  aiCvContent?: string | null;
  aiCvReviewed?: boolean;
}

export interface GenerateCareerProfileCvBody {
  sourceDocumentId?: number | null;
}

const CAREER_PROFILES_KEY = ["career-profiles"] as const;

export function getCareerProfilesQueryKey() {
  return CAREER_PROFILES_KEY;
}

export function useListCareerProfiles() {
  return useQuery<CareerProfileListResponse>({
    queryKey: CAREER_PROFILES_KEY,
    queryFn: ({ signal }) =>
      customFetch<CareerProfileListResponse>("/api/career-profiles", { signal }),
  });
}

export function useCreateCareerProfile() {
  const qc = useQueryClient();
  return useMutation<CareerProfile, Error, CreateCareerProfileBody>({
    mutationFn: (data) =>
      customFetch<CareerProfile>("/api/career-profiles", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: CAREER_PROFILES_KEY }),
  });
}

export function useUpdateCareerProfile() {
  const qc = useQueryClient();
  return useMutation<CareerProfile, Error, { id: number; data: UpdateCareerProfileBody }>({
    mutationFn: ({ id, data }) =>
      customFetch<CareerProfile>(`/api/career-profiles/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: CAREER_PROFILES_KEY }),
  });
}

export function useDeleteCareerProfile() {
  const qc = useQueryClient();
  return useMutation<void, Error, number>({
    mutationFn: (id) =>
      customFetch<void>(`/api/career-profiles/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: CAREER_PROFILES_KEY }),
  });
}

export function useActivateCareerProfile() {
  const qc = useQueryClient();
  return useMutation<CareerProfile, Error, number>({
    mutationFn: (id) =>
      customFetch<CareerProfile>(`/api/career-profiles/${id}/activate`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: CAREER_PROFILES_KEY }),
  });
}

export function useGenerateProfileCv() {
  const qc = useQueryClient();
  return useMutation<CareerProfile, Error, number | { id: number; data?: GenerateCareerProfileCvBody }>({
    mutationFn: (variables) => {
      const id = typeof variables === "number" ? variables : variables.id;
      const data = typeof variables === "number" ? undefined : variables.data;
      return customFetch<CareerProfile>(`/api/career-profiles/${id}/generate-cv`, {
        method: "POST",
        body: data ? JSON.stringify(data) : undefined,
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: CAREER_PROFILES_KEY }),
  });
}
