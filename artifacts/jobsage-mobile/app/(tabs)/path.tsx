import { Ionicons } from "@expo/vector-icons";
import {
  useGetJourneyStatus,
  getGetJourneyStatusQueryKey,
} from "@workspace/api-client-react";
import type { JourneyStageItem, JourneyBadge } from "@workspace/api-client-react";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Modal,
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

import { useColors } from "@/hooks/useColors";

function ReadinessRing({ score, size = 90 }: { score: number; size?: number }) {
  const colors = useColors();
  const strokeWidth = 8;
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
            cx={size / 2} cy={size / 2} r={radius}
            stroke={colors.border} strokeWidth={strokeWidth} fill="none"
          />
          <Circle
            cx={size / 2} cy={size / 2} r={radius}
            stroke={ringColor} strokeWidth={strokeWidth} fill="none"
            strokeDasharray={`${circumference} ${circumference}`}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
          />
        </G>
      </Svg>
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ fontSize: 18, fontFamily: "Inter_700Bold", color: ringColor }}>{score}%</Text>
          <Text style={{ fontSize: 9, fontFamily: "Inter_400Regular", color: colors.mutedForeground }}>readiness</Text>
        </View>
      </View>
    </View>
  );
}

function StageStatusIcon({ status, locked }: { status: string; locked: boolean }) {
  if (locked) return <Ionicons name="lock-closed-outline" size={18} color="#94a3b8" />;
  if (status === "complete") return <Ionicons name="checkmark-circle" size={18} color="#22c55e" />;
  if (status === "inProgress") return <Ionicons name="radio-button-on" size={18} color="#0ea5e9" />;
  return <Ionicons name="ellipse-outline" size={18} color="#94a3b8" />;
}

function StageTile({
  stage,
  index,
  isLast,
  onPress,
}: {
  stage: JourneyStageItem;
  index: number;
  isLast: boolean;
  onPress: () => void;
}) {
  const colors = useColors();
  const isComplete = stage.status === "complete";
  const isInProgress = stage.status === "inProgress";
  const isLocked = stage.locked;

  const borderColor = isComplete
    ? "#bbf7d0"
    : isInProgress
      ? "#bfdbfe"
      : isLocked
        ? colors.border
        : colors.border;
  const bgColor = isComplete
    ? "#f0fdf4"
    : isInProgress
      ? "#eff6ff"
      : colors.card;

  return (
    <View style={styles.tileRow}>
      {/* Left: index + connector */}
      <View style={styles.tileLeft}>
        <View style={[
          styles.tileIndex,
          {
            backgroundColor: isComplete ? "#22c55e" : isInProgress ? "#0ea5e9" : isLocked ? colors.border : "#f59e0b",
          },
        ]}>
          <Text style={styles.tileIndexText}>{index + 1}</Text>
        </View>
        {!isLast && <View style={[styles.connector, { backgroundColor: colors.border }]} />}
      </View>

      {/* Right: card */}
      <Pressable
        style={[styles.tileCard, { backgroundColor: bgColor, borderColor }]}
        onPress={onPress}
        disabled={isLocked}
        android_ripple={isLocked ? undefined : { color: "#0001" }}
      >
        <View style={styles.tileCardInner}>
          <View style={styles.tileCardHeader}>
            <Text
              style={[styles.tileName, { color: isLocked ? colors.mutedForeground : colors.foreground }]}
              numberOfLines={1}
            >
              {stage.name}
            </Text>
            <StageStatusIcon status={stage.status} locked={isLocked} />
          </View>

          {/* Progress bar */}
          {!isLocked && stage.completionPct > 0 && !isComplete && (
            <View style={{ marginTop: 6 }}>
              <View style={[styles.progressTrack, { backgroundColor: colors.border }]}>
                <View style={[styles.progressFill, { width: `${stage.completionPct}%`, backgroundColor: "#0ea5e9" }]} />
              </View>
              <Text style={[styles.progressLabel, { color: colors.mutedForeground }]}>{stage.completionPct}%</Text>
            </View>
          )}

          {isLocked && stage.nextUnlockHint && (
            <Text style={[styles.tileHint, { color: colors.mutedForeground }]} numberOfLines={2}>
              🔒 {stage.nextUnlockHint}
            </Text>
          )}
        </View>
      </Pressable>
    </View>
  );
}

