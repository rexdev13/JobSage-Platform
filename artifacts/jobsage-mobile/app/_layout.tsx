import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { setBaseUrl } from "@workspace/api-client-react";
import Constants from "expo-constants";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import React, { useCallback, useEffect, useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { LaunchScreen } from "@/components/LaunchScreen";
import colors from "@/constants/colors";
import { AuthProvider } from "@/context/AuthContext";
import { cleanupInterruptedDocumentUploads } from "@/lib/document-upload";
import { getNativeNotifications } from "@/lib/notification-runtime";

if (process.env.EXPO_PUBLIC_DOMAIN) {
  setBaseUrl(`https://${process.env.EXPO_PUBLIC_DOMAIN}`);
}

const Notifications = getNativeNotifications();
if (Notifications) {
  Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
  });
}

if (Platform.OS !== "web") {
  // Keep this at module scope: waiting for a React effect is too late on cold starts.
  void SplashScreen.preventAutoHideAsync().catch((error: unknown) => {
    console.warn("Could not retain the native splash screen.", error);
  });
  if (Constants.executionEnvironment !== "storeClient") {
    SplashScreen.setOptions({ fade: true, duration: 200 });
  }
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
});

export const unstable_settings = { initialRouteName: "workspace" };

function RootLayoutNav() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="workspace" options={{ headerShown: false, gestureEnabled: false }} />
      <Stack.Screen name="companion" options={{ headerShown: false }} />
      <Stack.Screen name="login" options={{ headerShown: false, animation: "fade" }} />
    </Stack>
  );
}

export default function RootLayout() {
  const [navigationLaidOut, setNavigationLaidOut] = useState(false);
  const [launchImageReady, setLaunchImageReady] = useState(false);
  const [handoffComplete, setHandoffComplete] = useState(false);
  const onNavigationLayout = useCallback(() => setNavigationLaidOut(true), []);
  const onLaunchReady = useCallback(() => setLaunchImageReady(true), []);
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if ((Platform.OS !== "web" && !fontsLoaded && !fontError) || !navigationLaidOut || !launchImageReady) return;

    // Layout and image decoding must both finish before revealing React content.
    // Keep the matching overlay painted until native dismissal has been requested.
    let active = true;
    const frame = requestAnimationFrame(() => {
      const hide = Platform.OS === "web" ? Promise.resolve() : SplashScreen.hideAsync();
      void hide.catch((error: unknown) => {
        console.warn("Could not dismiss the native splash screen.", error);
      }).finally(() => {
        if (active) setHandoffComplete(true);
      });
    });
    return () => {
      active = false;
      cancelAnimationFrame(frame);
    };
  }, [fontsLoaded, fontError, navigationLaidOut, launchImageReady]);

  useEffect(() => {
    try {
      cleanupInterruptedDocumentUploads();
    } catch {
      // The Documents screen retries cleanup and blocks new uploads if it still fails.
    }
  }, []);

  // A slow web font request must not leave the entire browser preview blank.
  // The browser can render with its system fallback while Inter finishes loading.
  if (Platform.OS !== "web" && !fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <GestureHandlerRootView style={styles.root}>
            <KeyboardProvider>
              <AuthProvider>
                <View style={styles.root} onLayout={onNavigationLayout}>
                  <RootLayoutNav />
                  {!handoffComplete ? (
                    <>
                      <StatusBar style="dark" />
                      <LaunchScreen onReady={onLaunchReady} testID="startup-splash-handoff" />
                    </>
                  ) : null}
                </View>
              </AuthProvider>
            </KeyboardProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.light.launchBackground },
});
