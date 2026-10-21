import type { NativeProof } from "./workspace-config";
import { workspaceMessage } from "@workspace/mobile-core";

/** Diagnostic codes only: never return payloads, URLs, auth proofs or answers. */
export function workspaceBridgeRejectionReason(raw: string, options: {
  origin: string; navigationUrl: string; channel: string; now?: number;
  allowSameOriginNavigation?: boolean;
}): string {
  if (raw.length > 12_000) return "message-too-large";
  try {
    const parsed = workspaceMessage.safeParse(JSON.parse(raw));
    if (!parsed.success) return "invalid-message-shape";
    const message = parsed.data;
    if (message.channel !== options.channel) return "channel-mismatch";
    if (Math.abs((options.now ?? Date.now()) - message.timestamp) > 60_000) return "timestamp-outside-window";
    const claimed = new URL(message.url);
    const navigation = new URL(options.navigationUrl);
    if (claimed.origin !== options.origin) return "claimed-origin-mismatch";
    if (navigation.origin !== options.origin) return "native-origin-mismatch";
    if (!options.allowSameOriginNavigation && claimed.href !== navigation.href) return "navigation-url-mismatch";
    return "message-policy-rejected";
  } catch { return "invalid-json-or-url"; }
}

/** Idempotent so Android can recover when document-start injection is missed. */
export function workspaceBridgeScript(origin: string, proof: NativeProof): string {
  const config = JSON.stringify({ version: 1, channel: proof.channel, challenge: proof.challenge });
  return `(function(){try{
if(window!==window.top||location.origin!==${JSON.stringify(origin)})return;
var config=${config};
if(!window.__JOBSAGE_NATIVE__){
Object.defineProperty(window,"__JOBSAGE_NATIVE__",{value:Object.freeze(config),writable:false,configurable:false});
}
var installed=window.__JOBSAGE_NATIVE__;
if(installed.version===1&&installed.channel===config.channel&&installed.challenge===config.challenge){
window.dispatchEvent(new Event("jobsage:native-ready"));
}
}catch(e){}})();true;`;
}
