import { describe, expect, it, jest } from "@jest/globals";
import { workspaceBridgeRejectionReason, workspaceBridgeScript } from "../lib/workspace-bridge";

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
  it("identifies SPA URL, channel and timestamp rejection without exposing message data", () => {
    const now = Date.now();
    const message = {
      version: 1, type: "application", applicationId: 73,
      channel: proof.channel, timestamp: now, url: `${origin}/opportunities?private=value`,
    };
    const options = { origin, channel: proof.channel, navigationUrl: `${origin}/dashboard`, now };
    expect(workspaceBridgeRejectionReason(JSON.stringify(message), options)).toBe("navigation-url-mismatch");
    expect(workspaceBridgeRejectionReason(JSON.stringify({ ...message, channel: "c".repeat(48) }), options)).toBe("channel-mismatch");
    expect(workspaceBridgeRejectionReason(JSON.stringify({ ...message, timestamp: now - 61_000 }), options)).toBe("timestamp-outside-window");
    expect(workspaceBridgeRejectionReason(JSON.stringify({ ...message, applicationId: "73" }), options)).toBe("invalid-message-shape");
    expect(workspaceBridgeRejectionReason("not-json", options)).toBe("invalid-json-or-url");
  });

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
