import React, { useCallback, useEffect, useRef } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";

export interface LaunchScreenProps {
  onReady?: () => void;
  testID?: string;
}

export function LaunchScreen({ onReady, testID }: LaunchScreenProps) {
  const colors = useColors();

  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const laidOut = useRef(false);
  const fired = useRef(false);
  const mounted = useRef(true);

  const maybeReady = useCallback(() => {
    if (!mounted.current || fired.current || !laidOut.current) return;
    fired.current = true;
    onReadyRef.current?.();
  }, []);

  useEffect(() => {
    mounted.current = true;
    maybeReady();
    return () => { mounted.current = false; };
  }, [maybeReady]);

  return (
    <View
      style={[StyleSheet.absoluteFill, styles.root, { backgroundColor: colors.background }]}
      pointerEvents="none"
      testID={testID}
      accessibilityRole="progressbar"
      accessibilityLabel="Loading JOBSAGE workspace"
      accessibilityLiveRegion="polite"
      onLayout={() => { laidOut.current = true; maybeReady(); }}
    >
      <Text style={[styles.wordmark, { color: colors.foreground }]}>JOBSAGE</Text>
      <ActivityIndicator
        testID={`${testID ?? "jobsage-launch"}-spinner`}
        size="large"
        color={colors.accent}
        style={styles.spinner}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: "center", justifyContent: "center", padding: 32 },
  wordmark: { fontFamily: "Inter_700Bold", fontSize: 22, letterSpacing: 4 },
  spinner: { marginTop: 16 },
});

export default LaunchScreen;
