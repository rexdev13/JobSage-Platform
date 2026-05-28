import { Ionicons } from "@expo/vector-icons";
import { useGetMyProfile, useLogout } from "@workspace/api-client-react";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";

interface ProfileData {
  profession?: string | null;
  specialty?: string | null;
  qualificationCountry?: string | null;
  registrationStatus?: string | null;
  requiresSponsorship?: boolean | null;
  residencyStatus?: string | null;
}

function AvatarCircle({ name, email }: { name: string; email: string }) {
  const colors = useColors();
  const initials = name
    ? name
        .split(" ")
        .map((n) => n[0])
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : email[0]?.toUpperCase() ?? "?";

  return (
    <View style={[styles.avatar, { backgroundColor: colors.accent }]}>
      <Text style={styles.avatarText}>{initials}</Text>
    </View>
  );
}

function InfoRow({
  icon,
  label,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
}) {
  const colors = useColors();
  return (
    <View style={[styles.infoRow, { borderBottomColor: colors.border }]}>
      <View style={[styles.infoIcon, { backgroundColor: colors.muted }]}>
        <Ionicons name={icon} size={16} color={colors.mutedForeground} />
      </View>
      <View style={styles.infoContent}>
        <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>{label}</Text>
        <Text style={[styles.infoValue, { color: colors.foreground }]}>{value}</Text>
      </View>
    </View>
  );
}

function formatEnum(val: string): string {
  return val.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function ProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuth();
  const isWeb = Platform.OS === "web";
  const [loggingOut, setLoggingOut] = useState(false);

  const topPadding = isWeb ? 67 : insets.top;

  const { data: profile, isLoading } = useGetMyProfile();
  const profileData = profile as ProfileData | undefined;

  const logoutMutation = useLogout({
    mutation: {
      onSettled: async () => {
        await logout();
        setLoggingOut(false);
        router.replace("/login");
      },
    },
  });

  const handleLogout = () => {
    if (Platform.OS === "web") {
      setLoggingOut(true);
      logoutMutation.mutate();
      return;
    }
    Alert.alert("Sign Out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign Out",
        style: "destructive",
        onPress: () => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          setLoggingOut(true);
          logoutMutation.mutate();
        },
      },
    ]);
  };

  const fullName =
    [user?.firstName, user?.lastName].filter(Boolean).join(" ") || "";

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={[
        styles.content,
        { paddingTop: topPadding + 16, paddingBottom: (isWeb ? 34 : insets.bottom) + 100 },
      ]}
      showsVerticalScrollIndicator={false}
    >
      <Text style={[styles.title, { color: colors.foreground }]}>Profile</Text>

      <View style={[styles.userCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <AvatarCircle name={fullName} email={user?.email ?? ""} />
        <View style={styles.userInfo}>
          {fullName ? (
            <Text style={[styles.userName, { color: colors.foreground }]}>{fullName}</Text>
          ) : null}
          <Text style={[styles.userEmail, { color: colors.mutedForeground }]}>
            {user?.email ?? ""}
          </Text>
          {user?.role ? (
            <View style={[styles.roleBadge, { backgroundColor: colors.muted }]}>
              <Text style={[styles.roleText, { color: colors.mutedForeground }]}>
                {formatEnum(user.role)}
              </Text>
            </View>
          ) : null}
        </View>
      </View>

      {isLoading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color={colors.accent} />
          <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>
            Loading profile details...
          </Text>
        </View>
      ) : profileData ? (
        <View style={[styles.detailCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
            Professional Details
          </Text>
          {profileData.profession ? (
            <InfoRow
              icon="medical-outline"
              label="Profession"
              value={formatEnum(profileData.profession)}
            />
          ) : null}
          {profileData.specialty ? (
            <InfoRow
              icon="ribbon-outline"
              label="Specialty"
              value={formatEnum(profileData.specialty)}
            />
          ) : null}
          {profileData.qualificationCountry ? (
            <InfoRow
              icon="globe-outline"
              label="Qualification Country"
              value={profileData.qualificationCountry}
            />
          ) : null}
          {profileData.registrationStatus ? (
            <InfoRow
              icon="document-text-outline"
              label="Registration Status"
              value={formatEnum(profileData.registrationStatus)}
            />
          ) : null}
          {profileData.residencyStatus ? (
            <InfoRow
              icon="home-outline"
              label="Residency Status"
              value={formatEnum(profileData.residencyStatus)}
            />
          ) : null}
          {typeof profileData.requiresSponsorship === "boolean" ? (
            <InfoRow
              icon="briefcase-outline"
              label="Requires Sponsorship"
              value={profileData.requiresSponsorship ? "Yes" : "No"}
            />
          ) : null}
        </View>
      ) : (
        <View
          style={[styles.noProfileCard, { backgroundColor: colors.card, borderColor: colors.border }]}
        >
          <Ionicons name="person-outline" size={32} color={colors.mutedForeground} />
          <Text style={[styles.noProfileText, { color: colors.mutedForeground }]}>
            Complete your profile on the web app to see details here.
          </Text>
        </View>
      )}

      <Pressable
        style={({ pressed }) => [
          styles.logoutBtn,
          { borderColor: "#ef4444", opacity: pressed || loggingOut ? 0.7 : 1 },
        ]}
        onPress={handleLogout}
        disabled={loggingOut}
        testID="logout-button"
      >
        {loggingOut ? (
          <ActivityIndicator size="small" color="#ef4444" />
        ) : (
          <>
            <Ionicons name="log-out-outline" size={18} color="#ef4444" />
            <Text style={styles.logoutText}>Sign Out</Text>
          </>
        )}
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 20,
    gap: 16,
  },
  title: {
    fontSize: 28,
    fontFamily: "Inter_700Bold",
  },
  userCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  avatarText: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    color: "#ffffff",
  },
  userInfo: {
    flex: 1,
    gap: 4,
  },
  userName: {
    fontSize: 18,
    fontFamily: "Inter_600SemiBold",
  },
  userEmail: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
  },
  roleBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    marginTop: 4,
  },
  roleText: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 16,
  },
  loadingText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  detailCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 18,
    gap: 4,
  },
  sectionTitle: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    marginBottom: 8,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  infoIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  infoContent: {
    flex: 1,
  },
  infoLabel: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  infoValue: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
  },
  noProfileCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 24,
    alignItems: "center",
    gap: 10,
  },
  noProfileText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 20,
  },
  logoutBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 14,
    height: 52,
    borderWidth: 1.5,
    marginTop: 8,
  },
  logoutText: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    color: "#ef4444",
  },
});
