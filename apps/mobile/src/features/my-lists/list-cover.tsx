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
 * - item／upload＝一張圖（內容封面或自己上傳的圖），沒有圖就是綠色學士帽；
 * - text＝「清單名稱」排成大字文字封面，底可以是管理員上傳的清單專用底圖（`bgUrl`）或純色。
 * 文字封面要在各種複雜底圖上都清楚，所以：字級自動放到框裡能放的最大（`fitFontSize`）、白字粗體，
 * 底圖先蓋一層暗化，再加「描邊＋緊貼的陰影＋大範圍光暈」三層（網頁版；App 版用單層陰影），字級已算好、不吃全站字體放大。
 * children 疊在封面上（例如下緣的名稱列、右上角按鈕）。
 */
export function ListCover({ mode, imageUrl, bgUrl, title, height = 190, children }: { mode: ListCoverMode; imageUrl: string | null; bgUrl: string | null; title: string; height?: number; children?: React.ReactNode }) {
  const [box, setBox] = useState({ w: 0, h: 0 });
  const text = mode === "text";
  const fs = text && box.w > 0 ? fitFontSize(title, box.w * 0.86, box.h * 0.78, Math.round(box.h * 0.62), 18) : 0;
  const web = Platform.OS === "web";
  return (
    <View style={[styles.box, { height, backgroundColor: text ? SOLID : "transparent" }]} onLayout={(e) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      {text ? (
        <>
          {bgUrl ? <Image source={{ uri: resolveUrl(bgUrl) }} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityIgnoresInvertColors /> : null}
          {bgUrl ? <View style={[StyleSheet.absoluteFill, styles.scrim]} /> : null}
          {fs ? (
            <View style={styles.center} pointerEvents="none">
              <AppText
                accessibilityRole="header"
                style={[
                  { color: "#fff", fontSize: fs, lineHeight: Math.round(fs * 1.2), fontWeight: "900", textAlign: "center", maxWidth: "92%" },
                  web
                    ? ({
                        // 描邊（先畫邊再畫字，字不會變細）＋緊貼陰影＋大範圍光暈：複雜底圖上字邊緣仍清楚。
                        WebkitTextStroke: `${Math.max(2, Math.round(fs * 0.1))}px rgba(0,0,0,0.55)`,
                        paintOrder: "stroke fill",
                        textShadow: "0 2px 3px rgba(0,0,0,0.75), 0 0 14px rgba(0,0,0,0.8), 0 0 34px rgba(0,0,0,0.65)",
                      } as object)
                    : { textShadowColor: "rgba(0,0,0,0.85)", textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 10 },
                ]}
                {...({ dataSet: { noScale: "" } } as object)}
              >
                {title}
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
