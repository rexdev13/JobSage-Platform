export const FRESH_LINK_WINDOW_MS = 6 * 60 * 60 * 1000;
export const CLICK_HEALTH_TIMEOUT_MS = 1500;

type LinkHealthResponse = { verdict?: string };

export function isFreshLiveApplyLink(
  linkVerified: boolean,
  linkCheckedAt: string | null | undefined,
  nowMs = Date.now(),
): boolean {
  if (!linkVerified || !linkCheckedAt) return false;
  const checkedMs = new Date(linkCheckedAt).getTime();
  return Number.isFinite(checkedMs) && checkedMs > 0 && nowMs - checkedMs < FRESH_LINK_WINDOW_MS;
}

export async function checkApplyLinkInBackground({
  url,
  endpoint,
  linkVerified,
  linkCheckedAt,
  fetchImpl = fetch,
  onDead,
}: {
  url: string;
  endpoint: string;
  linkVerified: boolean;
  linkCheckedAt?: string | null;
  fetchImpl?: typeof fetch;
  onDead: () => void;
}): Promise<void> {
  if (isFreshLiveApplyLink(linkVerified, linkCheckedAt)) return;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CLICK_HEALTH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${endpoint}?url=${encodeURIComponent(url)}`, {
      credentials: "include",
      signal: controller.signal,
    });
    if (!response.ok) return;
    const result = (await response.json()) as LinkHealthResponse;
    if (result.verdict === "dead") onDead();
  } catch {
    // The candidate's tab is already open; timeouts and network failures are
    // deliberately inconclusive and never block the application.
  } finally {
    clearTimeout(timeout);
  }
}