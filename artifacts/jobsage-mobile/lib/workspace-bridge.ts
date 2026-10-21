import type { NativeProof } from "./workspace-config";

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
