import { Feather } from "@expo/vector-icons";
import { safeEmployerUrl } from "@workspace/mobile-core";
import { confirmApplicationSubmission, getDownloadSmartApplyCurrentCvUrl } from "@workspace/api-client-react";
import type { MobileApplicationContext } from "@workspace/api-client-react";
import { nativeSmartApplyScript } from "@workspace/smart-apply-core/native-script";
import React, { useCallback, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import WebView from "react-native-webview";
import type { ShouldStartLoadRequest, WebViewMessageEvent, WebViewOpenWindowEvent } from "react-native-webview/lib/WebViewTypes";

import { SmartApplyAssistant } from "@/components/SmartApplyAssistant";

import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { DownloadError, downloadAndShare } from "@/lib/native-download";
import { classifyEmployerWindowTarget, classifyUrl, openExternal } from "@/lib/external-links";
import {
  PageCommand,
  PageMessage,
  ScanSnapshot,
  commandScript,
  configureScript,
  createSmartApplyChannel,
  validatePageMessage,
} from "@/lib/smart-apply/protocol";

export interface NativeApplicationBrowserProps {
  /** Server-verified application context (resolved via getMobileApplicationContext). */
  context: MobileApplicationContext;
  visible: boolean;
  onClose: () => void;
  /** Called after the candidate explicitly confirms submission and the API accepts it. */
  onSubmissionConfirmed?: (context: MobileApplicationContext) => void;
}

/**
 * Controlled browser for untrusted employer pages. Injects only the stateless
 * DOM assistant, never credentials or first-party privileged bridge methods.
 * Page messages are advisory and are filtered against the OS-reported URL.
 */
export function NativeApplicationBrowser({ context, visible, onClose, onSubmissionConfirmed }: NativeApplicationBrowserProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { token, user } = useAuth();
  const webRef = useRef<WebView>(null);
  const startUrl = safeEmployerUrl(context.applicationUrl);
  const [currentUrl, setCurrentUrl] = useState<string>(startUrl ?? "");
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"cv" | "confirm" | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const channel = useMemo(() => createSmartApplyChannel(), [context.id]);
  const currentUrlRef = useRef<string>(startUrl ?? "");
  const [scan, setScan] = useState<ScanSnapshot | null>(null);
  const [lastEvent, setLastEvent] = useState<{ seq: number; message: PageMessage } | null>(null);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const signalPrompted = useRef(false);
  const confirmedRef = useRef(false);
  confirmedRef.current = confirmed;
  const injected = useMemo(() => `${nativeSmartApplyScript}\n;${configureScript(channel, context.id)}`, [channel, context.id]);

  const send = useCallback((command: PageCommand) => {
    webRef.current?.injectJavaScript(commandScript(command));
  }, []);

  const host = (() => {
    try {
      return new URL(currentUrl).host;
    } catch {
      return "";
    }
  })();

  const onShouldStart = (req: ShouldStartLoadRequest) => {
    if (req.isTopFrame === false) return /^https:/i.test(req.url) || /^about:/i.test(req.url);
    if (safeEmployerUrl(req.url)) return true;
    const kind = classifyUrl(req.url);
    if (kind === "system") void openExternal(req.url);
    else Alert.alert("Link blocked", "This page tried to open an address that is not a secure public website.");
    return false;
  };

  const onOpenWindow = useCallback((event: WebViewOpenWindowEvent) => {
    const targetUrl = event.nativeEvent.targetUrl;
    const target = classifyEmployerWindowTarget(targetUrl);
    if (target.kind === "in-app") {
      // target="_blank" and window.open links stay in the controlled browser,
      // where Smart Apply can continue to scan the employer's application form.
      webRef.current?.injectJavaScript(`window.location.assign(${JSON.stringify(target.url)});true;`);
      return;
    }
    if (target.kind === "system") {
      void openExternal(targetUrl).then((ok) => {
        if (!ok) Alert.alert("Link unavailable", "This link could not be opened.");
      });
      return;
    }
    Alert.alert("Link blocked", "This page tried to open an address that is not a secure public website.");
  }, []);

  const shareCv = async () => {
    setBusy("cv");
    try {
      await downloadAndShare({ url: getDownloadSmartApplyCurrentCvUrl(), token, fallbackName: "CV.pdf" });
    } catch (e) {
      Alert.alert("CV unavailable", e instanceof DownloadError ? e.message : "Your current CV could not be downloaded.");
    } finally {
      setBusy(null);
    }
  };

  const askConfirm = (detected = false) => {
    Alert.alert(
      detected ? "This page looks like a submission confirmation" : "Confirm you submitted this application",
      `${detected ? "JOBSAGE noticed a possible confirmation, but cannot be sure. " : ""}Only confirm if you have completed and sent your application${context.companyName ? ` to ${context.companyName}` : ""}. JOBSAGE will record it as submitted.`,
      [
        { text: "Not yet", style: "cancel" },
        {
          text: "I submitted it",
          onPress: async () => {
            setBusy("confirm");
            try {
              await confirmApplicationSubmission({ applicationUrl: context.applicationUrl });
              setConfirmed(true);
              onSubmissionConfirmed?.(context);
            } catch {
              Alert.alert("Not recorded", "We could not record your confirmation. Please try again.");
            } finally {
              setBusy(null);
            }
          },
        },
      ],
    );
  };

  const onMessage = (event: WebViewMessageEvent) => {
    const actualUrl = event.nativeEvent.url;
    if (typeof actualUrl !== "string" || !safeEmployerUrl(actualUrl)) return;
    const message = validatePageMessage(event.nativeEvent.data, {
      channel,
      applicationId: context.id,
      navigationUrl: actualUrl,
    });
    if (!message) return;
    if (actualUrl !== currentUrlRef.current) {
      // SPA pushState: the OS-reported URL is authoritative even if navigation state lagged.
      currentUrlRef.current = actualUrl;
      setCurrentUrl(actualUrl);
    }
    if (message.type === "scan") {
      setScan(message);
      return;
    }
    if (message.type === "submission") {
      if (!signalPrompted.current && !confirmedRef.current) {
        signalPrompted.current = true;
        askConfirm(true);
      }
      return;
    }
    setLastEvent((prev) => ({ seq: (prev?.seq ?? 0) + 1, message }));
  };

  const s = styles(colors);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={[s.root, { paddingTop: insets.top }]}>
        <View style={s.header}>
          <Pressable accessibilityRole="button" accessibilityLabel="Close application" onPress={onClose} hitSlop={10} style={s.iconBtn} testID="app-browser-close">
            <Feather name="x" size={22} color={colors.foreground} />
          </Pressable>
          <View style={s.titleWrap}>
            <Text style={s.title} numberOfLines={1}>{context.jobTitle ?? "Application"}</Text>
            <View style={s.hostRow}>
              <Feather name="lock" size={11} color={colors.mutedForeground} />
              <Text style={s.host} numberOfLines={1}>{host || "Employer site"}</Text>
            </View>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Open in browser" onPress={() => void openExternal(currentUrl)} hitSlop={10} style={s.iconBtn}>
            <Feather name="external-link" size={20} color={colors.foreground} />
          </Pressable>
        </View>

        <View style={{ flex: 1 }}>
          {startUrl && !loadError ? (
            <WebView
              ref={webRef}
              source={{ uri: startUrl }}
              originWhitelist={["https://*", "mailto:*", "tel:*", "about:*"]}
              onShouldStartLoadWithRequest={onShouldStart}
              onOpenWindow={onOpenWindow}
              injectedJavaScript={injected}
              injectedJavaScriptForMainFrameOnly
              onMessage={onMessage}
              onNavigationStateChange={(n) => {
                if (n.url !== currentUrlRef.current) setScan(null);
                currentUrlRef.current = n.url;
                setCurrentUrl(n.url);
                setCanGoBack(n.canGoBack);
                setCanGoForward(n.canGoForward);
              }}
              onLoadStart={(e) => {
                currentUrlRef.current = e.nativeEvent.url;
                setLoading(true);
              }}
              onLoadEnd={() => setLoading(false)}
              onError={(e) => setLoadError(e.nativeEvent.description || "The employer page could not be loaded.")}
              javaScriptCanOpenWindowsAutomatically={false}
              setSupportMultipleWindows={false}
              allowFileAccess={false}
              allowFileAccessFromFileURLs={false}
              allowUniversalAccessFromFileURLs={false}
              mixedContentMode="never"
              sharedCookiesEnabled={false}
              thirdPartyCookiesEnabled
              incognito={false}
              pullToRefreshEnabled={false}
              style={{ backgroundColor: colors.background }}
            />
          ) : (
            <View style={s.center}>
              <Feather name="alert-triangle" size={28} color={colors.destructive} />
              <Text style={s.errTitle}>{startUrl ? "Page unavailable" : "Link not allowed"}</Text>
              <Text style={s.errBody}>
                {startUrl ? loadError : "This application link is not a secure public website, so it cannot be opened in JOBSAGE."}
              </Text>
              {startUrl ? (
                <Pressable style={s.primary} onPress={() => setLoadError(null)} accessibilityRole="button">
                  <Text style={s.primaryText}>Retry</Text>
                </Pressable>
              ) : null}
            </View>
          )}
          {loading && startUrl && !loadError ? (
            <View style={s.loadingBar}><ActivityIndicator color={colors.accent} /></View>
          ) : null}
          {assistantOpen && startUrl && !loadError ? (
            <SmartApplyAssistant
              key={`${context.id}:${currentUrl}:${user?.id ?? "signed-out"}`}
              context={context}
              scan={scan}
              lastEvent={lastEvent}
              host={host}
              bottomInset={0}
              send={send}
              token={token}
              onClose={() => setAssistantOpen(false)}
            />
          ) : null}
        </View>

        <View style={[s.toolbar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
          <Pressable accessibilityLabel="Back" disabled={!canGoBack} onPress={() => webRef.current?.goBack()} style={s.iconBtn}>
            <Feather name="chevron-left" size={24} color={canGoBack ? colors.foreground : colors.border} />
          </Pressable>
          <Pressable accessibilityLabel="Forward" disabled={!canGoForward} onPress={() => webRef.current?.goForward()} style={s.iconBtn}>
            <Feather name="chevron-right" size={24} color={canGoForward ? colors.foreground : colors.border} />
          </Pressable>
          <Pressable
            accessibilityLabel="Open Smart Apply assistant"
            accessibilityState={{ expanded: assistantOpen }}
            onPress={() => {
              setAssistantOpen((o) => !o);
              if (!scan) send({ type: "scan" });
            }}
            style={s.iconBtn}
            testID="app-browser-assistant"
          >
            <Feather name="layers" size={21} color={assistantOpen ? colors.accent : colors.foreground} />
          </Pressable>
          <Pressable accessibilityLabel="Download or share my current CV" onPress={shareCv} disabled={busy !== null} style={s.secondary}>
            {busy === "cv" ? <ActivityIndicator size="small" color={colors.foreground} /> : <Feather name="file-text" size={16} color={colors.foreground} />}
            <Text style={s.secondaryText}>My CV</Text>
          </Pressable>
          <Pressable
            accessibilityLabel="Confirm application submitted"
            onPress={() => askConfirm(false)}
            disabled={busy !== null || confirmed}
            style={[s.primary, confirmed && { backgroundColor: colors.muted }]}
            testID="app-browser-confirm"
          >
            {busy === "confirm" ? (
              <ActivityIndicator size="small" color={colors.accentForeground} />
            ) : (
              <Feather name={confirmed ? "check-circle" : "check"} size={16} color={confirmed ? colors.foreground : colors.accentForeground} />
            )}
            <Text style={[s.primaryText, confirmed && { color: colors.foreground }]}>{confirmed ? "Submitted" : "I submitted"}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = (c: ReturnType<typeof useColors>) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: c.background },
    header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border, gap: 4 },
    iconBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
    titleWrap: { flex: 1, alignItems: "center" },
    title: { fontFamily: "Inter_600SemiBold", fontSize: 15, color: c.foreground },
    hostRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
    host: { fontFamily: "Inter_400Regular", fontSize: 12, color: c.mutedForeground, maxWidth: 220 },
    loadingBar: { position: "absolute", top: 12, alignSelf: "center" },
    toolbar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border, gap: 6, backgroundColor: c.card },
    secondary: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, height: 40, borderRadius: c.radius, borderWidth: 1, borderColor: c.border, marginLeft: "auto" },
    secondaryText: { fontFamily: "Inter_500Medium", fontSize: 14, color: c.foreground },
    primary: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, height: 40, borderRadius: c.radius, backgroundColor: c.accent },
    primaryText: { fontFamily: "Inter_600SemiBold", fontSize: 14, color: c.accentForeground },
    center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 10 },
    errTitle: { fontFamily: "Inter_600SemiBold", fontSize: 17, color: c.foreground },
    errBody: { fontFamily: "Inter_400Regular", fontSize: 14, color: c.mutedForeground, textAlign: "center", marginBottom: 8 },
  });
