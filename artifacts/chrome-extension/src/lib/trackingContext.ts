export const TRACKING_CONTEXT_TTL_MS = 2 * 60 * 60 * 1000;

export interface TabTrackingContext {
  etld1: string;
  activatedAt: number;
  /** The exact URL initially opened from JOBSAGE, retained through ATS redirects. */
  applicationUrl?: string;
  canonicalUrl?: string;
  jobTitle?: string;
  employer?: string;
  roleId?: number;
}

export interface TopLevelNavigation {
  transitionType?: string;
  transitionQualifiers?: string[];
}

export function isTrackingContextFresh(
  context: TabTrackingContext,
  now = Date.now(),
): boolean {
  return now - context.activatedAt <= TRACKING_CONTEXT_TTL_MS;
}

function isApplicationFlowNavigation(navigation: TopLevelNavigation): boolean {
  return navigation.transitionType === "form_submit"
    || navigation.transitionQualifiers?.includes("client_redirect") === true
    || navigation.transitionQualifiers?.includes("server_redirect") === true;
}

/**
 * Keep a click context on its original employer domain, and only carry it
 * cross-domain for a fresh redirect or form-submission confirmation flow.
 */
export function nextTrackingContext(
  context: TabTrackingContext,
  destinationEtld1: string,
  navigation: TopLevelNavigation,
  now = Date.now(),
): TabTrackingContext | null {
  if (!isTrackingContextFresh(context, now)) return null;
  if (destinationEtld1 === context.etld1) return context;
  if (!context.applicationUrl || !isApplicationFlowNavigation(navigation)) return null;
  return { ...context, etld1: destinationEtld1 };
}