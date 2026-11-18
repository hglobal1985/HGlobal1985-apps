import { useState } from "react";
import { Animated, Image, Linking, Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { resolveUrl } from "@/api/client";
import { useTheme } from "@/theme/theme";
import { layoutOf } from "@/theme/layout";
import { maxContentWidth, space } from "@/theme/tokens";
import { AppText, Icon } from "@/ui";
import { EdmLightbox } from "./edm-viewer";
import { SubscribeButton, type SubscribeProps } from "./subscribe";

const COMPACT_H = 112;
const SIDE = 16;
/** 縮成窄橫幅時，照片上下留白合計（上 8＋下 4）。 */
const COMPACT_GAP = space.sm + space.xs;

/**
 * 照片完全展開時的寬與高。手機：左右滿版、16:10。頁面用高度在捲動內容最上方墊出同樣高的空間（Screen 的 heroHeight）。
 * 大螢幕（業主 2026-11-18）：寬度跟內容寬版一樣（置中），高度最多畫面高度的 42%，橫放平板、電腦不會被照片佔滿整個畫面。
 */
export function centerHeroSize(winW: number, winH: number): { w: number; h: number } {
  const lay = layoutOf(winW, winH);
  if (!lay.large) return { w: winW, h: Math.round((Math.min(winW, maxContentWidth) * 10) / 16) };
  const w = Math.min(winW, lay.wideMax + lay.gutter * 2);
  return { w, h: Math.round(Math.min((w * 10) / 16, winH * 0.42)) };
}
export const centerHeroFull = (winW: number, winH = 10000) => centerHeroSize(winW, winH).h;

/**
 * 中心專屬頁上方的照片（業主 2026-11-16 選方案 A）：
 * 展開＝左右滿版 16:10、底部暗色漸層、不放中心名稱（上方工具列已有）、左下角透明小標籤「N 門課・N 章節・N 點閱」、點封面任意處放大；
 * 往上滑時平順縮成窄橫幅（方案 D：高度 112、左右留白、圓角），往下滑回頂端再展開。沒有上傳照片就用品牌綠色漸層底。
 * 它是蓋在捲動區上面的浮動層（Screen 的 hero），不會改變捲動區大小，所以課程很少時也不會閃動（修正於 2026-11-16）。
 * scrollY 是頁面捲動位移（Screen 的 scrollY）；縮放範圍剛好讓「照片下緣＝展開高度 − 捲動量」，內容第一列永遠接在照片下方。
 */
export function CenterHero({ art, scrollY, courses, lessons, views, title, subscribe }: { subscribe?: SubscribeProps; art?: { edmUrl: string; coverUrl?: string | null }; scrollY: Animated.Value; courses: number; lessons: number; views: number | null; title: string }) {
  const { width: winW, height: winH } = useWindowDimensions();
  const [open, setOpen] = useState(false);
  const { w: heroW, h: full } = centerHeroSize(winW, winH);
  const range = Math.max(1, full - (COMPACT_H + COMPACT_GAP));
  const at = (a: number, b: number) => scrollY.interpolate({ inputRange: [0, range], outputRange: [a, b], extrapolate: "clamp" });
  const url = art ? art.coverUrl ?? art.edmUrl : null;
  return (
    <Animated.View style={[styles.box, url ? { backgroundColor: "#fff" } : null, heroW < winW ? { alignSelf: "center", width: heroW } : null, { height: at(full, COMPACT_H), marginHorizontal: at(0, SIDE), marginTop: at(0, space.sm), marginBottom: at(0, space.xs), borderRadius: at(0, 16) }]}>
      {url ? (
        <Image source={{ uri: resolveUrl(url) }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : (
        <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
          <Defs>
            <LinearGradient id="brand" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor="#2F5D3A" />
              <Stop offset="1" stopColor="#4C8A5B" />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#brand)" />
        </Svg>
      )}
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" pointerEvents="none">
        <Defs>
          <LinearGradient id="shade" x1="0" y1="0.45" x2="0" y2="1">
            <Stop offset="0" stopColor="#000" stopOpacity={0} />
            <Stop offset="1" stopColor="#000" stopOpacity={0.6} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#shade)" />
      </Svg>
      {/* 點封面任意處放大看原始大圖（業主 2026-11-17：不再放右上角的放大鈕）；與課程 EDM 放大共用同一個 EdmLightbox（分享、下載、拖曳、放大縮小）。 */}
      {art ? <Pressable accessibilityRole="button" accessibilityLabel="放大中心首頁圖" onPress={() => setOpen(true)} style={StyleSheet.absoluteFill} /> : null}
      <View style={styles.chips} pointerEvents="box-none">
        {/* 訂閱鈕（業主 2026-11-17）：放在最左邊、比膠卷標籤大兩倍、實心不透明；鈴鐺圖案與主選單「通知」一致，旁邊是訂閱人數。 */}
        {subscribe ? <SubscribeButton {...subscribe} /> : null}
        <View style={styles.chipRow} pointerEvents="none">
          <Chip text={`${courses} 門課`} />
          <Chip text={`${lessons} 章節`} />
          <Chip text={`${views ?? 0} 點閱`} />
        </View>
      </View>
      {open && art ? <EdmLightbox uri={art.edmUrl} title={title} onClose={() => setOpen(false)} /> : null}
    </Animated.View>
  );
}

/**
 * 照片下方的中心地址卡：放在捲動內容的最上方（Screen 第一個子元素），跟著內容自然往上捲，滑到縮小的照片後面就消失；
 * 不用高度／透明度動畫，也不用先量高度。點一下開啟 Google 地圖。
 */
export function CenterAddress({ address }: { address: string }) {
  const { c } = useTheme();
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`中心地址：${address}，開啟地圖`}
      onPress={() => Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`).catch(() => undefined)}
      style={[styles.addr, { backgroundColor: c.accentSoft, borderColor: c.border }]}
    >
      <View style={[styles.pin, { backgroundColor: c.accent }]}>
        <Icon name="location" size={16} color={c.textOnAccent} />
      </View>
      <AppText variant="callout" style={{ flex: 1, color: c.accentText, fontWeight: "600" }} numberOfLines={2}>
        {address}
      </AppText>
      <Icon name="chevron-forward" size={18} color={c.accentText} />
    </Pressable>
  );
}

function Chip({ text }: { text: string }) {
  return (
    <View style={styles.chip}>
      <AppText variant="caption" style={styles.chipText}>
        {text}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  addr: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: 10, paddingHorizontal: space.md, borderRadius: 14, borderWidth: 1 },
  pin: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  box: { overflow: "hidden", backgroundColor: "#2F5D3A", alignSelf: "stretch" },
  chips: { position: "absolute", left: 12, bottom: 10, flexDirection: "row", gap: 6, alignItems: "center" },
  chipRow: { flexDirection: "row", gap: 6 },
  chip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.22)" },
  chipText: { color: "#fff", fontWeight: "600" },
});
