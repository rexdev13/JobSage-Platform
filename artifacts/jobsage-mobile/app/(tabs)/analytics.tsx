import { Ionicons } from "@expo/vector-icons";
import { useGetMyAnalytics } from "@workspace/api-client-react";
import { LinearGradient } from "expo-linear-gradient";
import React, { useState } from "react";
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

interface MonthlyEntry {
  month: string;
  total: number;
  applied: number;
  shortlisted: number;
  interview: number;
  offer: number;
  rejected: number;
  no_response: number;
}

const STATUS_COLORS: Record<string, string> = {
  applied: "#0ea5e9",
  shortlisted: "#8b5cf6",
  interview: "#f59e0b",
  offer: "#22c55e",
  rejected: "#ef4444",
  no_response: "#94a3b8",
};

const STATUS_LABELS: Record<string, string> = {
  applied: "Applied",
  shortlisted: "Shortlisted",
  interview: "Interview",
  offer: "Offer",
  rejected: "Rejected",
  no_response: "No Response",
};

type ChartMode = "total" | "applied" | "interview" | "offer" | "rejected";

const CHART_MODES: { key: ChartMode; label: string; color: string }[] = [
  { key: "total", label: "Total", color: "#64748b" },
  { key: "applied", label: "Applied", color: "#0ea5e9" },
  { key: "interview", label: "Interview", color: "#f59e0b" },
  { key: "offer", label: "Offer", color: "#22c55e" },
  { key: "rejected", label: "Rejected", color: "#ef4444" },
];

