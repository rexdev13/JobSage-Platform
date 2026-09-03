// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import {
  createQuestionWatcher,
  detectQuestions,
  fillStructuredField,
  getStructuredFieldDescriptors,
  insertAnswer,
} from "../lib/questionDetector";

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

  it("uses a fieldset legend as context rather than the sole row title", () => {
    setBody(`
      <fieldset>
        <legend>Why do you want to work for this NHS trust?</legend>
        <textarea name="answer_12"></textarea>
      </fieldset>
    `);
    const qs = detectQuestions();
    expect(qs).toHaveLength(1);
    expect(qs[0].question).toBe("Why do you want to work for this NHS trust? — Application response");
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
    expect(qs[0].question).toBe("Supporting information — Tell us why you are suitable for this role.");
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

describe("detectQuestions — dedicated ATS selectors", () => {
  it("detects a labelled NHS Jobs supporting statement from the NHS selector", () => {
    setBody(`<textarea id="supportingInformation"></textarea>`);
    const [question] = detectQuestions(document, "apps.jobs.nhs.uk");
    expect(question.question).toMatch(/supporting/i);
  });

  it("detects a Trac application question even when the label is terse", () => {
    setBody(`<textarea id="question-answers-4" aria-label="Answer"></textarea>`);
    const [question] = detectQuestions(document, "apply.trac.jobs");
    expect(question.question).toBe("Answer");
  });

  it("detects a Workday long-text field and keeps Insert behaviour intact", () => {
    setBody(`<div data-automation-id="question-longText"><textarea id="wd-answer" aria-label="Response"></textarea></div>`);
    const [question] = detectQuestions(document, "company.myworkdayjobs.com");
    expect(question.question).toBe("Response");
    expect(insertAnswer(question.id, "A tailored answer")).toBe(true);
    expect((document.getElementById("wd-answer") as HTMLTextAreaElement).value).toBe("A tailored answer");
  });
});

describe("detectQuestions — precision (non-question fields excluded)", () => {
  it("lists personal-detail controls as fillable structured rows", () => {
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
    expect(qs).toHaveLength(5);
    expect(qs.map((question) => question.bucket)).toEqual([
      "structured",
      "structured",
      "structured",
      "structured",
      "generate",
    ]);
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

  it("lists short labelled controls but still ignores search controls", () => {
    setBody(`
      <div>
        <label for="a">What?</label><input id="a" type="text" maxlength="30">
        <label for="b">Describe yourself</label><input id="b" type="text" autocomplete="name" maxlength="500">
        <label for="c">Search</label><input id="c" type="text" size="70" name="search">
      </div>
    `);
    expect(detectQuestions().map((question) => question.question)).toEqual(["What?", "Describe yourself"]);
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

  it("detects an unlabelled writable textarea using its stable field metadata", () => {
    setBody(`<div><textarea name="notes"></textarea></div>`);
    const [question] = detectQuestions();
    expect(question.question).toBe("Notes");
  });

  it("detects two generic long-text fields even when both labels are weak", () => {
    setBody(`
      <div><label for="weak-1">Response one</label><textarea id="weak-1"></textarea></div>
      <div><label for="weak-2">Response two</label><input id="weak-2" type="text" maxlength="500"></div>
    `);
    expect(detectQuestions().map((question) => question.question)).toEqual(["Response one", "Response two"]);
  });

  it("keeps repeated identical questions as separate writable fields", () => {
    setBody(`
      <div><label for="x1">Achievements</label><textarea id="x1"></textarea></div>
      <div><label for="x2">Achievements</label><textarea id="x2"></textarea></div>
    `);
    const questions = detectQuestions();
    expect(questions).toHaveLength(2);
    expect(questions[0]?.id).not.toBe(questions[1]?.id);
  });

  it("detects skills and additional-information fields, but flags declarations for the candidate", () => {
    setBody(`
      <div><label for="skills">Skills and experience</label><textarea id="skills"></textarea></div>
      <div><label for="more">Additional information</label><textarea id="more"></textarea></div>
      <div><label for="declaration">Criminal convictions declaration</label><textarea id="declaration"></textarea></div>
    `);
    const questions = detectQuestions();
    expect(questions).toHaveLength(3);
    expect(questions.find((q) => q.id === (document.getElementById("skills") as HTMLTextAreaElement).dataset.jobsageQid)?.restricted).toBe(false);
    expect(questions.find((q) => q.id === (document.getElementById("declaration") as HTMLTextAreaElement).dataset.jobsageQid)?.restricted).toBe(true);
  });

  it("labels repeated section controls with their child fields instead of duplicate legends", () => {
    setBody(`
      <fieldset>
        <legend>Current / Last Job</legend>
        <label for="employer">Employer</label><input id="employer" name="previous_employer">
        <label for="position">Position</label><input id="position" name="previous_position">
        <label for="duties">Duties</label><textarea id="duties" name="previous_duties"></textarea>
      </fieldset>
    `);
    const questions = detectQuestions();
    expect(questions.map((question) => question.question)).toEqual([
      "Current / Last Job — Employer",
      "Current / Last Job — Position",
      "Current / Last Job — Duties",
    ]);
    expect(questions.map((question) => question.bucket)).toEqual(["structured", "structured", "generate"]);
  });

  it("keeps Training short fields as structured rows", () => {
    setBody(`
      <fieldset>
        <legend>Training</legend>
        <label for="course">Course title</label><input id="course" type="text">
        <label for="tutor">Tutored by</label><input id="tutor" type="text">
        <label for="days">Number of days</label><input id="days" type="number">
        <label for="year">Year attended</label><input id="year" type="date">
      </fieldset>
    `);
    const questions = detectQuestions();
    expect(questions).toHaveLength(4);
    expect(questions.every((question) => question.bucket === "structured")).toBe(true);
    expect(questions.map((question) => question.question)).toContain("Training — Course title");
  });

  it("never marks cautions, health, medical or diversity controls as generatable", () => {
    setBody(`
      <label for="cautions">Cautions</label><textarea id="cautions"></textarea>
      <label for="health">Health Details</label><textarea id="health"></textarea>
      <label for="medical">Medical declaration</label><textarea id="medical"></textarea>
      <label for="ethnicity">Ethnicity</label><select id="ethnicity"><option>Choose</option></select>
    `);
    const questions = detectQuestions();
    expect(questions).toHaveLength(4);
    expect(questions.every((question) => question.bucket === "confirmation" && question.restricted)).toBe(true);
  });
});

describe("detectQuestions — Pinpoint", () => {
  it("lists Pinpoint screening selects and radio groups once without making them generatable", () => {
    setBody(`
      <main>
        <section class="questions-step">
          <h2>3. Questions</h2>
          <fieldset>
            <legend>Right to Work in the UK</legend>
            <label><input type="radio" name="rtw" value="yes">Yes</label>
            <label><input type="radio" name="rtw" value="no">No</label>
          </fieldset>
          <label for="registration">Professional registration</label>
          <input id="registration" name="professional_registration">
          <label for="employee">Do you currently work for this employer?</label>
          <select id="employee"><option>Choose</option><option>Yes</option><option>No</option></select>
        </section>
      </main>
      <footer>POWERED BY Pinpoint</footer>
    `);
    const questions = detectQuestions(document, "careers.example.test");
    expect(questions.map((question) => question.question)).toEqual([
      "Right to Work in the UK",
      "3. Questions — Professional registration",
      "3. Questions — Do you currently work for this employer?",
    ]);
    expect(questions.every((question) => question.bucket !== "generate")).toBe(true);
  });
});

describe("detectQuestions — AMS-style forms", () => {
  it("turns indexed raw names into readable section and child labels", () => {
    setBody(`
      <fieldset>
        <legend>Employment History</legend>
        <input name="employment[0][from]">
        <input name="employment[0][to]">
        <input name="employment[0][position]">
      </fieldset>
      <fieldset>
        <legend>Equal Opportunities</legend>
        <select name="eq_sex"><option value="">Choose</option><option>Female</option></select>
      </fieldset>
    `);

    expect(detectQuestions().map((question) => question.question)).toEqual([
      "Employment History 1 — From",
      "Employment History 1 — To",
      "Employment History 1 — Position held",
      "Equal Opportunities — Sex",
    ]);
  });

  it("fills exact safe structured values but does not overwrite existing answers", () => {
    setBody(`
      <label for="qualification">Qualification gained</label>
      <select id="qualification"><option value="">Choose</option><option value="bsc">BSc Nursing</option></select>
      <label for="employer">Employer</label><input id="employer">
      <label for="existing">Position held</label><input id="existing" value="Already entered">
    `);
    const questions = detectQuestions();
    const descriptors = getStructuredFieldDescriptors(questions);
    expect(descriptors.map((field) => field.label)).toEqual(["Qualifications — Qualification gained", "Employer"]);
    expect(fillStructuredField(descriptors[0].id, "BSc Nursing")).toBe(true);
    expect(fillStructuredField(descriptors[1].id, "Example NHS Trust")).toBe(true);
    expect((document.getElementById("qualification") as HTMLSelectElement).value).toBe("bsc");
    expect((document.getElementById("employer") as HTMLInputElement).value).toBe("Example NHS Trust");
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

  it("rescans when a history-based SPA URL changes", async () => {
    setBody(`<div><label for="spa">Supporting statement</label><textarea id="spa"></textarea></div>`);
    const watcher = createQuestionWatcher();
    let notified = 0;
    watcher.subscribe(() => notified++);

    history.pushState({}, "", "/application/step-2");
    await new Promise((r) => setTimeout(r, 600));

    expect(notified).toBe(1);
    watcher.stop();
  });

  it("observes changes inside an accessible same-origin iframe", async () => {
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    const watcher = createQuestionWatcher();
    let notified = 0;
    watcher.subscribe(() => notified++);

    iframe.contentDocument!.body.innerHTML = `
      <label for="iframe-answer">Anything else</label>
      <textarea id="iframe-answer"></textarea>
    `;
    await new Promise((r) => setTimeout(r, 600));

    expect(notified).toBe(1);
    expect(watcher.getSnapshot()).toHaveLength(1);
    watcher.stop();
  });
});
