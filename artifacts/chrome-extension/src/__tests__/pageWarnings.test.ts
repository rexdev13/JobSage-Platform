// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  hideRawPhpRuntimeWarnings,
  isRawPhpRuntimeWarning,
  watchRawPhpRuntimeWarnings,
} from "../lib/pageWarnings";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("raw PHP warning cleanup", () => {
  const warning =
    "Warning: Attempt to read property \"roles\" on false in /home/example/public_html/wp-content/plugins/simple-job-board/templates/v1/single-jobpost/job-application.php on line 55";

  it("recognises the raw server warning shown by employer job boards", () => {
    expect(isRawPhpRuntimeWarning(warning)).toBe(true);
    expect(isRawPhpRuntimeWarning("Warning: review your application carefully before submitting.")).toBe(false);
  });

  it("hides a standalone warning without changing the application form", () => {
    document.body.innerHTML = `
      <p id="server-warning">${warning}</p>
      <form><input name="firstName" value="John"><input type="file" name="cv"></form>
    `;

    expect(hideRawPhpRuntimeWarnings()).toBe(1);
    expect(document.querySelector<HTMLElement>("#server-warning")?.style.display).toBe("none");
    expect(document.querySelector<HTMLInputElement>("[name='firstName']")?.value).toBe("John");
    expect(document.querySelector<HTMLInputElement>("[name='cv']")).not.toBeNull();
  });

  it("removes an unwrapped warning text node while retaining page controls", () => {
    document.body.append(document.createTextNode(warning));
    const form = document.createElement("form");
    form.innerHTML = "<input name='email' type='email'>";
    document.body.append(form);

    expect(hideRawPhpRuntimeWarnings()).toBe(1);
    expect(document.body.textContent).not.toContain("Attempt to read property");
    expect(document.querySelector<HTMLInputElement>("[name='email']")).not.toBeNull();
  });

  it("removes only the warning when it shares a wrapper with an application form", () => {
    document.body.innerHTML = `
      <div id="application-wrapper">${warning}<form><input name="surname" value="Dev"></form></div>
    `;

    expect(hideRawPhpRuntimeWarnings()).toBe(1);
    expect(document.querySelector("#application-wrapper")?.textContent).not.toContain("Attempt to read property");
    expect(document.querySelector<HTMLInputElement>("[name='surname']")?.value).toBe("Dev");
  });

  it("hides a PHP warning injected after an application form step", async () => {
    const stop = watchRawPhpRuntimeWarnings();
    const warningElement = document.createElement("p");
    warningElement.id = "late-warning";
    warningElement.textContent = warning;
    document.body.append(warningElement);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(warningElement.style.display).toBe("none");
    stop();
  });
});