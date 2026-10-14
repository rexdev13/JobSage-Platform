import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { getPrivacySettings, registerPushDevice, revokePushDevices } from "@workspace/api-client-react";
import { router } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { resolvePushDestination } from "@/lib/deep-link";
import { hasEnabledNotificationCategory, registerNativePushToken, revokeNativePushToken } from "@/lib/native-push";
import {
  clearStoredPushRegistration,
  loadStoredPushRegistration,
  saveStoredPushRegistration,
} from "@/lib/push-registration-storage";

type RegistrationState = "loading" | "ready" | "working" | "disabling" | "enabled" | "unconfirmed" | "blocked" | "unavailable";

export function PushNotifications() {
  const colors = useColors();
  const { user, token } = useAuth();
  const [state, setState] = useState<RegistrationState>("loading");
  const [message, setMessage] = useState<string | null>(null);
  const registered = useRef<{ accountId: string; authToken: string; pushToken: string } | null>(null);
  const handledResponses = useRef(new Set<string>());
  const userRef = useRef(user);
  userRef.current = user;
  const tokenRef = useRef(token);
  tokenRef.current = token;

  const actor = user ? { id: user.id, role: user.role } : null;
  const handleNotificationResponse = useCallback((response: Notifications.NotificationResponse) => {
    const responseKey = `${response.notification.request.identifier}:${response.actionIdentifier}`;
    if (handledResponses.current.has(responseKey)) return;
    handledResponses.current.add(responseKey);
    const data = response.notification.request.content.data as Record<string, unknown>;
    const decision = resolvePushDestination(data.destination, data.accountId, actor);
    if (decision.kind === "open") {
      router.replace({ pathname: "/workspace", params: { path: decision.path } });
    } else if (decision.kind === "login") {
      router.replace({ pathname: "/login", params: { next: decision.path } });
    }
  }, [user?.id, user?.role]);

  useEffect(() => {
    let active = true;
    if (!user || !token || (Platform.OS !== "ios" && Platform.OS !== "android")) {
      setState("unavailable");
      return;
    }
    setState("loading");
    setMessage(null);
    void (async () => {
      try {
        const stored = await loadStoredPushRegistration();
        if (!active) return;
        const savedForAccount = stored?.accountId === user.id ? stored : null;
        if (savedForAccount) {
          registered.current = {
            accountId: user.id,
            authToken: token,
            pushToken: savedForAccount.pushToken,
          };
          setState("enabled");
        }

        const settings = await getPrivacySettings({ headers: { Authorization: `Bearer ${token}` } });
        if (!active) return;
        if (!hasEnabledNotificationCategory(settings.notifications)) {
          if (savedForAccount) {
            try {
              await revokeNativePushToken({ confirmed: true, token: savedForAccount.pushToken }, {
                accountId: user.id,
                authToken: token,
                revoke: revokePushDevices,
              });
              await clearStoredPushRegistration(savedForAccount);
              registered.current = null;
            } catch {
              setState("enabled");
              setMessage("Notification preferences are off, but this device could not be removed. Try turning notifications off again.");
              return;
            }
          }
          setState("unavailable");
          return;
        }

        if (savedForAccount) {
          const permission = await Notifications.getPermissionsAsync();
          if (!active) return;
          if (permission.granted) {
            setState("enabled");
          } else {
            setState("blocked");
            setMessage("Notifications are blocked for JOBSAGE. Enable them in device settings or turn them off on this device.");
          }
        } else {
          setState("ready");
        }
      } catch {
        if (active) {
          setState(registered.current?.accountId === user.id ? "enabled" : "unavailable");
          setMessage("Notification preferences could not be checked.");
        }
      }
    })();
    return () => { active = false; };
  }, [user?.id, token]);

  useEffect(() => {
    if (Platform.OS !== "ios" && Platform.OS !== "android") return;
    const subscription = Notifications.addNotificationResponseReceivedListener(handleNotificationResponse);
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response) return;
      handleNotificationResponse(response);
      return Notifications.clearLastNotificationResponseAsync();
    }).catch(() => {
      // A missed cold-start response does not affect authenticated in-app navigation.
    });
    return () => subscription.remove();
  }, [handleNotificationResponse]);

  useEffect(() => {
    if (Platform.OS !== "ios" && Platform.OS !== "android") return;
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState !== "active") return;
      const registration = registered.current;
      void Notifications.getPermissionsAsync().then((permission) => {
        if (registration && (
          registered.current !== registration
          || userRef.current?.id !== registration.accountId
        )) return;
        if (registration) {
          setState(permission.granted ? "enabled" : "blocked");
        } else if (permission.granted) {
          setState((current) => current === "blocked" ? "ready" : current);
        }
        setMessage(permission.granted
          ? null
          : "Notifications are blocked for JOBSAGE. Enable them in device settings.");
      }).catch(() => {
        setMessage("Device notification permission could not be checked.");
      });
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    const oldRegistration = registered.current;
    if (!oldRegistration) return;
    if (oldRegistration.accountId === user?.id) {
      if (token && oldRegistration.authToken !== token) {
        registered.current = { ...oldRegistration, authToken: token };
      }
      return;
    }
    registered.current = null;
    void revokeNativePushToken({ confirmed: true, token: oldRegistration.pushToken }, {
      accountId: oldRegistration.accountId,
      authToken: oldRegistration.authToken,
      revoke: revokePushDevices,
    }).then(() => clearStoredPushRegistration({
      accountId: oldRegistration.accountId,
      pushToken: oldRegistration.pushToken,
    })).catch(() => {
      // Account changes must not expose tokens or details in logs.
    });
  }, [user?.id, token]);

  const enable = useCallback(async () => {
    if (!user || !token || (Platform.OS !== "ios" && Platform.OS !== "android")) return;
    const accountId = user.id;
    const authToken = token;
    const stillSameAccount = () => userRef.current?.id === accountId;
    let localRegistration: { accountId: string; pushToken: string } | null = null;
    let registrationRequestStarted = false;
    setState("working");
    setMessage(null);
    try {
      if (Platform.OS === "android") {
        await Notifications.setNotificationChannelAsync("default", {
          name: "JOBSAGE updates",
          importance: Notifications.AndroidImportance.DEFAULT,
        });
      }
      const existing = await Notifications.getPermissionsAsync();
      const permission = existing.granted ? existing : await Notifications.requestPermissionsAsync();
      if (!stillSameAccount()) return;
      if (!permission.granted) {
        setState(permission.canAskAgain ? "ready" : "blocked");
        setMessage(permission.canAskAgain
          ? "Notifications are off. Tap Enable when you are ready."
          : "Notifications are blocked for JOBSAGE. Enable them in device settings.");
        return;
      }
      const projectId = Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId;
      if (!projectId) throw new Error("Push registration needs the approved Expo project configuration.");
      const result = await Notifications.getExpoPushTokenAsync({ projectId });
      if (!result.data) throw new Error("The device did not return a push registration.");
      if (!stillSameAccount()) return;
      localRegistration = { accountId, pushToken: result.data };
      await saveStoredPushRegistration(localRegistration);
      if (!stillSameAccount()) {
        await clearStoredPushRegistration(localRegistration);
        return;
      }
      registrationRequestStarted = true;
      await registerNativePushToken({
        token: result.data,
        platform: Platform.OS,
      }, {
        accountId,
        authToken: tokenRef.current ?? authToken,
        register: registerPushDevice,
      });
      if (!stillSameAccount()) {
        await revokeNativePushToken({ confirmed: true, token: result.data }, {
          accountId,
          authToken,
          revoke: revokePushDevices,
        });
        await clearStoredPushRegistration(localRegistration);
        return;
      }
      registered.current = { ...localRegistration, authToken: tokenRef.current ?? authToken };
      setState("enabled");
      setMessage("Notifications are enabled on this device.");
    } catch {
      if (!stillSameAccount()) return;
      if (localRegistration && registrationRequestStarted) {
        registered.current = { ...localRegistration, authToken: tokenRef.current ?? authToken };
        setState("unconfirmed");
        setMessage("JOBSAGE could not confirm push registration. Retry setup or turn notifications off on this device.");
      } else {
        setState(registered.current?.accountId === accountId ? "enabled" : "ready");
        setMessage("Notifications could not be enabled. Check your connection and approved app configuration, then retry.");
      }
    }
  }, [user?.id, token]);

  const disable = useCallback(async () => {
    const registration = registered.current;
    if (!registration) return;
    setState("disabling");
    setMessage(null);
    try {
      await revokeNativePushToken({ confirmed: true, token: registration.pushToken }, {
        accountId: registration.accountId,
        authToken: registration.authToken,
        revoke: revokePushDevices,
      });
      registered.current = null;
      try {
        await clearStoredPushRegistration({
          accountId: registration.accountId,
          pushToken: registration.pushToken,
        });
      } catch {
        // Server-side revocation succeeded; the local setting can be retried by enabling again.
      }
      setState("ready");
      setMessage("Notifications are off on this device. You can enable them again any time.");
    } catch {
      setState("enabled");
      setMessage("Notifications could not be turned off. Check your connection and try again.");
    }
  }, []);

  if (
    state === "loading"
    || !user
    || Platform.OS === "web"
    || (state === "unavailable" && !message)
  ) return null;
  const enabled = state === "enabled";
  return (
    <View style={[styles.wrap, { backgroundColor: colors.background, borderColor: colors.border }]}>
      <View style={styles.copy}>
        <Text style={[styles.title, { color: colors.foreground }]}>
          {state === "unconfirmed"
            ? "Push setup needs attention"
            : enabled ? "Notifications enabled" : "Get JOBSAGE updates"}
        </Text>
        {message ? <Text accessibilityLiveRegion="polite" style={[styles.message, { color: colors.mutedForeground }]}>{message}</Text> : null}
      </View>
      {state === "blocked" ? (
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open device settings to allow JOBSAGE notifications"
            onPress={() => {
              void Linking.openSettings().catch(() =>
                setMessage("Device settings could not be opened. Find JOBSAGE in your notification settings."),
              );
            }}
            style={[styles.button, { backgroundColor: colors.accent }]}
            testID="open-push-settings"
          >
            <Text style={[styles.buttonText, { color: colors.accentForeground }]}>Settings</Text>
          </Pressable>
          {registered.current ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Turn off JOBSAGE notifications on this device"
              onPress={() => void disable()}
              style={[styles.secondaryButton, { borderColor: colors.border }]}
              testID="disable-push-notifications"
            >
              <Text style={[styles.secondaryButtonText, { color: colors.foreground }]}>Turn off</Text>
            </Pressable>
          ) : null}
        </View>
      ) : state === "unconfirmed" ? (
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retry JOBSAGE push setup"
            onPress={() => void enable()}
            style={[styles.button, { backgroundColor: colors.accent }]}
            testID="retry-push-notifications"
          >
            <Text style={[styles.buttonText, { color: colors.accentForeground }]}>Retry</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Turn off JOBSAGE notifications on this device"
            onPress={() => void disable()}
            style={[styles.secondaryButton, { borderColor: colors.border }]}
            testID="disable-push-notifications"
          >
            <Text style={[styles.secondaryButtonText, { color: colors.foreground }]}>Turn off</Text>
          </Pressable>
        </View>
      ) : state === "enabled" ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Turn off JOBSAGE notifications on this device"
          onPress={() => void disable()}
          style={[styles.secondaryButton, { borderColor: colors.border }]}
          testID="disable-push-notifications"
        >
          <Text style={[styles.secondaryButtonText, { color: colors.foreground }]}>Turn off</Text>
        </Pressable>
      ) : state === "disabling" ? (
        <ActivityIndicator color={colors.accent} />
      ) : !enabled && state !== "unavailable" ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Enable JOBSAGE push notifications"
          disabled={state === "working"}
          onPress={() => void enable()}
          style={[styles.button, { backgroundColor: colors.accent }]}
          testID="enable-push-notifications"
        >
          {state === "working"
            ? <ActivityIndicator color={colors.accentForeground} />
            : <Text style={[styles.buttonText, { color: colors.accentForeground }]}>Enable</Text>}
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { minHeight: 58, paddingHorizontal: 14, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: "row", alignItems: "center", gap: 12 },
  copy: { flex: 1 },
  actions: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontSize: 13, fontWeight: "600" },
  message: { fontSize: 12, marginTop: 2 },
  button: { minHeight: 44, minWidth: 72, paddingHorizontal: 14, alignItems: "center", justifyContent: "center", borderRadius: 10 },
  buttonText: { fontSize: 14, fontWeight: "600" },
  secondaryButton: { minHeight: 44, paddingHorizontal: 12, alignItems: "center", justifyContent: "center", borderRadius: 10, borderWidth: 1 },
  secondaryButtonText: { fontSize: 13, fontWeight: "600" },
});
