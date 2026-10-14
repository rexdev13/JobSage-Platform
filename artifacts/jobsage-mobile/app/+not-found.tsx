import { Link, Redirect, Stack, useRouter } from "expo-router";
import * as Linking from "expo-linking";
import React, { useEffect, useMemo } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { resolveJobsageDeepLink } from "@/lib/deep-link";

export default function NotFoundScreen() {
  const colors = useColors();
  const router = useRouter();
  const url = Linking.useURL();
  const { user, isLoading } = useAuth();
  const decision = useMemo(
    () => resolveJobsageDeepLink(url, user ? { id: user.id, role: user.role } : null),
    [url, user],
  );

  useEffect(() => {
    if (isLoading || decision.kind === "invalid" || decision.kind === "forbidden") return;
    if (decision.kind === "login") {
      router.replace({ pathname: "/login", params: { next: decision.path } });
      return;
    }
    router.replace({ pathname: "/workspace", params: { path: decision.path } });
  }, [decision, isLoading, router]);

  if (isLoading || decision.kind === "open" || decision.kind === "login") {
    return <View style={[styles.container, { backgroundColor: colors.background }]}><ActivityIndicator accessibilityLabel="Opening JOBSAGE link" color={colors.primary} /></View>;
  }

  return (
    <>
      <Stack.Screen options={{ title: "Oops!" }} />
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Text style={[styles.title, { color: colors.foreground }]} accessibilityRole="header">
          {decision.kind === "forbidden" ? "This link belongs to another account or role." : "This link is invalid or unavailable."}
        </Text>

        <Link href="/workspace" style={styles.link}>
          <Text style={[styles.linkText, { color: colors.primary }]}>
            Go to JOBSAGE
          </Text>
        </Link>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  title: {
    fontSize: 20,
    fontWeight: "bold",
  },
  link: {
    marginTop: 15,
    paddingVertical: 15,
  },
  linkText: {
    fontSize: 14,
  },
});
