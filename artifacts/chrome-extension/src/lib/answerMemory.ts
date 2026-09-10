import {
  getQuestionField,
  setQuestionFieldValue,
  type DetectedQuestion,
  type QuestionWatcher,
} from "./questionDetector";
import {
  ANSWER_LIBRARY_ENABLED_KEY,
  ANSWER_LIBRARY_MAX_ENTRIES,
  ANSWER_LIBRARY_MAX_VALUE_LENGTH,
  ANSWER_LIBRARY_STORAGE_KEY,
  ANSWER_LIBRARY_VERSION,
  findBestRememberedAnswer,
  isRememberedAnswer,
  normalizeRememberedQuestion,
  type AnswerMatchContext,
  type RememberedAnswer,
  type RememberedAnswerCategory,
  type RememberedAnswerScope,
  type RememberedControlType,
} from "./answerLibrary";
import {
  hasUnchangedExtensionValue,
  isExtensionFieldWrite,
  runExtensionFieldWrite,
} from "./fieldWriteProvenance";

const ANSWER_MEMORY_PREFIX = "jobsage_answer_memory_v1";
const TRACKING_QUERY_PARAM =
  /^(utm_.+|gclid|dclid|fbclid|msclkid|mc_cid|mc_eid|ref|source|campaign)$/i;

type LocalStorageArea = Pick<chrome.storage.StorageArea, "get" | "set" | "remove">;

export interface AnswerMemoryController {
  subscribe(listener: () => void): () => void;
  getSnapshot(): AnswerLibrarySnapshot;
  recall(questions?: DetectedQuestion[]): Promise<RecallResult>;
  setEnabled(enabled: boolean): Promise<void>;
  updateAnswer(id: string, value: string): Promise<boolean>;
  deleteAnswer(id: string): Promise<boolean>;
  clearAll(): Promise<number>;
  clearPage(): Promise<number>;
  stop(): void;
}

export interface AnswerLibraryEvent {
  type: "saved" | "restored" | "updated" | "deleted" | "cleared";
  message: string;
  at: number;
}

export interface AnswerLibrarySnapshot {
  ready: boolean;
  enabled: boolean;
  answers: RememberedAnswer[];
  restoredQuestionIds: string[];
  lastEvent: AnswerLibraryEvent | null;
}

export interface RecallResult {
  restored: Array<{ questionId: string; question: string; answerId: string }>;
}