function MonthlyBarChart({
  data,
  mode,
}: {
  data: MonthlyEntry[];
  mode: ChartMode;
}) {
  const colors = useColors();
  const activeMode = CHART_MODES.find((m) => m.key === mode)!;

  const values = data.map((d) => d[mode]);
  const maxVal = Math.max(...values, 1);

  return (
    <View style={styles.chartContainer}>
      <View style={styles.barsRow}>
        {data.map((entry, i) => {
          const val = entry[mode];
          const pct = (val / maxVal) * 100;
          const shortMonth = entry.month.slice(0, 3);

          return (
            <View key={i} style={styles.barColumn}>
              <Text style={[styles.barValue, { color: colors.foreground }]}>
                {val > 0 ? val : ""}
              </Text>
              <View style={[styles.barTrack, { backgroundColor: colors.border }]}>
                <View
                  style={[
                    styles.barFill,
                    {
                      height: `${pct}%`,
                      backgroundColor: pct > 0 ? activeMode.color : "transparent",
                    },
                  ]}
                />
              </View>
              <Text style={[styles.barLabel, { color: colors.mutedForeground }]}>
                {shortMonth}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function StatusDonut({ breakdown }: { breakdown: Record<string, number> }) {
  const colors = useColors();
  const keys = Object.keys(STATUS_COLORS);
  const total = keys.reduce((s, k) => s + (breakdown[k] ?? 0), 0) || 1;

  return (
    <View style={styles.donutWrapper}>
      {keys.map((key) => {
        const val = breakdown[key] ?? 0;
        const pct = Math.round((val / total) * 100);
        if (val === 0) return null;
        return (
          <View key={key} style={styles.donutRow}>
            <View style={[styles.donutDot, { backgroundColor: STATUS_COLORS[key] }]} />
            <Text style={[styles.donutLabel, { color: colors.foreground }]}>
              {STATUS_LABELS[key]}
            </Text>
            <View style={[styles.donutBarTrack, { backgroundColor: colors.border }]}>
              <View
                style={[
                  styles.donutBarFill,
                  { width: `${pct}%`, backgroundColor: STATUS_COLORS[key] },
                ]}
              />
            </View>
            <Text style={[styles.donutPct, { color: colors.mutedForeground }]}>
              {val}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function SummaryCard({
  label,
  value,
  sub,
  accent,
  icon,
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent: string;
  icon: keyof typeof Ionicons.glyphMap;
}) {
  const colors = useColors();
  return (
    <View style={[styles.summaryCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={[styles.summaryIcon, { backgroundColor: `${accent}18` }]}>
        <Ionicons name={icon} size={18} color={accent} />
      </View>
      <Text style={[styles.summaryValue, { color: colors.foreground }]}>{value}</Text>
      <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>{label}</Text>
      {sub ? (
        <Text style={[styles.summarySub, { color: accent }]}>{sub}</Text>
      ) : null}
    </View>
  );
}

export default function AnalyticsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";
  const [chartMode, setChartMode] = useState<ChartMode>("total");

  const { data, isLoading, isError, refetch, isRefetching } = useGetMyAnalytics();

  const topPadding = isWeb ? 67 : insets.top;

  const monthly: MonthlyEntry[] = data?.monthlyApplications ?? [];
  const breakdown = data?.statusBreakdown;
  const totalAll = breakdown
    ? Object.values(breakdown).reduce((s, v) => s + v, 0)
    : 0;
  const conversionRate =
    breakdown && totalAll > 0
      ? Math.round(((breakdown.interview + breakdown.offer) / totalAll) * 100)
      : 0;
  const offerRate =
    breakdown && totalAll > 0
      ? Math.round((breakdown.offer / totalAll) * 100)
      : 0;

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
      <Text style={[styles.title, { color: colors.foreground }]}>Analytics</Text>
      <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
        Your application performance over time
      </Text>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.accent} />
          <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>
            Loading analytics...
          </Text>
        </View>
      ) : isError ? (
        <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Ionicons name="bar-chart-outline" size={40} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
            No analytics available
          </Text>
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            Apply to some roles on the web app to start building your analytics.
          </Text>
          <Pressable
            onPress={() => refetch()}
            style={[styles.retryBtn, { borderColor: colors.border }]}
          >
            <Text style={[styles.retryText, { color: colors.foreground }]}>Retry</Text>
          </Pressable>
        </View>
      ) : data ? (
        <>
          <View style={styles.summaryRow}>
            <SummaryCard
              label="Total"
              value={totalAll}
              icon="paper-plane-outline"
              accent="#0ea5e9"
            />
            <SummaryCard
              label="Interview rate"
              value={`${conversionRate}%`}
              icon="people-outline"
              accent="#f59e0b"
            />
            <SummaryCard
              label="Offer rate"
              value={`${offerRate}%`}
              icon="trophy-outline"
              accent="#22c55e"
            />
          </View>

          {data.streakDays != null && data.streakDays > 0 ? (
            <LinearGradient
              colors={["#f59e0b", "#d97706"]}
              style={styles.streakBanner}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
            >
              <Ionicons name="flame" size={20} color="#ffffff" />
              <Text style={styles.streakText}>
                {data.streakDays}-day activity streak — keep it up!
              </Text>
            </LinearGradient>
          ) : null}

          {monthly.length > 0 ? (
            <View
              style={[
                styles.chartCard,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
                Monthly Applications
              </Text>

              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.modeScroll}
                contentContainerStyle={styles.modeRow}
              >
                {CHART_MODES.map((m) => (
                  <Pressable
                    key={m.key}
                    onPress={() => setChartMode(m.key)}
                    style={[
                      styles.modeChip,
                      chartMode === m.key
                        ? { backgroundColor: m.color }
                        : { backgroundColor: colors.muted, borderColor: colors.border, borderWidth: 1 },
                    ]}
                  >
                    <Text
                      style={[
                        styles.modeChipText,
                        { color: chartMode === m.key ? "#ffffff" : colors.mutedForeground },
                      ]}
                    >
                      {m.label}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>

              <MonthlyBarChart data={monthly} mode={chartMode} />
            </View>
          ) : (
            <View
              style={[
                styles.chartCard,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
                Monthly Applications
              </Text>
              <View style={styles.noDataRow}>
                <Ionicons name="bar-chart-outline" size={28} color={colors.mutedForeground} />
                <Text style={[styles.noDataText, { color: colors.mutedForeground }]}>
                  No monthly data yet. Apply to roles to see your trend.
                </Text>
              </View>
            </View>
          )}

          {breakdown ? (
            <View
              style={[
                styles.chartCard,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
                Status Breakdown
              </Text>
              <StatusDonut breakdown={breakdown} />
            </View>
          ) : null}

          {data.predictiveInsight ? (
            <View
              style={[
                styles.insightCard,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <View style={styles.insightHeader}>
                <Ionicons name="sparkles" size={16} color={colors.accent} />
                <Text style={[styles.insightTitle, { color: colors.foreground }]}>
                  AI Insight
                </Text>
              </View>
              <Text style={[styles.insightText, { color: colors.mutedForeground }]}>
                {data.predictiveInsight}
              </Text>
              {data.disclaimer ? (
                <Text style={[styles.disclaimerText, { color: colors.mutedForeground }]}>
                  {data.disclaimer}
                </Text>
              ) : null}
            </View>
          ) : null}
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 20 },
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
  center: { alignItems: "center", paddingTop: 60, gap: 16 },
  loadingText: { fontSize: 14, fontFamily: "Inter_400Regular" },
  emptyCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 28,
    alignItems: "center",
    gap: 10,
    marginTop: 12,
  },
  emptyTitle: { fontSize: 18, fontFamily: "Inter_600SemiBold", textAlign: "center", marginTop: 4 },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
  retryBtn: { paddingVertical: 10, paddingHorizontal: 20, borderRadius: 10, borderWidth: 1, marginTop: 4 },
  retryText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  summaryRow: { flexDirection: "row", gap: 10, marginBottom: 16 },
  summaryCard: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    alignItems: "center",
    gap: 5,
  },
  summaryIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  summaryValue: { fontSize: 20, fontFamily: "Inter_700Bold" },
  summaryLabel: { fontSize: 10, fontFamily: "Inter_500Medium", textTransform: "uppercase", letterSpacing: 0.5, textAlign: "center" },
  summarySub: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  streakBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 16,
  },
  streakText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#ffffff", flex: 1 },
  chartCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 18,
    marginBottom: 16,
    gap: 14,
  },
  sectionTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  modeScroll: { marginHorizontal: -2 },
  modeRow: { gap: 6, flexDirection: "row" },
  modeChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  modeChipText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  chartContainer: { height: 180 },
  barsRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 4,
  },
  barColumn: {
    flex: 1,
    alignItems: "center",
    height: "100%",
    justifyContent: "flex-end",
    gap: 3,
  },
  barValue: { fontSize: 9, fontFamily: "Inter_600SemiBold", minHeight: 12 },
  barTrack: {
    width: "100%",
    height: 130,
    borderRadius: 4,
    overflow: "hidden",
    justifyContent: "flex-end",
  },
  barFill: { width: "100%", borderRadius: 4 },
  barLabel: { fontSize: 9, fontFamily: "Inter_500Medium", textAlign: "center" },
  donutWrapper: { gap: 10 },
  donutRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  donutDot: { width: 10, height: 10, borderRadius: 5, flexShrink: 0 },
  donutLabel: { width: 88, fontSize: 13, fontFamily: "Inter_400Regular" },
  donutBarTrack: { flex: 1, height: 8, borderRadius: 4, overflow: "hidden" },
  donutBarFill: { height: "100%", borderRadius: 4 },
  donutPct: { width: 24, fontSize: 12, fontFamily: "Inter_600SemiBold", textAlign: "right" },
  noDataRow: { alignItems: "center", gap: 10, paddingVertical: 20 },
  noDataText: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
  insightCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 18,
    gap: 8,
    marginBottom: 4,
  },
  insightHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  insightTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  insightText: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 21 },
  disclaimerText: {
    fontSize: 10,
    fontFamily: "Inter_400Regular",
    lineHeight: 14,
    opacity: 0.6,
  },
});
