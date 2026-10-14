import { useLocalSearchParams } from "expo-router";
import React, { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import { workspaceEntryPath } from "@/lib/workspace-entry-path";
import { WORKSPACE_START_PATH, workspaceUrl } from "@/lib/workspace-config";

/** react-native-webview cannot render on web: send visitors to a useful website route. */
export default function WorkspaceWeb() {
  const colors = useColors();
  const params = useLocalSearchParams<{ path?: string }>();
  const path = workspaceEntryPath(
    typeof params.path === "string" ? params.path : WORKSPACE_START_PATH,
  );
  const target = workspaceUrl(path);

  useEffect(() => {
    if (target && typeof window !== "undefined") window.location.replace(target);
  }, [target]);

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <Text style={[styles.title, { color: colors.foreground }]}>JOBSAGE</Text>
      <Text style={[styles.body, { color: colors.mutedForeground }]}>
        {target ? "Opening the JOBSAGE website..." : "EXPO_PUBLIC_DOMAIN is not set, so the website cannot be opened."}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, paddingTop: 67, paddingBottom: 34, gap: 10 },
  title: { fontFamily: "Inter_700Bold", fontSize: 22, letterSpacing: 4 },
  body: { fontFamily: "Inter_400Regular", fontSize: 14, textAlign: "center" },
});
