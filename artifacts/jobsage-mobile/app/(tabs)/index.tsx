import { Ionicons } from "@expo/vector-icons";
import { useGetMyAnalytics } from "@workspace/api-client-react";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Svg, { Circle, G } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";

function ReadinessRing({ score, size = 180 }: { score: number; size?: number }) {
  const colors = useColors();
  const strokeWidth = 14;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.min(Math.max(score, 0), 100) / 100;
  const strokeDashoffset = circumference * (1 - progress);

  const ringColor =
    score >= 80 ? "#22c55e" : score >= 60 ? "#0ea5e9" : score >= 40 ? "#f59e0b" : "#ef4444";

  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Svg width={size} height={size}>
        <G rotation="-90" origin={`${size / 2},${size / 2}`}>
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={colors.border}
            strokeWidth={strokeWidth}
            fill="none"
          />
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={ringColor}
            strokeWidth={strokeWidth}
            fill="none"
            strokeDasharray={`${circumference} ${circumference}`}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
          />
        </G>
      </Svg>
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ fontSize: 42, fontFamily: "Inter_700Bold", color: ringColor }}>
            {score}
          </Text>
          <Text style={{ fontSize: 12, fontFamily: "Inter_500Medium", color: colors.mutedForeground, marginTop: 2 }}>
            READINESS
          </Text>
        </View>
      </View>
    </View>
  );
}

