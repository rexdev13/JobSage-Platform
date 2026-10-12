import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@workspace/auth-web";
import { createMobileSessionGrant } from "@workspace/api-client-react";
import { ASSISTED_APPLICATION_EVENT, type AssistedApplicationEvent } from "@/lib/assistedApplication";
import { nativeWorkspaceAvailable, notifyNative } from "@/lib/nativeWorkspace";

/** Only the controlled first-party workspace installs this adapter. Employer
 * pages have a separate, non-privileged native browser and no auth adapter. */
export function NativeWorkspaceBridge() {
  const { user } = useAuth();
  const [location] = useLocation();
  const issued = useRef<string | null>(null);
  const previousUser = useRef<string | null>(null);

  useEffect(() => {
    if (!nativeWorkspaceAvailable()) return;
    notifyNative("ready");
  }, [location]);

  useEffect(() => {
    if (!nativeWorkspaceAvailable()) return;
    const userId = user?.id ?? null;
    if (!userId) {
      if (previousUser.current) notifyNative("logout");
      previousUser.current = null;
      issued.current = null;
      return;
    }
    previousUser.current = userId;
    const config = window.__JOBSAGE_NATIVE__!;
    const key = `${userId}:${config.challenge}`;
    if (issued.current === key) return;
    issued.current = key;
    let active = true;
    void createMobileSessionGrant({ challenge: config.challenge, audience: "native" })
      .then(grant => { if (active) notifyNative("session", { code: grant.code }); })
      .catch(() => {
        // No fake native session. A subsequent page/lifecycle retry can issue a
        // fresh grant; keep website auth working if the adapter is unavailable.
        if (issued.current === key) issued.current = null;
      });
    return () => { active = false; };
  }, [user?.id]);

  useEffect(() => {
    if (!nativeWorkspaceAvailable()) return;
    const onApplication = (event: Event) => {
      const detail = (event as CustomEvent<AssistedApplicationEvent>).detail;
      if (detail?.phase === "ready" && Number.isSafeInteger(detail.application?.id)) {
        notifyNative("application", { applicationId: detail.application!.id });
      }
    };
    window.addEventListener(ASSISTED_APPLICATION_EVENT, onApplication);
    return () => window.removeEventListener(ASSISTED_APPLICATION_EVENT, onApplication);
  }, []);
  return null;
}
