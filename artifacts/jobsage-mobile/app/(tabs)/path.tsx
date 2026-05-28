import { Ionicons } from "@expo/vector-icons";
import { useGetRemediationPlan } from "@workspace/api-client-react";
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
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";

type StepStatus = "planned" | "in_progress" | "done" | string;

interface RemediationStep {
  id: number;
  stepOrder: number;
  title: string;
  description: string;
  gap?: string;
  status: StepStatus;
}

interface RemediationPlan {
  id: number;
  steps: RemediationStep[];
}

const STEP_CONFIG: Record<
  string,
  { icon: keyof typeof Ionicons.glyphMap; color: string; bg: string; label: string }
> = {
  done: { icon: "checkmark-circle", color: "#22c55e", bg: "#dcfce7", label: "Complete" },
  in_progress: { icon: "radio-button-on", color: "#0ea5e9", bg: "#e0f2fe", label: "In Progress" },
  planned: { icon: "ellipse-outline", color: "#94a3b8", bg: "#f1f5f9", label: "Planned" },
};

function StepCard({ step, index }: { step: RemediationStep; index: number }) {
  const colors = useColors();
  const cfg = STEP_CONFIG[step.status] ?? STEP_CONFIG.planned;

  return (
    <View style={[styles.stepCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.stepLeft}>
        <View style={[styles.stepIconWrap, { backgroundColor: cfg.bg }]}>
          <Ionicons name={cfg.icon} size={20} color={cfg.color} />
        </View>
        {index > 0 && (
          <View style={[styles.connector, { backgroundColor: colors.border }]} />
        )}
      </View>
      <View style={styles.stepBody}>
        <View style={styles.stepHeader}>
          <Text
            style={[
              styles.stepTitle,
              { color: colors.foreground },
              step.status === "done" && styles.strikethrough,
            ]}
            numberOfLines={2}
          >
            {step.title}
          </Text>
          <View style={[styles.stepBadge, { backgroundColor: cfg.bg }]}>
            <Text style={[styles.stepBadgeText, { color: cfg.color }]}>{cfg.label}</Text>
          </View>
        </View>
        {step.description ? (
          <Text
            style={[styles.stepDesc, { color: colors.mutedForeground }]}
            numberOfLines={3}
          >
            {step.description}
          </Text>
        ) : null}
        {step.gap ? (
          <View style={[styles.gapTag, { backgroundColor: colors.muted }]}>
            <Ionicons name="warning-outline" size={12} color={colors.mutedForeground} />
            <Text style={[styles.gapText, { color: colors.mutedForeground }]} numberOfLines={1}>
              {step.gap}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

export default function PathScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";

  const { data, isLoading, isError, refetch, isRefetching } = useGetRemediationPlan();
  const plan = data as RemediationPlan | undefined;

  const topPadding = isWeb ? 67 : insets.top;

  const steps = plan?.steps ?? [];
  const doneCount = steps.filter((s) => s.status === "done").length;
  const total = steps.length;
  const progressPct = total > 0 ? (doneCount / total) * 100 : 0;

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
      <Text style={[styles.title, { color: colors.foreground }]}>My Path</Text>
      <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
        Steps to UK registration readiness
      </Text>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.accent} />
          <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>
            Loading your path...
          </Text>
        </View>
      ) : isError ? (
        <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Ionicons name="map-outline" size={40} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
            No path generated yet
          </Text>
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            Run your eligibility check on the web app to generate your personalised path to UK registration.
          </Text>
          <Pressable
            onPress={() => refetch()}
            style={[styles.retryBtn, { borderColor: colors.border }]}
          >
            <Text style={[styles.retryText, { color: colors.foreground }]}>Refresh</Text>
          </Pressable>
        </View>
      ) : steps.length === 0 ? (
        <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Ionicons name="map-outline" size={40} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
            No path generated yet
          </Text>
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            Run your eligibility check on the web app to generate your personalised path to UK registration.
          </Text>
        </View>
      ) : (
        <>
          <View style={[styles.progressCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.progressRow}>
              <Text style={[styles.progressLabel, { color: colors.foreground }]}>
                {doneCount} of {total} steps complete
              </Text>
              <Text style={[styles.progressPct, { color: colors.accent }]}>
                {Math.round(progressPct)}%
              </Text>
            </View>
            <View style={[styles.progressTrack, { backgroundColor: colors.border }]}>
              <View
                style={[
                  styles.progressFill,
                  { backgroundColor: colors.accent, width: `${progressPct}%` },
                ]}
              />
            </View>
          </View>

          <View style={styles.stepList}>
            {steps.map((step, index) => (
              <StepCard key={step.id} step={step} index={index} />
            ))}
          </View>
        </>
      )}
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
  title: {
    fontSize: 28,
    fontFamily: "Inter_700Bold",
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    marginBottom: 24,
  },
  center: {
    alignItems: "center",
    paddingTop: 60,
    gap: 16,
  },
  loadingText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  emptyCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 28,
    alignItems: "center",
    gap: 10,
    marginTop: 12,
  },
  emptyTitle: {
    fontSize: 18,
    fontFamily: "Inter_600SemiBold",
    textAlign: "center",
    marginTop: 4,
  },
  emptyText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 20,
  },
  retryBtn: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 4,
  },
  retryText: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
  },
  progressCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    marginBottom: 20,
    gap: 10,
  },
  progressRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  progressLabel: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
  },
  progressPct: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
  },
  progressTrack: {
    height: 8,
    borderRadius: 4,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 4,
  },
  stepList: {
    gap: 10,
  },
  stepCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    flexDirection: "row",
    gap: 12,
    alignItems: "flex-start",
  },
  stepLeft: {
    alignItems: "center",
    gap: 4,
  },
  stepIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  connector: {
    width: 2,
    height: 10,
    borderRadius: 1,
  },
  stepBody: {
    flex: 1,
    gap: 6,
  },
  stepHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 8,
  },
  stepTitle: {
    flex: 1,
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    lineHeight: 19,
  },
  strikethrough: {
    textDecorationLine: "line-through",
    opacity: 0.5,
  },
  stepBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 20,
    flexShrink: 0,
  },
  stepBadgeText: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
  },
  stepDesc: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 18,
  },
  gapTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    alignSelf: "flex-start",
  },
  gapText: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
  },
});
