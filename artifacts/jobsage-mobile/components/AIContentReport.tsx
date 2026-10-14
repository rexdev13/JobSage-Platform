import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { appealContentReport, createSupportTicket } from "@workspace/api-client-react";
import { AI_REPORT_REASONS, buildAIReportMessage, type AIReportReason } from "@workspace/mobile-core";
import { getNativeSessionToken, getNativeSessionUserId, useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";

export function AIContentReport({ content, context }: { content: string; context: string }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, token } = useAuth();
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState({ content: "", context: "", userId: "" });
  const [reason, setReason] = useState<AIReportReason>("inaccurate");
  const [detail, setDetail] = useState("");
  const [include, setInclude] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [savedTicketId, setSavedTicketId] = useState("");
  const [appealDetail, setAppealDetail] = useState("");
  const [appealTicketId, setAppealTicketId] = useState("");
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => { active.current?.abort(); active.current = null; }, []);
  function close() { active.current?.abort(); active.current = null; setBusy(false); setOpen(false); }
  useEffect(() => { close(); }, [user?.id, token]);
  async function submit() {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller; setBusy(true); setNotice("");
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      if (!user || !token || snapshot.userId !== user.id || getNativeSessionUserId() !== user.id || getNativeSessionToken() !== token) throw new Error("Account changed.");
      const message = buildAIReportMessage({ reason, detail, ...snapshot, includeContent: include });
      const saved = await createSupportTicket({
        name: [user.firstName, user.lastName].filter(Boolean).join(" ").slice(0, 120) || "JOBSAGE user",
        email: user.email, category: "Other", subject: "AI content report", message,
      }, { signal: controller.signal, headers: {
        Authorization: `Bearer ${token}`, "X-Jobsage-AI-Report": "1", "X-Jobsage-Report-User": user.id,
      } });
      if (active.current === controller && getNativeSessionUserId() === user.id && getNativeSessionToken() === token) {
        setSavedTicketId(saved.ticketId);
        setNotice(`Saved for staff review. Reference: ${saved.ticketId}.`);
      }
    } catch {
      if (active.current === controller) setNotice("Report not confirmed. Check your sign-in and connection. A timed-out report may already have been saved; check support before resending.");
    } finally {
      clearTimeout(timeout);
      if (active.current === controller) { active.current = null; setBusy(false); }
    }
  }
  async function submitAppeal() {
    if (!savedTicketId || appealDetail.trim().length < 10 || active.current) return;
    const controller = new AbortController();
    active.current = controller; setBusy(true); setNotice("");
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      if (!user || !token || snapshot.userId !== user.id || getNativeSessionUserId() !== user.id || getNativeSessionToken() !== token) {
        throw new Error("Account changed.");
      }
      const appeal = await appealContentReport(
        savedTicketId,
        { message: appealDetail.trim() },
        { signal: controller.signal, headers: { Authorization: `Bearer ${token}`, "X-Jobsage-Report-User": user.id } },
      );
      if (active.current === controller && getNativeSessionUserId() === user.id && getNativeSessionToken() === token) {
        setAppealTicketId(appeal.ticketId);
        setNotice(`Review request saved. Reference: ${appeal.ticketId}.`);
      }
    } catch {
      if (active.current === controller) setNotice("Review request not confirmed. Check your sign-in and connection before trying again.");
    } finally {
      clearTimeout(timeout);
      if (active.current === controller) { active.current = null; setBusy(false); }
    }
  }
  const text = { color: colors.foreground, fontSize: 14 };
  return <>
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: !user?.id || !token }} disabled={!user?.id || !token} onPress={() => {
      if (!user?.id || !token) return;
      setSnapshot({ content, context, userId: user.id }); setDetail(""); setInclude(false); setNotice(""); setReason("inaccurate"); setSavedTicketId(""); setAppealDetail(""); setAppealTicketId(""); setOpen(true);
    }} style={{ paddingVertical: 14, opacity: user?.id && token ? 1 : 0.5 }}><Text style={{ ...text, textDecorationLine: "underline" }}>{user?.id && token ? "Report this AI answer" : "Sign in to report"}</Text></Pressable>
    <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 16 }} keyboardShouldPersistTaps="handled">
          <View style={{ backgroundColor: colors.background, borderRadius: colors.radius, padding: 20, gap: 16 }}>
            <Text accessibilityRole="header" style={{ ...text, fontSize: 20, fontFamily: "Inter_700Bold" }}>Report an AI answer</Text>
            <Text style={text}>Your account contact details and report go to JOBSAGE support. Answer text is excluded unless you choose to include it. Do not include passwords, payment details or other people's medical or personal information.</Text>
            <View accessibilityRole="radiogroup" accessibilityLabel="Report reason">
              {Object.entries(AI_REPORT_REASONS).map(([value, label]) => <Pressable key={value} accessibilityRole="radio" accessibilityState={{ checked: reason === value, disabled: busy }} disabled={busy} onPress={() => setReason(value as AIReportReason)} style={{ paddingVertical: 10 }}>
                <Text style={text}>{reason === value ? "Selected: " : ""}{label}</Text>
              </Pressable>)}
            </View>
            <Text style={text}>Describe the issue (10–1,000 characters)</Text>
            <TextInput accessibilityLabel="Describe the AI issue" multiline editable={!busy} maxLength={1000} value={detail} onChangeText={setDetail} style={{ ...text, borderWidth: 1, borderColor: colors.border, borderRadius: colors.radius, padding: 12, minHeight: 100, textAlignVertical: "top" }} />
            <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: include, disabled: busy }} disabled={busy} onPress={() => setInclude(value => !value)} style={{ paddingVertical: 10 }}>
              <Text style={text}>{include ? "Included: " : "Not included: "}Include up to 2,000 characters of this answer</Text>
            </Pressable>
            {include && <Text style={{ ...text, fontSize: 12 }}>{snapshot.content.slice(0, 2000)}</Text>}
            {!!notice && <Text accessibilityLiveRegion="polite" style={text}>{notice}</Text>}
            {!savedTicketId ? <Pressable accessibilityRole="button" disabled={busy || detail.trim().length < 10} onPress={() => void submit()} style={{ backgroundColor: colors.accent, opacity: busy || detail.trim().length < 10 ? 0.5 : 1, padding: 14, borderRadius: colors.radius, alignItems: "center" }}>
              {busy ? <ActivityIndicator color={colors.accentForeground} /> : <Text style={{ color: colors.accentForeground }}>Send report</Text>}
            </Pressable> : <View style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 14, gap: 10 }}>
              <Text style={{ ...text, fontFamily: "Inter_700Bold" }}>Request another review</Text>
              <Text style={{ ...text, fontSize: 12 }}>The original report stays unchanged. Add what you think staff should reconsider.</Text>
              {!appealTicketId && <>
                <TextInput accessibilityLabel="Review request details" multiline editable={!busy} maxLength={1000} value={appealDetail} onChangeText={setAppealDetail} placeholder="What should staff reconsider?" style={{ ...text, borderWidth: 1, borderColor: colors.border, borderRadius: colors.radius, padding: 12, minHeight: 100, textAlignVertical: "top" }} />
                <Pressable accessibilityRole="button" disabled={busy || appealDetail.trim().length < 10} onPress={() => void submitAppeal()} style={{ backgroundColor: colors.accent, opacity: busy || appealDetail.trim().length < 10 ? 0.5 : 1, padding: 14, borderRadius: colors.radius, alignItems: "center" }}>
                  {busy ? <ActivityIndicator color={colors.accentForeground} /> : <Text style={{ color: colors.accentForeground }}>Request review</Text>}
                </Pressable>
              </>}
            </View>}
            <Pressable accessibilityRole="button" onPress={close} style={{ padding: 14, alignItems: "center" }}><Text style={text}>Close</Text></Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  </>;
}
