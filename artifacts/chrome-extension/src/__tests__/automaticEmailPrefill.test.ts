// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { startAutomaticEmailPrefill } from "../lib/automaticEmailPrefill";
import { createQuestionWatcher } from "../lib/questionDetector";
import { prefillCandidateEmail, prefillPersonalDetails } from "../lib/prefill";

const alias = "synthetic.candidate@mail.jobsage.co.uk";
let stop: (() => void) | undefined;
let watcher: ReturnType<typeof createQuestionWatcher> | undefined;

async function settle() {
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(450);
}

function watch(loadEmail = vi.fn(async () => alias)) {
  watcher = createQuestionWatcher();
  stop = startAutomaticEmailPrefill(watcher, loadEmail);
  return loadEmail;
}

afterEach(() => {
  stop?.();
  watcher?.stop();
  stop = undefined;
  watcher = undefined;
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("candidate email on ATS registration and later steps", () => {
  it("fills a clearly labelled email even when its technical model property is UserName", () => {
    document.body.innerHTML = `
      <form>
        <label for="UserName">What is your email?</label>
        <input id="UserName" name="UserName" type="email" autocomplete="username" placeholder="Email address" required>
        <label for="MobileNumber">Lastly, tell me your mobile number?</label>
        <input id="MobileNumber" value="07000000000">
        <label><input id="consent" type="checkbox" required>I confirm that I consent</label>
        <label for="password">Password</label><input id="password" type="password">
      </form>`;
    const result = prefillPersonalDetails({ email: alias, phone: "07111111111" });
    expect((document.getElementById("UserName") as HTMLInputElement).value).toBe(alias);
    expect((document.getElementById("MobileNumber") as HTMLInputElement).value).toBe("07000000000");
    expect((document.getElementById("consent") as HTMLInputElement).checked).toBe(false);
    expect((document.getElementById("password") as HTMLInputElement).value).toBe("");
    expect(result.filled).toContain("email");
  });

  it.each([
    '<input id="opaque-347" type="email">',
    '<input id="EmailAddress" type="text">',
    '<input id="opaque-347" type="text" placeholder="Email address">',
    '<input id="ConfirmEmailAddress" type="text">',
  ])("recognises email semantics without requiring a particular label format: %s", (html) => {
    document.body.innerHTML = html;
    prefillCandidateEmail(alias);
    expect(document.querySelector<HTMLInputElement>("input")!.value).toBe(alias);
  });

  it("does not fill login usernames, sensitive prompts, other people's emails, or consent", () => {
    document.body.innerHTML = `
      <label for="username">Username</label><input id="username" autocomplete="username">
      <label for="security">Security question email</label><input id="security" type="email">
      <label for="referee">Referee email</label><input id="referee" type="email">
      <label for="employer">Employer email</label><input id="employer" type="email">
      <fieldset><legend>Reference 1</legend><label for="other">Email</label><input id="other" type="email"></fieldset>
      <label><input id="consent" type="checkbox">I consent</label>`;
    prefillPersonalDetails({ email: alias });
    expect(Array.from(document.querySelectorAll("input")).every((field) => field.value === "" || field.type === "checkbox")).toBe(true);
    expect((document.getElementById("consent") as HTMLInputElement).checked).toBe(false);
  });

  it("never inserts a personal email supplied instead of a JOBSAGE alias", () => {
    document.body.innerHTML = '<input type="email">';
    prefillCandidateEmail("synthetic@example.test");
    expect(document.querySelector<HTMLInputElement>("input")!.value).toBe("");
  });

  it("automatically fills a later step and confirmation field without rerunning profile mapping", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<form><label for="first">First name</label><input id="first"></form>';
    const loadEmail = watch();
    await settle();
    document.querySelector("form")!.innerHTML = `
      <label for="UserName">What is your email?</label><input id="UserName" type="email">
      <label for="phone">Mobile number</label><input id="phone">
      <label><input id="consent" type="checkbox">I consent</label>`;
    await settle();
    expect((document.getElementById("UserName") as HTMLInputElement).value).toBe(alias);
    expect((document.getElementById("phone") as HTMLInputElement).value).toBe("");
    expect((document.getElementById("consent") as HTMLInputElement).checked).toBe(false);
    document.querySelector("form")!.insertAdjacentHTML("beforeend", '<input id="ConfirmEmailAddress" type="email">');
    await settle();
    expect((document.getElementById("ConfirmEmailAddress") as HTMLInputElement).value).toBe(alias);
    expect(loadEmail).toHaveBeenCalledTimes(1);
  });

  it("fills a control when its hidden step becomes visible", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="step" hidden><label for="email">Email</label><input id="email" type="email"></div>';
    watch();
    await settle();
    expect((document.getElementById("email") as HTMLInputElement).value).toBe("");
    document.getElementById("step")!.removeAttribute("hidden");
    await settle();
    expect((document.getElementById("email") as HTMLInputElement).value).toBe(alias);
  });

  it("does not continually overwrite candidate edits when another question is added", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<label for="email">Email</label><input id="email" type="email">';
    watch();
    await settle();
    const email = document.getElementById("email") as HTMLInputElement;
    email.value = "candidate-chosen@example.test";
    document.body.insertAdjacentHTML("beforeend", '<label for="phone">Phone</label><input id="phone">');
    await settle();
    expect(email.value).toBe("candidate-chosen@example.test");
  });

  it("ignores a profile response that finishes after the watcher is stopped", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<input type="email">';
    let resolveEmail!: (email: string) => void;
    watch(vi.fn(() => new Promise<string>((resolve) => { resolveEmail = resolve; })));
    stop?.();
    resolveEmail(alias);
    await settle();
    expect(document.querySelector<HTMLInputElement>("input")!.value).toBe("");
  });

  it("can retry on a later step after an unavailable profile without a polling loop", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<form><label for="first">First name</label><input id="first"></form>';
    const loadEmail = vi.fn<() => Promise<string | null>>().mockResolvedValueOnce(null).mockResolvedValue(alias);
    watcher = createQuestionWatcher();
    stop = startAutomaticEmailPrefill(watcher, loadEmail);
    await settle();
    expect(loadEmail).toHaveBeenCalledTimes(1);
    document.querySelector("form")!.innerHTML = '<input type="email">';
    await settle();
    expect(document.querySelector<HTMLInputElement>("input")!.value).toBe(alias);
    expect(loadEmail).toHaveBeenCalledTimes(2);
  });
});
