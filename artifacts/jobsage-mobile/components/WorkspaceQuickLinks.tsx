import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";

const shortcuts = [
  { id: "opportunities", title: "Job opportunities", detail: "Find roles that match your profile.", path: "/opportunities", icon: "briefcase-outline" },
  { id: "inbox", title: "Messages", detail: "Read employer and JOBSAGE updates.", path: "/inbox", icon: "mail-outline" },
  { id: "calendar", title: "Interview calendar", detail: "Review interviews and respond to invitations.", path: "/calendar", icon: "calendar-outline" },
  { id: "documents", title: "CV and documents", detail: "Manage your CV and supporting documents.", path: "/documents", icon: "document-text-outline" },
] as const;

export function WorkspaceQuickLinks() {
  const colors = useColors();

  return (
    <View style={styles.container}>
      <Text accessibilityRole="header" style={[styles.heading, { color: colors.foreground }]}>
        Continue in JOBSAGE
      </Text>
      <Text style={[styles.description, { color: colors.mutedForeground }]}>
        Open the full workspace for more candidate tools.
      </Text>
      <View style={styles.list}>
        {shortcuts.map((shortcut) => (
          <Pressable
            key={shortcut.id}
            accessibilityRole="button"
            accessibilityLabel={`Open ${shortcut.title}${shortcut.id === "documents" ? "" : " in the full JOBSAGE workspace"}`}
            accessibilityHint={shortcut.detail}
            onPress={() => {
              if (shortcut.id === "documents") {
                router.push("/companion/documents");
                return;
              }
              router.push({
                pathname: "/workspace",
                params: { path: shortcut.path },
              });
            }}
            style={({ pressed }) => [
              styles.row,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                opacity: pressed ? 0.75 : 1,
              },
            ]}
            testID={`workspace-shortcut-${shortcut.id}`}
          >
            <View style={[styles.iconWrap, { backgroundColor: colors.muted }]}>
              <Ionicons name={shortcut.icon} size={20} color={colors.accent} />
            </View>
            <View style={styles.copy}>
              <Text style={[styles.title, { color: colors.foreground }]}>{shortcut.title}</Text>
              <Text style={[styles.detail, { color: colors.mutedForeground }]}>{shortcut.detail}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginTop: 26, gap: 8 },
  heading: { fontSize: 18, fontFamily: "Inter_600SemiBold" },
  description: { fontSize: 13, lineHeight: 19, fontFamily: "Inter_400Regular" },
  list: { marginTop: 4, gap: 10 },
  row: {
    minHeight: 66,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  iconWrap: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  copy: { flex: 1, gap: 3 },
  title: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  detail: { fontSize: 12, lineHeight: 17, fontFamily: "Inter_400Regular" },
});
