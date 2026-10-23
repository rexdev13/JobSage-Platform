import React, { useCallback, useEffect, useRef } from "react";
import { Image, Platform, StyleSheet, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";

const LOGO = require("../assets/images/splash-logo.png");
// Dimensions of the existing full lockup; keep its embedded tagline in the image.
const LOGO_RATIO = 1600 / 351;
const HORIZONTAL_MARGIN = 48;

export interface LaunchScreenProps {
  onReady?: () => void;
  testID?: string;
}

export function LaunchScreen({ onReady, testID }: LaunchScreenProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { width: screenW, height: screenH } = useWindowDimensions();

  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const imageDone = useRef(false);
  const laidOut = useRef(false);
  const fired = useRef(false);
  const mounted = useRef(true);

  const maybeReady = useCallback(() => {
    if (!mounted.current || fired.current || !imageDone.current || !laidOut.current) return;
    fired.current = true;
    onReadyRef.current?.();
  }, []);

  useEffect(() => {
    mounted.current = true;
    maybeReady();
    return () => { mounted.current = false; };
  }, [maybeReady]);

  const usableH = Math.max(0, screenH - insets.top - insets.bottom - HORIZONTAL_MARGIN);
  const baseWidth = Platform.OS === "android" ? 184 : 280;
  const width = Math.max(0, Math.min(baseWidth, screenW - HORIZONTAL_MARGIN, usableH * LOGO_RATIO));
  const height = width / LOGO_RATIO;

  return (
    <View
      style={[StyleSheet.absoluteFill, styles.root, { backgroundColor: colors.launchBackground }]}
      pointerEvents="none"
      testID={testID}
      accessibilityRole="progressbar"
      accessibilityLabel="Loading JOBSAGE workspace"
      accessibilityLiveRegion="polite"
      onLayout={() => { laidOut.current = true; maybeReady(); }}
    >
      <Image
        testID={`${testID ?? "jobsage-launch"}-logo`}
        source={LOGO}
        style={{ width, height }}
        resizeMode="contain"
        accessible={false}
        fadeDuration={0}
        onLoad={() => { imageDone.current = true; maybeReady(); }}
        onError={(e) => {
          console.warn("[JOBSAGE] Launch logo failed to load; releasing launch readiness.", e.nativeEvent?.error ?? null);
          imageDone.current = true;
          maybeReady();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: "center", justifyContent: "center" },
});

export default LaunchScreen;
