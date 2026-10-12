import {
  ANSWER_LIBRARY_VERSION,
  isRememberedAnswer,
  normalizeRememberedQuestion,
} from "@workspace/smart-apply-core/answerLibrary";
import { NEVER_REMEMBER_PATTERN, SAFE_FREE_TEXT_PATTERN } from "@workspace/smart-apply-core/memoryPolicy";
import type { DetectedQuestion, RememberedAnswer } from "@workspace/smart-apply-core";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

export const MAX_REMEMBERED_VALUE = 1500;
const MAX_ENTRIES = 40;
const options = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

/** Where an answer's current text came from. Only candidate-authored text may be remembered. */
export type AnswerSource = "typed" | "edited" | "generated" | "restored" | "library";

const SENSITIVE = /@|\b\d{5,}\b|\b[A-CEGHJ-PR-TW-Z]{2}\s?\d{2}\s?\d{2}\s?\d{2}\s?[A-D]\b|passport|password|national insurance|date of birth|salary/i;

export function isRememberEligible(q: Pick<DetectedQuestion, "restricted" | "bucket" | "question">, value: string, source: AnswerSource): boolean {
  if (source !== "typed" && source !== "edited") return false;
  if (q.restricted || q.bucket !== "generate") return false;
  const v = value.trim();
  if (!v || v.length > MAX_REMEMBERED_VALUE) return false;
  return SAFE_FREE_TEXT_PATTERN.test(q.question)
    && !NEVER_REMEMBER_PATTERN.test(q.question)
    && !SENSITIVE.test(v) && !SENSITIVE.test(q.question);
}

async function scope(userId: string): Promise<string> {
  const h = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `jobsage-answer-library:${userId}`);
  return `jsal_${h.slice(0, 32)}`;
}

const available = () => Platform.OS !== "web";

async function readIndex(prefix: string): Promise<string[]> {
  const raw = await SecureStore.getItemAsync(`${prefix}_index`, options);
  if (!raw) return [];
  try {
    const ids = JSON.parse(raw);
    return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string" && /^[a-f0-9]{16}$/.test(x)) : [];
  } catch {
    return [];
  }
}

export async function loadLibrary(userId: string): Promise<RememberedAnswer[]> {
  if (!available()) return [];
  const prefix = await scope(userId);
  const ids = await readIndex(prefix);
  const out: RememberedAnswer[] = [];
  for (const id of ids) {
    const raw = await SecureStore.getItemAsync(`${prefix}_${id}`, options);
    if (!raw) continue;
    try {
      const v = JSON.parse(raw);
      if (isRememberedAnswer(v) && v.value.length <= MAX_REMEMBERED_VALUE) out.push(v);
    } catch {
      // skip corrupt entry
    }
  }
  return out;
}

export async function rememberAnswer(userId: string, q: DetectedQuestion, value: string, host: string): Promise<RememberedAnswer> {
  if (!available()) throw new Error("Answer memory is only available in the mobile app.");
  const prefix = await scope(userId);
  const ids = await readIndex(prefix);
  const normalized = normalizeRememberedQuestion(q.question);
  const id = (await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${normalized}|${host}`)).slice(0, 16);
  const now = Date.now();
  const entry: RememberedAnswer = {
    id,
    version: ANSWER_LIBRARY_VERSION,
    value: value.trim().slice(0, MAX_REMEMBERED_VALUE),
    normalizedQuestion: normalized.slice(0, 300),
    questionSignature: q.signature.slice(0, 200),
    labelVariants: [q.question.slice(0, 200)],
    controlType: "textarea",
    category: "safe_free_text",
    source: "candidate",
    scope: "global",
    originHost: host,
    createdAt: now,
    updatedAt: now,
    lastUsedAt: null,
    useCount: 0,
    explicitSave: true,
  };
  await SecureStore.setItemAsync(`${prefix}_${id}`, JSON.stringify(entry), options);
  const next = [id, ...ids.filter((x) => x !== id)];
  for (const stale of next.slice(MAX_ENTRIES)) await SecureStore.deleteItemAsync(`${prefix}_${stale}`, options);
  await SecureStore.setItemAsync(`${prefix}_index`, JSON.stringify(next.slice(0, MAX_ENTRIES)), options);
  return entry;
}

export async function forgetAnswers(userId: string, ids: string[]): Promise<void> {
  if (!available()) return;
  const prefix = await scope(userId);
  const index = await readIndex(prefix);
  for (const id of ids) await SecureStore.deleteItemAsync(`${prefix}_${id}`, options);
  await SecureStore.setItemAsync(`${prefix}_index`, JSON.stringify(index.filter((x) => !ids.includes(x))), options);
}
