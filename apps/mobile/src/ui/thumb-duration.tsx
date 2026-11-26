import { useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { minutesText } from "@/features/format";
import { AppText } from "./text";

const NO_SCALE = Platform.OS === "web" ? ({ dataSet: { noScale: "" } } as object) : {};

/**
 * 縮圖內部下方的影片長度（杜杜龍 2026-11-25）：白色文字加陰影、沒有膠囊底色。
 * 強制單行、不可出現「…」：依縮圖寬度自動縮小字體（網頁不支援 adjustsFontSizeToFit，所以自己用字數估寬度算字級；App 另加 adjustsFontSizeToFit）。
 * 搜尋結果的單元列（超派 `ChapterList`、至尊 `ElderChapterRow`）共用；放在縮圖容器（relative、overflow hidden）裡，沒有長度（0）不顯示。
 */
export function ThumbDuration({ minutes, big = false }: { minutes: number | null | undefined; /** 至尊模式（縮圖大）用大一點的字。 */ big?: boolean }) {
  const text = minutesText(minutes);
  const [w, setW] = useState(0);
  if (!text) return null;
  const base = big ? 18 : 12;
  // 中日文字約 1 個字寬、數字與英文約 0.58 個字寬；左右各留 4 的空隙。
  const units = [...text].reduce((n, ch) => n + (/[⺀-鿿]/.test(ch) ? 1 : 0.58), 0);
  const size = w ? Math.max(8, Math.min(base, Math.floor((w - 8) / units))) : base;
  return (
    <View style={styles.wrap} pointerEvents="none" onLayout={(e) => setW(Math.floor(e.nativeEvent.layout.width))}>
      <AppText numberOfLines={1} ellipsizeMode="clip" adjustsFontSizeToFit minimumFontScale={0.5} {...NO_SCALE} style={[styles.text, { fontSize: size, lineHeight: size + 4 }]}>
        {text}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 0, right: 0, bottom: 4, alignItems: "center", paddingHorizontal: 4 },
  text: { color: "#fff", fontWeight: "800", textShadowColor: "rgba(0,0,0,0.85)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },
});
