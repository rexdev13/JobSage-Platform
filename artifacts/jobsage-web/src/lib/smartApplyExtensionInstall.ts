import type { MouseEvent } from "react";

/** Smart Apply installs only on desktop browsers; mobile Chrome cannot install it. */
export function isDesktopSmartApplyInstallAvailable(): boolean {
  const browser = navigator as Navigator & {
    userAgentData?: { mobile?: boolean };
  };
  const userAgent = browser.userAgent || "";
  const mobileUserAgent = /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent);
  const iPadDesktopMode = browser.platform === "MacIntel" && browser.maxTouchPoints > 1;
  const coarsePointer = window.matchMedia?.("(pointer: coarse)").matches === true;

  return browser.userAgentData?.mobile !== true
    && !mobileUserAgent
    && !iPadDesktopMode
    && !coarsePointer;
}

/**
 * Open the Chrome Web Store in a separate window sized to the current page.
 * The anchor remains the fallback if the browser blocks the scripted popup.
 */
export function openChromeWebStorePopup(
  event: MouseEvent<HTMLAnchorElement>,
  storeUrl: string,
): void {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey
  ) {
    return;
  }

  let popup: Window | null = null;
  try {
    const width = Math.max(100, Math.floor(window.innerWidth));
    const height = Math.max(100, Math.floor(window.innerHeight));
    const left = Math.max(
      0,
      Math.floor(window.screenX + (window.outerWidth - width) / 2),
    );
    const top = Math.max(
      0,
      Math.floor(window.screenY + (window.outerHeight - height) / 2),
    );
    popup = window.open(
      storeUrl,
      "jobsage-chrome-web-store",
      `popup=yes,width=${width},height=${height},left=${left},top=${top}`,
    );
  } catch {
    // Leave the anchor's normal new-tab behavior available as the fallback.
    return;
  }

  if (!popup) return;

  event.preventDefault();
  try {
    popup.opener = null;
  } catch {
    // A restrictive browser may not allow changing opener; the Store still opens.
  }
}
