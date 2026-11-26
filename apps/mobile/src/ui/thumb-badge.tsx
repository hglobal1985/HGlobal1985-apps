import { useState } from "react";
import { StyleSheet, View } from "react-native";
import type { ThumbBadgeKind } from "@/api/client";
import { useThumbBadge } from "@/lib/thumb-badges";
import { AppText } from "./text";
import { ThumbFallback } from "./thumb-fallback";

/** 符號字數 → 字級占框短邊的比例（emoji／1 個字最大，4 個字兩行）。 */
function fontFor(symbol: string, box: number): number {
  const n = [...symbol].length;
  const r = n <= 1 ? 0.62 : n === 2 ? 0.42 : n === 3 ? 0.3 : 0.3;
  return Math.max(10, Math.round(box * r));
}

/** 縮圖符號本體（填滿父層）：底色＋置中的 emoji／短文字。預覽與全站縮圖共用。 */
export function ThumbBadgeView({ symbol, fg, bg }: { symbol: string; fg: string; bg: string }) {
  const [box, setBox] = useState(0);
  const chars = [...symbol];
  const text = chars.length === 4 ? `${chars.slice(0, 2).join("")}\n${chars.slice(2).join("")}` : symbol;
  const fs = fontFor(symbol, box);
  return (
    <View style={[StyleSheet.absoluteFill, styles.box, { backgroundColor: bg }]} accessible={false} onLayout={(e) => setBox(Math.min(e.nativeEvent.layout.width, e.nativeEvent.layout.height))}>
      {box ? (
        <AppText style={{ color: fg, fontSize: fs, lineHeight: Math.round(fs * 1.15), fontWeight: "900", textAlign: "center" }} {...({ dataSet: { noScale: "" } } as object)}>
          {text}
        </AppText>
      ) : null}
    </View>
  );
}

/**
 * 小縮圖的預設樣子（杜杜龍 2026-11-23 取代「用標題文字當縮圖」）：這張卡有指定縮圖符號就顯示它，沒指定顯示綠色學士帽。
 * 放進縮圖框裡會自動鋪滿。kind／id：課程＝課程編號、系列＝系列名稱、中心＝中心名稱。
 */
export function CardThumb({ kind, id }: { kind: ThumbBadgeKind; id: string | null | undefined }) {
  const b = useThumbBadge(kind, id);
  return b ? <ThumbBadgeView symbol={b.symbol} fg={b.fg} bg={b.bg} /> : <ThumbFallback />;
}

const styles = StyleSheet.create({ box: { alignItems: "center", justifyContent: "center", overflow: "hidden" } });
