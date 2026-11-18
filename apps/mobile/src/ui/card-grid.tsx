import { Children, type ReactNode } from "react";
import { View } from "react-native";
import { useLayout } from "@/theme/layout";
import { space } from "@/theme/tokens";

/**
 * 卡片格狀排列（業主 2026-11-18 大螢幕版面）：手機一列一張（跟原本一樣），平板兩張、寬螢幕三張（theme/layout.ts 的 cardCols）。
 * 「學習中」、系列「顯示全部」等 CourseCard 清單都用它；最後一列不足時用空白補齊，卡片寬度永遠一致。
 */
export function CardGrid({ children, cols, gap = space.md }: { children: ReactNode; cols?: number; gap?: number }) {
  const { cardCols } = useLayout();
  const n = Math.max(1, cols ?? cardCols);
  const items = Children.toArray(children).filter(Boolean);
  if (n === 1) return <View style={{ gap }}>{items}</View>;
  const rows: ReactNode[][] = [];
  for (let i = 0; i < items.length; i += n) rows.push(items.slice(i, i + n));
  return (
    <View style={{ gap }}>
      {rows.map((row, r) => (
        <View key={r} style={{ flexDirection: "row", gap, alignItems: "stretch" }}>
          {row.map((item, i) => (
            <View key={i} style={{ flex: 1, minWidth: 0 }}>
              {item}
            </View>
          ))}
          {Array.from({ length: n - row.length }, (_, i) => (
            <View key={`pad${i}`} style={{ flex: 1 }} />
          ))}
        </View>
      ))}
    </View>
  );
}
