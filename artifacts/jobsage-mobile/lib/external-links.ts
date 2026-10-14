import { safeEmployerUrl } from "@workspace/mobile-core";
import * as Clipboard from "expo-clipboard";
import * as WebBrowser from "expo-web-browser";
import { Alert } from "react-native";

import { isFirstPartyUrl } from "@/lib/workspace-config";

export type LinkKind = "first-party" | "https" | "http" | "contact" | "blocked";

export type EmployerWindowTarget =
  | { kind: "in-app"; url: string }
  | { kind: "contact" }
  | { kind: "blocked" };

export type InAppContactLink = {
  kind: "email" | "phone";
  displayValue: string;
  copyValue: string;
};

/** Safe-to-log URL metadata. Never return paths, query values, or fragments. */
export function safeLinkLogContext(value: string): { scheme: string; host: string | null } {
  try {
    const url = new URL(value);
    return { scheme: url.protocol.replace(/:$/, ""), host: url.host || null };
  } catch {
    return { scheme: "invalid", host: null };
  }
}

/** Extract only a simple email address or phone number for an in-app copy action. */
export function parseInAppContactLink(value: string): InAppContactLink | null {
  if (value.length > 2048 || /[\r\n]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.protocol === "mailto:") {
      const address = decodeURIComponent(url.pathname).trim();
      if (address.length <= 254 && /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(address)) {
        return { kind: "email", displayValue: address, copyValue: address };
      }
    }
    if (url.protocol === "tel:") {
      const displayValue = decodeURIComponent(url.pathname).trim();
      const copyValue = displayValue.replace(/[\s().-]/g, "");
      if (copyValue.length >= 3 && copyValue.length <= 32 && /^\+?[0-9*#]+$/.test(copyValue)) {
        return { kind: "phone", displayValue, copyValue };
      }
    }
  } catch {
    return null;
  }
  return null;
}

/** Keep contact links in JOBSAGE; offer copying rather than launching another app. */
export function showInAppContactLink(value: string): boolean {
  const contact = parseInAppContactLink(value);
  if (!contact) return false;
  const label = contact.kind === "email" ? "email address" : "phone number";
  Alert.alert(
    contact.kind === "email" ? "Employer email" : "Employer phone",
    contact.displayValue,
    [
      {
        text: `Copy ${label}`,
        onPress: () => {
          void Clipboard.setStringAsync(contact.copyValue).catch(() => {
            Alert.alert("Copy failed", "The contact detail could not be copied.");
          });
        },
      },
      { text: "Close", style: "cancel" },
    ],
  );
  return true;
}

export function classifyUrl(value: string): LinkKind {
  if (isFirstPartyUrl(value)) return "first-party";
  if (/^(mailto|tel):/i.test(value)) return value.length < 2048 && !/[\r\n]/.test(value) ? "contact" : "blocked";
  if (/^about:(blank|srcdoc)$/i.test(value)) return "first-party";
  if (!safeEmployerUrl(value)) return "blocked";
  return safeLinkLogContext(value).scheme === "http" ? "http" : "https";
}

/** Route employer pop-up links into the controlled browser whenever safe. */
export function classifyEmployerWindowTarget(value: string): EmployerWindowTarget {
  const url = safeEmployerUrl(value);
  if (url) return { kind: "in-app", url };
  return classifyUrl(value) === "contact" ? { kind: "contact" } : { kind: "blocked" };
}

/** Opens a public web link in an in-app browser. Contact links stay in JOBSAGE. */
export async function openExternal(value: string): Promise<boolean> {
  const kind = classifyUrl(value);
  try {
    if (kind === "https" || kind === "http") {
      const secureUrl = safeEmployerUrl(value);
      if (!secureUrl) return false;
      await WebBrowser.openBrowserAsync(secureUrl, { presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET });
      return true;
    }
  } catch {
    return false;
  }
  return false;
}
