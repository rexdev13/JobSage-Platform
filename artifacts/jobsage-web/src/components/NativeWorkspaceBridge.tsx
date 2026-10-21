import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@workspace/auth-web";
import { createMobileSessionGrant } from "@workspace/api-client-react";
import { installNativeLinkHandlers, nativeWorkspaceAvailable, notifyNative } from "@/lib/nativeWorkspace";

/** Only the controlled first-party workspace installs this adapter. Employer
 * pages have a separate, non-privileged native browser and no auth adapter. */
export function NativeWorkspaceBridge() {
  const { user } = useAuth();
  const [location] = useLocation();
  const issued = useRef<string | null>(null);
  const previousUser = useRef<string | null>(null);
  const [nativeReady, setNativeReady] = useState(nativeWorkspaceAvailable);

  useEffect(() => {
    const refresh = () => setNativeReady(nativeWorkspaceAvailable());
    window.addEventListener("jobsage:native-ready", refresh);
    refresh();
    return () => window.removeEventListener("jobsage:native-ready", refresh);
  }, []);

  useEffect(() => {
    if (!nativeReady) return;
    notifyNative("ready");
  }, [location, nativeReady]);

  useEffect(() => {
    if (!nativeReady) return;
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
  }, [user?.id, nativeReady]);

  useEffect(() => {
    if (!nativeReady) return;
    return installNativeLinkHandlers();
  }, [nativeReady]);
  return null;
}
