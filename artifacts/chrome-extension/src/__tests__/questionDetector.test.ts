// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { detectQuestions, insertAnswer, createQuestionWatcher } from "../lib/questionDetector";

function setBody(html: string) {
  document.body.innerHTML = html;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("detectQuestions — NHS Jobs / Trac style forms", () => {
  it("detects labelled essay textareas with their label text", () => {
    setBody(`
      <form>
        <div class="nhsuk-form-group">
          <label for="q1">Describe a time you handled a clinical crisis and what you learned from it</label>
          <textarea id="q1" name="supportingInformation"></textarea>
        </div>
      </form>
    `);
    const qs = detectQuestions();
    expect(qs).toHaveLength(1);
    expect(qs[0].question).toContain("Describe a time you handled a clinical crisis");
  });

  it("resolves question text from a fieldset legend", () => {
    setBody(`
      <fieldset>
        <legend>Why do you want to work for this NHS trust?</legend>
        <textarea name="answer_12"></textarea>
      </fieldset>
    `);
    const qs = detectQuestions();
    expect(qs).toHaveLength(1);
    expect(qs[0].question).toBe("Why do you want to work for this NHS trust?");
  });

  it("resolves question text from a preceding heading when no label exists", () => {
    setBody(`
      <div class="form-section">
        <h3>Supporting information</h3>
        <p>Tell us why you are suitable for this role.</p>
        <textarea name="q_free_text"></textarea>
      </div>
    `);
    const qs = detectQuestions();
    expect(qs).toHaveLength(1);
    expect(qs[0].question).toBe("Tell us why you are suitable for this role.");
  });

  it("extracts maxlength and word limits", () => {
    setBody(`
      <div>
        <label for="q2">Describe your relevant experience (maximum 250 words)</label>
        <textarea id="q2" maxlength="4000"></textarea>
      </div>
    `);
    const [q] = detectQuestions();
    expect(q.maxLength).toBe(4000);
    expect(q.wordLimit).toBe(250);
  });
});

describe("detectQuestions — Workday style forms", () => {
  it("detects textareas inside data-automation-id containers", () => {
    setBody(`
      <div data-automation-id="formField-motivationQuestion">
        <label>What motivates you to apply for this position?</label>
        <textarea data-automation-id="textInput"></textarea>
      </div>
    `);
    const qs = detectQuestions();
    expect(qs).toHaveLength(1);
    expect(qs[0].question).toBe("What motivates you to apply for this position?");
  });

  it("uses aria-labelledby when present", () => {
    setBody(`
      <div>
        <span id="lbl-9">Please give an example of how you demonstrate our values</span>
        <textarea aria-labelledby="lbl-9"></textarea>
      </div>
    `);
    const qs = detectQuestions();
    expect(qs).toHaveLength(1);
    expect(qs[0].question).toContain("example of how you demonstrate our values");
  });
});

describe("detectQuestions — precision (non-question fields excluded)", () => {
  it("ignores personal-detail inputs and textareas", () => {
    setBody(`
      <form>
        <label for="fn">First name</label><input id="fn" type="text" name="first_name" size="80">
        <label for="em">Email address</label><input id="em" type="email" name="email">
        <label for="ph">Phone</label><input id="ph" type="tel" name="phone">
        <label for="addr">Address</label><textarea id="addr" name="address"></textarea>
        <input type="file" name="cv">
        <label for="q">Explain why you meet the person specification</label>
        <textarea id="q" name="q_1"></textarea>
      </form>
    `);
    const qs = detectQuestions();
    expect(qs).toHaveLength(1);
    expect(qs[0].question).toBe("Explain why you meet the person specification");
  });

  it("ignores hidden and disabled fields", () => {
    setBody(`
      <div>
        <label for="h1">Describe your leadership experience</label>
        <textarea id="h1" hidden></textarea>
        <label for="d1">Describe your teamwork experience</label>
        <textarea id="d1" disabled></textarea>
        <label for="s1">Describe your clinical experience</label>
        <textarea id="s1" style="display:none"></textarea>
      </div>
    `);
    expect(detectQuestions()).toHaveLength(0);
  });

  it("ignores short text inputs and autocomplete personal fields", () => {
    setBody(`
      <div>
        <label for="a">What?</label><input id="a" type="text" maxlength="30">
        <label for="b">Describe yourself</label><input id="b" type="text" autocomplete="name" maxlength="500">
        <label for="c">Search</label><input id="c" type="text" size="70" name="search">
      </div>
    `);
    expect(detectQuestions()).toHaveLength(0);
  });

  it("accepts long text inputs with question-like labels", () => {
    setBody(`
      <div>
        <label for="li">Why are you interested in this role?</label>
        <input id="li" type="text" maxlength="1000">
      </div>
    `);
    const qs = detectQuestions();
    expect(qs).toHaveLength(1);
  });

  it("ignores unlabelled textareas with no question-like context", () => {
    setBody(`<div><textarea name="notes"></textarea></div>`);
    expect(detectQuestions()).toHaveLength(0);
  });

  it("de-duplicates repeated identical questions", () => {
    setBody(`
      <div><label for="x1">Describe a challenging situation you resolved</label><textarea id="x1"></textarea></div>
      <div><label for="x2">Describe a challenging situation you resolved</label><textarea id="x2"></textarea></div>
    `);
    expect(detectQuestions()).toHaveLength(1);
  });
});

describe("detectQuestions — same-origin iframes", () => {
  it("picks up questions inside a same-origin iframe", () => {
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    iframe.contentDocument!.body.innerHTML = `
      <div>
        <label for="iq">Explain your experience of multidisciplinary working</label>
        <textarea id="iq"></textarea>
      </div>
    `;
    const qs = detectQuestions();
    expect(qs).toHaveLength(1);
    expect(qs[0].question).toContain("multidisciplinary working");
  });
});

describe("stable identity across re-scans", () => {
  it("keeps the same id for the same field", () => {
    setBody(`
      <div><label for="q1">Describe your greatest achievement in this field</label><textarea id="q1"></textarea></div>
    `);
    const first = detectQuestions();
    const second = detectQuestions();
    expect(first[0].id).toBe(second[0].id);
  });
});

describe("insertAnswer", () => {
  it("writes the answer into the field and dispatches input/change events", () => {
    setBody(`
      <div><label for="q1">Describe a time you improved patient safety</label><textarea id="q1"></textarea></div>
    `);
    const [q] = detectQuestions();
    const field = document.getElementById("q1") as HTMLTextAreaElement;
    let inputFired = false;
    let changeFired = false;
    field.addEventListener("input", () => (inputFired = true));
    field.addEventListener("change", () => (changeFired = true));

    expect(insertAnswer(q.id, "My answer text")).toBe(true);
    expect(field.value).toBe("My answer text");
    expect(inputFired).toBe(true);
    expect(changeFired).toBe(true);
  });

  it("returns false when the field has been removed from the page", () => {
    setBody(`
      <div><label for="q1">Describe your approach to safeguarding</label><textarea id="q1"></textarea></div>
    `);
    const [q] = detectQuestions();
    document.getElementById("q1")!.remove();
    expect(insertAnswer(q.id, "answer")).toBe(false);
  });
});

describe("createQuestionWatcher — live re-scanning", () => {
  it("notifies subscribers when new questions appear (debounced)", async () => {
    setBody(`<div id="step"></div>`);
    const watcher = createQuestionWatcher();
    expect(watcher.getSnapshot()).toHaveLength(0);

    let notified = 0;
    watcher.subscribe(() => notified++);

    document.getElementById("step")!.innerHTML = `
      <label for="w1">Why do you want to join our team?</label>
      <textarea id="w1"></textarea>
    `;
    await new Promise((r) => setTimeout(r, 600));
    expect(notified).toBe(1);
    expect(watcher.getSnapshot()).toHaveLength(1);
    watcher.stop();
  });

  it("does not notify when nothing question-related changed (no flicker)", async () => {
    setBody(`
      <div><label for="w2">Describe your experience with audits</label><textarea id="w2"></textarea></div>
      <div id="noise"></div>
    `);
    const watcher = createQuestionWatcher();
    let notified = 0;
    watcher.subscribe(() => notified++);

    document.getElementById("noise")!.innerHTML = `<p>Some unrelated content update</p>`;
    await new Promise((r) => setTimeout(r, 600));
    expect(notified).toBe(0);
    watcher.stop();
  });
});
