// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { nativeSmartApplyScript } from "@workspace/smart-apply-core";

describe("shared native ATS runtime", () => {
  const messages: any[] = [];
  beforeEach(() => {
    window.__JOBSAGE_SMART_APPLY__?.stop();
    document.body.innerHTML = "";
    messages.length = 0;
    window.ReactNativeWebView = { postMessage: vi.fn(value => messages.push(JSON.parse(value))) };
    window.eval(nativeSmartApplyScript);
  });
  function start() {
    window.__JOBSAGE_SMART_APPLY__!.configure({ channel: "a".repeat(64), applicationId: 17 });
  }
  it("has no Chrome API access and emits bounded context without field values", () => {
    expect(nativeSmartApplyScript).not.toMatch(/chrome\.(?:runtime|storage|tabs)/);
    document.body.innerHTML = '<h1>Staff Nurse</h1><form><label for="why">Why are you suitable?</label><textarea id="why" required maxlength="600">private manual answer</textarea></form>';
    start();
    const snapshot = messages.find(message => message.type === "scan");
    expect(snapshot.applicationId).toBe(17);
    expect(snapshot.questions[0].maxLength).toBe(600);
    expect(JSON.stringify(snapshot)).not.toContain("private manual answer");
  });
  it("does not overwrite candidate edits when clearing previously inserted text", () => {
    document.body.innerHTML = '<form><label for="why">Why are you suitable?</label><textarea id="why"></textarea></form>';
    start();
    const id = messages.find(message => message.type === "scan").questions[0].id;
    window.__JOBSAGE_SMART_APPLY__!.command({ type: "insert", questionId: id, value: "Reviewed answer" });
    const field = document.querySelector("textarea")!;
    expect(field.value).toBe("Reviewed answer");
    field.value = "Candidate's newer edit";
    window.__JOBSAGE_SMART_APPLY__!.command({ type: "clear-page" });
    expect(field.value).toBe("Candidate's newer edit");
  });
  it("refuses sensitive declaration insertion", () => {
    document.body.innerHTML = '<form><label for="q">Do you have criminal convictions?</label><textarea id="q"></textarea></form>';
    start();
    const id = messages.find(message => message.type === "scan").questions[0].id;
    window.__JOBSAGE_SMART_APPLY__!.command({ type: "insert", questionId: id, value: "No" });
    expect(document.querySelector("textarea")!.value).toBe("");
    expect(messages.some(message => message.type === "error")).toBe(true);
  });
});
