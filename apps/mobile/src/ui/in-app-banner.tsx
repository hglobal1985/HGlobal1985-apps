import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { inAppBrowser, openInSystemBrowser } from "@/lib/in-app-browser";
import { useTheme } from "@/theme/theme";
import { minTouch } from "@/theme/tokens";
import { DIM_COLOR } from "@/ui/dim-backdrop";
import { flashText } from "@/ui/flash-notice";

const RED = "#B3261E";

/**
 * App 內建瀏覽器警示條（業主 2026-11-17 定稿）：全站在「上方返回工具列」正下方（五個主分頁在最上方）固定顯示，全寬、固定大小，
 * 紅框淡粉紅底；標題強制兩行、按鈕置中「按此改用Chrome／Safari瀏覽器開啟」。不是 App 內建瀏覽器就不顯示。
 * 偵測與開啟方式只在 lib/in-app-browser.ts；要改畫面只改這個檔案。
 */
export function InAppBrowserBanner() {
  const { c } = useTheme();
  const info = inAppBrowser();
  const [h, setH] = useState(0);
  if (!info) return null;
  const long = info.app.length > 6; // 名稱較長時第二行縮字，仍維持一行
  return (
    <>
    <View onLayout={(e) => setH(e.nativeEvent.layout.height)} accessibilityRole="alert" style={[styles.box, { backgroundColor: c.dangerSoft, borderColor: RED }]}>
      <Text numberOfLines={1} style={[styles.l1, { color: RED }]}>
        ⚠️目前播放功能被受限⚠️
      </Text>
      <Text numberOfLines={1} style={[styles.l2, { color: RED, fontSize: long ? 16 : 19 }]}>
        因為您正在使用{info.app}內建瀏覽器
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`按這裡用${info.browser}瀏覽器開啟寰宇行動大學`}
        onPress={() => {
          if (openInSystemBrowser(info) === "copied") flashText("已複製網址，若沒有自動跳轉，請到 Safari 貼上");
        }}
        style={({ pressed }) => [styles.btn, pressed && { opacity: 0.85 }]}
      >
        <Text style={styles.btnText}>👉按這裡開啟 寰宇行動大學👈</Text>
      </Pressable>
    </View>
    {/* 警示條下方整個 App 蓋一層 60% 暗化（業主 2026-11-17）；只是視覺提醒，不擋操作。 */}
    {h > 0 ? <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, bottom: 0, top: h, backgroundColor: DIM_COLOR, zIndex: 50 }} /> : null}
    </>
  );
}

const styles = StyleSheet.create({
  box: { position: "relative", zIndex: 60, borderTopWidth: 3, borderBottomWidth: 3, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 14, alignItems: "center", gap: 2 },
  l1: { fontSize: 22, fontWeight: "900", textAlign: "center" },
  l2: { fontWeight: "800", textAlign: "center", marginBottom: 8 },
  btn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: minTouch + 8, paddingHorizontal: 22, borderRadius: 14, backgroundColor: RED },
  btnText: { color: "#fff", fontSize: 17, fontWeight: "800" },
});
