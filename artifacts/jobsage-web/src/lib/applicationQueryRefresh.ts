import type { QueryClient } from "@tanstack/react-query";
import {
  getListMyApplicationsQueryKey,
  getGetMyAnalyticsQueryKey,
  getListMatchedRolesQueryKey,
  getGetMyMatchesQueryKey,
} from "@workspace/api-client-react";

/** Keep tracker, dashboard totals and vacancy applied badges consistent. */
export async function refreshApplicationQueries(client: QueryClient): Promise<void> {
  await Promise.all([
    getListMyApplicationsQueryKey(),
    getGetMyAnalyticsQueryKey(),
    getListMatchedRolesQueryKey(),
    getGetMyMatchesQueryKey(),
  ].map(queryKey => client.invalidateQueries({ queryKey })));
}