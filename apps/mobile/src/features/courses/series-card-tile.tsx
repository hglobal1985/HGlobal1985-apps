import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { resolveUrl, type CourseSummary } from "@/api/client";
import { useSession } from "@/state/session";
import { useUiConfig } from "@/state/ui-config";
import { useTheme } from "@/theme/theme";
import { radius } from "@/theme/tokens";
import { BrandCover, CornerRibbon, CourseCover } from "@/ui";
import { fadedStyle } from "@/ui/fade-style";
import { ribbonsFor } from "./ribbons";
import { TopFill } from "./series-tile";
import { displayName } from "./sort";

/**
 * 系列頁裡的「課程卡」與「清單卡」小卡（業主 2026-11-19）：
 * 課程卡＝直式 3:4（一列至少 3 張）、清單卡＝橫式 4:3（一列至少 2 張）；點一下直接進該卡的詳細頁（不再展開細節）；
 * 右下角顯示教材數量，數量是 0 的卡灰色淡化（仍可點）。編輯模式下面多一排 ◀ ▶（跟相鄰的卡交換）與「隱藏／顯示」。
 */
export function SeriesCardTile({ course, width, editing, canBack, canForward, onMove, onToggleHide }: { course: CourseSummary; width: number; editing?: boolean; canBack?: boolean; canForward?: boolean; onMove?: (dir: -1 | 1) => void; onToggleHide?: () => void }) {
  const { c } = useTheme();
  const { member } = useSession();
  const { config } = useUiConfig();
  const list = course.isList;
  const height = Math.round(list ? (width * 3) / 4 : (width * 4) / 3);
  const ribbons = ribbonsFor(course, member, config);
  const img = course.edmUrl || course.coverUrl;
  const cropped = !course.edmUrl && !!course.coverUrl;
  const empty = course.materialCount === 0;
  const hidden = course.seriesHidden;
  const btn = (key: string, label: string, icon: "chevron-back" | "chevron-forward" | "eye-outline" | "eye-off-outline", off: boolean, onPress?: () => void) => (
    <Pressable key={key} accessibilityRole="button" accessibilityLabel={label} disabled={off} onPress={onPress} style={[styles.swapBtn, { borderColor: c.border, backgroundColor: c.surface, opacity: off ? 0.3 : 1 }]}>
      <Ionicons name={icon} size={22} color={c.accentText} />
    </Pressable>
  );
  return (
    <View style={{ width, gap: 6 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${course.title}，${course.materialCount}個教材`}
        onPress={() => router.push(`/course/${course.id}`)}
        style={[styles.art, { width, height, backgroundColor: img ? "#fff" : c.surfaceMuted }, ...(empty ? fadedStyle : []), hidden && { opacity: 0.4 }]}
      >
        {course.brand ? <BrandCover brand={course.brand} fill /> : img && cropped ? <Image source={{ uri: resolveUrl(img) }} resizeMode="cover" style={StyleSheet.absoluteFill} accessibilityIgnoresInvertColors /> : img ? <TopFill uri={resolveUrl(img)} w={width} h={height} viewY={list ? 0 : course.edmViewY} fillBlur /> : <CourseCover theme={course.theme} label={course.category} title={displayName(course)} fill />}
        {ribbons.left ? <CornerRibbon label={ribbons.left.label} bg={ribbons.left.bg} fg={ribbons.left.fg} side="left" scale={0.8} /> : null}
        {ribbons.right ? <CornerRibbon label={ribbons.right.label} bg={ribbons.right.bg} fg={ribbons.right.fg} side="right" scale={0.8} /> : null}
        <View style={styles.count} pointerEvents="none">
          <Text style={styles.countText} {...({ dataSet: { noScale: "" } } as object)}>
            {course.materialCount}
          </Text>
        </View>
        {course.status === "draft" ? (
          <View style={[styles.tag, { backgroundColor: c.warning, left: 6, bottom: 6 }]}>
            <Text style={styles.tagText}>未上架</Text>
          </View>
        ) : null}
        {hidden ? (
          <View style={[styles.tag, { backgroundColor: c.textMuted, left: 6, top: 6 }]}>
            <Text style={styles.tagText}>已隱藏</Text>
          </View>
        ) : null}
      </Pressable>
      {editing ? (
        <View style={{ flexDirection: "row", gap: 6 }}>
          {btn("b", `${course.title} 往前移`, "chevron-back", !canBack, () => onMove?.(-1))}
          {btn("f", `${course.title} 往後移`, "chevron-forward", !canForward, () => onMove?.(1))}
          {btn("h", hidden ? `顯示 ${course.title}` : `隱藏 ${course.title}`, hidden ? "eye-off-outline" : "eye-outline", false, onToggleHide)}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  art: { borderRadius: radius.md, overflow: "hidden" },
  count: { position: "absolute", right: 6, bottom: 6, minWidth: 22, paddingHorizontal: 7, paddingVertical: 1, borderRadius: 999, alignItems: "center", backgroundColor: "rgba(232,232,230,0.96)" },
  countText: { color: "#5A5A57", fontSize: 12, fontWeight: "700" },
  tag: { position: "absolute", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  tagText: { color: "#fff", fontSize: 11, fontWeight: "700" },
  swapBtn: { flex: 1, minWidth: 0, height: 40, borderRadius: radius.md, borderWidth: 1, alignItems: "center", justifyContent: "center" },
});
