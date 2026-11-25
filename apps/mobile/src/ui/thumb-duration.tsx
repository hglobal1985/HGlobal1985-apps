import { StyleSheet, View } from "react-native";
import { minutesText } from "@/features/format";
import { AppText } from "./text";

/**
 * 縮圖內部下方的影片長度（業主 2026-11-25）：白色文字加陰影、沒有膠囊底色。
 * 搜尋結果的單元列（超派 `ChapterList`、至尊 `ElderChapterRow`）共用；放在縮圖容器（relative、overflow hidden）裡，沒有長度（0）不顯示。
 */
export function ThumbDuration({ minutes, big = false }: { minutes: number | null | undefined; /** 至尊模式（縮圖大）用大一點的字。 */ big?: boolean }) {
  const text = minutesText(minutes);
  if (!text) return null;
  return (
    <View style={styles.wrap} pointerEvents="none">
      <AppText variant={big ? "callout" : "caption"} numberOfLines={1} style={[styles.text, big && { fontSize: 16, lineHeight: 20 }]}>
        {text}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 0, right: 0, bottom: 4, alignItems: "center" },
  text: { color: "#fff", fontWeight: "800", textShadowColor: "rgba(0,0,0,0.85)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },
});
