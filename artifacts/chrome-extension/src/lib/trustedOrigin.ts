import { IS_STORE_BUILD } from "./env";

/**
 * Automatic prefill may only start from the exact configured JOBSAGE origin.
 * Never use suffix checks here: public hosting platforms have many unrelated
 * tenants that can share a hostname suffix.
 */
export function isConfiguredFirstPartyOrigin(senderUrl: string | undefined, configuredOrigin: string): boolean {
  try {
    return !!senderUrl && new URL(senderUrl).origin === new URL(configuredOrigin).origin;
  } catch {
    return false;
  }
}

export function isJobSageFirstPartyPage(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (hostname === "jobsage.co.uk" || hostname.endsWith(".jobsage.co.uk")) return true;
    return !IS_STORE_BUILD && (
      hostname === "localhost"
      || hostname.endsWith(".replit.dev")
      || hostname.endsWith(".repl.co")
    );
  } catch {
    return false;
  }
}