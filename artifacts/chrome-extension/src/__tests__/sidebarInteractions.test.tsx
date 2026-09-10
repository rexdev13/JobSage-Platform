// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { ASSISTANT_STREAM_TIMEOUT_MS, clampSidebarWidth, Sidebar, sidebarWidthBounds } from "../components/Sidebar";
import type { DetectedQuestion, QuestionWatcher } from "../lib/questionDetector";
import type { PrefillResult } from "../lib/prefill";
import type { AnswerLibrarySnapshot, AnswerMemoryController } from "../lib/answerMemory";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let mount: HTMLDivElement | null = null;

function renderSidebar(
  startOpen = false,
  onClearAnswerMemory?: () => Promise<number>,
  options?: {
    questions?: DetectedQuestion[];
    onPrefill?: (questions: DetectedQuestion[]) => Promise<PrefillResult>;
    answerMemory?: AnswerMemoryController;
  },
) {
  mount = document.createElement("div");
  document.body.append(mount);
  const root = createRoot(mount);
  const snapshot = options?.questions ?? [];
  const questionWatcher: QuestionWatcher | undefined = options?.questions
    ? {
        subscribe: () => () => undefined,
        getSnapshot: () => snapshot,
        stop: () => undefined,
      }
    : undefined;
  act(() => {
    root.render(
      <Sidebar
        startOpen={startOpen}
        jobContext={{
          jobTitle: "Care Assistant",
          companyName: "Example Care",
          jobDescription: "",
          pageUrl: "https://example.test/apply",
        }}
        onLogApplication={async () => undefined}
        onDismiss={() => undefined}
        onClearAnswerMemory={onClearAnswerMemory}
        questionWatcher={questionWatcher}
        onPrefill={options?.onPrefill}
        answerMemory={options?.answerMemory}
      />,
    );
  });
  return root;
}

afterEach(async () => {
  mount?.remove();
  mount = null;
});

