import { useState } from "react";
import { trackFeature } from "@/lib/feature-track";
import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";
import type { Achievement } from "@/api/client";
import { useApi } from "@/state/session";
import { useTheme } from "@/theme/theme";
import { minTouch, radius, space } from "@/theme/tokens";
import { AppText, SaplingIcon, showFlash } from "@/ui";
import { FLASH_ICON } from "@/ui/flash-notice";
import { BadgeIcon } from "./badge-icon";
import { conditionText } from "./text";

/**
 * 「學習中」最上方（業主 2026-11-16）：小樹苗累計（每學完一堂課長一棵）與「學習成就」並排一列；
 * 下面直接列出已解鎖的成就圖示，點一下以「全螢幕文字提醒」顯示該成就的達成條件。
 */
export function SaplingBar({ saplings }: { saplings: number }) {
  const { c } = useTheme();
  const { data } = useApi<Achievement[]>("/me/achievements");
  const earned = (data ?? []).filter((a) => a.earned).sort((a, b) => (b.earnedAt ?? "").localeCompare(a.earnedAt ?? ""));
  // 只顯示最近取得的 4 枚，第 5 個圖示是「展開更多徽章」（業主 2026-11-17）；展開後最後一個變成「收合」。
  const [open, setOpen] = useState(false);
  const shown = open || earned.length <= 5 ? earned : earned.slice(0, 4);
  const needMore = earned.length > 5;
  const tile = [styles.tile, { backgroundColor: c.surface, borderColor: c.border }];
  return (
    <View style={{ gap: space.sm }}>
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`小樹苗 ${saplings} 棵`}
          onPress={() => (trackFeature("sapling_tap"), showFlash({ icon: <SaplingIcon size={FLASH_ICON} />, title: `小樹苗 ${saplings} 棵`, body: "每學完一堂課就長出一棵小樹苗", holdMs: 1800 }))}
          style={tile}
        >
          <SaplingIcon size={44} />
          <AppText style={[styles.num, { color: c.accentText }]}>{saplings}</AppText>
          <AppText variant="caption" tone="muted">
            小樹苗
          </AppText>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="學習成就" onPress={() => router.push("/achievements")} style={tile}>
          <Ionicons name="trophy-outline" size={40} color={c.accent} />
          <AppText style={[styles.num, { color: c.accentText }]}>{data ? `${earned.length}/${data.length}` : "–"}</AppText>
          <AppText variant="caption" tone="muted">
            學習成就
          </AppText>
        </Pressable>
      </View>
      {earned.length ? (
        <View style={styles.icons}>
          {shown.map((a) => (
            <Pressable
              key={a.id}
              accessibilityRole="button"
              accessibilityLabel={`${a.name}，已解鎖`}
              onPress={() => showFlash({ icon: <BadgeIcon icon={a.icon} size={40} />, title: a.name, body: a.description || conditionText(a.type, a.threshold, a.courseTitle, a.feature, a.lessonTitle), holdMs: 2200 })}
              style={[styles.badge, { backgroundColor: c.accentSoft, borderColor: c.accent }]}
            >
              <BadgeIcon icon={a.icon} size={26} />
            </Pressable>
          ))}
          {needMore ? (
            <Pressable accessibilityRole="button" accessibilityLabel={open ? "收合徽章" : `展開更多徽章，共 ${earned.length} 枚`} onPress={() => setOpen((v) => !v)} style={[styles.badge, { backgroundColor: c.surface, borderColor: c.border }]}>
              <Ionicons name={open ? "chevron-up" : "ellipsis-horizontal"} size={26} color={c.accentText} />
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: space.sm },
  tile: { flex: 1, minHeight: minTouch * 2, borderWidth: 1, borderRadius: radius.md, alignItems: "center", justifyContent: "center", paddingVertical: space.sm, gap: 2 },
  num: { fontSize: 26, lineHeight: 32, fontWeight: "800" },
  icons: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, justifyContent: "center" },
  badge: { width: minTouch, height: minTouch, borderRadius: minTouch / 2, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  badgeText: { fontSize: 26, lineHeight: 32 },
  emoji: { fontSize: 40, lineHeight: 48 }, // 全螢幕提醒裡的成就圖示（80% 尺寸）
});
