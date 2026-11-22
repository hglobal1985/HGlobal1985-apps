import { useState } from "react";
import { Image, Platform, StyleSheet, View } from "react-native";
import { resolveUrl } from "@/api/client";
import { radius } from "@/theme/tokens";
import { AppText, ThumbFallback } from "@/ui";
import { fitFontSize } from "@/ui/course-cover";

export type ListCoverMode = "item" | "upload" | "text";

/** 文字封面的純色底（沒有選底圖時用，網站深綠）。 */
const SOLID = "#0C603C";

/**
 * 我的清單封面（業主 2026-11-22，全站清單封面唯一來源）：
 * - item＝清單內容的圖，沒有圖就是綠色學士帽；
 * - 自訂封面（upload／text，業主 2026-11-22 合併）＝底（自己上傳的圖 `imageUrl`，或管理員的清單專用底圖 `bgUrl`／純色）＋可選的文字 `text`（預設清單名稱，可自訂，null＝不顯示）疊在底上。
 * 文字封面要在各種複雜底圖上都清楚，所以：字級自動放到框裡的適中大小（`fitFontSize`，最大約框高 42%）、白字粗體，
 * 底圖先蓋一層暗化，再加「緊貼的陰影＋光暈」（沒有描邊，網頁版；App 版用單層陰影），字級已算好、不吃全站字體放大。
 * children 疊在封面上（例如下緣的名稱列、右上角按鈕）。
 */
export function ListCover({ mode, imageUrl, bgUrl, title, text, height = 190, minFont = 18, radius: rad, children }: { mode: ListCoverMode; imageUrl: string | null; bgUrl: string | null; title: string; text?: string | null; height?: number; minFont?: number; radius?: number; children?: React.ReactNode }) {
  const [box, setBox] = useState({ w: 0, h: 0 });
  const custom = mode !== "item";
  // 疊在封面上的文字：呼叫端有傳 text 就照它（null＝不顯示）；沒傳時文字封面用清單名稱（舊行為）。
  const overlay = !custom ? null : text !== undefined ? text : mode === "text" ? title : null;
  const bg = mode === "upload" ? imageUrl : bgUrl;
  const fs = overlay && box.w > 0 ? fitFontSize(overlay, box.w * 0.8, box.h * 0.6, Math.round(box.h * 0.42), minFont) : 0;
  const web = Platform.OS === "web";
  return (
    <View style={[styles.box, { height, backgroundColor: custom ? SOLID : "transparent" }, rad !== undefined ? { borderRadius: rad } : null]} onLayout={(e) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      {custom ? (
        <>
          {bg ? <Image source={{ uri: resolveUrl(bg) }} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityIgnoresInvertColors /> : null}
          {bg && overlay ? <View style={[StyleSheet.absoluteFill, styles.scrim]} /> : null}
          {fs ? (
            <View style={styles.center} pointerEvents="none">
              <AppText
                accessibilityRole="header"
                style={[
                  { color: "#fff", fontSize: fs, lineHeight: Math.round(fs * 1.2), fontWeight: "900", textAlign: "center", maxWidth: "92%" },
                  web
                    ? ({
                        // 只保留陰影（業主 2026-11-22：取消黑邊框）：緊貼陰影＋光暈，疊在圖片上仍清楚。
                        textShadow: "0 2px 4px rgba(0,0,0,0.8), 0 0 16px rgba(0,0,0,0.75)",
                      } as object)
                    : { textShadowColor: "rgba(0,0,0,0.85)", textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 10 },
                ]}
                {...({ dataSet: { noScale: "" } } as object)}
              >
                {overlay}
              </AppText>
            </View>
          ) : null}
        </>
      ) : imageUrl ? (
        <Image source={{ uri: resolveUrl(imageUrl) }} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityIgnoresInvertColors />
      ) : (
        <ThumbFallback />
      )}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: radius.lg, overflow: "hidden", justifyContent: "flex-end" },
  scrim: { backgroundColor: "rgba(0,0,0,0.32)" },
  center: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center" },
});
