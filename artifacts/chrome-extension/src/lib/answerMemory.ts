import {
  getQuestionField,
  setQuestionFieldValue,
  type DetectedQuestion,
  type QuestionWatcher,
} from "./questionDetector";

const ANSWER_MEMORY_PREFIX = "jobsage_answer_memory_v1";
const TRACKING_QUERY_PARAM =
  /^(utm_.+|gclid|dclid|fbclid|msclkid|mc_cid|mc_eid|ref|source|campaign)$/i;

type LocalStorageArea = Pick<chrome.storage.StorageArea, "get" | "set" | "remove">;

export interface AnswerMemoryController {
  clearPage(): Promise<number>;
  stop(): void;
}

function normalizePart(value: string): string {
  return encodeURIComponent(value.trim().toLowerCase());
}

export function normalizedFormPath(urlValue: string): { hostname: string; path: string } {
  const url = new URL(urlValue);
  const retained = Array.from(url.searchParams.entries())
    .filter(([key]) => !TRACKING_QUERY_PARAM.test(key))
    .sort(([aKey, aValue], [bKey, bValue]) =>
      aKey === bKey ? aValue.localeCompare(bValue) : aKey.localeCompare(bKey),
    );
  const query = new URLSearchParams(retained).toString();
  return {
    hostname: url.hostname.toLowerCase(),
    path: `${url.pathname || "/"}${query ? `?${query}` : ""}`,
  };
}

export function answerMemoryPagePrefix(urlValue: string): string {
  const { hostname, path } = normalizedFormPath(urlValue);
  return `${ANSWER_MEMORY_PREFIX}::${normalizePart(hostname)}::${encodeURIComponent(path)}::`;
}

export function answerMemoryStorageKey(question: DetectedQuestion, urlValue: string): string {
  return `${answerMemoryPagePrefix(urlValue)}${encodeURIComponent(question.signature)}`;
}

function storageArea(): LocalStorageArea {
  return chrome.storage.local;
}

async function saveAnswer(
  question: DetectedQuestion,
  value: string,
  urlValue: string,
  storage: LocalStorageArea,
): Promise<void> {
  const key = answerMemoryStorageKey(question, urlValue);
  if (value.trim()) {
    await storage.set({ [key]: value });
  } else {
    await storage.remove(key);
  }
}

async function restoreAnswer(
  question: DetectedQuestion,
  urlValue: string,
  storage: LocalStorageArea,
): Promise<void> {
  if (question.restricted) return;
  const field = getQuestionField(question.id);
  if (!field || field.value.trim()) return;

  const key = answerMemoryStorageKey(question, urlValue);
  const stored = await storage.get(key);
  const value = stored[key];
  if (typeof value !== "string" || !value.trim()) return;

  // Re-check after the asynchronous read so a candidate's typing always wins.
  const currentField = getQuestionField(question.id);
  if (!currentField || currentField.value.trim()) return;
  setQuestionFieldValue(question.id, value, { focus: false });
}

export function createAnswerMemoryController(
  watcher: QuestionWatcher,
  getUrl: () => string = () => window.location.href,
  storage: LocalStorageArea = storageArea(),
): AnswerMemoryController {
  const bindings = new Map<
    string,
    {
      field: HTMLTextAreaElement | HTMLInputElement;
      input: () => void;
      blur: () => void;
      pagePrefix: string;
    }
  >();
  let stopped = false;
  let storageQueue: Promise<void> = Promise.resolve();

  const unbind = (id: string) => {
    const binding = bindings.get(id);
    if (!binding) return;
    binding.field.removeEventListener("input", binding.input);
    binding.field.removeEventListener("blur", binding.blur);
    bindings.delete(id);
  };

  const reconcile = () => {
    if (stopped) return;
    const questions = watcher.getSnapshot();
    const currentIds = new Set(questions.map((question) => question.id));
    for (const id of bindings.keys()) {
      if (!currentIds.has(id)) unbind(id);
    }

    for (const question of questions) {
      if (question.restricted) {
        unbind(question.id);
        continue;
      }
      const field = getQuestionField(question.id);
      if (!field) continue;
      if (!(field.tagName === "TEXTAREA" || (field.tagName === "INPUT" && (field as HTMLInputElement).type !== "radio"))) {
        unbind(question.id);
        continue;
      }
      const memoryField = field as HTMLTextAreaElement | HTMLInputElement;
      const urlValue = getUrl();
      const pagePrefix = answerMemoryPagePrefix(urlValue);
      const existing = bindings.get(question.id);
      if (existing?.field === memoryField && existing.pagePrefix === pagePrefix) continue;
      if (existing) unbind(question.id);

      const persist = () => {
        storageQueue = storageQueue
          .catch(() => {
            // Keep later candidate edits writable after a transient storage error.
          })
          .then(() => saveAnswer(question, memoryField.value, getUrl(), storage));
        void storageQueue.catch(() => {
          // The extension may be reloaded while an employer form remains open.
        });
      };
      memoryField.addEventListener("input", persist);
      memoryField.addEventListener("blur", persist);
      bindings.set(question.id, { field: memoryField, input: persist, blur: persist, pagePrefix });
      void restoreAnswer(question, urlValue, storage).catch(() => {
        // Storage may be unavailable during an extension reload.
      });
    }
  };

  const unsubscribe = watcher.subscribe(reconcile);
  reconcile();

  return {
    async clearPage() {
      // A blur can fire just before the sidebar button click. Let that save
      // settle first so the clear action cannot be undone by an older write.
      await storageQueue.catch(() => {});
      const prefix = answerMemoryPagePrefix(getUrl());
      const stored = await storage.get(null);
      const keys = Object.keys(stored).filter((key) => key.startsWith(prefix));
      if (keys.length > 0) await storage.remove(keys);
      return keys.length;
    },
    stop() {
      stopped = true;
      unsubscribe();
      for (const id of Array.from(bindings.keys())) unbind(id);
    },
  };
}