function StatCard({
  label,
  value,
  icon,
  accent,
}: {
  label: string;
  value: number;
  icon: keyof typeof Ionicons.glyphMap;
  accent: string;
}) {
  const colors = useColors();
  return (
    <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={[styles.statIcon, { backgroundColor: `${accent}18` }]}>
        <Ionicons name={icon} size={18} color={accent} />
      </View>
      <Text style={[styles.statValue, { color: colors.foreground }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{label}</Text>
    </View>
  );
}

export default function DashboardScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const isWeb = Platform.OS === "web";

  const { data, isLoading, isError, refetch, isRefetching } = useGetMyAnalytics();

  const topPadding = isWeb ? 67 : insets.top;

  const greeting = () => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 18) return "Good afternoon";
    return "Good evening";
  };

  const firstName = user?.firstName ?? user?.email?.split("@")[0] ?? "there";

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={[
        styles.content,
        { paddingTop: topPadding + 16, paddingBottom: (isWeb ? 34 : insets.bottom) + 100 },
      ]}
      refreshControl={
        <RefreshControl
          refreshing={isRefetching}
          onRefresh={() => { refetch(); }}
          tintColor={colors.accent}
        />
      }
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.headerRow}>
        <View>
          <Text style={[styles.greeting, { color: colors.mutedForeground }]}>
            {greeting()},
          </Text>
          <Text style={[styles.name, { color: colors.foreground }]}>{firstName}</Text>
        </View>
        <View style={[styles.logoTag, { backgroundColor: colors.primary }]}>
          <Ionicons name="pulse" size={14} color={colors.primaryForeground} />
          <Text style={[styles.logoTagText, { color: colors.primaryForeground }]}>JOBSAGE</Text>
        </View>
      </View>

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.accent} />
          <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>
            Loading your data...
          </Text>
        </View>
      ) : isError ? (
        <View style={[styles.errorCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Ionicons name="alert-circle-outline" size={32} color="#ef4444" />
          <Text style={[styles.errorTitle, { color: colors.foreground }]}>
            Couldn't load your data
          </Text>
          <Text style={[styles.errorSub, { color: colors.mutedForeground }]}>
            Make sure your profile is set up on the web app first.
          </Text>
          <Pressable
            style={[styles.retryBtn, { borderColor: colors.border }]}
            onPress={() => refetch()}
          >
            <Text style={[styles.retryText, { color: colors.foreground }]}>Try Again</Text>
          </Pressable>
        </View>
      ) : data ? (
        <>
          <View style={[styles.ringCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <ReadinessRing score={data.readinessScore} />
            <Text style={[styles.ringLabel, { color: colors.mutedForeground }]}>
              UK Registration Readiness Score
            </Text>
          </View>

          <View style={styles.statsRow}>
            <StatCard
              label="Applied"
              value={data.statusBreakdown.applied + data.statusBreakdown.shortlisted}
              icon="paper-plane-outline"
              accent="#0ea5e9"
            />
            <StatCard
              label="Interviews"
              value={data.statusBreakdown.interview}
              icon="people-outline"
              accent="#8b5cf6"
            />
            <StatCard
              label="Offers"
              value={data.statusBreakdown.offer}
              icon="trophy-outline"
              accent="#22c55e"
            />
          </View>

          {data.readinessBreakdown && (
            <View style={[styles.breakdownCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
                Score Breakdown
              </Text>
              {[
                { label: "Eligibility", value: data.readinessBreakdown.eligibility, color: "#0ea5e9" },
                { label: "Plan Progress", value: data.readinessBreakdown.planProgress, color: "#8b5cf6" },
                { label: "Documents", value: data.readinessBreakdown.documents, color: "#f59e0b" },
                { label: "Applications", value: data.readinessBreakdown.applications, color: "#22c55e" },
                { label: "Profile", value: data.readinessBreakdown.profileComplete, color: "#ec4899" },
              ].map((item) => (
                <View key={item.label} style={styles.breakdownRow}>
                  <Text style={[styles.breakdownLabel, { color: colors.mutedForeground }]}>
                    {item.label}
                  </Text>
                  <View style={[styles.barTrack, { backgroundColor: colors.border }]}>
                    <View
                      style={[
                        styles.barFill,
                        {
                          backgroundColor: item.color,
                          width: `${Math.min(item.value, 100)}%`,
                        },
                      ]}
                    />
                  </View>
                  <Text style={[styles.breakdownValue, { color: colors.foreground }]}>
                    {item.value}
                  </Text>
                </View>
              ))}
            </View>
          )}

          {data.predictiveInsight ? (
            <LinearGradient
              colors={["#0ea5e9", "#0284c7"]}
              style={styles.insightCard}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
            >
              <View style={styles.insightHeader}>
                <Ionicons name="sparkles" size={16} color="rgba(255,255,255,0.9)" />
                <Text style={styles.insightLabel}>AI Insight</Text>
              </View>
              <Text style={styles.insightText}>{data.predictiveInsight}</Text>
              {data.disclaimer ? (
                <Text style={styles.insightDisclaimer}>{data.disclaimer}</Text>
              ) : null}
            </LinearGradient>
          ) : null}

          <Pressable
            style={({ pressed }) => [
              styles.ctaButton,
              { backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1 },
            ]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.push("/(tabs)/path");
            }}
            testID="view-path-button"
          >
            <Ionicons name="map-outline" size={18} color={colors.primaryForeground} />
            <Text style={[styles.ctaText, { color: colors.primaryForeground }]}>
              View My Path
            </Text>
            <Ionicons name="chevron-forward" size={18} color={colors.primaryForeground} />
          </Pressable>
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 20,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 24,
  },
  greeting: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  name: {
    fontSize: 24,
    fontFamily: "Inter_700Bold",
    marginTop: 2,
  },
  logoTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
  },
  logoTagText: {
    fontSize: 12,
    fontFamily: "Inter_700Bold",
    letterSpacing: 1,
  },
  loadingContainer: {
    alignItems: "center",
    paddingTop: 80,
    gap: 16,
  },
  loadingText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  errorCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 24,
    alignItems: "center",
    gap: 8,
    marginTop: 20,
  },
  errorTitle: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    marginTop: 8,
  },
  errorSub: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 20,
  },
  retryBtn: {
    marginTop: 8,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 10,
    borderWidth: 1,
  },
  retryText: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
  },
  ringCard: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 24,
    alignItems: "center",
    marginBottom: 16,
    gap: 12,
  },
  ringLabel: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  statsRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 16,
  },
  statCard: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    alignItems: "center",
    gap: 6,
  },
  statIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  statValue: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
  },
  statLabel: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  breakdownCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 18,
    marginBottom: 16,
    gap: 12,
  },
  sectionTitle: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    marginBottom: 4,
  },
  breakdownRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  breakdownLabel: {
    width: 80,
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  barTrack: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    overflow: "hidden",
  },
  barFill: {
    height: "100%",
    borderRadius: 3,
  },
  breakdownValue: {
    width: 28,
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    textAlign: "right",
  },
  insightCard: {
    borderRadius: 16,
    padding: 18,
    marginBottom: 16,
    gap: 8,
  },
  insightHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  insightLabel: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    color: "rgba(255,255,255,0.85)",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  insightText: {
    fontSize: 15,
    fontFamily: "Inter_500Medium",
    color: "#ffffff",
    lineHeight: 22,
  },
  insightDisclaimer: {
    fontSize: 10,
    fontFamily: "Inter_400Regular",
    color: "rgba(255,255,255,0.5)",
    lineHeight: 14,
  },
  ctaButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 14,
    height: 52,
    marginBottom: 16,
  },
  ctaText: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
});
