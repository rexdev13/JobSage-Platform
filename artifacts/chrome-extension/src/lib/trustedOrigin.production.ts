/**
 * Store-only origin check. Keep development hosts out of the Chrome Web Store
 * content-script bundle entirely.
 */
export function isJobSageFirstPartyPage(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname === "jobsage.co.uk" || hostname.endsWith(".jobsage.co.uk");
  } catch {
    return false;
  }
}
