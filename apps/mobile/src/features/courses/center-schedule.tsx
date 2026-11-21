import { useMemo, useState } from "react";
import { Image, Linking, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import { resolveUrl } from "@/api/client";
import { useThumb } from "@/lib/thumb";
import { useApi } from "@/state/session";
import { useTheme } from "@/theme/theme";
import { radius, space } from "@/theme/tokens";
import { AppText, Button, Icon, SheetRow, SheetThumb } from "@/ui";
import { BottomSheet, SheetScroll } from "@/ui/bottom-sheet";
import { EdmLightbox } from "./edm-viewer";

/**
 * 中心每月課表（業主 2026-11-21 選方案 A）：中心頁封面與廣播公告下方的課表卡（沒有標題）——縮圖、最近幾個月的月份小鈕（同一列最右邊是「歷年課表」進入鈕）；
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

export function ScheduleCard({ items, title, address }: { items: Schedules["items"]; title: string; address?: string }) {
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
      <Pressable accessibilityRole="button" accessibilityLabel={`放大${ymLabel(sel.ym)}課表`} onPress={() => setZoom(true)} style={styles.img}>
        <Image source={{ uri: thumb(resolveUrl(sel.url), Math.min(winW, 720)) }} style={StyleSheet.absoluteFill} resizeMode="contain" />
      </Pressable>
      {items.length > 1 ? (
        // 月份小鈕在左、「歷年課表」在同一列最右邊（業主 2026-11-21）；上方不再有「本月課表」標題。
        <View style={styles.chipRow}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={styles.chips}>
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
          <Pressable accessibilityRole="button" accessibilityLabel="歷年課表" onPress={() => setAll(true)} hitSlop={8} style={styles.linkBtn}>
            <AppText variant="callout" style={{ color: c.accentText, fontWeight: "800" }}>
              歷年課表 ›
            </AppText>
          </Pressable>
        </View>
      ) : null}
      {/* 地址收在課表卡最下面（業主 2026-11-21 方案二）：細線分隔、小字地址、右邊「導航 ›」與「歷年課表 ›」同樣大小；點整列開啟 Google 地圖。 */}
      {address ? (
        <Pressable accessibilityRole="link" accessibilityLabel={`中心地址：${address}，開啟導航`} onPress={() => Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`).catch(() => undefined)} style={[styles.addr, { borderTopColor: c.border }]}>
          <Icon name="location" size={14} color={c.accentText} />
          <AppText variant="caption" tone="muted" numberOfLines={1} style={{ flex: 1 }}>
            {address}
          </AppText>
          <AppText variant="callout" style={{ color: c.accentText, fontWeight: "800" }}>
            導航 ›
          </AppText>
        </Pressable>
      ) : null}
      {zoom ? <EdmLightbox uri={sel.url} title={`${title} ${ymLabel(sel.ym)}課表`} items={items.map((x) => ({ uri: x.url, title: `${title} ${ymLabel(x.ym)}課表` }))} index={Math.max(0, items.findIndex((x) => x.ym === sel.ym))} onClose={() => setZoom(false)} /> : null}
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
  chipRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  linkBtn: { minHeight: 44, justifyContent: "center" },
  img: { width: "100%", aspectRatio: 16 / 9, borderRadius: radius.sm, overflow: "hidden", backgroundColor: "#fff" },
  chips: { gap: 6, paddingVertical: 2 },
  chip: { minHeight: 36, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  addr: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 2 },
  fill: { width: "100%", height: "100%" },
});
