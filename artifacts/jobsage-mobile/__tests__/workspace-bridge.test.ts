import { describe, expect, it, jest } from "@jest/globals";
import { workspaceBridgeScript } from "../lib/workspace-bridge";

const origin = "https://jobsage.example";
const proof = { channel: "a".repeat(48), challenge: "b".repeat(64), verifier: "NEVER-INJECT-THIS-VERIFIER" };

function page() {
  const window: Record<string, unknown> = { dispatchEvent: jest.fn() };
  window.top = window;
  return window;
}

function run(window: Record<string, unknown>, pageOrigin = origin) {
  const execute = new Function("window", "location", "Event", workspaceBridgeScript(origin, proof));
  execute(window, { origin: pageOrigin }, class { constructor(public type: string) {} });
}

describe("Android workspace bridge bootstrap", () => {
  it("can initialize after page mount and safely run again after loading", () => {
    const window = page();
    run(window);
    run(window);
    expect(window.__JOBSAGE_NATIVE__).toEqual({ version: 1, channel: proof.channel, challenge: proof.challenge });
    expect(window.dispatchEvent).toHaveBeenCalledTimes(2);
    expect(Object.getOwnPropertyDescriptor(window, "__JOBSAGE_NATIVE__")?.writable).toBe(false);
    expect(workspaceBridgeScript(origin, proof)).not.toContain(proof.verifier);
  });

  it("never installs the privileged bridge on another origin or in a child frame", () => {
    const foreign = page();
    run(foreign, "https://employer.example");
    expect(foreign.__JOBSAGE_NATIVE__).toBeUndefined();
    expect(foreign.dispatchEvent).not.toHaveBeenCalled();
    const frame = page();
    frame.top = {};
    run(frame);
    expect(frame.__JOBSAGE_NATIVE__).toBeUndefined();
  });
});
