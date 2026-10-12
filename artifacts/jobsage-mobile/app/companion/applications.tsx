import { Ionicons } from "@expo/vector-icons";
import { useListMyApplications } from "@workspace/api-client-react";
import React from "react";
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";

type ApplicationStatus =
  | "link_clicked"
  | "applied"
  | "shortlisted"
  | "interview"
  | "offer"
  | "rejected"
  | "no_response"
  | "withdrawn"
  | string;

interface Application {
  id: number;
  roleId: number;
  status: ApplicationStatus;
  appliedAt: string;
  notes?: string | null;
  roleTitle?: string | null;
  roleLocation?: string | null;
  companyName?: string | null;
  applicationUrl?: string | null;
}

const STATUS_CONFIG: Record<
  string,
  { label: string; color: string; bg: string; icon: keyof typeof Ionicons.glyphMap }
> = {
  link_clicked: { label: "Started", color: "#64748b", bg: "#f1f5f9", icon: "open-outline" },
  applied: { label: "Applied", color: "#0ea5e9", bg: "#e0f2fe", icon: "paper-plane-outline" },
  shortlisted: { label: "Shortlisted", color: "#8b5cf6", bg: "#ede9fe", icon: "star-outline" },
  interview: { label: "Interview", color: "#f59e0b", bg: "#fef3c7", icon: "people-outline" },
  offer: { label: "Offer", color: "#22c55e", bg: "#dcfce7", icon: "trophy-outline" },
  rejected: { label: "Rejected", color: "#ef4444", bg: "#fee2e2", icon: "close-circle-outline" },
  no_response: { label: "No Response", color: "#94a3b8", bg: "#f1f5f9", icon: "time-outline" },
  withdrawn: { label: "Withdrawn", color: "#94a3b8", bg: "#f1f5f9", icon: "remove-circle-outline" },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? {
    label: status,
    color: "#64748b",
    bg: "#f1f5f9",
    icon: "ellipsis-horizontal-outline" as keyof typeof Ionicons.glyphMap,
  };

  return (
    <View style={[styles.badge, { backgroundColor: cfg.bg }]}>
      <Ionicons name={cfg.icon} size={11} color={cfg.color} />
      <Text style={[styles.badgeText, { color: cfg.color }]}>{cfg.label}</Text>
    </View>
  );
}

function ApplicationItem({ item }: { item: Application }) {
  const colors = useColors();
  const date = new Date(item.appliedAt).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  return (
    <View style={[styles.appCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.appCardTop}>
        <View style={styles.appCardLeft}>
          <Text style={[styles.appTitle, { color: colors.foreground }]} numberOfLines={2}>
            {item.roleTitle ?? `Role #${item.roleId}`}
          </Text>
           {item.companyName && item.companyName !== item.roleTitle ? (
             <Text style={[styles.company, { color: colors.mutedForeground }]} numberOfLines={1}>
               {item.companyName}
             </Text>
           ) : null}
          {item.roleLocation ? (
            <View style={styles.locationRow}>
              <Ionicons name="location-outline" size={12} color={colors.mutedForeground} />
              <Text style={[styles.location, { color: colors.mutedForeground }]}>
                {item.roleLocation}
              </Text>
            </View>
          ) : null}
        </View>
        <StatusBadge status={item.status} />
      </View>
      <View style={[styles.appCardBottom, { borderTopColor: colors.border }]}>
        <Ionicons name="calendar-outline" size={12} color={colors.mutedForeground} />
        <Text style={[styles.date, { color: colors.mutedForeground }]}>
          {item.status === "link_clicked" ? "Started" : "Applied"} {date}
        </Text>
      </View>
      {item.applicationUrl ? (
        <Pressable
          onPress={() => { void Linking.openURL(item.applicationUrl!); }}
          style={styles.applicationLink}
          accessibilityRole="link"
          accessibilityLabel="Open application page"
        >
          <Ionicons name="open-outline" size={12} color={colors.accent} />
          <Text style={[styles.applicationLinkText, { color: colors.accent }]} numberOfLines={1}>
            View application
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export default function ApplicationsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === "web";

  const { data, isLoading, isError, refetch, isRefetching } = useListMyApplications();

  const topPadding = isWeb ? 67 : insets.top;
  const applications = (data?.applications ?? []) as Application[];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          {
            paddingTop: topPadding + 12,
            backgroundColor: colors.background,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Applications</Text>
        {data?.stats && (
          <View style={styles.statsChips}>
            <View style={[styles.chip, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.chipNum, { color: colors.foreground }]}>{data.stats.total}</Text>
              <Text style={[styles.chipLabel, { color: colors.mutedForeground }]}>Total</Text>
            </View>
            <View style={[styles.chip, { backgroundColor: "#fef3c7", borderColor: "#fde68a" }]}>
              <Text style={[styles.chipNum, { color: "#d97706" }]}>{data.stats.interviews}</Text>
              <Text style={[styles.chipLabel, { color: "#d97706" }]}>Interviews</Text>
            </View>
            <View style={[styles.chip, { backgroundColor: "#dcfce7", borderColor: "#bbf7d0" }]}>
              <Text style={[styles.chipNum, { color: "#16a34a" }]}>{data.stats.offers}</Text>
              <Text style={[styles.chipLabel, { color: "#16a34a" }]}>Offers</Text>
            </View>
          </View>
        )}
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      ) : isError ? (
        <View style={styles.center}>
          <Ionicons name="alert-circle-outline" size={40} color="#ef4444" />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Couldn't load applications</Text>
          <Pressable onPress={() => refetch()} style={[styles.retryBtn, { borderColor: colors.border }]}>
            <Text style={[styles.retryText, { color: colors.foreground }]}>Try Again</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList<Application>
          data={applications}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => <ApplicationItem item={item} />}
          contentContainerStyle={[
            styles.list,
            {
              paddingBottom: (isWeb ? 34 : insets.bottom) + 100,
              flexGrow: applications.length === 0 ? 1 : undefined,
            },
          ]}
          scrollEnabled={applications.length > 0}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={() => { refetch(); }}
              tintColor={colors.accent}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <View style={[styles.emptyIcon, { backgroundColor: colors.muted }]}>
                <Ionicons name="folder-open-outline" size={32} color={colors.mutedForeground} />
              </View>
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
                No applications yet
              </Text>
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                Browse opportunities on the web app and apply to start tracking your progress here.
              </Text>
            </View>
          }
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontSize: 28,
    fontFamily: "Inter_700Bold",
    marginBottom: 14,
  },
  statsChips: {
    flexDirection: "row",
    gap: 8,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
  },
  chipNum: {
    fontSize: 14,
    fontFamily: "Inter_700Bold",
  },
  chipLabel: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
  },
  list: {
    paddingHorizontal: 20,
    paddingTop: 16,
    gap: 10,
  },
  appCard: {
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden",
  },
  appCardTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    padding: 16,
    gap: 12,
  },
  appCardLeft: {
    flex: 1,
    gap: 4,
  },
  appTitle: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    lineHeight: 20,
  },
  locationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  location: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  company: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
  },
  appCardBottom: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: 1,
  },
  date: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  applicationLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  applicationLinkText: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 20,
    flexShrink: 0,
  },
  badgeText: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 12,
    paddingTop: 60,
  },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  emptyTitle: {
    fontSize: 18,
    fontFamily: "Inter_600SemiBold",
    textAlign: "center",
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
});
