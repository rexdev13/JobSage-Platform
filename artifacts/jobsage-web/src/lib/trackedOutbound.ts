import { beginAssistedApplication, shouldUseAssistedWorkspace } from "./assistedApplication";

type ToastFn = (opts: { title: string; description: string; variant?: "default" | "destructive" }) => void;

export type TrackedOutboundSource = "sponsor" | "careers" | "role-website";

export interface TrackedVacancyContext {
  title?: string;
  employer?: string;
  roleId?: number;
  canonicalUrl?: string;
}

/** Stored websites are sometimes saved without a protocol ("www.x.com"). */
export function normalizeWebsiteUrl(url: string): string {
  const t = url.trim();
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

/**
 * Appends `?ref=jobsage` and emits the first-party event that lets the
 * extension trust this exact click through redirects. The public parameter is
 * only a matching aid; it is never sufficient to activate the sidebar alone.
 */
function appendJobSageRef(raw: string): string {
  try {
    const parsed = new URL(raw);
    parsed.searchParams.set("ref", "jobsage");
    return parsed.toString();
  } catch {
    // Malformed URL (e.g. a bare domain without protocol) — open as-is rather
    // than silently swallowing the navigation.
    return raw;
  }
}

export async function openTrackedOutbound({
  url,
  vacancy,
  onTracked,
}: {
  /** Id in the id-space implied by `source` (kept for company-site call-site compatibility). */
  id?: number | null | undefined;
  source?: TrackedOutboundSource;
  url: string;
  toast?: ToastFn;
  onTracked?: () => void;
  vacancy?: TrackedVacancyContext;
}): Promise<void> {
  const outboundUrl = appendJobSageRef(url);
  if (vacancy && shouldUseAssistedWorkspace()) {
    await beginAssistedApplication(outboundUrl, vacancy, onTracked);
    return;
  }
  // A vacancy context is the explicit intent signal. Employer/careers-site
  // navigation deliberately omits it, so it never creates a vacancy record.
  if (vacancy) {
    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    void fetch(`${base}/api/applications`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        applicationType: "website",
        status: "link_clicked",
        roleId: vacancy.roleId,
        companyName: vacancy.employer,
        jobTitle: vacancy.title,
        applicationUrl: outboundUrl,
      }),
    }).catch(() => {
      // Navigation and extension hand-off must never wait for tracker logging.
    });
  }
  window.dispatchEvent(new CustomEvent("jobsage:outbound-application", {
    detail: {
      applicationUrl: outboundUrl,
      canonicalUrl: vacancy?.canonicalUrl ?? url,
      jobTitle: vacancy?.title,
      employer: vacancy?.employer,
      roleId: vacancy?.roleId,
    },
  }));
  window.open(outboundUrl, "_blank", "noopener,noreferrer");
  onTracked?.();
}

export async function openTrackedSponsorVacancy({
  url,
  title,
  employer,
  vacancyId,
  roleId,
  onTracked,
}: {
  vacancyId?: number | null | undefined;
  /** Unified Opportunities role ID. Prefer this when it is available. */
  roleId?: number | null | undefined;
  url: string;
  title?: string;
  employer?: string;
  toast?: ToastFn;
  onTracked?: () => void;
}): Promise<void> {
  return openTrackedOutbound({
    url,
    onTracked,
    vacancy: {
      title,
      employer,
      roleId: roleId ?? vacancyId ?? undefined,
      canonicalUrl: url,
    },
  });
}
