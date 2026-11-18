import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { Image, Pressable, StyleSheet, View } from "react-native";
import { resolveUrl, type CourseSummary } from "@/api/client";
import { eventDays } from "@/features/format";
import { useTheme } from "@/theme/theme";
import { minTouch, radius, space } from "@/theme/tokens";
import { BrandCover, AppText, Button, SheetAction } from "@/ui";
import { CourseCover } from "@/ui/course-cover";
import { BottomSheet, SheetScroll } from "@/ui/bottom-sheet";
import { ribbonsFor } from "./ribbons";
import { useApi, useSession } from "@/state/session";
import { useUiConfig } from "@/state/ui-config";
import { seriesOrdered } from "./sort";
import { fadedStyle } from "@/ui/fade-style";


/** 狀態標籤：與課程卡左邊緞帶同步的文字與顏色；沒有左緞帶時用右邊緞帶（倒數、進行中…）。 */
function StatusChip({ course }: { course: CourseSummary }) {
  const { member } = useSession();
  const { config } = useUiConfig();
  const r = ribbonsFor(course, member, config);
  const rb = r.left ?? r.right;
  if (!rb) return null;
  return (
    <View style={[styles.chip, { backgroundColor: rb.bg }]}>
      <AppText variant="caption" style={{ color: rb.fg, fontWeight: "800" }} numberOfLines={1}>
        {rb.label}
      </AppText>
    </View>
  );
}

/**
 * 清單的區塊選單（業主 2026-11-18）：清單有勾「顯示在上拉選單」的區塊時，點寰宇大學的小卡彈出這個。
 * 每列＝封面（手動上傳 > 品牌 logo > 預設圖）＋區塊名稱＋灰色「有N個素材」；點一列進清單頁、自動捲到該區塊並展開。
 */
export function BlockSheet({ course, onClose }: { course: CourseSummary; onClose: () => void }) {
  const { c } = useTheme();
  const open = (block?: string) => {
    onClose();
    router.push(block ? { pathname: "/course/[id]", params: { id: course.id, block } } : `/course/${course.id}`);
  };
  return (
    <BottomSheet onClose={onClose} onExpand={() => open()} expandLabel="繼續上拉進入清單">
      <View style={styles.head}>
        <View style={styles.matTag} accessibilityLabel="素材">
          <Ionicons name="folder-open" size={14} color="#1D2A22" />
          <AppText variant="caption" style={{ color: "#1D2A22", fontWeight: "800" }}>
            素材
          </AppText>
        </View>
        <AppText variant="headline" style={{ flex: 1 }} numberOfLines={2}>
          {course.title}
        </AppText>
        <SheetAction label="完整清單" accessibilityLabel={`進入「${course.title}」完整清單`} onPress={() => open()} />
      </View>
      <SheetScroll>
        {course.blocks.map((b) => (
          <Pressable key={b.id} accessibilityRole="button" accessibilityLabel={`${b.title}，有${b.count}個素材`} onPress={() => open(b.id)} style={[styles.row, { borderTopColor: c.border }, b.count === 0 ? fadedStyle : null]}>
            {b.coverUrl ? (
              <Image source={{ uri: resolveUrl(b.coverUrl) }} style={styles.thumb} resizeMode="cover" />
            ) : b.brand ? (
              <View style={styles.thumb}>
                <BrandCover brand={b.brand} fill />
              </View>
            ) : (
              // 沒有封面圖：直接用文字當封面（業主 2026-11-18）
              <View style={styles.thumb}>
                <CourseCover theme="" label="" title={b.title} fill />
              </View>
            )}
            <AppText variant="body" style={{ flex: 1, fontWeight: "700" }} numberOfLines={2}>
              {b.title}
            </AppText>
            <View style={[styles.chip, { backgroundColor: c.surfaceMuted, borderWidth: 1, borderColor: c.border }]}>
              <AppText variant="caption" style={{ color: c.text, fontWeight: "700" }} numberOfLines={1}>
                有{b.count}個素材
              </AppText>
            </View>
            <AppText tone="muted">›</AppText>
          </Pressable>
        ))}
      </SheetScroll>
      <Button variant="cancel" label="關閉" onPress={onClose} fullWidth />
    </BottomSheet>
  );
}

