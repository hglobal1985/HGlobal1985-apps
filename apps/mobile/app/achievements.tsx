import { useEffect } from "react";
import { trackFeature } from "@/lib/feature-track";
import { router } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";
import type { Achievement } from "@/api/client";
import { conditionText } from "@/features/achievements/text";
import { dateOnly } from "@/features/format";
import { useApi, useSession } from "@/state/session";
import { useTheme } from "@/theme/theme";
import { radius, space } from "@/theme/tokens";
import { GuestGate, AppText, EmptyState, ErrorView, LoadingView, Screen } from "@/ui";

/** 集滿這麼多枚徽章解鎖書櫃鑰匙（與後端 LIBRARY_KEY_BADGES 相同）。 */
const KEY_BADGES = 100;

/** 學習成就：達成條件就會獲得徽章；還沒達成的顯示目前進度。 */
export default function AchievementsScreen() {
  const { c } = useTheme();
  const { member } = useSession();
  const { data, error, loading, reload } = useApi<Achievement[]>(member ? "/me/achievements" : null);
  useEffect(() => (member ? trackFeature("achievements_view") : undefined), [member]);
  if (!member)
    return (
      <Screen header={false}>
        <GuestGate icon="trophy-outline" body="登入後可以查看你的學習徽章。" />
      </Screen>
    );
  const earned = (data ?? []).filter((a) => a.earned);
  return (
    <Screen header={false}>
      {error && !data ? <ErrorView message={error} onRetry={reload} /> : null}
      {loading && !data ? <LoadingView /> : null}
      {data ? (
        <AppText variant="title">
          已取得 {earned.length} / {data.length} 枚徽章
        </AppText>
      ) : null}
      {data && !data.length ? <EmptyState icon="trophy-outline" title="目前還沒有徽章" body="管理員設定徽章後，達成條件就能獲得。" /> : null}
      {data ? (
        <Pressable accessibilityRole="button" accessibilityLabel="書櫃鑰匙解鎖條件" onPress={() => router.push("/library")} style={[styles.key, { backgroundColor: c.surface, borderColor: earned.length >= KEY_BADGES ? c.accent : c.border }]}>
          <AppText style={styles.icon}>🔑</AppText>
          <View style={{ flex: 1, gap: 4 }}>
            <AppText variant="headline">解鎖「我的書櫃」鑰匙</AppText>
            <AppText variant="caption" tone="muted">
              獲得任意 {KEY_BADGES} 枚徽章，就能解鎖個人專屬的書櫃。
            </AppText>
            {earned.length >= KEY_BADGES ? (
              <AppText variant="caption" style={{ color: c.accentText, fontWeight: "700" }}>
                已解鎖，點一下進入我的書櫃
              </AppText>
            ) : (
              <View style={{ gap: 2 }}>
                <View style={[styles.track, { backgroundColor: c.border }]}>
                  <View style={{ height: 6, width: `${(earned.length / KEY_BADGES) * 100}%`, backgroundColor: c.accent, borderRadius: 3 }} />
                </View>
                <AppText variant="caption" tone="muted">
                  {earned.length} / {KEY_BADGES} 枚
                </AppText>
              </View>
            )}
          </View>
        </Pressable>
      ) : null}
      <View style={styles.grid}>
        {(data ?? []).map((a) => (
          <View key={a.id} style={[styles.card, { backgroundColor: c.surface, borderColor: a.earned ? c.accent : c.border, opacity: a.earned ? 1 : 0.6 }]} accessibilityLabel={`${a.name}，${a.earned ? "已取得" : "尚未取得"}`}>
            <AppText style={[styles.icon, !a.earned && { opacity: 0.35 }]}>{a.icon}</AppText>
            <AppText variant="headline" style={{ textAlign: "center" }} numberOfLines={2}>
              {a.name}
            </AppText>
            <AppText variant="caption" tone="muted" style={{ textAlign: "center" }} numberOfLines={3}>
              {a.description || conditionText(a.type, a.threshold, a.courseTitle, a.feature)}
            </AppText>
            {a.earned ? (
              <AppText variant="caption" style={{ color: c.accentText, fontWeight: "700" }}>
                {a.earnedAt ? `${dateOnly(a.earnedAt)} 取得` : "已取得"}
              </AppText>
            ) : a.type === "course_completed" ? (
              <AppText variant="caption" tone="muted">
                尚未達成
              </AppText>
            ) : (
              <View style={{ alignSelf: "stretch", gap: 2 }}>
                <View style={[styles.track, { backgroundColor: c.border }]}>
                  <View style={{ height: 6, width: `${(a.current / a.threshold) * 100}%`, backgroundColor: c.accent, borderRadius: 3 }} />
                </View>
                <AppText variant="caption" tone="muted" style={{ textAlign: "center" }}>
                  {a.current} / {a.threshold}
                </AppText>
              </View>
            )}
          </View>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  card: { width: "48.5%", borderWidth: 2, borderRadius: radius.md, padding: space.md, alignItems: "center", gap: space.xs },
  key: { flexDirection: "row", alignItems: "center", gap: space.md, borderWidth: 2, borderRadius: radius.md, padding: space.md },
  icon: { fontSize: 44, lineHeight: 54 },
  track: { height: 6, borderRadius: 3, overflow: "hidden" },
});
