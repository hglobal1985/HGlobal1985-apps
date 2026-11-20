import Ionicons from "@expo/vector-icons/Ionicons";
import { useThumb } from "@/lib/thumb";
import { router } from "expo-router";
import { Image, StyleSheet, View } from "react-native";
import { resolveUrl, type CourseSummary } from "@/api/client";
import { eventDays } from "@/features/format";
import { useTheme } from "@/theme/theme";
import { minTouch, radius, space } from "@/theme/tokens";
import { BrandCover, AppText, Button, SheetAction, SheetRow, SheetThumb } from "@/ui";
import { CourseCover } from "@/ui/course-cover";
import { BottomSheet, SheetScroll } from "@/ui/bottom-sheet";
import { ribbonsFor } from "./ribbons";
import { useApi, useSession } from "@/state/session";
import { useUiConfig } from "@/state/ui-config";
import { displayName, seriesOrdered } from "./sort";


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
 * 每列＝封面（手動上傳 > 品牌 logo > 預設圖）＋區塊名稱＋灰色數字（只顯示數量）；點一列進清單頁、自動捲到該區塊並展開。
 */
export function BlockSheet({ course, onClose }: { course: CourseSummary; onClose: () => void }) {
  const thumb = useThumb();
  const { c } = useTheme();
  const open = (block?: string) => {
    onClose();
    router.push(block ? { pathname: "/course/[id]", params: { id: course.id, block } } : `/course/${course.id}`);
  };
  return (
    <BottomSheet onClose={onClose} onExpand={() => open()} expandLabel="繼續上拉進入清單">
      <View style={styles.head}>
        <AppText variant="headline" style={{ flex: 1 }} numberOfLines={2}>
          {course.title}
        </AppText>
        <SheetAction label="完整清單" accessibilityLabel={`進入「${course.title}」完整清單`} onPress={() => open()} />
      </View>
      <SheetScroll>
        {course.blocks.map((b) => (
          <SheetRow
            key={b.id}
            accessibilityLabel={`${b.title}，有${b.count}個教材`}
            onPress={() => open(b.id)}
            faded={b.count === 0}
            leading={
              <SheetThumb>
                {b.coverUrl ? (
                  <Image source={{ uri: thumb(resolveUrl(b.coverUrl), 120) }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                ) : b.brand ? (
                  <BrandCover brand={b.brand} fill />
                ) : (
                  // 沒有封面圖：直接用文字當封面（業主 2026-11-18）
                  <CourseCover theme="" label="" title={b.title} fill />
                )}
              </SheetThumb>
            }
            title={b.title}
            count={b.count}
          />
        ))}
      </SheetScroll>
      <Button variant="cancel" label="關閉" onPress={onClose} fullWidth />
    </BottomSheet>
  );
}

/** 「還有 N 個梯次」：從下方彈出，列出同系列所有梯次（日期＋狀態），點一列進入那一場的課程頁。 */
export function SeriesSheet({ title, items, onClose, onPick, currentId, showAllSeries }: { title: string; items: CourseSummary[]; onClose: () => void; onPick?: (c: CourseSummary) => void; currentId?: string; showAllSeries?: string }) {
  const thumb = useThumb();
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
        <AppText variant="headline" style={{ flex: 1 }} numberOfLines={2}>
          {title}
        </AppText>
        {showAllSeries ? <SheetAction label="顯示全部" accessibilityLabel={`顯示「${showAllSeries}」全部梯次`} onPress={showAll} /> : null}
      </View>
      <SheetScroll>
        {seriesOrdered(items).map((x) => (
          <SheetRow
            key={x.id}
            accessibilityLabel={`${x.title} ${x.eventStart ?? ""}`}
            onPress={() => {
              onClose();
              if (onPick) onPick(x);
              else router.push(`/course/${x.id}`);
            }}
            leading={
              <SheetThumb>
                {x.brand ? <BrandCover brand={x.brand} fill /> : x.coverUrl || x.edmUrl ? <Image source={{ uri: thumb(resolveUrl((x.coverUrl || x.edmUrl) as string), 120) }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : <CourseCover theme={x.theme} label="" title={displayName(x)} fill />}
              </SheetThumb>
            }
            // 素材：清單卡名稱＋素材數量（只顯示數字）；課程梯次：日期＋名稱＋狀態標籤（業主 2026-11-18）
            title={x.isList ? x.title : `${x.eventStart ? eventDays(x.eventStart, x.eventEnd) : "未設定日期"}${x.id === currentId ? "（目前顯示）" : ""}`}
            subtitle={x.isList ? undefined : x.title}
            count={x.isList ? x.materialCount : undefined}
            right={x.isList ? undefined : <StatusChip course={x} />}
          />
        ))}
      </SheetScroll>
      <Button variant="cancel" label="關閉" onPress={onClose} fullWidth />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  chip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, maxWidth: 120 },
  matTag: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: "#FFD43B" },
  head: { flexDirection: "row", alignItems: "center", gap: space.sm },
});
