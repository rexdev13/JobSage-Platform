// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  answerMemoryStorageKey,
  createAnswerMemoryController,
  normalizedFormPath,
} from "../lib/answerMemory";
import { ANSWER_LIBRARY_STORAGE_KEY, type RememberedAnswer } from "../lib/answerLibrary";
import { createQuestionWatcher, insertAnswer } from "../lib/questionDetector";
import { prefillPersonalDetails } from "../lib/prefill";

const values: Record<string, unknown> = {};

const localStorageMock = {
  async get(keys: string | string[] | Record<string, unknown> | null) {
    if (keys === null) return { ...values };
    if (typeof keys === "string") return keys in values ? { [keys]: values[keys] } : {};
    if (Array.isArray(keys)) {
      return Object.fromEntries(keys.filter((key) => key in values).map((key) => [key, values[key]]));
    }
    return Object.fromEntries(
      Object.entries(keys).map(([key, fallback]) => [key, key in values ? values[key] : fallback]),
    );
  },
  async set(items: Record<string, unknown>) {
    Object.assign(values, items);
  },
  async remove(keys: string | string[]) {
    for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key];
  },
};

function library(): RememberedAnswer[] {
  return (values[ANSWER_LIBRARY_STORAGE_KEY] as RememberedAnswer[] | undefined) ?? [];
}

beforeEach(() => {
  document.body.innerHTML = "";
  for (const key of Object.keys(values)) delete values[key];
  history.replaceState({}, "", "/application?utm_source=email&step=1");
  vi.stubGlobal("chrome", { storage: { local: localStorageMock } });
});

