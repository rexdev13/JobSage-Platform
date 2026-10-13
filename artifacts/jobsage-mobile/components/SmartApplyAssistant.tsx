import { Feather } from "@expo/vector-icons";
import { AIContentReport } from "@/components/AIContentReport";
import {
  deleteSmartApplyDraft,
  generateNativeSmartApplyAnswer,
  getDownloadSmartApplyCurrentCvUrl,
  getGenerateNativeSmartApplyAnswerUrl,
  getNativeStructuredPrefill,
  getSmartApplyCandidatePrefill,
  getSmartApplyDraft,
  saveSmartApplyDraft,
} from "@workspace/api-client-react";
import type { GenerateNativeSmartApplyAnswerBody, MobileApplicationContext } from "@workspace/api-client-react";
import { fetch as expoFetch } from "expo/fetch";
import { File } from "expo-file-system";
import { findBestRememberedAnswer } from "@workspace/smart-apply-core/answerLibrary";
import type { PrefillResult, RememberedAnswer } from "@workspace/smart-apply-core";
import * as Clipboard from "expo-clipboard";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";

import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { DownloadError, downloadAndShare } from "@/lib/native-download";
import { WORKSPACE_ORIGIN } from "@/lib/workspace-config";
import {
  AnswerSource,
  MAX_REMEMBERED_VALUE,
  forgetAnswers,
  isRememberEligible,
  loadLibrary,
  rememberAnswer,
} from "@/lib/smart-apply/answer-library";
import {
  PageCommand,
  PageMessage,
  ScanQuestion,
  ScanSnapshot,
  canDraft,
  charLimit,
  createSseStreamParser,
  limitProblem,
  parseSseAnswer,
  wordCount,
} from "@/lib/smart-apply/protocol";

interface Draft {
  value: string;
  source: AnswerSource;
  reviewed: boolean;
  signature: string;
}

export interface SmartApplyAssistantProps {
  context: MobileApplicationContext;
  scan: ScanSnapshot | null;
  /** Latest non-scan page event with a sequence number so repeats are observed. */
  lastEvent: { seq: number; message: PageMessage } | null;
  host: string;
  bottomInset: number;
  send: (command: PageCommand) => void;
  /** Native bearer token, only sent to the fixed first-party generate endpoint. */
  token: string | null;
  onClose: () => void;
}

type Tab = "questions" | "details" | "memory";

