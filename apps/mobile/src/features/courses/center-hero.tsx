import { useState } from "react";
import { Animated, Image, Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { resolveUrl, type CenterArt } from "@/api/client";
import { maxContentWidth, space } from "@/theme/tokens";
import { AppText, Icon } from "@/ui";
import { EdmLightbox } from "./edm-viewer";

const COMPACT_H = 112;
const SIDE = 16;

/**
 * 中心專屬頁上方的照片（業主 2026-11-16 選方案 A）：
 * 展開＝左右滿版 16:10、底部暗色漸層、不放中心名稱（上方工具列已有）、左下角透明小標籤「N 門課・N 章節・N 瀏覽」、右上角放大鈕；
 * 往上滑時平順縮成窄橫幅（方案 D：高度 112、左右留白、圓角），往下滑回頂端再展開。沒有上傳照片就用品牌綠色漸層底。
 * scrollY 是頁面捲動位移（Screen 的 scrollY），高度、留白、圓角都用它內插，不會讓整頁重新繪製。
 */
export function CenterHero({ art, scrollY, courses, lessons, views, title }: { art?: CenterArt; scrollY: Animated.Value; courses: number; lessons: number; views: number | null; title: string }) {
  const { width: winW } = useWindowDimensions();
  const [open, setOpen] = useState(false);
  const w = Math.min(winW, maxContentWidth);
  const full = Math.round((w * 10) / 16);
  const range = Math.max(1, full - COMPACT_H);
  const at = (a: number, b: number) => scrollY.interpolate({ inputRange: [0, range], outputRange: [a, b], extrapolate: "clamp" });
  const url = art ? art.coverUrl ?? art.edmUrl : null;
  return (
    <Animated.View style={[styles.box, { height: at(full, COMPACT_H), marginHorizontal: at(0, SIDE), marginTop: at(0, space.sm), marginBottom: at(0, space.xs), borderRadius: at(0, 16) }]}>
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
      <View style={styles.chips} pointerEvents="none">
        <Chip text={`${courses} 門課`} />
        <Chip text={`${lessons} 章節`} />
        <Chip text={`${views ?? 0} 瀏覽`} />
      </View>
      {art ? (
        <Pressable accessibilityRole="button" accessibilityLabel="放大照片" onPress={() => setOpen(true)} hitSlop={8} style={styles.zoom}>
          <Icon name="expand-outline" size={18} color="#fff" />
        </Pressable>
      ) : null}
      {open && art ? <EdmLightbox uri={art.edmUrl} title={title} onClose={() => setOpen(false)} /> : null}
    </Animated.View>
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
  box: { overflow: "hidden", backgroundColor: "#2F5D3A", alignSelf: "stretch" },
  chips: { position: "absolute", left: 12, bottom: 10, flexDirection: "row", gap: 6 },
  chip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.22)" },
  chipText: { color: "#fff", fontWeight: "600" },
  zoom: { position: "absolute", right: 10, top: 10, width: 34, height: 34, borderRadius: 17, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center" },
});