describe("answer library capture and recall", () => {
  it("normalizes tracking parameters out of legacy page-memory keys", () => {
    expect(normalizedFormPath("https://apply.example.test/form?utm_source=email&step=2&gclid=x")).toEqual({
      hostname: "apply.example.test",
      path: "/form?step=2",
    });
  });

  it("saves candidate-authored text and restores a similar question on another host", async () => {
    let url = "https://apply.first.test/application/123";
    document.body.innerHTML = `
      <label for="motivation">Why do you want this role?</label>
      <textarea id="motivation"></textarea>
    `;
    const firstWatcher = createQuestionWatcher();
    const firstController = createAnswerMemoryController(firstWatcher, () => url, localStorageMock);
    const firstField = document.getElementById("motivation") as HTMLTextAreaElement;
    firstField.value = "I am motivated by the opportunity to improve patient care.";
    firstField.dispatchEvent(new Event("blur"));
    await vi.waitFor(() => expect(library()).toHaveLength(1));
    firstController.stop();
    firstWatcher.stop();

    url = "https://careers.second.test/jobs/456/apply";
    document.body.innerHTML = `
      <label for="motivation-two">What motivates you to apply for this position?</label>
      <textarea id="motivation-two" required></textarea>
    `;
    const secondWatcher = createQuestionWatcher();
    const secondController = createAnswerMemoryController(secondWatcher, () => url, localStorageMock);

    await vi.waitFor(() =>
      expect((document.getElementById("motivation-two") as HTMLTextAreaElement).value)
        .toBe("I am motivated by the opportunity to improve patient care."),
    );
    expect(secondController.getSnapshot().restoredQuestionIds).toHaveLength(1);
    expect(secondWatcher.getSnapshot()[0]).toMatchObject({ required: true, requiredKnown: true });
    expect(library()[0].useCount).toBe(1);
    secondController.stop();
    secondWatcher.stop();
  });

  it("never overwrites a non-empty field and candidate typing wins during async recall", async () => {
    document.body.innerHTML = `<label for="statement">Supporting statement</label><textarea id="statement"></textarea>`;
    const seedWatcher = createQuestionWatcher();
    const [seedQuestion] = seedWatcher.getSnapshot();
    values[ANSWER_LIBRARY_STORAGE_KEY] = [{
      id: "seed",
      version: 1,
      value: "Remembered statement",
      normalizedQuestion: "supporting statement",
      questionSignature: seedQuestion.signature,
      labelVariants: ["Supporting statement"],
      controlType: "textarea",
      category: "safe_free_text",
      source: "candidate",
      scope: "global",
      createdAt: 1,
      updatedAt: 1,
      lastUsedAt: null,
      useCount: 0,
      explicitSave: false,
    } satisfies RememberedAnswer];
    seedWatcher.stop();

    document.body.innerHTML = `<label for="statement">Supporting statement</label><textarea id="statement">Candidate draft</textarea>`;
    const watcher = createQuestionWatcher();
    const controller = createAnswerMemoryController(watcher, () => "https://different.test/apply", localStorageMock);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect((document.getElementById("statement") as HTMLTextAreaElement).value).toBe("Candidate draft");
    controller.stop();
    watcher.stop();
  });

  it("does not save AI insertion or profile autofill as candidate-authored memory", async () => {
    document.body.innerHTML = `
      <label for="answer">Supporting statement</label><textarea id="answer"></textarea>
      <label for="experience">Years of experience</label><input id="experience">
    `;
    const watcher = createQuestionWatcher();
    const controller = createAnswerMemoryController(watcher, undefined, localStorageMock);
    const statement = watcher.getSnapshot().find((question) => question.question === "Supporting statement")!;
    expect(insertAnswer(statement.id, "Generated answer that the candidate has not approved")).toBe(true);
    prefillPersonalDetails({ experienceYears: 7 });
    (document.getElementById("answer") as HTMLTextAreaElement).dispatchEvent(new Event("blur"));
    (document.getElementById("experience") as HTMLInputElement).dispatchEvent(new Event("blur"));
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(library()).toEqual([]);
    controller.stop();
    watcher.stop();
  });

  it("never saves or restores sensitive, unknown, checkbox, or file fields", async () => {
    document.body.innerHTML = `
      <label for="criminal">Criminal convictions declaration</label><textarea id="criminal"></textarea>
      <label for="unknown">Additional information</label><textarea id="unknown"></textarea>
      <label><input id="consent" type="checkbox">I agree to this declaration</label>
      <label for="passport">Upload passport</label><input id="passport" type="file">
    `;
    const watcher = createQuestionWatcher();
    const controller = createAnswerMemoryController(watcher, undefined, localStorageMock);
    for (const id of ["criminal", "unknown"]) {
      const field = document.getElementById(id) as HTMLTextAreaElement;
      field.value = "Private candidate information";
      field.dispatchEvent(new Event("blur"));
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(library()).toEqual([]);
    controller.stop();
    watcher.stop();
  });

  it("captures safe select and radio values as stable option text", async () => {
    document.body.innerHTML = `
      <label for="availability">Preferred start date</label>
      <select id="availability"><option value="">Choose</option><option value="immediate">Immediately</option></select>
      <fieldset><legend>Preferred work pattern</legend>
        <label><input type="radio" name="pattern" value="ft">Full time</label>
        <label><input type="radio" name="pattern" value="pt">Part time</label>
      </fieldset>
    `;
    const watcher = createQuestionWatcher();
    const controller = createAnswerMemoryController(watcher, undefined, localStorageMock);
    const select = document.getElementById("availability") as HTMLSelectElement;
    select.value = "immediate";
    select.dispatchEvent(new Event("change"));
    const radio = document.querySelector<HTMLInputElement>("input[value='pt']")!;
    radio.checked = true;
    radio.dispatchEvent(new Event("change"));

    await vi.waitFor(() => expect(library()).toHaveLength(2));
    expect(library().map((answer) => answer.value).sort()).toEqual(["Immediately", "Part time"]);
    controller.stop();
    watcher.stop();
  });
});

describe("answer library management and lifecycle", () => {
  it("edits, deletes, toggles, and globally clears remembered answers", async () => {
    document.body.innerHTML = `<label for="answer">Supporting statement</label><textarea id="answer"></textarea>`;
    const watcher = createQuestionWatcher();
    const controller = createAnswerMemoryController(watcher, undefined, localStorageMock);
    const field = document.getElementById("answer") as HTMLTextAreaElement;
    field.value = "Candidate-authored supporting statement";
    field.dispatchEvent(new Event("blur"));
    await vi.waitFor(() => expect(controller.getSnapshot().answers).toHaveLength(1));
    const id = controller.getSnapshot().answers[0].id;

    expect(await controller.updateAnswer(id, "Edited candidate answer")).toBe(true);
    expect(controller.getSnapshot().answers[0]).toMatchObject({ value: "Edited candidate answer", explicitSave: true });
    await controller.setEnabled(false);
    expect(controller.getSnapshot().enabled).toBe(false);
    expect(await controller.deleteAnswer(id)).toBe(true);
    expect(controller.getSnapshot().answers).toEqual([]);

    values[answerMemoryStorageKey(watcher.getSnapshot()[0], location.href)] = "Unsafe legacy value";
    expect(await controller.clearAll()).toBe(1);
    expect(values).not.toHaveProperty(ANSWER_LIBRARY_STORAGE_KEY);
    controller.stop();
    watcher.stop();
  });

  it("does not migrate provenance-free legacy page memory into the library", async () => {
    document.body.innerHTML = `<label for="answer">Supporting statement</label><textarea id="answer"></textarea>`;
    const watcher = createQuestionWatcher();
    const question = watcher.getSnapshot()[0];
    values[answerMemoryStorageKey(question, location.href)] = "Unknown-source legacy value";
    const controller = createAnswerMemoryController(watcher, undefined, localStorageMock);
    await vi.waitFor(() => expect(controller.getSnapshot().ready).toBe(true));

    expect(controller.getSnapshot().answers).toEqual([]);
    expect((document.getElementById("answer") as HTMLTextAreaElement).value).toBe("");
    controller.stop();
    watcher.stop();
  });

  it("cancels a pending input save when the candidate clears this page", async () => {
    document.body.innerHTML = `<label for="answer">Supporting statement</label><textarea id="answer"></textarea>`;
    const watcher = createQuestionWatcher();
    const controller = createAnswerMemoryController(watcher, undefined, localStorageMock);
    await vi.waitFor(() => expect(controller.getSnapshot().ready).toBe(true));
    const field = document.getElementById("answer") as HTMLTextAreaElement;
    field.value = "A candidate answer waiting for its input debounce";
    field.dispatchEvent(new Event("input", { bubbles: true }));

    expect(await controller.clearPage()).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(controller.getSnapshot().answers).toEqual([]);
    controller.stop();
    watcher.stop();
  });

  it("rebinds after an SPA step change and remembers a safe field in a same-origin iframe", async () => {
    let url = "https://apply.example.test/step/one";
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    iframe.contentDocument!.body.innerHTML = `
      <label for="experience">Describe your relevant experience</label>
      <textarea id="experience"></textarea>
    `;
    const watcher = createQuestionWatcher();
    const controller = createAnswerMemoryController(watcher, () => url, localStorageMock);
    const field = iframe.contentDocument!.getElementById("experience") as HTMLTextAreaElement;
    field.value = "I have five years of directly relevant experience.";
    field.dispatchEvent(new iframe.contentWindow!.Event("blur"));
    await vi.waitFor(() => expect(library()).toHaveLength(1));

    url = "https://apply.example.test/step/two";
    iframe.contentDocument!.body.innerHTML = `
      <label for="experience-two">Outline your relevant experience</label>
      <textarea id="experience-two"></textarea>
    `;
    history.pushState({}, "", "/step/two");
    await vi.waitFor(() =>
      expect((iframe.contentDocument!.getElementById("experience-two") as HTMLTextAreaElement).value)
        .toBe("I have five years of directly relevant experience."),
    );
    expect(controller.getSnapshot().answers).toHaveLength(1);
    controller.stop();
    watcher.stop();
  });
});