export function SmartApplyAssistant({ context, scan, lastEvent, host, bottomInset, send, token, onClose }: SmartApplyAssistantProps) {
  const colors = useColors();
  const s = styles(colors);
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("questions");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [remember, setRemember] = useState(false);
  const [generating, setGenerating] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [prefillResult, setPrefillResult] = useState<PrefillResult | null>(null);
  const [prefilling, setPrefilling] = useState(false);
  const [structured, setStructured] = useState<Array<{ id: string; label: string; value: string; pick: boolean }> | null>(null);
  const [structuredReviewed, setStructuredReviewed] = useState(false);
  const [structuredBusy, setStructuredBusy] = useState(false);
  const [library, setLibrary] = useState<RememberedAnswer[]>([]);
  const [draftBusy, setDraftBusy] = useState<"load" | "save" | "delete" | null>(null);
  const [restoredSignatures, setRestoredSignatures] = useState<Record<string, string>>({});
  const [cvState, setCvState] = useState<"idle" | "working" | "sent" | "attached" | "failed">("idle");
  const [cvMessage, setCvMessage] = useState<string | null>(null);
  const roleId = context.roleId > 0 ? context.roleId : null;

  const questions = scan?.questions ?? [];
  const selected = questions.find((q) => q.id === selectedId) ?? null;
  const storedDraft = selected ? drafts[selected.id] : undefined;
  const draft = storedDraft?.signature === selected?.signature ? storedDraft : undefined;
  const answeredCount = questions.filter((q) => q.answered).length;

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; abortRef.current?.abort(); };
  }, []);

  useEffect(() => {
    if (cvState !== "sent") return;
    const timer = setTimeout(() => {
      setCvState("failed");
      setCvMessage("The form did not confirm attachment. Check the employer page, or use My CV and its file picker. Nothing was submitted.");
    }, 15000);
    return () => clearTimeout(timer);
  }, [cvState]);

  useEffect(() => {
    if (!user?.id) return;
    loadLibrary(user.id).then(setLibrary).catch(() => setLibrary([]));
  }, [user?.id]);

  // Restore server draft once; restored answers are ALWAYS unreviewed.
  useEffect(() => {
    if (!roleId) return;
    let alive = true;
    setDraftBusy("load");
    getSmartApplyDraft(roleId)
      .then((res) => alive && res.answers && setRestoredSignatures(res.answers))
      .catch(() => undefined)
      .finally(() => alive && setDraftBusy(null));
    return () => {
      alive = false;
    };
  }, [roleId]);

  useEffect(() => {
    if (!scan) return;
    setDrafts((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const q of scan.questions) {
        const restored = restoredSignatures[q.signature];
        if (restored && !next[q.id] && canDraft(q)) {
          next[q.id] = { value: restored.slice(0, charLimit(q)), source: "restored", reviewed: false, signature: q.signature };
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    if (selectedId && !scan.questions.some((q) => q.id === selectedId)) setSelectedId(null);
  }, [scan, restoredSignatures, selectedId]);

  useEffect(() => {
    if (!lastEvent) return;
    const m = lastEvent.message;
    if (m.type === "prefill") {
      setPrefilling(false);
      setPrefillResult(m.result);
    } else if (m.type === "structured") {
      setStructuredBusy(false);
      setStructured(null);
      setStructuredReviewed(false);
      setNotice({ tone: "ok", text: `${m.filled} structured ${m.filled === 1 ? "field" : "fields"} filled. Check each one on the page.` });
    } else if (m.type === "inserted") {
      setNotice({ tone: "ok", text: "Answer inserted. Review it on the page before you continue." });
    } else if (m.type === "cleared") {
      setNotice({ tone: "ok", text: "Cleared answers that JOBSAGE wrote and you had not changed." });
    } else if (m.type === "cv-attached") {
      setCvState("attached");
      setCvMessage(`Attached ${m.filename}. Check the employer's page shows your CV before continuing.`);
    } else if (m.type === "error") {
      if (cvState === "sent") {
        setCvState("failed");
        setCvMessage(`${m.message} Use My CV to save or share your CV, then choose it with the employer's file picker.`);
      }
      setPrefilling(false);
      setStructuredBusy(false);
      setNotice({ tone: "error", text: m.message });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastEvent]);

  const updateDraft = (id: string, value: string) => {
    setDrafts((prev) => {
      const old = prev[id];
      const source: AnswerSource = !old || old.source === "typed" ? "typed" : "edited";
      return { ...prev, [id]: { value, source, reviewed: false, signature: questions.find(q => q.id === id)?.signature ?? "" } };
    });
  };

  const select = (id: string) => {
    setSelectedId(id);
    setRemember(false);
    setNotice(null);
    setDrafts((prev) => (prev[id] ? { ...prev, [id]: { ...prev[id], reviewed: false } } : prev));
  };

  const nextUnanswered = () => {
    const start = selected ? questions.indexOf(selected) + 1 : 0;
    const order = [...questions.slice(start), ...questions.slice(0, start)];
    const next = order.find((q) => !q.answered && q.id !== selectedId);
    if (next) select(next.id);
    else setNotice({ tone: "ok", text: "No unanswered questions were detected on this page." });
  };

  const generate = async (q: ScanQuestion) => {
    if (!canDraft(q)) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setGenerating(q.id);
    setNotice(null);
    setRemember(false);
    const payload: GenerateNativeSmartApplyAnswerBody = {
      ...(roleId ? { roleId } : {}),
      message: "Draft an answer to this application question using my JOBSAGE profile.",
      questionId: q.id.slice(0, 200),
      questionText: q.question.slice(0, 3000),
      jobTitle: context.jobTitle?.slice(0, 500) ?? undefined,
      employer: context.companyName?.slice(0, 500) ?? undefined,
      jobDescription: scan?.context.jobDescription.slice(0, 12000) || undefined,
      wordLimit: q.wordLimit,
      maxLength: charLimit(q),
    };
    const limit = charLimit(q);
    // Only this controller may write into the draft; user editing is disabled while generating.
    const write = (text: string) => {
      if (!alive.current || controller.signal.aborted || abortRef.current !== controller) return;
      setDrafts((prev) => ({ ...prev, [q.id]: { value: text.slice(0, limit), source: "generated", reviewed: false, signature: q.signature } }));
    };
    let text = "";
    try {
      const path = getGenerateNativeSmartApplyAnswerUrl();
      const url = WORKSPACE_ORIGIN && path.startsWith("/") && !path.startsWith("//") ? `${WORKSPACE_ORIGIN}${path}` : null;
      let streamed = false;
      if (url) {
        const res = await expoFetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
          redirect: "error",
          credentials: "omit",
        });
        if (!res.ok) throw new Error(res.status === 401 ? "Please sign in again to generate drafts." : "The draft could not be generated.");
        const reader = res.body?.getReader?.();
        if (reader) {
          streamed = true;
          const decoder = new TextDecoder();
          let error: string | null = null;
          const parser = createSseStreamParser((f) => {
            if (f.error) error = f.error;
            if (f.text) {
              text += f.text;
              write(text);
            }
          });
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            if (controller.signal.aborted) break;
            parser.push(decoder.decode(value, { stream: true }));
            if (error) break;
          }
          parser.push(decoder.decode());
          parser.end();
          if (error) throw new Error(error);
        } else {
          // No reader: parse the already-received whole body; no second request.
          streamed = true;
          const parsed = parseSseAnswer(await res.text());
          if (parsed.error) throw new Error(parsed.error);
          text = parsed.text;
          write(text);
        }
      }
      if (!streamed) {
        const body = await generateNativeSmartApplyAnswer(payload, { signal: controller.signal, responseType: "text" } as RequestInit);
        const parsed = parseSseAnswer(typeof body === "string" ? body : "");
        if (parsed.error) throw new Error(parsed.error);
        text = parsed.text;
        write(text);
      }
      if (!controller.signal.aborted && !text.trim()) throw new Error("No draft was returned. Please try again.");
      if (!controller.signal.aborted) write(text.trim());
    } catch (e) {
      if (controller.signal.aborted) {
        if (text) setNotice({ tone: "ok", text: "Generation cancelled. The partial draft is unreviewed." });
      } else {
        setNotice({
          tone: "error",
          text: `${e instanceof Error && e.message ? e.message : "The draft could not be generated."}${text ? " The partial draft is kept and unreviewed." : ""}`,
        });
      }
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setGenerating(null);
      }
    }
  };

  const attachCv = () => {
    if (!scan?.applicationPage) return;
    Alert.alert(
      "Share your CV with this employer?",
      `Your current JOBSAGE CV will be added to the file field on ${host || "this page"}${context.companyName ? ` for ${context.companyName}` : ""}. Nothing is submitted.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Attach CV",
          onPress: async () => {
            setCvState("working");
            setCvMessage(null);
            try {
              const dl = await downloadAndShare({ url: getDownloadSmartApplyCurrentCvUrl(), token, share: false, fallbackName: "CV.pdf" });
              if (dl.mimeType !== "application/pdf") throw new DownloadError("Your current CV is not a PDF, so it cannot be attached automatically.");
              const file = new File(dl.uri);
              if (!file.exists || !file.size || file.size > 10 * 1024 * 1024) throw new DownloadError("Your CV is larger than 10 MB, so it cannot be attached automatically.");
              const base64 = await file.base64();
              if (!alive.current) return;
              send({ type: "attach-cv", base64, filename: dl.filename.slice(0, 200) });
              setCvState("sent");
              setCvMessage("Sent to the page. Waiting for the employer form to confirm...");
            } catch (e) {
              setCvState("failed");
              setCvMessage(`${e instanceof DownloadError ? e.message : "Your CV could not be prepared."} Use My CV to save or share it, then choose it with the employer's file picker.`);
            }
          },
        },
      ],
    );
  };

  const insert = async (q: ScanQuestion, d: Draft) => {
    const live = scan?.questions.find((x) => x.id === q.id);
    if (!live || !canDraft(live) || live.signature !== q.signature || live.signature !== d.signature) {
      setNotice({ tone: "error", text: "This field changed or must be completed manually. Refresh the scan." });
      return;
    }
    const problem = limitProblem(live, d.value);
    if (problem || !d.reviewed || !d.value.trim()) return;
    send({ type: "insert", questionId: live.id, value: d.value });
    if (remember && user?.id && isRememberEligible(live, d.value, d.source)) {
      try {
        const entry = await rememberAnswer(user.id, live, d.value, host);
        setLibrary((prev) => [entry, ...prev.filter((x) => x.id !== entry.id)]);
      } catch {
        setNotice({ tone: "error", text: "Inserted, but the answer could not be remembered on this device." });
      }
    }
  };

  const runPrefill = async () => {
    setPrefilling(true);
    setNotice(null);
    try {
      const p = await getSmartApplyCandidatePrefill();
      if (!alive.current) return;
      send({
        type: "prefill",
        profile: { firstName: p.firstName, lastName: p.lastName, fullName: p.fullName, email: p.email },
        jobTitle: context.jobTitle ?? undefined,
      });
    } catch {
      setPrefilling(false);
      setNotice({ tone: "error", text: "Your details could not be loaded. Please try again." });
    }
  };

  const loadStructured = async () => {
    if (!scan?.structuredFields.length) return;
    setStructuredBusy(true);
    setStructuredReviewed(false);
    try {
      const res = await getNativeStructuredPrefill({ fields: scan.structuredFields });
      const byId = new Map(scan.structuredFields.map((f) => [f.id, f]));
      const rows = res.values
        .filter((v) => byId.has(v.id) && typeof v.value === "string" && v.value.length <= 8000)
        .map((v) => ({ id: v.id, label: byId.get(v.id)!.label, value: v.value, pick: true }));
      setStructured(rows);
      if (!rows.length) setNotice({ tone: "ok", text: "Your profile has no matching answers for these fields." });
    } catch {
      setNotice({ tone: "error", text: "Suggestions could not be loaded." });
    } finally {
      setStructuredBusy(false);
    }
  };

  const saveDraft = async () => {
    if (!roleId || !scan) return;
    const answers: Record<string, string> = {};
    for (const q of scan.questions) {
      const d = drafts[q.id];
      if (d?.value.trim() && d.signature === q.signature && canDraft(q)) answers[q.signature] = d.value.slice(0, charLimit(q));
    }
    setDraftBusy("save");
    try {
      await saveSmartApplyDraft(roleId, { answers });
      setNotice({ tone: "ok", text: "Draft saved to your JOBSAGE account." });
    } catch {
      setNotice({ tone: "error", text: "The draft could not be saved." });
    } finally {
      setDraftBusy(null);
    }
  };

  const deleteDraft = () => {
    if (!roleId) return;
    Alert.alert("Delete saved draft?", "This removes the answers saved for this vacancy from your account.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          setDraftBusy("delete");
          try {
            await deleteSmartApplyDraft(roleId);
            setRestoredSignatures({});
            setNotice({ tone: "ok", text: "Saved draft deleted." });
          } catch {
            setNotice({ tone: "error", text: "The draft could not be deleted." });
          } finally {
            setDraftBusy(null);
          }
        },
      },
    ]);
  };

  const clearPage = () => {
    Alert.alert("Clear page memory?", "Removes unchanged answers JOBSAGE wrote on this page and forgets unsaved drafts here.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Clear",
        style: "destructive",
        onPress: () => {
          abortRef.current?.abort();
          setDrafts({});
          setPrefillResult(null);
          setStructured(null);
          send({ type: "clear-page" });
        },
      },
    ]);
  };

  const match = useMemo(() => {
    if (!selected || !canDraft(selected) || draft?.value) return null;
    return findBestRememberedAnswer(selected, "textarea", library, {});
  }, [selected, draft?.value, library]);

  const siteMemory = library.filter((e) => e.originHost === host);

  const manualMessage = scan
    ? !questions.length
      ? scan.applicationPage
        ? "An application form was detected, but no questions JOBSAGE can help with were recognised. Complete this step manually."
        : "No application form was detected on this page. Continue on the employer's site and refresh the scan on the form step."
      : null
    : null;

  const badge = (q: ScanQuestion) => {
    if (q.restricted) return { text: "Manual - declaration", color: colors.destructive };
    if (q.bucket === "confirmation") return { text: "Manual - personal confirmation", color: colors.destructive };
    if (q.bucket === "structured") return { text: "Structured field", color: colors.mutedForeground };
    return { text: "Draft available", color: colors.accent };
  };

  const renderEditor = (q: ScanQuestion) => {
    const value = draft?.value ?? "";
    const problem = value ? limitProblem(q, value) : null;
    const eligible = draft ? isRememberEligible(q, value, draft.source) : false;
    const draftable = canDraft(q);
    return (
      <View style={s.editor}>
        <Pressable onPress={() => setSelectedId(null)} accessibilityRole="button" style={s.backRow}>
          <Feather name="chevron-left" size={18} color={colors.accent} />
          <Text style={s.link}>All questions</Text>
        </Pressable>
        <Text style={s.qText} accessibilityRole="header">{q.question}</Text>
        <View style={s.chips}>
          <Text style={[s.chip, { color: badge(q).color }]}>{badge(q).text}</Text>
          <Text style={s.chip}>{q.requiredKnown ? (q.required ? "Required" : "Not marked required") : "Requiredness unknown"}</Text>
          <Text style={s.chip}>{q.answered ? "Has a value on page" : "Empty on page"}</Text>
        </View>
        {!draftable ? (
          <Text style={s.muted}>
            {q.bucket === "structured"
              ? "Use Details > Suggest structured answers, or complete this field on the page."
              : "JOBSAGE will not draft or fill this field. Answer it yourself on the employer's page."}
          </Text>
        ) : (
          <>
            {match ? (
              <Pressable
                style={s.suggest}
                accessibilityRole="button"
                onPress={() => setDrafts((p) => ({ ...p, [q.id]: { value: match.answer.value, source: "library", reviewed: false, signature: q.signature } }))}
              >
                <Feather name="bookmark" size={14} color={colors.accent} />
                <Text style={s.suggestText} numberOfLines={2}>Use your remembered answer: {match.answer.value}</Text>
              </Pressable>
            ) : null}
            {draft?.source === "restored" ? <Text style={s.muted}>Restored from your saved draft. Review before inserting.</Text> : null}
            {draft?.source === "generated" ? <Text style={s.muted}>AI draft from your JOBSAGE profile. Check every fact before inserting.</Text> : null}
            <TextInput
              value={value}
              onChangeText={(t) => updateDraft(q.id, t.slice(0, 20000))}
              multiline
              editable={generating !== q.id}
              placeholder="Write your answer"
              placeholderTextColor={colors.mutedForeground}
              style={s.input}
              accessibilityLabel="Answer"
              textAlignVertical="top"
            />
            <View style={s.countRow}>
              <Text style={[s.count, problem ? { color: colors.destructive } : null]}>
                {value.length}/{charLimit(q)} characters{q.wordLimit ? ` - ${wordCount(value)}/${q.wordLimit} words` : ""}
              </Text>
              {problem ? <Text style={[s.count, { color: colors.destructive }]}>{problem}</Text> : null}
            </View>
            <View style={s.row}>
              {generating === q.id ? (
                <Pressable style={s.btn} onPress={() => abortRef.current?.abort()} accessibilityRole="button">
                  <ActivityIndicator size="small" color={colors.foreground} />
                  <Text style={s.btnText}>Cancel</Text>
                </Pressable>
              ) : (
                <Pressable style={s.btn} onPress={() => generate(q)} disabled={generating !== null} accessibilityRole="button">
                  <Feather name="edit-3" size={15} color={colors.foreground} />
                  <Text style={s.btnText}>Generate</Text>
                </Pressable>
              )}
              <Pressable
                style={s.btn}
                disabled={!value}
                accessibilityRole="button"
                onPress={async () => {
                  await Clipboard.setStringAsync(value);
                  setNotice({ tone: "ok", text: "Copied." });
                }}
              >
                <Feather name="copy" size={15} color={colors.foreground} />
                <Text style={s.btnText}>Copy</Text>
              </Pressable>
              <Pressable
                style={s.btn}
                accessibilityRole="button"
                disabled={generating === q.id}
                onPress={() => {
                  setDrafts((p) => {
                    const n = { ...p };
                    delete n[q.id];
                    return n;
                  });
                  send({ type: "clear", questionId: q.id });
                }}
              >
                <Feather name="x-circle" size={15} color={colors.foreground} />
                <Text style={s.btnText}>Clear</Text>
              </Pressable>
            </View>
            <Pressable
              style={s.check}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: !!draft?.reviewed, disabled: !value || generating === q.id }}
              disabled={!value || generating === q.id}
              onPress={() => draft && setDrafts((p) => ({ ...p, [q.id]: { ...draft, reviewed: !draft.reviewed } }))}
            >
              <Feather name={draft?.reviewed ? "check-square" : "square"} size={18} color={colors.foreground} />
              <Text style={s.checkText}>I have reviewed this answer and it is accurate</Text>
            </Pressable>
            {!!value && generating !== q.id && <AIContentReport content={value} context={`Native Smart Apply, application ${context.id}`} />}
            {eligible ? (
              <Pressable style={s.check} accessibilityRole="checkbox" accessibilityState={{ checked: remember }} onPress={() => setRemember((r) => !r)}>
                <Feather name={remember ? "check-square" : "square"} size={18} color={colors.foreground} />
                <Text style={s.checkText}>Remember this answer on this device (up to {MAX_REMEMBERED_VALUE} characters)</Text>
              </Pressable>
            ) : null}
            <Pressable
              style={[s.primary, (!draft?.reviewed || !!problem || !value.trim()) && s.disabled]}
              disabled={!draft?.reviewed || !!problem || !value.trim() || generating === q.id}
              onPress={() => draft && insert(q, draft)}
              accessibilityRole="button"
              testID="smart-apply-insert"
            >
              <Feather name="corner-down-left" size={16} color={colors.accentForeground} />
              <Text style={s.primaryText}>Insert into page</Text>
            </Pressable>
          </>
        )}
      </View>
    );
  };

  return (
    <View style={s.overlay} pointerEvents="box-none">
      <KeyboardAvoidingView behavior="padding" style={s.sheet}>
        <View style={s.handle} />
        <View style={s.headRow}>
          <Text style={s.title} accessibilityRole="header">Smart Apply</Text>
          <Pressable onPress={() => send({ type: "scan" })} accessibilityLabel="Refresh scan" style={s.icon}>
            <Feather name="refresh-cw" size={18} color={colors.foreground} />
          </Pressable>
          <Pressable onPress={onClose} accessibilityLabel="Close Smart Apply" style={s.icon}>
            <Feather name="chevron-down" size={22} color={colors.foreground} />
          </Pressable>
        </View>
        <View style={s.tabs} accessibilityRole="tablist">
          {(["questions", "details", "memory"] as Tab[]).map((t) => (
            <Pressable key={t} onPress={() => setTab(t)} style={[s.tab, tab === t && s.tabOn]} accessibilityRole="tab" accessibilityState={{ selected: tab === t }}>
              <Text style={[s.tabText, tab === t && s.tabTextOn]}>{t === "questions" ? "Questions" : t === "details" ? "Details" : "Memory"}</Text>
            </Pressable>
          ))}
        </View>
        {notice ? (
          <Text style={[s.notice, notice.tone === "error" && { color: colors.destructive }]} accessibilityLiveRegion="polite">{notice.text}</Text>
        ) : null}
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: bottomInset + 24 }} keyboardShouldPersistTaps="handled">
          {!scan ? (
            <View style={s.center}>
              <ActivityIndicator color={colors.accent} />
              <Text style={s.muted}>Reading this page...</Text>
            </View>
          ) : tab === "questions" ? (
            selected ? (
              renderEditor(selected)
            ) : (
              <>
                {manualMessage ? <Text style={s.muted}>{manualMessage}</Text> : (
                  <View style={s.progressRow}>
                    <Text style={s.progress}>{answeredCount} of {questions.length} fields have a value</Text>
                    <Pressable onPress={nextUnanswered} accessibilityRole="button">
                      <Text style={s.link}>Next unanswered</Text>
                    </Pressable>
                  </View>
                )}
                {questions.map((q) => (
                  <Pressable key={q.id} onPress={() => select(q.id)} style={s.qRow} accessibilityRole="button" accessibilityHint="Open answer editor">
                    <Feather name={q.answered ? "check-circle" : "circle"} size={16} color={q.answered ? colors.accent : colors.mutedForeground} />
                    <View style={{ flex: 1 }}>
                      <Text style={s.qRowText} numberOfLines={2}>{q.question}</Text>
                      <Text style={[s.qMeta, { color: badge(q).color }]}>
                        {badge(q).text} - {q.requiredKnown ? (q.required ? "Required" : "Not marked required") : "Requiredness unknown"}
                        {drafts[q.id]?.value ? " - Draft ready" : ""}
                      </Text>
                    </View>
                    <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
                  </Pressable>
                ))}
                {roleId ? (
                  <View style={[s.row, { marginTop: 16 }]}>
                    <Pressable style={s.btn} onPress={saveDraft} disabled={draftBusy !== null} accessibilityRole="button">
                      {draftBusy === "save" ? <ActivityIndicator size="small" color={colors.foreground} /> : <Feather name="save" size={15} color={colors.foreground} />}
                      <Text style={s.btnText}>Save draft</Text>
                    </Pressable>
                    <Pressable style={s.btn} onPress={deleteDraft} disabled={draftBusy !== null} accessibilityRole="button">
                      <Feather name="trash-2" size={15} color={colors.foreground} />
                      <Text style={s.btnText}>Delete saved draft</Text>
                    </Pressable>
                  </View>
                ) : null}
              </>
            )
          ) : tab === "details" ? (
            <>
              <Text style={s.section}>Your name and contact email</Text>
              <Text style={s.muted}>Fills name and email fields on this page from your JOBSAGE profile. Your sign-in email is not used.</Text>
              <Pressable style={[s.primary, prefilling && s.disabled]} onPress={runPrefill} disabled={prefilling} accessibilityRole="button">
                {prefilling ? <ActivityIndicator size="small" color={colors.accentForeground} /> : <Feather name="user-check" size={16} color={colors.accentForeground} />}
                <Text style={s.primaryText}>Fill my details</Text>
              </Pressable>
              {prefillResult ? (
                <View style={{ marginTop: 10 }}>
                  {prefillResult.warning ? <Text style={[s.muted, { color: colors.destructive }]}>{prefillResult.warning}</Text> : null}
                  {Object.entries(prefillResult.fieldResults).map(([k, r]) => (
                    <View key={k} style={s.resultRow}>
                      <Text style={s.resultKey}>{k}</Text>
                      <Text style={[s.resultStatus, { color: r.status === "filled" ? colors.accent : r.status === "missing" ? colors.destructive : colors.mutedForeground }]}>
                        {r.status === "filled" ? "Filled" : r.status === "missing" ? "Missing" : "Skipped"}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : null}

              <Text style={[s.section, { marginTop: 22 }]}>Structured questions</Text>
              {scan.structuredFields.length ? (
                <>
                  <Text style={s.muted}>{scan.structuredFields.length} structured {scan.structuredFields.length === 1 ? "field" : "fields"} detected. Suggestions come from your profile and are only filled after you review them.</Text>
                  {!structured ? (
                    <Pressable style={s.btn} onPress={loadStructured} disabled={structuredBusy} accessibilityRole="button">
                      {structuredBusy ? <ActivityIndicator size="small" color={colors.foreground} /> : <Feather name="list" size={15} color={colors.foreground} />}
                      <Text style={s.btnText}>Suggest structured answers</Text>
                    </Pressable>
                  ) : (
                    <>
                      {structured.map((row, i) => (
                        <Pressable
                          key={row.id}
                          style={s.check}
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked: row.pick }}
                          onPress={() => {
                            setStructuredReviewed(false);
                            setStructured((p) => p && p.map((r, j) => (j === i ? { ...r, pick: !r.pick } : r)));
                          }}
                        >
                          <Feather name={row.pick ? "check-square" : "square"} size={18} color={colors.foreground} />
                          <Text style={s.checkText}><Text style={{ fontFamily: "Inter_600SemiBold" }}>{row.label}: </Text>{row.value}</Text>
                        </Pressable>
                      ))}
                      {structured.length ? (
                        <>
                          <Pressable style={s.check} accessibilityRole="checkbox" accessibilityState={{ checked: structuredReviewed }} onPress={() => setStructuredReviewed((v) => !v)}>
                            <Feather name={structuredReviewed ? "check-square" : "square"} size={18} color={colors.foreground} />
                            <Text style={s.checkText}>I have reviewed the selected answers</Text>
                          </Pressable>
                          <Pressable
                            style={[s.primary, (!structuredReviewed || !structured.some((r) => r.pick)) && s.disabled]}
                            disabled={!structuredReviewed || !structured.some((r) => r.pick) || structuredBusy}
                            onPress={() => {
                              setStructuredBusy(true);
                              send({ type: "structured", values: structured.filter((r) => r.pick).map((r) => ({ id: r.id, value: r.value })) });
                            }}
                            accessibilityRole="button"
                          >
                            <Text style={s.primaryText}>Fill selected</Text>
                          </Pressable>
                        </>
                      ) : null}
                    </>
                  )}
                </>
              ) : (
                <Text style={s.muted}>No structured fields were detected on this page.</Text>
              )}
              <Text style={[s.section, { marginTop: 22 }]}>CV</Text>
              {scan.applicationPage ? (
                <>
                  <Text style={s.muted}>Attach your current CV (PDF, up to 10 MB) to this form's file field. You will be asked to confirm first. If the form has no clear CV field, use My CV in the toolbar and the employer's file picker.</Text>
                  <Pressable
                    style={[s.btn, cvState === "working" && s.disabled]}
                    onPress={attachCv}
                    disabled={cvState === "working"}
                    accessibilityRole="button"
                    testID="smart-apply-attach-cv"
                  >
                    {cvState === "working" ? <ActivityIndicator size="small" color={colors.foreground} /> : <Feather name="paperclip" size={15} color={colors.foreground} />}
                    <Text style={s.btnText}>Attach current CV</Text>
                  </Pressable>
                  {cvMessage ? (
                    <Text style={[s.muted, cvState === "failed" && { color: colors.destructive }]} accessibilityLiveRegion="polite">{cvMessage}</Text>
                  ) : null}
                </>
              ) : (
                <Text style={s.muted}>No application form was detected here. Use My CV in the toolbar to save or share your current CV, then choose it with the employer's file picker.</Text>
              )}
            </>
          ) : (
            <>
              <Text style={s.section}>This page</Text>
              <Pressable style={s.btn} onPress={clearPage} accessibilityRole="button">
                <Feather name="slash" size={15} color={colors.foreground} />
                <Text style={s.btnText}>Clear page memory</Text>
              </Pressable>
              <Text style={[s.section, { marginTop: 22 }]}>Remembered answers ({library.length})</Text>
              <Text style={s.muted}>Stored only on this device, encrypted, and only for answers you wrote yourself.</Text>
              {siteMemory.length ? (
                <Pressable
                  style={s.btn}
                  accessibilityRole="button"
                  onPress={async () => {
                    if (!user?.id) return;
                    const ids = siteMemory.map((e) => e.id);
                    await forgetAnswers(user.id, ids).catch(() => undefined);
                    setLibrary((p) => p.filter((e) => !ids.includes(e.id)));
                  }}
                >
                  <Text style={s.btnText}>Forget answers from {host}</Text>
                </Pressable>
              ) : null}
              {library.map((e) => (
                <View key={e.id} style={s.memRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.qRowText} numberOfLines={1}>{e.labelVariants[0] ?? e.normalizedQuestion}</Text>
                    <Text style={s.qMeta} numberOfLines={2}>{e.value}</Text>
                  </View>
                  <Pressable
                    accessibilityLabel="Delete remembered answer"
                    style={s.icon}
                    onPress={async () => {
                      if (!user?.id) return;
                      await forgetAnswers(user.id, [e.id]).catch(() => undefined);
                      setLibrary((p) => p.filter((x) => x.id !== e.id));
                    }}
                  >
                    <Feather name="trash-2" size={16} color={colors.destructive} />
                  </Pressable>
                </View>
              ))}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = (c: ReturnType<typeof useColors>) =>
  StyleSheet.create({
    overlay: { ...StyleSheet.absoluteFillObject, justifyContent: "flex-end" },
    sheet: { height: "68%", backgroundColor: c.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border, boxShadow: `0px -4px 16px ${c.foreground}1F` },
    handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: c.border, alignSelf: "center", marginTop: 8 },
    headRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 6 },
    title: { flex: 1, fontFamily: "Inter_700Bold", fontSize: 17, color: c.foreground },
    icon: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
    tabs: { flexDirection: "row", marginHorizontal: 16, backgroundColor: c.muted, borderRadius: c.radius, padding: 3 },
    tab: { flex: 1, alignItems: "center", paddingVertical: 8, borderRadius: c.radius - 3 },
    tabOn: { backgroundColor: c.card },
    tabText: { fontFamily: "Inter_500Medium", fontSize: 13, color: c.mutedForeground },
    tabTextOn: { color: c.foreground },
    notice: { marginHorizontal: 16, marginTop: 10, fontFamily: "Inter_500Medium", fontSize: 13, color: c.accent },
    center: { alignItems: "center", gap: 10, paddingVertical: 32 },
    muted: { fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 19, color: c.mutedForeground, marginBottom: 10 },
    progressRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 8 },
    progress: { fontFamily: "Inter_500Medium", fontSize: 13, color: c.foreground },
    link: { fontFamily: "Inter_600SemiBold", fontSize: 13, color: c.accent },
    qRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border, minHeight: 52 },
    qRowText: { fontFamily: "Inter_500Medium", fontSize: 14, color: c.foreground },
    qMeta: { fontFamily: "Inter_400Regular", fontSize: 12, color: c.mutedForeground, marginTop: 2 },
    editor: { gap: 10 },
    backRow: { flexDirection: "row", alignItems: "center", gap: 2, minHeight: 32 },
    qText: { fontFamily: "Inter_600SemiBold", fontSize: 15, lineHeight: 21, color: c.foreground },
    chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    chip: { fontFamily: "Inter_500Medium", fontSize: 11, color: c.mutedForeground, backgroundColor: c.muted, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, overflow: "hidden" },
    suggest: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: c.radius, borderWidth: 1, borderColor: c.accent },
    suggestText: { flex: 1, fontFamily: "Inter_400Regular", fontSize: 13, color: c.foreground },
    input: { minHeight: 140, maxHeight: 260, borderWidth: 1, borderColor: c.input, borderRadius: c.radius, padding: 12, fontFamily: "Inter_400Regular", fontSize: 15, color: c.foreground, backgroundColor: c.background },
    countRow: { flexDirection: "row", justifyContent: "space-between", flexWrap: "wrap" },
    count: { fontFamily: "Inter_400Regular", fontSize: 12, color: c.mutedForeground },
    row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    btn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, height: 40, borderRadius: c.radius, borderWidth: 1, borderColor: c.border, alignSelf: "flex-start" },
    btnText: { fontFamily: "Inter_500Medium", fontSize: 13, color: c.foreground },
    check: { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingVertical: 8, minHeight: 44 },
    checkText: { flex: 1, fontFamily: "Inter_400Regular", fontSize: 14, color: c.foreground },
    primary: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 46, borderRadius: c.radius, backgroundColor: c.accent, marginTop: 4 },
    primaryText: { fontFamily: "Inter_600SemiBold", fontSize: 15, color: c.accentForeground },
    disabled: { opacity: 0.45 },
    section: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: c.foreground, marginBottom: 6 },
    resultRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border },
    resultKey: { fontFamily: "Inter_400Regular", fontSize: 13, color: c.foreground },
    resultStatus: { fontFamily: "Inter_600SemiBold", fontSize: 13 },
    memRow: { flexDirection: "row", alignItems: "center", paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border },
  });
