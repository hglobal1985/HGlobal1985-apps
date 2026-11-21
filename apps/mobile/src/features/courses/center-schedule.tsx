import { useMemo, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import { resolveUrl } from "@/api/client";
import { useThumb } from "@/lib/thumb";
import { useApi } from "@/state/session";
import { useTheme } from "@/theme/theme";
import { radius, space } from "@/theme/tokens";
import { AppText, Button, SheetRow, SheetThumb } from "@/ui";
import { BottomSheet, SheetScroll } from "@/ui/bottom-sheet";
import { EdmLightbox } from "./edm-viewer";

/**
 * 中心每月課表（業主 2026-11-21 選方案 A）：中心頁封面與廣播公告下方的「本月課表」卡——縮圖、「歷年課表」進入鈕、最近幾個月的月份小鈕；
 * 點圖用照片放大視窗（下載、分享、雙指縮放）。沒有任何課表時整張卡不顯示。資料公開（訪客也看得到）。
 * 上傳在中心頁「編輯」面板的「課表管理」（features/admin/center-schedule-editor.web.tsx）。
 */
export type Schedules = { items: { ym: string; url: string }[] };

export function useCenterSchedules(center: string) {
  return useApi<Schedules>(center ? `/center-schedules?center=${encodeURIComponent(center)}` : null);
}

/** 台灣現在的年月（YYYY-MM）。 */
export const thisYm = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 7);
export const ymLabel = (ym: string) => `${Number(ym.slice(0, 4))}年${Number(ym.slice(5))}月`;

export function ScheduleCard({ items, title }: { items: Schedules["items"]; title: string }) {
  const { c } = useTheme();
  const { width: winW } = useWindowDimensions();
  const thumb = useThumb();
  const [picked, setPicked] = useState<string | null>(null);
  const [zoom, setZoom] = useState(false);
  const [all, setAll] = useState(false);
  const now = thisYm();
  // 預設顯示本月；本月沒有就用「不晚於本月」最新的一張，再沒有就用最新的。
  const def = useMemo(() => (items.find((x) => x.ym === now) ?? items.find((x) => x.ym <= now) ?? items[0])?.ym ?? "", [items, now]);
  const sel = items.find((x) => x.ym === picked) ?? items.find((x) => x.ym === def);
  if (!sel) return null;
  const chipLabel = (ym: string) => (ym.slice(0, 4) === now.slice(0, 4) ? `${Number(ym.slice(5))}月` : `${ym.slice(0, 4)}/${Number(ym.slice(5))}`);
  return (
    <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
      <View style={styles.head}>
        <AppText variant="headline" style={{ flex: 1, fontWeight: "800" }}>
          {sel.ym === now ? "本月課表" : "課表"}
        </AppText>
        {items.length > 1 ? (
          <Pressable accessibilityRole="button" accessibilityLabel="歷年課表" onPress={() => setAll(true)} hitSlop={8} style={styles.linkBtn}>
            <AppText variant="callout" style={{ color: c.accentText, fontWeight: "800" }}>
              歷年課表 ›
            </AppText>
          </Pressable>
        ) : null}
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={`放大${ymLabel(sel.ym)}課表`} onPress={() => setZoom(true)} style={[styles.img, { borderColor: c.border }]}>
        <Image source={{ uri: thumb(resolveUrl(sel.url), Math.min(winW, 720)) }} style={StyleSheet.absoluteFill} resizeMode="contain" />
      </Pressable>
      <AppText variant="caption" tone="muted">
        {ymLabel(sel.ym)}・點圖放大，可下載分享
      </AppText>
      {items.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {items.slice(0, 8).map((x) => {
            const on = x.ym === sel.ym;
            return (
              <Pressable key={x.ym} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={ymLabel(x.ym)} onPress={() => setPicked(x.ym)} style={[styles.chip, { backgroundColor: on ? c.accent : c.surfaceMuted, borderColor: on ? c.accent : c.border }]}>
                <AppText variant="callout" style={{ color: on ? c.textOnAccent : c.text, fontWeight: on ? "800" : "600" }}>
                  {chipLabel(x.ym)}
                </AppText>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}
      {zoom ? <EdmLightbox uri={sel.url} title={`${title} ${ymLabel(sel.ym)}課表`} onClose={() => setZoom(false)} /> : null}
      {all ? (
        <BottomSheet onClose={() => setAll(false)}>
          <AppText variant="headline">{`${title}歷年課表`}</AppText>
          <SheetScroll>
            {items.map((x) => (
              <SheetRow
                key={x.ym}
                leading={
                  <SheetThumb>
                    <Image source={{ uri: thumb(resolveUrl(x.url), 160) }} style={styles.fill} resizeMode="cover" />
                  </SheetThumb>
                }
                title={ymLabel(x.ym)}
                subtitle={x.ym === now ? "本月" : undefined}
                onPress={() => (setPicked(x.ym), setAll(false))}
              />
            ))}
          </SheetScroll>
          <Button variant="cancel" label="關閉" onPress={() => setAll(false)} fullWidth />
        </BottomSheet>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: radius.md, padding: space.md, gap: space.sm },
  head: { flexDirection: "row", alignItems: "center", gap: space.sm },
  linkBtn: { minHeight: 44, justifyContent: "center" },
  img: { width: "100%", aspectRatio: 16 / 9, borderRadius: radius.sm, borderWidth: 1, overflow: "hidden", backgroundColor: "#fff" },
  chips: { gap: 6, paddingVertical: 2 },
  chip: { minHeight: 36, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  fill: { width: "100%", height: "100%" },
});
