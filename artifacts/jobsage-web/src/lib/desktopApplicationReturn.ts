export type DesktopApplicationState = "pending" | "confirmed" | "not-found";

interface TrackedWebsiteApplication {
  applicationType?: string;
  applicationUrl?: string | null;
  status?: string;
}

/** Recheck the exact clicked website URL after the candidate returns.
 * The extension's automatic confirmation must win before a desktop prompt opens.
 */
export async function readDesktopApplicationState(
  applicationUrl: string,
  request: typeof fetch = fetch,
): Promise<DesktopApplicationState> {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const response = await request(`${base}/api/applications`, {
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Could not refresh the application tracker.");
  const body = await response.json() as { applications?: TrackedWebsiteApplication[] };
  const tracked = body.applications?.find((application) =>
    application.applicationType === "website" && application.applicationUrl === applicationUrl,
  );
  if (!tracked) return "not-found";
  return tracked.status === "in_progress" || tracked.status === "link_clicked" ? "pending" : "confirmed";
}