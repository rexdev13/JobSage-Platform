// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  answerMemoryPagePrefix,
  answerMemoryStorageKey,
  createAnswerMemoryController,
  normalizedFormPath,
} from "../lib/answerMemory";
import { createQuestionWatcher, insertAnswer } from "../lib/questionDetector";

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

beforeEach(() => {
  document.body.innerHTML = "";
  for (const key of Object.keys(values)) delete values[key];
  history.replaceState({}, "", "/application?utm_source=email&step=1");
  vi.stubGlobal("chrome", { storage: { local: localStorageMock } });
});

describe("answer memory", () => {
  it("normalizes tracking parameters out of the page-scoped storage key", () => {
    expect(normalizedFormPath("https://apply.example.test/form?utm_source=email&step=2&gclid=x")).toEqual({
      hostname: "apply.example.test",
      path: "/form?step=2",
    });
  });

  it("restores typed text after a reload on the same URL but never overwrites a non-empty field", async () => {
    document.body.innerHTML = `<label for="answer">Achievements</label><textarea id="answer"></textarea>`;
    const firstWatcher = createQuestionWatcher();
    const firstController = createAnswerMemoryController(firstWatcher);
    const field = document.getElementById("answer") as HTMLTextAreaElement;
    field.value = "Candidate's final edited answer";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.waitFor(() => expect(Object.keys(values)).toHaveLength(1));
    firstController.stop();
    firstWatcher.stop();

    document.body.innerHTML = `<label for="answer">Achievements</label><textarea id="answer"></textarea>`;
    const reloadWatcher = createQuestionWatcher();
    const reloadController = createAnswerMemoryController(reloadWatcher);
    await vi.waitFor(() =>
      expect((document.getElementById("answer") as HTMLTextAreaElement).value).toBe("Candidate's final edited answer"),
    );
    reloadController.stop();
    reloadWatcher.stop();

    document.body.innerHTML = `<label for="answer">Achievements</label><textarea id="answer">ATS draft</textarea>`;
    const filledWatcher = createQuestionWatcher();
    const filledController = createAnswerMemoryController(filledWatcher);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((document.getElementById("answer") as HTMLTextAreaElement).value).toBe("ATS draft");
    filledController.stop();
    filledWatcher.stop();
  });

  it("saves inserted answers and allows the current page memory to be cleared", async () => {
    document.body.innerHTML = `<label for="answer">Supporting statement</label><textarea id="answer"></textarea>`;
    const watcher = createQuestionWatcher();
    const controller = createAnswerMemoryController(watcher);
    const [question] = watcher.getSnapshot();

    expect(insertAnswer(question.id, "Inserted generated text")).toBe(true);
    await vi.waitFor(() =>
      expect(values[answerMemoryStorageKey(question, location.href)]).toBe("Inserted generated text"),
    );
    expect(await controller.clearPage()).toBe(1);
    expect(Object.keys(values).filter((key) => key.startsWith(answerMemoryPagePrefix(location.href)))).toHaveLength(0);
    controller.stop();
    watcher.stop();
  });

  it("clears a field value even when its blur save was still pending", async () => {
    document.body.innerHTML = `<label for="answer">Achievements</label><textarea id="answer"></textarea>`;
    const watcher = createQuestionWatcher();
    const controller = createAnswerMemoryController(watcher);
    const field = document.getElementById("answer") as HTMLTextAreaElement;
    field.value = "Latest edit";
    field.dispatchEvent(new Event("blur"));

    expect(await controller.clearPage()).toBe(1);
    expect(values).toEqual({});
    controller.stop();
    watcher.stop();
  });

  it("never stores or restores restricted declaration answers", async () => {
    document.body.innerHTML = `
      <label for="criminal">Criminal convictions declaration</label>
      <textarea id="criminal"></textarea>
    `;
    const watcher = createQuestionWatcher();
    const controller = createAnswerMemoryController(watcher);
    const field = document.getElementById("criminal") as HTMLTextAreaElement;
    field.value = "Private declaration";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(values).toEqual({});
    controller.stop();
    watcher.stop();
  });
});