describe("Smart Apply panel interactions", () => {
  it("uses a bounded assistant stream timeout", () => {
    expect(ASSISTANT_STREAM_TIMEOUT_MS).toBeGreaterThanOrEqual(45_000);
    expect(ASSISTANT_STREAM_TIMEOUT_MS).toBeLessThanOrEqual(60_000);
  });
  it("opens from a pointer release on the visible launcher", async () => {
    const root = renderSidebar();
    const pill = document.querySelector<HTMLButtonElement>("[aria-label='Open JOBSAGE']");

    await act(async () => {
      pill?.dispatchEvent(new Event("pointerup", { bubbles: true, composed: true }));
    });

    expect(document.querySelector("[role='dialog']")).not.toBeNull();
    await act(async () => root.unmount());
  });

  it("closes on an outside click without hiding the launcher", async () => {
    const root = renderSidebar(true);
    expect(document.querySelector("[role='dialog']")).not.toBeNull();

    await act(async () => {
      document.body.dispatchEvent(new Event("pointerdown", { bubbles: true, composed: true }));
    });

    expect(document.querySelector("[role='dialog']")).toBeNull();
    expect(document.querySelector("[aria-label='Open JOBSAGE']")).not.toBeNull();
    await act(async () => root.unmount());
  });

  it("closes on Escape and supports keyboard width changes", async () => {
    const root = renderSidebar(true);
    const resizer = document.querySelector<HTMLDivElement>("[aria-label='Resize JOBSAGE sidebar']");
    const startingWidth = Number(resizer?.getAttribute("aria-valuenow"));

    await act(async () => {
      resizer?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    });
    expect(Number(resizer?.getAttribute("aria-valuenow"))).toBeGreaterThan(startingWidth);

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(document.querySelector("[role='dialog']")).toBeNull();
    await act(async () => root.unmount());
  });

  it("keeps the sidebar within a usable responsive width range", () => {
    expect(sidebarWidthBounds(1440)).toEqual({ minimum: 320, maximum: 720 });
    expect(sidebarWidthBounds(320)).toEqual({ minimum: 288, maximum: 288 });
    expect(clampSidebarWidth(1000, 500)).toBe(468);
    expect(clampSidebarWidth(100, 500)).toBe(320);
  });

  it("clears remembered answers for the current page without exposing a submit action", async () => {
    let clearCalls = 0;
    const root = renderSidebar(true, async () => {
      clearCalls += 1;
      return 2;
    });

    const clearButton = Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Clear remembered answers for this page"),
    );
    await act(async () => clearButton?.click());

    expect(clearCalls).toBe(1);
    expect(document.body.textContent).toContain("Cleared 2 remembered answers.");
    expect(document.querySelector("form")).toBeNull();
    expect(
      Array.from(document.querySelectorAll("button")).some((button) => /^submit/i.test(button.textContent?.trim() ?? "")),
    ).toBe(false);
    await act(async () => root.unmount());
  });

  it("shows required stars, a legend, and a separate required-missing summary", async () => {
    const questions: DetectedQuestion[] = [
      {
        id: "required-confirmation",
        question: "Right to work declaration",
        restricted: true,
        bucket: "confirmation",
        signature: "required-confirmation",
        required: true,
        requiredSource: "dom",
        requiredConfidence: 1,
        requiredKnown: true,
      },
      {
        id: "unknown",
        question: "Portfolio URL",
        restricted: false,
        bucket: "structured",
        signature: "unknown",
        required: false,
        requiredSource: "unknown",
        requiredConfidence: 0,
        requiredKnown: false,
      },
    ];
    const root = renderSidebar(true, undefined, {
      questions,
      onPrefill: async () => ({
        filled: [],
        missing: ["portfolio URL"],
        requiredMissing: ["Right to work declaration"],
        skipped: [],
        fieldResults: {},
      }),
    });

    expect(document.body.textContent).toContain("* Required");
    const requiredButton = Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Right to work declaration"),
    );
    const unknownButton = Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Portfolio URL"),
    );
    expect(requiredButton?.textContent).toContain("*");
    expect(requiredButton?.textContent).toContain("Required — complete this yourself");
    expect(unknownButton?.textContent).not.toContain("*");
    expect(unknownButton?.textContent).not.toContain("Optional");

    const prefillButton = Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Prefill my details"),
    );
    await act(async () => prefillButton?.click());
    expect(document.body.textContent).toContain("1 required field still needs your attention.");
    expect(document.body.textContent).toContain("1 field was left blank because no exact saved detail was available.");

    await act(async () => root.unmount());
  });

  it("shows memory provenance and lets candidates toggle, edit, delete, and clear the library", async () => {
    const question: DetectedQuestion = {
      id: "remembered",
      question: "Why do you want this role?",
      restricted: false,
      bucket: "generate",
      signature: "remembered",
      required: false,
      requiredSource: "unknown",
      requiredConfidence: 0,
      requiredKnown: false,
    };
    let snapshot: AnswerLibrarySnapshot = {
      ready: true,
      enabled: true,
      answers: [{
        id: "answer-1",
        version: 1,
        value: "My saved motivation answer",
        normalizedQuestion: "why do you want this role",
        questionSignature: "remembered",
        labelVariants: ["Why do you want this role?"],
        controlType: "textarea",
        category: "safe_free_text",
        source: "candidate",
        scope: "global",
        createdAt: 1,
        updatedAt: 2,
        lastUsedAt: 3,
        useCount: 1,
        explicitSave: false,
      }],
      restoredQuestionIds: ["remembered"],
      lastEvent: null,
    };
    const listeners = new Set<() => void>();
    const calls = { enabled: [] as boolean[], updated: [] as string[], deleted: 0, cleared: 0 };
    const publish = () => listeners.forEach((listener) => listener());
    const answerMemory: AnswerMemoryController = {
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      getSnapshot: () => snapshot,
      recall: async () => ({ restored: [] }),
      async setEnabled(enabled) {
        calls.enabled.push(enabled);
        snapshot = { ...snapshot, enabled };
        publish();
      },
      async updateAnswer(_id, value) {
        calls.updated.push(value);
        snapshot = {
          ...snapshot,
          answers: snapshot.answers.map((answer) => ({ ...answer, value })),
        };
        publish();
        return true;
      },
      async deleteAnswer() {
        calls.deleted += 1;
        snapshot = { ...snapshot, answers: [] };
        publish();
        return true;
      },
      async clearAll() {
        calls.cleared += 1;
        snapshot = { ...snapshot, answers: [] };
        publish();
        return 1;
      },
      clearPage: async () => 0,
      stop: () => undefined,
    };
    const root = renderSidebar(true, undefined, {
      questions: [question],
      answerMemory,
    });

    expect(document.body.textContent).toContain("From previous application");
    const toggle = document.querySelector<HTMLButtonElement>("[role='switch']");
    await act(async () => toggle?.click());
    expect(calls.enabled).toEqual([false]);

    const manage = Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Manage remembered answers"),
    );
    await act(async () => manage?.click());
    expect(document.body.textContent).toContain("My saved motivation answer");

    const edit = Array.from(document.querySelectorAll("button")).find((button) => button.textContent === "Edit");
    await act(async () => edit?.click());
    const editor = document.querySelector<HTMLTextAreaElement>("[aria-label^='Edit remembered answer']");
    await act(async () => {
      if (editor) {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
        setter?.call(editor, "Updated saved answer");
        editor.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    const save = Array.from(document.querySelectorAll("button")).find((button) => button.textContent === "Save");
    await act(async () => save?.click());
    expect(calls.updated).toEqual(["Updated saved answer"]);

    const deleteButton = Array.from(document.querySelectorAll("button")).find((button) => button.textContent === "Delete");
    await act(async () => deleteButton?.click());
    expect(calls.deleted).toBe(1);

    await act(async () => root.unmount());
  });
});