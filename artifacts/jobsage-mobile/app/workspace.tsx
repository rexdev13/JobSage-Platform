import { Feather } from "@expo/vector-icons";
import { safeInternalPath, validateWorkspaceMessage } from "@workspace/mobile-core";
import {
  createMobileSessionGrant,
  getCurrentAuthUser,
  getMobileApplicationContext,
  redeemMobileSessionGrant,
  logout as revokeNativeSession,
} from "@workspace/api-client-react";
import type { MobileApplicationContext } from "@workspace/api-client-react";
import * as Network from "expo-network";
import { useLocalSearchParams } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  BackHandler,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useColorScheme,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import WebView from "react-native-webview";
import type { WebViewMessageEvent, WebViewSource } from "react-native-webview/lib/WebViewTypes";
import type { ShouldStartLoadRequest } from "react-native-webview/lib/WebViewTypes";

import { NativeApplicationBrowser } from "@/components/NativeApplicationBrowser";
import { getNativeAuthRevision, getNativeSessionToken, getNativeSessionUserId, useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { classifyUrl, openExternal } from "@/lib/external-links";
import { DownloadError, cleanupTempDownloads, cleanupPrivateExportFiles, downloadAndShare } from "@/lib/native-download";
import {
  NativeProof,
  WORKSPACE_ORIGIN,
  WORKSPACE_START_PATH,
  createNativeProof,
  isFirstPartyUrl,
  workspaceUrl,
} from "@/lib/workspace-config";

const SESSION_CHECK_AFTER_MS = 5 * 60_000;

function bridgeScript(origin: string, proof: NativeProof) {
  const config = JSON.stringify({ version: 1, channel: proof.channel, challenge: proof.challenge });
  return `(function(){try{if(location.origin!==${JSON.stringify(origin)})return;
Object.defineProperty(window,"__JOBSAGE_NATIVE__",{value:Object.freeze(${config}),writable:false,configurable:false});
}catch(e){}})();true;`;
}

function errorStatus(e: unknown): number | undefined {
  const s = (e as { status?: unknown })?.status;
  return typeof s === "number" ? s : undefined;
}

async function discardUnusedSession(token: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    await revokeNativeSession({ signal: controller.signal, headers: { Authorization: `Bearer ${token}` } });
  } catch {
    console.warn("An unused native session could not be revoked.");
  } finally { clearTimeout(timer); }
}

