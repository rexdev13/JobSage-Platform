import { Feather } from "@expo/vector-icons";
import { safeEmployerUrl } from "@workspace/mobile-core";
import { confirmApplicationSubmission, getDownloadSmartApplyCurrentCvUrl } from "@workspace/api-client-react";
import type { MobileApplicationContext } from "@workspace/api-client-react";
import { nativeSmartApplyScript } from "@workspace/smart-apply-core/native-script";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import WebView from "react-native-webview";
import type { ShouldStartLoadRequest, WebViewMessageEvent, WebViewOpenWindowEvent } from "react-native-webview/lib/WebViewTypes";

import { SmartApplyAssistant } from "@/components/SmartApplyAssistant";

import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { DownloadError, downloadAndShare } from "@/lib/native-download";
import {
  classifyEmployerWindowTarget,
  classifyUrl,
  openExternal,
  safeLinkLogContext,
  showInAppContactLink,
} from "@/lib/external-links";
import { applicationAssistantStepKey, applicationPrefillPageKey } from "@/lib/smart-apply/auto-prefill";
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
  const originalStartScheme = safeLinkLogContext(context.applicationUrl).scheme;
  const startUrl = safeEmployerUrl(context.applicationUrl);
  const [currentUrl, setCurrentUrl] = useState<string>(startUrl ?? "");
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [httpErrorStatus, setHttpErrorStatus] = useState<number | null>(null);
  const [busy, setBusy] = useState<"cv" | "confirm" | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const channel = useMemo(() => createSmartApplyChannel(), [context.id]);
  const currentUrlRef = useRef<string>(startUrl ?? "");
  const [scan, setScan] = useState<ScanSnapshot | null>(null);
  const [lastEvent, setLastEvent] = useState<{ seq: number; message: PageMessage } | null>(null);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const assistantAutoOpenedFor = useRef<string | null>(null);
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

  useEffect(() => {
    console.info("[SmartApply] application browser opened", {
      host: safeLinkLogContext(startUrl ?? "").host,
      safeUrlAvailable: !!startUrl,
      upgradedToHttps: originalStartScheme === "http" && !!startUrl,
    });
  }, [originalStartScheme, startUrl]);

  useEffect(() => {
    assistantAutoOpenedFor.current = null;
  }, [context.id, visible]);

  const onShouldStart = (req: ShouldStartLoadRequest) => {
    const urlContext = safeLinkLogContext(req.url);
    if (req.isTopFrame === false) {
      const allowed = /^about:(blank|srcdoc)$/i.test(req.url)
        || (urlContext.scheme === "https" && !!safeEmployerUrl(req.url));
      console.info("[SmartApply] web navigation", {
        frame: "subframe",
        action: allowed ? "in-app" : "blocked",
        ...urlContext,
      });
      return allowed;
    }
    if (/^about:(blank|srcdoc)$/i.test(req.url)) {
      console.info("[SmartApply] web navigation", { frame: "main", action: "in-app", ...urlContext });
      return true;
    }
    const safeUrl = safeEmployerUrl(req.url);
    if (safeUrl && urlContext.scheme === "http") {
      console.info("[SmartApply] web navigation", { frame: "main", action: "upgraded-to-https", ...urlContext });
      webRef.current?.injectJavaScript(`window.location.assign(${JSON.stringify(safeUrl)});true;`);
      return false;
    }
    if (safeUrl) {
      console.info("[SmartApply] web navigation", { frame: "main", action: "in-app", ...urlContext });
      return true;
    }
    const kind = classifyUrl(req.url);
    if (kind === "contact") {
      const handled = showInAppContactLink(req.url);
      console.info("[SmartApply] web navigation", {
        frame: "main",
        action: handled ? "in-app-contact" : "blocked-unsupported-scheme",
        ...urlContext,
      });
      if (!handled) Alert.alert("Link unavailable", "This contact or calendar link cannot be opened inside JOBSAGE.");
    } else {
      console.warn("[SmartApply] web navigation", { frame: "main", action: "blocked", ...urlContext });
      Alert.alert("Link blocked", "This destination is not a supported public website. JOBSAGE blocked it to protect your data.");
    }
    return false;
  };

  const onOpenWindow = useCallback((event: WebViewOpenWindowEvent) => {
    const targetUrl = event.nativeEvent.targetUrl;
    const target = classifyEmployerWindowTarget(targetUrl);
    if (target.kind === "in-app") {
      console.info("[SmartApply] new-window link", {
        action: safeLinkLogContext(targetUrl).scheme === "http" ? "upgraded-to-https-in-app" : "in-app",
        ...safeLinkLogContext(targetUrl),
      });
      // target="_blank" and window.open links stay in the controlled browser,
      // where Smart Apply can continue to scan the employer's application form.
      webRef.current?.injectJavaScript(`window.location.assign(${JSON.stringify(target.url)});true;`);
      return;
    }
    if (target.kind === "contact") {
      const handled = showInAppContactLink(targetUrl);
      console.info("[SmartApply] new-window link", {
        action: handled ? "in-app-contact" : "blocked-unsupported-scheme",
        ...safeLinkLogContext(targetUrl),
      });
      if (!handled) Alert.alert("Link unavailable", "This contact or calendar link cannot be opened inside JOBSAGE.");
      return;
    }
    console.warn("[SmartApply] new-window link", {
      action: "blocked",
      ...safeLinkLogContext(targetUrl),
    });
    Alert.alert("Link blocked", "This destination is not a supported public website. JOBSAGE blocked it to protect your data.");
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
      console.info("[SmartApply] application page scan", {
        host: safeLinkLogContext(actualUrl).host,
        applicationPage: message.applicationPage,
        questionCount: message.questions.length,
        structuredFieldCount: message.structuredFields.length,
      });
      setScan(message);
      const stepKey = applicationAssistantStepKey(
        context.id,
        message.context.pageUrl,
        message.questions.map((question) => question.signature || question.id),
      );
      if (message.applicationPage && stepKey && assistantAutoOpenedFor.current !== stepKey) {
        assistantAutoOpenedFor.current = stepKey;
        setAssistantOpen(true);
      }
      return;
    }
    if (message.type === "prefill") {
      console.info("[SmartApply] page prefill result", {
        host: safeLinkLogContext(actualUrl).host,
        filledTypeCount: message.result.filled.length,
        missingTypeCount: message.result.missing.length,
        requiredMissingTypeCount: message.result.requiredMissing.length,
        skippedTypeCount: message.result.skipped.length,
      });
    } else if (message.type === "structured") {
      console.info("[SmartApply] structured profile fill result", {
        host: safeLinkLogContext(actualUrl).host,
        filledCount: message.filled,
      });
    } else if (message.type === "error") {
      console.warn("[SmartApply] employer page rejected a fill command", {
        host: safeLinkLogContext(actualUrl).host,
      });
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
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open Smart Apply assistant"
            accessibilityState={{ expanded: assistantOpen, disabled: !!loadError }}
            disabled={!!loadError}
            onPress={() => {
              setAssistantOpen((o) => !o);
              if (!scan) send({ type: "scan" });
            }}
            style={s.assistantToggle}
            testID="app-browser-assistant"
          >
            <Feather name="layers" size={17} color={colors.accent} />
            <Text style={s.assistantText}>Smart Apply</Text>
          </Pressable>
        </View>

        <View style={{ flex: 1 }}>
          {startUrl && !loadError ? (
            <WebView
              ref={webRef}
              source={{ uri: startUrl }}
              // Wildcard is intentional: non-whitelisted navigations otherwise bypass
              // onShouldStartLoadWithRequest and can be handed to the OS browser.
              originWhitelist={["*"]}
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
              onHttpError={(e) => {
                const { url, statusCode } = e.nativeEvent;
                // Failed images/scripts must not replace a working main page.
                if (statusCode < 400 || url.split("#")[0] !== currentUrlRef.current.split("#")[0]) return;
                console.warn("[SmartApply] employer HTTP response blocked loading", {
                  host: safeLinkLogContext(url).host, status: statusCode,
                });
                setHttpErrorStatus(statusCode);
                setLoadError(statusCode === 403 || statusCode === 401
                  ? `The employer's website refused this request (HTTP ${statusCode}). Smart Apply cannot read the application form until the website allows it to load. You can retry, but JOBSAGE cannot override the website's access restrictions.`
                  : `The employer's website could not load this page (HTTP ${statusCode}). Please retry later.`);
                setLoading(false);
                setScan(null);
                setLastEvent(null);
                setAssistantOpen(false);
              }}
              onError={(e) => {
                console.warn("[SmartApply] employer page load failed", {
                  host: safeLinkLogContext(e.nativeEvent.url).host,
                  code: e.nativeEvent.code,
                });
                setHttpErrorStatus(null);
                setLoadError(e.nativeEvent.description || "The employer page could not be loaded.");
                setLoading(false);
                setScan(null);
                setLastEvent(null);
                setAssistantOpen(false);
              }}
              // Keep async ATS pop-ups working on Android; onOpenWindow routes
              // safe destinations into this browser and rejects unsafe links.
              javaScriptCanOpenWindowsAutomatically
              setSupportMultipleWindows
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
              <Text style={s.errTitle}>{!startUrl ? "Link not allowed"
                : httpErrorStatus === 403 || httpErrorStatus === 401 ? "Website refused access" : "Page unavailable"}</Text>
              <Text style={s.errBody}>
                {startUrl ? loadError : "This application link is not a supported public web address, so it cannot be opened safely in JOBSAGE."}
              </Text>
              {startUrl ? (
                <Pressable style={s.primary} onPress={() => {
                  setHttpErrorStatus(null);
                  setLoadError(null);
                  setLoading(true);
                }} accessibilityRole="button">
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
              key={`${applicationPrefillPageKey(context.id, currentUrl) ?? `${context.id}:${host}`}:${user?.id ?? "signed-out"}`}
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
    titleWrap: { flex: 1, minWidth: 0, alignItems: "center" },
    assistantToggle: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, minHeight: 44, paddingHorizontal: 9, borderRadius: c.radius, borderWidth: 1, borderColor: c.border },
    assistantText: { fontFamily: "Inter_600SemiBold", fontSize: 12, color: c.foreground },
    title: { fontFamily: "Inter_600SemiBold", fontSize: 15, color: c.foreground },
    hostRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
    host: { fontFamily: "Inter_400Regular", fontSize: 12, color: c.mutedForeground, maxWidth: 220, flexShrink: 1 },
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
