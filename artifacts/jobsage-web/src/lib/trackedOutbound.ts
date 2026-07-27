// Guarded outbound-click flow for sponsor-vacancy external links.
// Mirrors the Opportunities page apply flow: open the tab synchronously so
// popup blockers don't interfere, then point it at the employer page only
// after the tracking endpoint approves. On 400/410 rejection the tab is
// closed and a toast explains why.

type ToastFn = (opts: { title: string; description: string; variant?: "default" | "destructive" }) => void;

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
  // Graceful degrade: without a sponsor-vacancy id we cannot track the click —
  // fall back to a plain untracked open rather than breaking the redirect.
  if (!vacancyId || vacancyId <= 0) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }

  const win = window.open("", "_blank");
  if (win) win.opener = null;
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const trackUrl = `${base}/api/applications/track-outbound?vacancyId=${vacancyId}&source=sponsor&destinationUrl=${encodeURIComponent(url)}`;
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
