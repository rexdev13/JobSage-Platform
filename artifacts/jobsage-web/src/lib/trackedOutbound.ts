// Outbound apply/company-website links: simply open the destination in a new
// tab. Click-logging was retired — no application record is created and no
// toast is shown when a candidate clicks through to an employer site.

type ToastFn = (opts: { title: string; description: string; variant?: "default" | "destructive" }) => void;

export type TrackedOutboundSource = "sponsor" | "careers" | "role-website";

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
}: {
  /** Id in the id-space implied by `source` (kept for call-site compatibility; no longer used). */
  id?: number | null | undefined;
  source?: TrackedOutboundSource;
  url: string;
  toast?: ToastFn;
  onTracked?: () => void;
}): Promise<void> {
  const outboundUrl = appendJobSageRef(url);
  window.dispatchEvent(new CustomEvent("jobsage:outbound-application", { detail: outboundUrl }));
  window.open(outboundUrl, "_blank", "noopener,noreferrer");
}

export async function openTrackedSponsorVacancy({
  url,
}: {
  vacancyId?: number | null | undefined;
  url: string;
  toast?: ToastFn;
  onTracked?: () => void;
}): Promise<void> {
  return openTrackedOutbound({ url });
}
