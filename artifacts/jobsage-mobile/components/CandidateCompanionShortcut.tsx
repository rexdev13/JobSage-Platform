import { Feather } from "@expo/vector-icons";
import {
  getListEmployerOrganizationsQueryKey,
  useListEmployerOrganizations,
} from "@workspace/api-client-react";
import { router } from "expo-router";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { canAccessCandidateCompanion } from "@/lib/role-access";

export function CandidateCompanionShortcut({ role }: { role: string | null | undefined }) {
  const colors = useColors();
  const { user } = useAuth();
  const organizationsQuery = useListEmployerOrganizations({
    query: {
      queryKey: [...getListEmployerOrganizationsQueryKey(), user?.id ?? "anonymous"],
      enabled: role === "candidate" && !!user?.id,
      retry: false,
      staleTime: 0,
      refetchOnMount: "always",
    },
  });
  if (
    organizationsQuery.isLoading
    || organizationsQuery.isFetching
    || organizationsQuery.isError
    || !organizationsQuery.data
    || !canAccessCandidateCompanion(role, user?.id, organizationsQuery.data)
  ) {
    return null;
  }

  return (
    <Pressable
      style={({ pressed }) => [
        styles.shortcut,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderRadius: colors.radius,
          opacity: pressed ? 0.72 : 1,
        },
      ]}
      onPress={() => router.push("/companion")}
      accessibilityRole="button"
      accessibilityLabel="Open candidate companion"
      testID="workspace-companion-link"
    >
      <Feather name="grid" size={18} color={colors.accent} />
      <View style={styles.copy}>
        <Text style={[styles.title, { color: colors.foreground }]}>Candidate companion</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          Progress, applications, and profile
        </Text>
      </View>
      <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  shortcut: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 58,
    marginHorizontal: 12,
    marginTop: 8,
    marginBottom: 8,
    paddingHorizontal: 14,
    borderWidth: 1,
  },
  copy: { flex: 1, gap: 2 },
  title: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
  subtitle: { fontFamily: "Inter_400Regular", fontSize: 12 },
});
