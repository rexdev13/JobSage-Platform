import { safeEmployerUrl } from "@workspace/mobile-core";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";

import { isFirstPartyUrl } from "@/lib/workspace-config";

export type LinkKind = "first-party" | "https" | "system" | "blocked";

export function classifyUrl(value: string): LinkKind {
  if (isFirstPartyUrl(value)) return "first-party";
  if (/^(mailto|tel|webcal):/i.test(value)) return value.length < 2048 && !/[\r\n]/.test(value) ? "system" : "blocked";
  if (/^about:(blank|srcdoc)$/i.test(value)) return "first-party";
  return safeEmployerUrl(value) ? "https" : "blocked";
}

/** Opens a link outside the workspace. Returns false when blocked. */
export async function openExternal(value: string): Promise<boolean> {
  const kind = classifyUrl(value);
  try {
    if (kind === "https") {
      await WebBrowser.openBrowserAsync(value, { presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET });
      return true;
    }
    if (kind === "system") {
      await Linking.openURL(value);
      return true;
    }
  } catch {
    return false;
  }
  return false;
}
