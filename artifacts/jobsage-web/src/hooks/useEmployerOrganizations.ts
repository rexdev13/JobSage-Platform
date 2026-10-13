import { useAuth } from "@workspace/auth-web";
import {
  getListEmployerOrganizationsQueryKey,
  useListEmployerOrganizations,
  useSelectEmployerOrganization,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

export type EmployerStaffRole =
  | "employer_owner"
  | "employer_admin"
  | "recruiter"
  | "hiring_manager"
  | "employer_viewer";

export type EmployerOrganization = {
  id: number;
  companyName: string;
  role: EmployerStaffRole;
};

export function useEmployerOrganizations(enabled = true) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const queryKey = [...getListEmployerOrganizationsQueryKey(), user?.id ?? "anonymous"];
  const organizationsQuery = useListEmployerOrganizations({
    query: {
      enabled: enabled && !!user,
      queryKey,
      retry: false,
      staleTime: 30_000,
    },
  });
  const selectMutation = useSelectEmployerOrganization({
    mutation: {
      onSuccess: async response => {
        queryClient.removeQueries({
          predicate: query => {
            const root = query.queryKey[0];
            return typeof root === "string"
              && root.startsWith("/api/employer/")
              && root !== getListEmployerOrganizationsQueryKey()[0];
          },
        });
        queryClient.setQueryData(queryKey, current => current
          ? { ...current, activeOrganizationId: response.organization.id }
          : current);
        await queryClient.invalidateQueries({ queryKey });
      },
    },
  });
  const organizations = organizationsQuery.data?.organizations ?? [];
  const activeOrganization = organizations.find(
    organization => organization.id === organizationsQuery.data?.activeOrganizationId,
  ) ?? null;

  return {
    ...organizationsQuery,
    organizations,
    activeOrganization,
    selectOrganization: (employerProfileId: number) =>
      selectMutation.mutateAsync({ data: { employerProfileId } }),
    isSelectingOrganization: selectMutation.isPending,
    selectionError: selectMutation.error,
  };
}
