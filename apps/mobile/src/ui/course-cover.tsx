import { useState } from "react";
import { Image, StyleSheet, View } from "react-native";
import { resolveUrl } from "@/api/client";
import { useTheme } from "@/theme/theme";
import { textCoverLines } from "@/api/client";
import { courseThemes, coverBronze, radius, space } from "@/theme/tokens";
import { AppText } from "./text";

/** 估算文字寬度（以字級為單位）：中日韓全形字算 1，英數與標點約 0.58。 */
const textUnits = (t: string) => [...t].reduce((n, ch) => n + (/[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/.test(ch) ? 1 : 0.58), 0);

/** 找出剛好塞得進 w×h 方框的最大字級（字越少越大）；自動換行，不用 AI、不用圖片。 */
export function fitFontSize(title: string, w: number, h: number, max = 72, min = 16): number {
  const t = title.trim() || " ";
  for (let fs = max; fs > min; fs -= 2) {
    const perLine = Math.max(1, Math.floor(w / fs));
    // 逐字貪婪換行
    let lines = 1;
    let used = 0;
    for (const ch of t) {
      const u = textUnits(ch);
      if (used + u > perLine && used > 0) {
        lines++;
        used = 0;
      }
      used += u;
    }
    if (lines * fs * 1.18 <= h) return fs;
  }
  return min;
}

/** 固定分行的字級：每一行都塞得進寬度，總高度也塞得進方框。 */
function fitLines(lines: string[], w: number, h: number, max = 72, min = 14): number {
  // 每一行都不可換行（業主 2026-11-19：日期 X年X月 強制同一行）：寬度估算多留 15% 安全邊界，字寧可小一點。
  const widest = Math.max(...lines.map(textUnits), 1) * 1.15;
  for (let fs = max; fs > min; fs -= 2) if (widest * fs <= w && lines.length * fs * 1.25 <= h) return fs;
  return min;
}

/**
 * 課程封面（課程清單縮圖）：有 16:9 封面圖就顯示圖片（管理員從 EDM 裁切出來的）；
 * 沒有就由系統自動產生（字級已依封面大小算好，不吃全站字體放大 noScale，否則平板／電腦會爆版，業主 2026-11-18）：在主題色底上放大大的標題文字（程式排版，不是 AI 生成）；不顯示系列與分類標籤（業主 2026-11-14 指示）。
 * fill＝填滿父層（課程介紹頁上方沒有 EDM 時用）。
 */
export function CourseCover({ theme, label, title, height, imageUrl, fill }: { theme: string; label: string; title?: string; height?: number; imageUrl?: string | null; fill?: boolean }) {
  const { scheme } = useTheme();
  const [box, setBox] = useState({ w: 0, h: 0 });
  if (imageUrl) {
    return <Image source={{ uri: resolveUrl(imageUrl) }} style={{ width: "100%", aspectRatio: 16 / 9, borderRadius: radius.md }} resizeMode="cover" accessibilityLabel={`${label}課程封面`} />;
  }
  // 沒有封面圖時的文字封面顏色：自動隨機（依名稱固定挑一款，同一個名稱每次都同色），不再提供手動指定（業主 2026-11-18）。
  const names = Object.keys(courseThemes);
  const seed = [...(title || label || theme || "")].reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) >>> 0, 7);
  // 固定格式文字封面（銅章會議等，見 contract 的 textCoverLines）：咖啡色系底、固定「名稱（換行）X年X月」兩行。
  const fixed = textCoverLines(title);
  const [bg, fg] = fixed ? coverBronze[scheme] : courseThemes[names[seed % names.length]!]![scheme];
  const pad = space.md;
  const hasTitle = !!title?.trim();
  const innerW = Math.max(0, box.w - pad * 2);
  const innerH = Math.max(0, box.h - pad * 2);
  const fs = hasTitle && box.w ? (fixed ? fitLines(fixed, innerW, innerH) : fitFontSize(title!, innerW, innerH)) : 0;
  return (
    <View
      style={[styles.cover, fill ? [StyleSheet.absoluteFill, { borderRadius: 0 }] : height ? { height } : { aspectRatio: 16 / 9 }, { backgroundColor: bg }]}
      onLayout={(e) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
      accessible
      accessibilityRole="image"
      accessibilityLabel={`${title ?? ""} ${label}`.trim()}
    >
      <View style={[styles.ring, { borderColor: fg }]} />
      <View style={[styles.ring2, { backgroundColor: fg }]} />
      {hasTitle ? (
        <View style={styles.titleBox}>
          {fs ? (
            fixed ? (
              // 固定格式：每一行各自一個文字、強制單行不換行。
              <>
                {fixed.map((ln, i) => (
                  <AppText key={i} numberOfLines={1} style={[{ color: fg, fontSize: fs, lineHeight: Math.round(fs * 1.25), fontWeight: "900", textAlign: "center" }, { whiteSpace: "nowrap" } as object]} {...({ dataSet: { noScale: "" } } as object)}>
                    {ln}
                  </AppText>
                ))}
              </>
            ) : (
              <AppText style={{ color: fg, fontSize: fs, lineHeight: Math.round(fs * 1.18), fontWeight: "900", textAlign: "center" }} {...({ dataSet: { noScale: "" } } as object)}>
                {title}
              </AppText>
            )
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  cover: { borderRadius: radius.md, padding: space.md, overflow: "hidden", gap: 6 },
  ring: { position: "absolute", right: -24, top: -24, width: 110, height: 110, borderRadius: 55, borderWidth: 14, opacity: 0.25 },
  ring2: { position: "absolute", left: -40, bottom: -40, width: 120, height: 120, borderRadius: 60, opacity: 0.1 },
  titleBox: { flex: 1, justifyContent: "center", alignItems: "center" },
});
