declare global {
  interface Window {
    ReactNativeWebView?: { postMessage(message: string): void };
    __JOBSAGE_NATIVE__?: { version: 1; channel: string; challenge: string };
  }
}

export function nativeWorkspaceAvailable(): boolean {
  const config = window.__JOBSAGE_NATIVE__;
  return !!window.ReactNativeWebView && config?.version === 1
    && /^[a-f0-9]{64}$/.test(config.challenge)
    && config.channel.length >= 20 && config.channel.length <= 100;
}

export function notifyNative(type: "ready" | "session" | "application" | "logout" | "download" | "open-url" | "privacy-export",
  payload: Record<string, unknown> = {}) {
  if (!nativeWorkspaceAvailable()) return;
  window.ReactNativeWebView!.postMessage(JSON.stringify({
    ...payload, version: 1, channel: window.__JOBSAGE_NATIVE__!.channel,
    type, url: window.location.href, timestamp: Date.now(),
  }));
}

/** Android may block window.open, especially after an asynchronous request.
 * Send new-window intent to the controlled native host instead of a pop-up. */
export function installNativeLinkHandlers(): () => void {
  if (!nativeWorkspaceAvailable()) return () => {};
  const originalOpen = window.open;
  const sameWindowTargets = ["_self", "_parent", "_top"];
  const openNative = (value: string | URL) => {
    const destination = new URL(String(value), window.location.href).href;
    if (destination !== "about:blank") notifyNative("open-url", { destination });
  };
  const nativeOpen: typeof window.open = (url, target, features) => {
    if (target && sameWindowTargets.includes(target.toLowerCase())) {
      return originalOpen.call(window, url, target, features);
    }
    if (url) openNative(url);
    return null;
  };
  const onClick = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0 || !(event.target instanceof Element)) return;
    const anchor = event.target.closest<HTMLAnchorElement>("a[href]");
    if (!anchor || anchor.hasAttribute("download") || !anchor.target ||
        sameWindowTargets.includes(anchor.target.toLowerCase())) return;
    event.preventDefault();
    openNative(anchor.href);
  };
  window.open = nativeOpen;
  document.addEventListener("click", onClick);
  return () => {
    if (window.open === nativeOpen) window.open = originalOpen;
    document.removeEventListener("click", onClick);
  };
}