export default function WorkspaceScreen() {
  const colors = useColors();
  const scheme = useColorScheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ path?: string }>();
  const { user, token, isLoading, login, logout } = useAuth();
  const network = Network.useNetworkState();

  const webRef = useRef<WebView>(null);
  const [proof, setProof] = useState<NativeProof | null>(null);
  const [source, setSource] = useState<WebViewSource | null>(null);
  const [webKey, setWebKey] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pageLoading, setPageLoading] = useState(true);
  const [canGoBack, setCanGoBack] = useState(false);
  const [appContext, setAppContext] = useState<MobileApplicationContext | null>(null);
  const previousUserId = useRef<string | null>(null);
  useEffect(() => {
    const id = user?.id ?? null;
    if (previousUserId.current && previousUserId.current !== id) {
      setAppContext(null);
      cleanupTempDownloads(previousUserId.current);
    }
    previousUserId.current = id;
  }, [user?.id]);

  const initialized = useRef(false);
  const lastUrl = useRef<string | null>(null);
  const usedCodes = useRef(new Set<string>());
  const redeeming = useRef(false);
  const pendingSessionCode = useRef<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; pendingSessionCode.current = null; };
  }, []);
  const backgroundedAt = useRef<number | null>(null);
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const userRef = useRef(user);
  userRef.current = user;
  const loginRef = useRef(login);
  loginRef.current = login;
  const logoutRef = useRef(logout);
  logoutRef.current = logout;

  const startPath = (typeof params.path === "string" && safeInternalPath(params.path)) || WORKSPACE_START_PATH;
  const startUrl = workspaceUrl(startPath);

  useEffect(() => {
    let alive = true;
    createNativeProof()
      .then((p) => alive && setProof(p))
      .catch(() => alive && setLoadError("Secure session setup is unavailable on this device."));
    return () => {
      alive = false;
      cleanupTempDownloads();
    };
  }, []);

  // Decide the initial source exactly once. Later token changes (e.g. a login
  // from a web session message) never remount or re-exchange the WebView.
  useEffect(() => {
    if (initialized.current || isLoading || !proof || !startUrl || !WORKSPACE_ORIGIN) return;
    initialized.current = true;
    const existing = getNativeSessionToken();
    if (!existing) {
      setSource({ uri: startUrl });
      return;
    }
    let alive = true;
    let completed = false;
    const revision = getNativeAuthRevision();
    (async () => {
      try {
        const exchange = await createNativeProof();
        if (!alive) return;
        const grant = await createMobileSessionGrant({
          challenge: exchange.challenge,
          audience: "web",
          nextPath: startPath,
        }, { headers: { Authorization: `Bearer ${existing}` } });
        if (!alive) return;
        if (getNativeAuthRevision() !== revision) { setSource({ uri: startUrl }); return; }
        const body = `code=${encodeURIComponent(grant.code)}&verifier=${encodeURIComponent(exchange.verifier)}`;
        setSource({
          uri: `${WORKSPACE_ORIGIN}/api/auth/mobile/session-exchange`,
          method: "POST",
          body,
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        });
      } catch (e) {
        if (!alive) return;
        if (getNativeAuthRevision() === revision && errorStatus(e) === 401) await logoutRef.current().catch(() => undefined);
        if (alive) setSource({ uri: startUrl });
      } finally { completed = true; }
    })();
    return () => {
      alive = false;
      if (!completed) initialized.current = false;
    };
  }, [isLoading, proof, startUrl, startPath]);

  // Lifecycle: re-validate the native session after the app has been away.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") {
        backgroundedAt.current = Date.now();
        return;
      }
      const away = backgroundedAt.current ? Date.now() - backgroundedAt.current : 0;
      backgroundedAt.current = null;
      const checkingToken = getNativeSessionToken();
      const checkingUserId = getNativeSessionUserId();
      const revision = getNativeAuthRevision();
      if (away < SESSION_CHECK_AFTER_MS || !checkingToken) return;
      getCurrentAuthUser({ cache: "no-store", headers: { Authorization: `Bearer ${checkingToken}` } })
        .then((current) => {
          if (!mounted.current || getNativeAuthRevision() !== revision) return;
          if (!current.user?.id || current.user.id !== checkingUserId) {
            void logoutRef.current().catch(() => undefined);
          }
        })
        .catch((e) => {
          if (mounted.current && getNativeAuthRevision() === revision && errorStatus(e) === 401) void logoutRef.current().catch(() => undefined);
        });
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (appContext) return false;
      if (canGoBack) {
        webRef.current?.goBack();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [canGoBack, appContext]);

  const retry = useCallback(() => {
    const target = lastUrl.current && isFirstPartyUrl(lastUrl.current) ? lastUrl.current : startUrl;
    if (!target) return;
    setLoadError(null);
    setSource({ uri: target });
    setWebKey((k) => k + 1);
  }, [startUrl]);

  const handleSession = useCallback(async (code: string): Promise<void> => {
    if (!proof || !mounted.current || usedCodes.current.has(code)) return;
    if (redeeming.current) { pendingSessionCode.current = code; return; }
    usedCodes.current.add(code);
    redeeming.current = true;
    const revision = getNativeAuthRevision();
    let unusedToken: string | null = null;
    try {
      const result = await redeemMobileSessionGrant({ code, verifier: proof.verifier });
      unusedToken = result.token;
      if (!mounted.current || getNativeAuthRevision() !== revision) return;
      const u = result.user;
      if (!u?.id || !u.email) return;
      await loginRef.current(result.token, {
        id: String(u.id),
        email: u.email,
        firstName: u.firstName ?? null,
        lastName: u.lastName ?? null,
        role: u.role ?? null,
      });
      unusedToken = null;
    } catch {
      // A failed redemption leaves the website cookie session intact; native
      // features that need a bearer will ask the user to sign in again.
    } finally {
      if (unusedToken) void discardUnusedSession(unusedToken);
      redeeming.current = false;
      const next = pendingSessionCode.current;
      pendingSessionCode.current = null;
      if (next && mounted.current) void handleSession(next);
    }
  }, [proof]);

  const handleApplication = useCallback(async (applicationId: number) => {
    const initiatingToken = tokenRef.current;
    if (!initiatingToken) {
      Alert.alert("Sign in required", "Please sign in to open this application.");
      return;
    }
    try {
      const ctx = await getMobileApplicationContext(applicationId);
      if (tokenRef.current !== initiatingToken) return;
      const where = [ctx.jobTitle, ctx.companyName].filter(Boolean).join(" at ");
      Alert.alert(
        "Open employer application?",
        `${where ? `${where}. ` : ""}You will leave JOBSAGE and continue on the employer's website inside a secure browser.`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Continue", onPress: () => {
            if (tokenRef.current === initiatingToken) setAppContext(ctx);
          } },
        ],
      );
    } catch {
      Alert.alert("Application unavailable", "We could not open this application. Please try again.");
    }
  }, []);

  useEffect(() => {
    try { cleanupPrivateExportFiles(); }
    catch { Alert.alert("Private-file cleanup failed", "Restart JOBSAGE before downloading a personal-data archive."); }
  }, []);

  const onMessage = useCallback((event: WebViewMessageEvent) => {
    if (!proof || !WORKSPACE_ORIGIN) return;
    // Only the OS-reported WebView URL is trusted; the page's claimed URL must match it.
    const actualUrl = event.nativeEvent.url;
    if (typeof actualUrl !== "string" || !isFirstPartyUrl(actualUrl)) return;
    const message = validateWorkspaceMessage(event.nativeEvent.data, {
      origin: WORKSPACE_ORIGIN,
      navigationUrl: actualUrl,
      channel: proof.channel,
    });
    if (!message) return;
    // Recover from SPA pushState where onNavigationStateChange may lag.
    if (!actualUrl.includes("/api/auth/mobile/session-exchange")) lastUrl.current = actualUrl;
    switch (message.type) {
      case "ready":
        return;
      case "session":
        void handleSession(message.code);
        return;
      case "logout":
        if (tokenRef.current || userRef.current) void logoutRef.current().catch(() => undefined);
        return;
      case "application":
        void handleApplication(message.applicationId);
        return;
      case "download":
        downloadAndShare({ url: message.downloadUrl, filename: message.filename, token: tokenRef.current }).catch((e) =>
          Alert.alert("Download failed", e instanceof DownloadError ? e.message : "The file could not be downloaded."),
        );
        return;
      case "privacy-export": {
        if (!userRef.current || getNativeSessionUserId() !== message.expectedAccountId) {
          Alert.alert("Export blocked", "Review this action in the signed-in account.");
          return;
        }
        const target = workspaceUrl("/api/privacy/export");
        if (!target) return;
        const verification = typeof message.emailCodeProof === "string"
          ? { emailCodeProof: message.emailCodeProof }
          : typeof message.password === "string" ? { password: message.password } : null;
        if (!verification) {
          Alert.alert("Export blocked", "Verify your account before downloading.");
          return;
        }
        void downloadAndShare({
          url: target, filename: "JOBSAGE-personal-data.zip", token: tokenRef.current,
          privateExport: { expectedAccountId: message.expectedAccountId, ...verification, confirmed: true },
        }).catch(e => Alert.alert("Export failed", e instanceof DownloadError ? e.message : "No export could be delivered."));
        return;
      }
      case "open-url": {
        const dest = message.destination;
        if (dest.startsWith("/") || isFirstPartyUrl(dest)) {
          const url = dest.startsWith("/") ? workspaceUrl(dest) : dest;
          if (url) webRef.current?.injectJavaScript(`location.assign(${JSON.stringify(url)});true;`);
          return;
        }
        void openExternal(dest).then((ok) => {
          if (!ok) Alert.alert("Link blocked", "This link cannot be opened safely.");
        });
        return;
      }
    }
  }, [proof, handleSession, handleApplication]);

  const onShouldStart = useCallback((req: ShouldStartLoadRequest) => {
    const kind = classifyUrl(req.url);
    if (kind === "first-party") return true;
    if (req.isTopFrame === false) return kind === "https";
    if (kind === "https" || kind === "system") void openExternal(req.url);
    return false;
  }, []);

  const s = styles(colors);
  const offline = network.isConnected === false || network.isInternetReachable === false;

  if (!WORKSPACE_ORIGIN || !startUrl) {
    return (
      <View style={[s.root, s.center, { paddingTop: insets.top }]}>
        <Feather name="settings" size={28} color={colors.mutedForeground} />
        <Text style={s.errTitle}>Workspace not configured</Text>
        <Text style={s.errBody}>EXPO_PUBLIC_DOMAIN is not set for this build, so the JOBSAGE workspace cannot be reached.</Text>
      </View>
    );
  }

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      {offline ? (
        <View style={s.banner} accessibilityLiveRegion="polite">
          <Feather name="wifi-off" size={14} color={colors.accentForeground} />
          <Text style={s.bannerText}>You are offline. Changes will not be saved until you reconnect.</Text>
        </View>
      ) : null}

      <View style={{ flex: 1 }}>
        {Platform.OS === "web" ? (
          <View style={[StyleSheet.absoluteFill, s.center, { backgroundColor: colors.background }]} testID="workspace-web-preview-fallback">
            <Feather name="smartphone" size={28} color={colors.accent} />
            <Text style={[s.errTitle, { marginTop: 16 }]}>Native workspace required</Text>
            <Text style={s.errBody}>
              This browser-based Expo preview does not run the native WebView used by the JOBSAGE workspace.
            </Text>
            <Pressable
              style={s.primary}
              onPress={() => {
                const loginUrl = workspaceUrl("/login");
                if (loginUrl) void Linking.openURL(loginUrl);
              }}
              accessibilityRole="link"
              accessibilityLabel="Open JOBSAGE sign in in your browser"
            >
              <Text style={s.primaryText}>Open JOBSAGE in a browser</Text>
            </Pressable>
          </View>
        ) : source && !loadError ? (
          <WebView
            key={webKey}
            ref={webRef}
            source={source}
            injectedJavaScriptBeforeContentLoaded={proof ? bridgeScript(WORKSPACE_ORIGIN, proof) : undefined}
            injectedJavaScriptBeforeContentLoadedForMainFrameOnly
            onMessage={onMessage}
            onShouldStartLoadWithRequest={onShouldStart}
            originWhitelist={["https://*", "mailto:*", "tel:*", "webcal:*", "about:*"]}
            onNavigationStateChange={(n) => {
              if (isFirstPartyUrl(n.url) && !n.url.includes("/api/auth/mobile/session-exchange")) lastUrl.current = n.url;
              setCanGoBack(n.canGoBack);
            }}
            onLoadStart={() => setPageLoading(true)}
            onLoadEnd={() => setPageLoading(false)}
            onError={(e) => setLoadError(e.nativeEvent.description || "The page could not be loaded.")}
            onHttpError={(e) => {
              if (e.nativeEvent.statusCode >= 500 && e.nativeEvent.url === lastUrl.current) {
                setLoadError(`JOBSAGE is temporarily unavailable (${e.nativeEvent.statusCode}).`);
              }
            }}
            onContentProcessDidTerminate={() => webRef.current?.reload()}
            onRenderProcessGone={() => retry()}
            allowsBackForwardNavigationGestures
            pullToRefreshEnabled={false}
            sharedCookiesEnabled
            thirdPartyCookiesEnabled={false}
            javaScriptCanOpenWindowsAutomatically={false}
            setSupportMultipleWindows={false}
            allowFileAccess={false}
            allowFileAccessFromFileURLs={false}
            allowUniversalAccessFromFileURLs={false}
            mixedContentMode="never"
            webviewDebuggingEnabled={__DEV__}
            keyboardDisplayRequiresUserAction={false}
            hideKeyboardAccessoryView={false}
            automaticallyAdjustContentInsets={false}
            contentInsetAdjustmentBehavior="never"
            style={{ backgroundColor: colors.background }}
            containerStyle={{ paddingBottom: insets.bottom, backgroundColor: colors.background }}
            testID="workspace-webview"
          />
        ) : loadError ? (
          <View style={s.center}>
            <Feather name={offline ? "wifi-off" : "alert-triangle"} size={28} color={offline ? colors.mutedForeground : colors.destructive} />
            <Text style={s.errTitle}>{offline ? "No connection" : "Something went wrong"}</Text>
            <Text style={s.errBody}>{offline ? "Reconnect to the internet to continue in JOBSAGE." : loadError}</Text>
            <Pressable style={s.primary} onPress={retry} accessibilityRole="button" testID="workspace-retry">
              <Feather name="refresh-cw" size={16} color={colors.accentForeground} />
              <Text style={s.primaryText}>Retry</Text>
            </Pressable>
          </View>
        ) : null}

        {(!source || pageLoading) && !loadError ? (
          <View style={[StyleSheet.absoluteFill, s.center, { backgroundColor: colors.background }]} pointerEvents="none">
            <Text style={s.wordmark}>JOBSAGE</Text>
            <ActivityIndicator color={colors.accent} style={{ marginTop: 16 }} />
          </View>
        ) : null}
      </View>

      {appContext ? (
        <NativeApplicationBrowser context={appContext} visible onClose={() => setAppContext(null)} />
      ) : null}
    </View>
  );
}

const styles = (c: ReturnType<typeof useColors>) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: c.background },
    center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 10 },
    wordmark: { fontFamily: "Inter_700Bold", fontSize: 22, letterSpacing: 4, color: c.foreground },
    errTitle: { fontFamily: "Inter_600SemiBold", fontSize: 18, color: c.foreground },
    errBody: { fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 20, color: c.mutedForeground, textAlign: "center", marginBottom: 8 },
    primary: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 20, height: 44, borderRadius: c.radius, backgroundColor: c.accent },
    primaryText: { fontFamily: "Inter_600SemiBold", fontSize: 15, color: c.accentForeground },
    banner: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: c.primary },
    bannerText: { flex: 1, fontFamily: "Inter_500Medium", fontSize: 13, color: c.primaryForeground },
  });