/** 「還有 N 個梯次」：從下方彈出，列出同系列所有梯次（日期＋狀態），點一列進入那一場的課程頁。 */
export function SeriesSheet({ title, items, onClose, onPick, currentId, showAllSeries }: { title: string; items: CourseSummary[]; onClose: () => void; onPick?: (c: CourseSummary) => void; currentId?: string; showAllSeries?: string }) {
  const { c } = useTheme();
  const links = useApi<{ kind: string; value: string; slug: string }[]>(showAllSeries ? "/short-links" : null);
  /** 顯示該系列全部梯次（全部展開）：有設定短網址就用短網址，沒有用 /series/系列名稱。 */
  const showAll = () => {
    onClose();
    const slug = links.data?.find((l) => l.kind === "series" && l.value === showAllSeries)?.slug;
    router.push(slug ? `/${slug}` : `/series/${encodeURIComponent(showAllSeries ?? "")}`);
  };
  return (
    <BottomSheet onClose={onClose} onExpand={showAllSeries ? showAll : undefined} expandLabel="繼續上拉顯示全部">
      <View style={styles.head}>
        {/* 素材（清單類別）的標示放在標題左邊（業主 2026-11-17：從小卡右下角移到這裡）。 */}
        {items.length > 0 && items.every((x) => x.isList) ? (
          <View style={styles.matTag} accessibilityLabel="素材">
            <Ionicons name="folder-open" size={14} color="#1D2A22" />
            <AppText variant="caption" style={{ color: "#1D2A22", fontWeight: "800" }}>
              素材
            </AppText>
          </View>
        ) : null}
        <AppText variant="headline" style={{ flex: 1 }} numberOfLines={2}>
          {title}
        </AppText>
        {showAllSeries ? <SheetAction label="顯示全部" accessibilityLabel={`顯示「${showAllSeries}」全部梯次`} onPress={showAll} /> : null}
      </View>
      <SheetScroll>
        {seriesOrdered(items).map((x) => (
          <Pressable
            key={x.id}
            accessibilityRole="button"
            accessibilityLabel={`${x.title} ${x.eventStart ?? ""}`}
            onPress={() => {
              onClose();
              if (onPick) onPick(x);
              else router.push(`/course/${x.id}`);
            }}
            style={[styles.row, { borderTopColor: c.border }]}
          >
            {x.brand ? (
              <View style={styles.thumb}>
                <BrandCover brand={x.brand} fill />
              </View>
            ) : x.coverUrl || x.edmUrl ? (
              <Image source={{ uri: resolveUrl((x.coverUrl || x.edmUrl) as string) }} style={styles.thumb} resizeMode="cover" />
            ) : (
              <Image source={require("../../../assets/icon.png")} style={styles.thumb} resizeMode="cover" />
            )}
            {x.isList ? (
              // 素材：素材清單名稱＋素材數量標籤（業主 2026-11-18）
              <>
                <AppText variant="body" style={{ flex: 1, fontWeight: "700" }} numberOfLines={2}>
                  {x.title}
                </AppText>
                <View style={[styles.chip, { backgroundColor: c.surfaceMuted, borderWidth: 1, borderColor: c.border }]} accessibilityLabel={`有${x.materialCount}個素材`}>
                  <AppText variant="caption" style={{ color: c.text, fontWeight: "700" }} numberOfLines={1}>
                    有{x.materialCount}個素材
                  </AppText>
                </View>
              </>
            ) : (
              <>
                <View style={{ flex: 1, gap: 2 }}>
                  <AppText variant="body" style={{ fontWeight: "700" }}>
                    {x.eventStart ? eventDays(x.eventStart, x.eventEnd) : "未設定日期"}{x.id === currentId ? "（目前顯示）" : ""}
                  </AppText>
                  <AppText variant="callout" tone="muted" numberOfLines={1}>
                    {x.title}
                  </AppText>
                </View>
                <StatusChip course={x} />
              </>
            )}
            <AppText tone="muted">›</AppText>
          </Pressable>
        ))}
      </SheetScroll>
      <Button variant="cancel" label="關閉" onPress={onClose} fullWidth />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  matTag: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: "#FFD43B" },
  head: { flexDirection: "row", alignItems: "center", gap: space.sm },
  chip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, maxWidth: 120 },
  thumb: { width: 64, height: 36, borderRadius: radius.sm, backgroundColor: "#fff" },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: minTouch + 12, borderTopWidth: StyleSheet.hairlineWidth, borderRadius: radius.sm },
});
