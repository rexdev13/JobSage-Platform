import { Redirect, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { LaunchScreen } from "@/components/LaunchScreen";
import { useColors } from "@/hooks/useColors";

export default function SplashPreviewScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colors = useColors();

  if (!__DEV__) {
    return <Redirect href="/workspace" />;
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.launchBackground }]}>
      <StatusBar style="dark" />
      <LaunchScreen testID="persistent-splash-preview" />
      <View
        pointerEvents="box-none"
        style={[styles.actionArea, { paddingBottom: Math.max(insets.bottom, 16) + 20 }]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Continue to JOBSAGE"
          onPress={() => router.replace("/workspace")}
          style={({ pressed }) => [
            styles.button,
            { backgroundColor: colors.primary, opacity: pressed ? 0.82 : 1 },
          ]}
        >
          <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>
            Continue to JOBSAGE
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  actionArea: {
    ...StyleSheet.absoluteFill,
    justifyContent: "flex-end",
    alignItems: "center",
    paddingHorizontal: 24,
  },
  button: {
    minHeight: 48,
    minWidth: 200,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  buttonText: {
    fontSize: 15,
    fontWeight: "600",
  },
});