export interface AnswerMemoryOptions {
  getEmployer?: () => string | undefined;
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

function normalizeKey(value: string | undefined): string | undefined {
  const normalized = normalizeRememberedQuestion(value ?? "");
  return normalized || undefined;
}

function atsKey(hostname: string): string {
  const host = hostname.toLowerCase();
  if (host.includes("workday")) return "workday";
  if (host.includes("trac.jobs")) return "trac";
  if (host.includes("nhsjobs") || host.includes("jobs.nhs")) return "nhs-jobs";
  if (host.includes("pinpoint")) return "pinpoint";
  return host;
}

const NEVER_REMEMBER_PATTERN =
  /\b(password|passcode|one[\s-]?time|otp|verification code|security code|national insurance|ni number|ssn|social security|passport|identity document|bank|sort code|account number|tax|payroll|health|medical|disab|criminal|conviction|caution|dbs|disclosure|ethnic|race|religion|sexual orientation|gender|sex|equal opportunit|diversity|right to work|work authori[sz]ation|visa|immigration|sponsor(?:ship)?|consent|declaration|declare|agreement|agree to|attest|terms and conditions|next of kin|emergency contact|reference contact|date of birth|dob)\b/i;
const SAFE_FREE_TEXT_PATTERN =
  /\b(supporting statement|supporting information|personal statement|why .*(?:role|position|job|apply|join)|motivat[a-z]*|experience|skills?|achievements?|strengths?|suitable|interest in|challenge|teamwork|leadership|communication|values|career goals?|what .* bring|tell us about)\b/i;
const SAFE_STRUCTURED_PATTERN =
  /\b(availability|available from|start date|notice period|years? of experience|professional registration(?: status)?|registration status|highest qualification|qualification gained|qualification type|languages?|driving licen[cs]e|willing to relocate|shift pattern|work pattern|preferred hours?)\b/i;

function questionMetadata(question: DetectedQuestion, field: HTMLElement): string {
  return [
    question.question,
    question.signature,
    "name" in field ? String(field.name) : "",
    field.id,
    field.getAttribute("autocomplete") ?? "",
    field.getAttribute("aria-label") ?? "",
    field.getAttribute("data-automation-id") ?? "",
  ].join(" ");
}

function controlType(field: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): RememberedControlType | null {
  if (field.tagName === "TEXTAREA") return "textarea";
  if (field.tagName === "SELECT") return "select";
  const input = field as HTMLInputElement;
  if (input.type === "radio") return "radio";
  if (["text", "number", "date", "month"].includes(input.type)) return "text";
  return null;
}

function eligibility(
  question: DetectedQuestion,
  field: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
): { category: RememberedAnswerCategory; controlType: RememberedControlType } | null {
  if (question.restricted || question.bucket === "confirmation") return null;
  const type = controlType(field);
  if (!type) return null;
  const metadata = questionMetadata(question, field);
  if (NEVER_REMEMBER_PATTERN.test(metadata)) return null;
  if (question.bucket === "generate" && SAFE_FREE_TEXT_PATTERN.test(metadata)) {
    return { category: "safe_free_text", controlType: type };
  }
  if (question.bucket === "structured" && SAFE_STRUCTURED_PATTERN.test(metadata)) {
    return { category: "safe_structured", controlType: type };
  }
  return null;
}

function radioGroup(field: HTMLInputElement): HTMLInputElement[] {
  if (!field.name) return [field];
  const escaped =
    typeof CSS !== "undefined" && CSS.escape
      ? CSS.escape(field.name)
      : field.name.replace(/["\\]/g, "\\$&");
  return Array.from(
    field.ownerDocument.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${escaped}"]`),
  );
}

function boundFields(
  field: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
): Array<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement> {
  return field.tagName === "INPUT" && (field as HTMLInputElement).type === "radio"
    ? radioGroup(field as HTMLInputElement)
    : [field];
}

function optionText(field: HTMLSelectElement): string {
  const option = field.selectedOptions[0];
  return option?.textContent?.replace(/\s+/g, " ").trim() || option?.value.trim() || "";
}

function radioText(field: HTMLInputElement): string {
  const checked = radioGroup(field).find((candidate) => candidate.checked);
  return checked?.closest("label")?.textContent?.replace(/\s+/g, " ").trim()
    || checked?.getAttribute("aria-label")?.trim()
    || checked?.value.trim()
    || "";
}

function fieldValue(
  field: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
): string {
  if (field.tagName === "SELECT") {
    const select = field as HTMLSelectElement;
    if (!select.value.trim()) return "";
    return optionText(select);
  }
  if (field.tagName === "INPUT" && (field as HTMLInputElement).type === "radio") {
    return radioText(field as HTMLInputElement);
  }
  return field.value.trim();
}

function normalizedChoice(value: string): string {
  return normalizeRememberedQuestion(value);
}

function applyRememberedValue(
  questionId: string,
  field: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
): boolean {
  if (fieldValue(field)) return false;
  const ViewEvent = field.ownerDocument.defaultView?.Event ?? Event;
  if (field.tagName === "SELECT") {
    const select = field as HTMLSelectElement;
    const wanted = normalizedChoice(value);
    const option = Array.from(select.options).find((candidate) =>
      [candidate.value, candidate.textContent ?? ""].some((candidateValue) => normalizedChoice(candidateValue) === wanted),
    );
    if (!option) return false;
    return runExtensionFieldWrite(select, () => {
      select.value = option.value;
      select.dispatchEvent(new ViewEvent("input", { bubbles: true }));
      select.dispatchEvent(new ViewEvent("change", { bubbles: true }));
      return true;
    });
  }
  if (field.tagName === "INPUT" && (field as HTMLInputElement).type === "radio") {
    const input = field as HTMLInputElement;
    const wanted = normalizedChoice(value);
    const radio = radioGroup(input).find((candidate) =>
      [
        candidate.value,
        candidate.getAttribute("aria-label") ?? "",
        candidate.closest("label")?.textContent ?? "",
      ].some((candidateValue) => normalizedChoice(candidateValue) === wanted),
    );
    if (!radio) return false;
    return runExtensionFieldWrite(radio, () => {
      radio.checked = true;
      radio.dispatchEvent(new ViewEvent("input", { bubbles: true }));
      radio.dispatchEvent(new ViewEvent("change", { bubbles: true }));
      return true;
    });
  }
  return setQuestionFieldValue(questionId, value, { focus: false });
}

function isMeaningful(value: string, category: RememberedAnswerCategory): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > ANSWER_LIBRARY_MAX_VALUE_LENGTH) return false;
  return category === "safe_free_text" ? trimmed.length >= 8 : true;
}

function uniqueId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `answer-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

function scopeFor(
  question: DetectedQuestion,
  value: string,
  employerKey: string | undefined,
): RememberedAnswerScope {
  if (!employerKey) return "global";
  const normalized = normalizeRememberedQuestion(`${question.question} ${value}`);
  if (
    normalized.includes(employerKey) ||
    /\b(this|your|our) (?:company|organisation|organization|employer|trust)\b/i.test(question.question)
  ) {
    return "employer";
  }
  return "global";
}

function currentContext(urlValue: string, employer: string | undefined): AnswerMatchContext {
  const url = new URL(urlValue);
  return {
    employerKey: normalizeKey(employer),
    atsKey: atsKey(url.hostname),
  };
}

async function loadLibrary(storage: LocalStorageArea): Promise<RememberedAnswer[]> {
  const stored = await storage.get(ANSWER_LIBRARY_STORAGE_KEY);
  const raw = stored[ANSWER_LIBRARY_STORAGE_KEY];
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(isRememberedAnswer)
    .filter((answer) => !answer.expiresAt || answer.expiresAt > Date.now())
    .slice(0, ANSWER_LIBRARY_MAX_ENTRIES);
}

async function loadEnabled(storage: LocalStorageArea): Promise<boolean> {
  const stored = await storage.get(ANSWER_LIBRARY_ENABLED_KEY);
  return stored[ANSWER_LIBRARY_ENABLED_KEY] !== false;
}

async function restoreAnswer(
  question: DetectedQuestion,
  answers: RememberedAnswer[],
  context: AnswerMatchContext,
): Promise<{ answer: RememberedAnswer; question: DetectedQuestion } | null> {
  const field = getQuestionField(question.id);
  if (!field || fieldValue(field)) return null;
  const eligible = eligibility(question, field);
  if (!eligible) return null;
  const match = findBestRememberedAnswer(question, eligible.controlType, answers, context);
  if (!match) return null;
  const currentField = getQuestionField(question.id);
  if (!currentField || fieldValue(currentField)) return null;
  if (!applyRememberedValue(question.id, currentField, match.answer.value)) return null;
  return { answer: match.answer, question };
}

export function createAnswerMemoryController(
  watcher: QuestionWatcher,
  getUrl: () => string = () => window.location.href,
  storage: LocalStorageArea = storageArea(),
  options: AnswerMemoryOptions = {},
): AnswerMemoryController {
  const bindings = new Map<
    string,
    {
      fields: Array<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>;
      input: (event: Event) => void;
      change: (event: Event) => void;
      blur: (event: Event) => void;
      pagePrefix: string;
      timer: ReturnType<typeof setTimeout> | null;
    }
  >();
  const listeners = new Set<() => void>();
  const restoredQuestionIds = new Set<string>();
  let answers: RememberedAnswer[] = [];
  let snapshot: AnswerLibrarySnapshot = {
    ready: false,
    enabled: true,
    answers: [],
    restoredQuestionIds: [],
    lastEvent: null,
  };
  let stopped = false;
  let storageQueue: Promise<void> = Promise.resolve();

  const publish = (event: AnswerLibraryEvent | null = snapshot.lastEvent) => {
    snapshot = {
      ready: snapshot.ready,
      enabled: snapshot.enabled,
      answers: [...answers].sort((a, b) => b.updatedAt - a.updatedAt),
      restoredQuestionIds: Array.from(restoredQuestionIds),
      lastEvent: event,
    };
    for (const listener of listeners) listener();
  };

  const saveLibrary = () => {
    answers = answers
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, ANSWER_LIBRARY_MAX_ENTRIES);
    return storage.set({ [ANSWER_LIBRARY_STORAGE_KEY]: answers });
  };

  const ready = Promise.all([loadLibrary(storage), loadEnabled(storage)])
    .then(([loadedAnswers, enabled]) => {
      answers = loadedAnswers;
      snapshot = { ...snapshot, ready: true, enabled };
      publish();
    })
    .catch(() => {
      snapshot = { ...snapshot, ready: true };
      publish();
    });

  const unbind = (id: string) => {
    const binding = bindings.get(id);
    if (!binding) return;
    if (binding.timer) clearTimeout(binding.timer);
    for (const field of binding.fields) {
      field.removeEventListener("input", binding.input);
      field.removeEventListener("change", binding.change);
      field.removeEventListener("blur", binding.blur);
    }
    bindings.delete(id);
  };

  const persistCandidateValue = (
    question: DetectedQuestion,
    field: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  ) => {
    storageQueue = storageQueue
      .catch(() => {})
      .then(async () => {
        await ready;
        if (!snapshot.enabled || stopped) return;
        const eligible = eligibility(question, field);
        if (!eligible) return;
        const value = fieldValue(field);
        if (!isMeaningful(value, eligible.category)) return;
        const url = new URL(getUrl());
        const context = currentContext(getUrl(), options.getEmployer?.());
        const scope = scopeFor(question, value, context.employerKey);
        const now = Date.now();
        const normalizedQuestion = normalizeRememberedQuestion(question.question);
        const existing = answers.find((answer) =>
          answer.normalizedQuestion === normalizedQuestion &&
          answer.controlType === eligible.controlType &&
          answer.scope === scope &&
          answer.employerKey === (scope === "employer" ? context.employerKey : undefined),
        );
        if (existing?.value === value) return;
        if (existing) {
          existing.value = value;
          existing.questionSignature = question.signature;
          existing.labelVariants = Array.from(new Set([...existing.labelVariants, question.question])).slice(-8);
          existing.updatedAt = now;
          existing.originHost = url.hostname.toLowerCase();
          existing.originPath = `${url.pathname}${url.search}`;
          existing.atsKey = context.atsKey;
        } else {
          answers.push({
            id: uniqueId(),
            version: ANSWER_LIBRARY_VERSION,
            value,
            normalizedQuestion,
            questionSignature: question.signature,
            labelVariants: [question.question],
            controlType: eligible.controlType,
            category: eligible.category,
            source: "candidate",
            scope,
            originHost: url.hostname.toLowerCase(),
            originPath: `${url.pathname}${url.search}`,
            employerKey: scope === "employer" ? context.employerKey : undefined,
            atsKey: context.atsKey,
            createdAt: now,
            updatedAt: now,
            lastUsedAt: null,
            useCount: 0,
            explicitSave: false,
          });
        }
        await saveLibrary();
        publish({ type: "saved", message: "Saved for future applications", at: now });
      });
    void storageQueue.catch(() => {});
  };

  const recallQuestions = async (questions: DetectedQuestion[]): Promise<RecallResult> => {
    await ready;
    if (!snapshot.enabled || stopped) return { restored: [] };
    const context = currentContext(getUrl(), options.getEmployer?.());
    const restored: RecallResult["restored"] = [];
    let libraryChanged = false;
    for (const question of questions) {
      const result = await restoreAnswer(question, answers, context);
      if (!result) continue;
      restoredQuestionIds.add(question.id);
      result.answer.lastUsedAt = Date.now();
      result.answer.useCount += 1;
      restored.push({ questionId: question.id, question: question.question, answerId: result.answer.id });
      libraryChanged = true;
    }
    if (libraryChanged) {
      await saveLibrary();
      publish({
        type: "restored",
        message: restored.length === 1 ? "Saved from a previous application" : `${restored.length} answers restored from previous applications`,
        at: Date.now(),
      });
    }
    return { restored };
  };

  const reconcile = () => {
    if (stopped) return;
    const questions = watcher.getSnapshot();
    const currentIds = new Set(questions.map((question) => question.id));
    for (const id of restoredQuestionIds) {
      if (!currentIds.has(id)) restoredQuestionIds.delete(id);
    }
    for (const id of bindings.keys()) {
      if (!currentIds.has(id)) unbind(id);
    }

    for (const question of questions) {
      const field = getQuestionField(question.id);
      if (!field || !eligibility(question, field)) {
        unbind(question.id);
        continue;
      }
      const urlValue = getUrl();
      const pagePrefix = answerMemoryPagePrefix(urlValue);
      const existing = bindings.get(question.id);
      const fields = boundFields(field);
      if (
        existing?.pagePrefix === pagePrefix &&
        existing.fields.length === fields.length &&
        existing.fields.every((bound, index) => bound === fields[index])
      ) continue;
      if (existing) unbind(question.id);

      const persist = (target: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement) => {
        if (isExtensionFieldWrite(target) || hasUnchangedExtensionValue(target)) return;
        persistCandidateValue(question, field);
      };
      const input = (event: Event) => {
        const binding = bindings.get(question.id);
        const target = event.currentTarget as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
        if (!binding || !target || isExtensionFieldWrite(target)) return;
        if (binding.timer) clearTimeout(binding.timer);
        binding.timer = setTimeout(() => persist(target), 350);
      };
      const change = (event: Event) => {
        const target = event.currentTarget as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
        if (target) persist(target);
      };
      const blur = (event: Event) => {
        const target = event.currentTarget as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
        if (target) persist(target);
      };
      const binding = { fields, input, change, blur, pagePrefix, timer: null };
      bindings.set(question.id, binding);
      for (const currentField of fields) {
        currentField.addEventListener("input", input);
        currentField.addEventListener("change", change);
        currentField.addEventListener("blur", blur);
      }
    }
    void recallQuestions(questions).catch(() => {});
    publish();
  };

  const unsubscribe = watcher.subscribe(reconcile);
  reconcile();

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot() {
      return snapshot;
    },
    recall(questions = watcher.getSnapshot()) {
      return recallQuestions(questions);
    },
    async setEnabled(enabled) {
      await ready;
      snapshot = { ...snapshot, enabled };
      await storage.set({ [ANSWER_LIBRARY_ENABLED_KEY]: enabled });
      publish();
      if (enabled) await recallQuestions(watcher.getSnapshot());
    },
    async updateAnswer(id, value) {
      await ready;
      const answer = answers.find((candidate) => candidate.id === id);
      const trimmed = value.trim();
      if (!answer || !trimmed || trimmed.length > ANSWER_LIBRARY_MAX_VALUE_LENGTH) return false;
      answer.value = trimmed;
      answer.updatedAt = Date.now();
      answer.explicitSave = true;
      await saveLibrary();
      publish({ type: "updated", message: "Remembered answer updated", at: Date.now() });
      return true;
    },
    async deleteAnswer(id) {
      await ready;
      const previousLength = answers.length;
      answers = answers.filter((answer) => answer.id !== id);
      if (answers.length === previousLength) return false;
      await saveLibrary();
      publish({ type: "deleted", message: "Remembered answer deleted", at: Date.now() });
      return true;
    },
    async clearAll() {
      await ready;
      for (const binding of bindings.values()) {
        if (binding.timer) {
          clearTimeout(binding.timer);
          binding.timer = null;
        }
      }
      await storageQueue.catch(() => {});
      const stored = await storage.get(null);
      const oldKeys = Object.keys(stored).filter((key) => key.startsWith(`${ANSWER_MEMORY_PREFIX}::`));
      const count = answers.length + oldKeys.length;
      answers = [];
      restoredQuestionIds.clear();
      await storage.remove([ANSWER_LIBRARY_STORAGE_KEY, ...oldKeys]);
      publish({ type: "cleared", message: "All remembered answers deleted", at: Date.now() });
      return count;
    },
    async clearPage() {
      await ready;
      for (const binding of bindings.values()) {
        if (binding.timer) {
          clearTimeout(binding.timer);
          binding.timer = null;
        }
      }
      await storageQueue.catch(() => {});
      const url = new URL(getUrl());
      const sourcePath = `${url.pathname}${url.search}`;
      const before = answers.length;
      answers = answers.filter((answer) =>
        answer.originHost !== url.hostname.toLowerCase() || answer.originPath !== sourcePath,
      );
      const prefix = answerMemoryPagePrefix(getUrl());
      const stored = await storage.get(null);
      const oldKeys = Object.keys(stored).filter((key) => key.startsWith(prefix));
      if (oldKeys.length > 0) await storage.remove(oldKeys);
      await saveLibrary();
      const count = before - answers.length + oldKeys.length;
      publish({ type: "cleared", message: "Answers saved from this page deleted", at: Date.now() });
      return count;
    },
    stop() {
      stopped = true;
      unsubscribe();
      for (const id of Array.from(bindings.keys())) unbind(id);
    },
  };
}