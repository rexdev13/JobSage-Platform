// Guarded outbound-click flow for tracked external apply links.
// Mirrors the Opportunities page apply flow: open the tab synchronously so
// popup blockers don't interfere, then point it at the employer page only
// after the tracking endpoint approves. On 400/410 rejection the tab is
// closed and a toast explains why.

type ToastFn = (opts: { title: string; description: string; variant?: "default" | "destructive" }) => void;

export type TrackedOutboundSource = "sponsor" | "careers" | "role-website";

/** Stored websites are sometimes saved without a protocol ("www.x.com"). */
export function normalizeWebsiteUrl(url: string): string {
  const t = url.trim();
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

export async function openTrackedOutbound({
  id,
  source,
  url,
  toast,
  onTracked,
}: {
  /** Id in the id-space implied by `source` (sponsor vacancy id, sponsor licence id, or role id). */
  id: number | null | undefined;
  source: TrackedOutboundSource;
  url: string;
  toast: ToastFn;
  onTracked?: () => void;
}): Promise<void> {
  // Graceful degrade: without an id we cannot track the click —
  // fall back to a plain untracked open rather than breaking the redirect.
  if (!id || id <= 0) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }

  const win = window.open("", "_blank");
  if (win) win.opener = null;
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const trackUrl = `${base}/api/applications/track-outbound?vacancyId=${id}&source=${source}&destinationUrl=${encodeURIComponent(url)}`;
  try {
    const resp = await fetch(trackUrl, { credentials: "include", redirect: "manual" });
    if (resp.type === "opaqueredirect" || resp.ok) {
      if (win) win.location.href = url;
      else window.open(url, "_blank", "noopener,noreferrer");
      toast({
        title: "Application logged!",
        description: "Track your progress under the 'Company Website' tab in your Tracker.",
      });
      onTracked?.();
    } else {
      win?.close();
      let message = "This vacancy is no longer accepting applications (closed by employer).";
      try {
        const data = (await resp.json()) as { error?: unknown };
        if (typeof data?.error === "string" && data.error) message = data.error;
      } catch {
        // non-JSON error body — keep default message
      }
      toast({ title: "Vacancy unavailable", description: message, variant: "destructive" });
    }
  } catch {
    win?.close();
    toast({
      title: "Vacancy unavailable",
      description: "This vacancy link is invalid or no longer available.",
      variant: "destructive",
    });
  }
}

export async function openTrackedSponsorVacancy({
  vacancyId,
  url,
  toast,
  onTracked,
}: {
  vacancyId: number | null | undefined;
  url: string;
  toast: ToastFn;
  onTracked?: () => void;
}): Promise<void> {
  return openTrackedOutbound({ id: vacancyId, source: "sponsor", url, toast, onTracked });
}