function StageDrawerModal({
  stage,
  badge,
  onClose,
}: {
  stage: JourneyStageItem | null;
  badge?: JourneyBadge;
  onClose: () => void;
}) {
  const colors = useColors();
  if (!stage) return null;

  const isComplete = stage.status === "complete";
  const isLocked = stage.locked;

  return (
    <Modal
      visible={!!stage}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.drawerOverlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.drawerSheet, { backgroundColor: colors.card }]}>
          {/* Handle */}
          <View style={[styles.drawerHandle, { backgroundColor: colors.border }]} />

          {/* Header */}
          <View style={styles.drawerHeader}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.drawerTitle, { color: colors.foreground }]} numberOfLines={1}>
                {stage.name}
              </Text>
              <Text style={[styles.drawerDesc, { color: colors.mutedForeground }]} numberOfLines={2}>
                {stage.description}
              </Text>
            </View>
            <Pressable onPress={onClose} style={styles.drawerClose}>
              <Ionicons name="close" size={20} color={colors.mutedForeground} />
            </Pressable>
          </View>

          {/* Status badge */}
          <View style={styles.drawerStatusRow}>
            <View style={[
              styles.drawerStatusBadge,
              {
                backgroundColor: isComplete ? "#dcfce7" : isLocked ? colors.muted : stage.status === "inProgress" ? "#dbeafe" : "#fef9c3",
              },
            ]}>
              <StageStatusIcon status={stage.status} locked={isLocked} />
              <Text style={[styles.drawerStatusText, {
                color: isComplete ? "#15803d" : isLocked ? colors.mutedForeground : stage.status === "inProgress" ? "#1d4ed8" : "#a16207",
              }]}>
                {isComplete ? "Complete" : isLocked ? "Locked" : stage.status === "inProgress" ? "In Progress" : "Not Started"}
              </Text>
            </View>
            {!isLocked && !isComplete && (
              <Text style={[styles.drawerPct, { color: colors.mutedForeground }]}>{stage.completionPct}% done</Text>
            )}
          </View>

          {/* Subtasks */}
          {!isLocked && stage.subTasks && stage.subTasks.length > 0 && (
            <View style={styles.drawerSection}>
              <Text style={[styles.drawerSectionTitle, { color: colors.foreground }]}>Checklist</Text>
              {stage.subTasks.map((task) => (
                <View key={task.id} style={styles.drawerSubtask}>
                  <Ionicons
                    name={task.done ? "checkmark-circle" : "ellipse-outline"}
                    size={16}
                    color={task.done ? "#22c55e" : colors.mutedForeground}
                  />
                  <Text style={[styles.drawerSubtaskText, { color: task.done ? colors.mutedForeground : colors.foreground }, task.done && styles.strikethrough]} numberOfLines={2}>
                    {task.label}
                  </Text>
                </View>
              ))}
            </View>
          )}

          {/* Badge */}
          {badge && (
            <View style={[styles.drawerBadge, { backgroundColor: "#fef3c7", borderColor: "#fde68a" }]}>
              <Text style={styles.drawerBadgeEmoji}>{badge.iconName}</Text>
              <View style={{ flex: 1 }}>
                <Text style={[styles.drawerBadgeTitle, { color: "#92400e" }]}>{badge.name}</Text>
                <Text style={[styles.drawerBadgeDesc, { color: "#a16207" }]}>{badge.description}</Text>
              </View>
            </View>
          )}

          {/* Unlock hint */}
          {isLocked && stage.nextUnlockHint && (
            <View style={[styles.drawerLockBox, { backgroundColor: colors.muted, borderColor: colors.border }]}>
              <Ionicons name="lock-closed-outline" size={16} color={colors.mutedForeground} />
              <Text style={[styles.drawerLockText, { color: colors.mutedForeground }]} numberOfLines={3}>
                {stage.nextUnlockHint}
              </Text>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

export default function PathScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const topPadding = isWeb ? 67 : insets.top;

  const { data, isLoading, isError, refetch, isRefetching } = useGetJourneyStatus({
    query: { queryKey: getGetJourneyStatusQueryKey(), staleTime: 30_000 },
  });

  const stages = data?.stages ?? [];
  const badges = data?.badges ?? [];
  const readinessScore = data?.readinessScore ?? 0;
  const nextAction = data?.nextAction ?? null;
  const completeCount = stages.filter((s) => s.status === "complete").length;

  const selectedStage = selectedId ? stages.find((s) => s.id === selectedId) ?? null : null;
  const selectedBadge = selectedStage?.badgeKey
    ? badges.find((b) => b.key === selectedStage.badgeKey)
    : undefined;

  const earnedBadges = badges.filter((b) => b.awardedAt);

  return (
    <>
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
        <Text style={[styles.title, { color: colors.foreground }]}>My Journey</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          10-stage path to UK registration readiness
        </Text>

        {isLoading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={colors.accent} />
            <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>Loading your journey...</Text>
          </View>
        ) : isError ? (
          <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Ionicons name="map-outline" size={40} color={colors.mutedForeground} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Journey unavailable</Text>
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              Sign in on the web app and complete your profile to begin your journey.
            </Text>
            <Pressable onPress={() => refetch()} style={[styles.retryBtn, { borderColor: colors.border }]}>
              <Text style={[styles.retryText, { color: colors.foreground }]}>Retry</Text>
            </Pressable>
          </View>
        ) : (
          <>
            {/* Header card — readiness + next action */}
            <View style={[styles.headerCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <ReadinessRing score={readinessScore} />
              <View style={styles.headerCardInfo}>
                <Text style={[styles.headerCardTitle, { color: colors.foreground }]}>
                  {completeCount}/{stages.length} stages complete
                </Text>
                {nextAction ? (
                  <Text style={[styles.headerCardNext, { color: colors.mutedForeground }]} numberOfLines={2}>
                    Next: {nextAction}
                  </Text>
                ) : completeCount === stages.length ? (
                  <Text style={[styles.headerCardNext, { color: "#22c55e" }]}>🎉 All stages complete!</Text>
                ) : null}
                {/* Progress bar */}
                <View style={[styles.progressTrack, { backgroundColor: colors.border, marginTop: 10 }]}>
                  <View
                    style={[
                      styles.progressFill,
                      {
                        width: stages.length > 0 ? `${(completeCount / stages.length) * 100}%` : "0%",
                        backgroundColor: colors.accent,
                      },
                    ]}
                  />
                </View>
              </View>
            </View>

            {/* Stage list */}
            <View style={styles.stageList}>
              {stages.map((stage, index) => (
                <StageTile
                  key={stage.id}
                  stage={stage}
                  index={index}
                  isLast={index === stages.length - 1}
                  onPress={() => setSelectedId(stage.id)}
                />
              ))}
            </View>

            {/* Earned badges shelf */}
            {earnedBadges.length > 0 && (
              <View style={[styles.badgesCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.badgesTitle, { color: colors.foreground }]}>🏆 Earned Badges</Text>
                <View style={styles.badgesGrid}>
                  {earnedBadges.map((badge) => (
                    <View key={badge.key} style={[styles.badgePill, { backgroundColor: "#fef3c7", borderColor: "#fde68a" }]}>
                      <Text style={styles.badgePillEmoji}>{badge.iconName}</Text>
                      <Text style={[styles.badgePillLabel, { color: "#92400e" }]} numberOfLines={1}>{badge.name}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}
          </>
        )}
      </ScrollView>

      <StageDrawerModal
        stage={selectedStage}
        badge={selectedBadge}
        onClose={() => setSelectedId(null)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 20 },
  title: { fontSize: 28, fontFamily: "Inter_700Bold", marginBottom: 4 },
  subtitle: { fontSize: 14, fontFamily: "Inter_400Regular", marginBottom: 20 },
  center: { alignItems: "center", paddingTop: 60, gap: 16 },
  loadingText: { fontSize: 14, fontFamily: "Inter_400Regular" },
  emptyCard: {
    borderRadius: 16, borderWidth: 1, padding: 28,
    alignItems: "center", gap: 10, marginTop: 12,
  },
  emptyTitle: { fontSize: 18, fontFamily: "Inter_600SemiBold", textAlign: "center", marginTop: 4 },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
  retryBtn: { paddingVertical: 10, paddingHorizontal: 20, borderRadius: 10, borderWidth: 1, marginTop: 4 },
  retryText: { fontSize: 14, fontFamily: "Inter_500Medium" },

  headerCard: {
    borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 20,
    flexDirection: "row", alignItems: "center", gap: 16,
  },
  headerCardInfo: { flex: 1, gap: 4 },
  headerCardTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  headerCardNext: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },
  progressTrack: { height: 6, borderRadius: 3, overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: 3 },

  stageList: { gap: 0, marginBottom: 20 },

  tileRow: { flexDirection: "row", gap: 12 },
  tileLeft: { alignItems: "center", width: 28 },
  tileIndex: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: "center", justifyContent: "center",
  },
  tileIndexText: { fontSize: 11, fontFamily: "Inter_700Bold", color: "#fff" },
  connector: { width: 2, flex: 1, marginVertical: 2, minHeight: 12, borderRadius: 1 },
  tileCard: {
    flex: 1, borderRadius: 12, borderWidth: 1,
    marginBottom: 8, overflow: "hidden",
  },
  tileCardInner: { padding: 12, gap: 4 },
  tileCardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  tileName: { flex: 1, fontSize: 13, fontFamily: "Inter_600SemiBold" },
  tileHint: { fontSize: 11, fontFamily: "Inter_400Regular", lineHeight: 16 },
  progressLabel: { fontSize: 10, fontFamily: "Inter_400Regular", marginTop: 2 },

  badgesCard: { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 12 },
  badgesTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginBottom: 12 },
  badgesGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  badgePill: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, borderWidth: 1,
  },
  badgePillEmoji: { fontSize: 14 },
  badgePillLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", maxWidth: 90 },

  drawerOverlay: {
    flex: 1, justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  drawerSheet: {
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingBottom: 40, paddingTop: 12,
    maxHeight: "80%",
  },
  drawerHandle: {
    width: 40, height: 4, borderRadius: 2,
    alignSelf: "center", marginBottom: 16,
  },
  drawerHeader: { flexDirection: "row", gap: 12, alignItems: "flex-start", marginBottom: 12 },
  drawerTitle: { fontSize: 18, fontFamily: "Inter_700Bold", marginBottom: 2 },
  drawerDesc: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
  drawerClose: { padding: 4 },
  drawerStatusRow: {
    flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 16,
  },
  drawerStatusBadge: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20,
  },
  drawerStatusText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  drawerPct: { fontSize: 12, fontFamily: "Inter_400Regular" },
  drawerSection: { marginBottom: 16 },
  drawerSectionTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold", marginBottom: 8 },
  drawerSubtask: { flexDirection: "row", alignItems: "flex-start", gap: 8, marginBottom: 6 },
  drawerSubtaskText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
  strikethrough: { textDecorationLine: "line-through", opacity: 0.5 },
  drawerBadge: {
    flexDirection: "row", alignItems: "center", gap: 10,
    padding: 12, borderRadius: 12, borderWidth: 1, marginBottom: 12,
  },
  drawerBadgeEmoji: { fontSize: 24 },
  drawerBadgeTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  drawerBadgeDesc: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  drawerLockBox: {
    flexDirection: "row", alignItems: "flex-start", gap: 8,
    padding: 12, borderRadius: 12, borderWidth: 1,
  },
  drawerLockText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },
});
