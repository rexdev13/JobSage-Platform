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

export function notifyNative(type: "ready" | "session" | "application" | "logout" | "download" | "open-url",
  payload: Record<string, unknown> = {}) {
  if (!nativeWorkspaceAvailable()) return;
  window.ReactNativeWebView!.postMessage(JSON.stringify({
    ...payload, version: 1, channel: window.__JOBSAGE_NATIVE__!.channel,
    type, url: window.location.href, timestamp: Date.now(),
  }));
}
