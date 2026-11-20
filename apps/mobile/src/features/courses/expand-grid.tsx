import { useState, type ReactNode } from "react";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Platform, Pressable, View } from "react-native";
import { useTheme } from "@/theme/theme";
import { minTouch, radius, space } from "@/theme/tokens";
import { AppText } from "@/ui";

/**
 * 「點一張卡，在那一列下方原地展開內容，其他卡淡化」的共用版面模組（業主 2026-11-20）：
 * 清單卡的區塊（`FullVersionList`）與系列頁的縮圖卡（`SeriesPage`）都用它；一次只展開一張，再點收合。
 * 淡化效果統一用 `ui/fade-style.ts` 的 `fadedStyle`：呼叫端在 `renderCell` 收到 `dimmed` 時套上去。
 * 展開內容最下面一定有「收合」鈕（業主 2026-11-20 回報：展開後卡片捲到上方固定的影片區底下按不到、收不起來），收合後自動捲回那張卡。
 * 欄數由 `cols(容器寬度)` 決定，每列格子等寬；展開的內容 `renderPanel` 接在被點那張卡所在的那一列下面。
 */
export type ExpandCellState = { on: boolean; /** 有別的卡展開時，其他卡 ＝ true（要套 fadedStyle） */ dimmed: boolean; toggle: () => void; width: number };

export function ExpandGrid<T>({
  items,
  keyOf,
  cols,
  gap = space.sm,
  defaultOpenId,
  renderCell,
  renderPanel,
}: {
  items: T[];
  keyOf: (item: T) => string;
  cols: (containerWidth: number) => number;
  gap?: number;
  defaultOpenId?: string | null;
  renderCell: (item: T, state: ExpandCellState) => ReactNode;
  renderPanel: (item: T) => ReactNode;
}) {
  const { c } = useTheme();
  const [openId, setOpenId] = useState<string | null>(defaultOpenId ?? null);
  const collapse = (id: string) => {
    setOpenId(null);
    if (Platform.OS === "web" && typeof document !== "undefined") setTimeout(() => document.getElementById(`xg-${id}`)?.scrollIntoView({ block: "center", behavior: "smooth" }), 60);
  };
  const [w, setW] = useState(0);
  const n = Math.max(1, cols(w));
  const cell = w ? Math.floor((w - gap * (n - 1)) / n) : 0;
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += n) rows.push(items.slice(i, i + n));
  return (
    <View style={{ gap }} onLayout={(e) => setW(Math.floor(e.nativeEvent.layout.width))}>
      {cell
        ? rows.map((row, ri) => {
            const opened = row.find((x) => keyOf(x) === openId);
            return (
              <View key={ri} style={{ gap }}>
                <View style={{ flexDirection: "row", alignItems: "flex-start", gap }}>
                  {row.map((x) => {
                    const id = keyOf(x);
                    const on = id === openId;
                    return <View key={id} nativeID={`xg-${id}`}>{renderCell(x, { on, dimmed: !!openId && !on, toggle: () => setOpenId(on ? null : id), width: cell })}</View>;
                  })}
                  {Array.from({ length: n - row.length }, (_, k) => (
                    <View key={`pad${k}`} style={{ width: cell }} />
                  ))}
                </View>
                {opened ? (
                  <View style={{ gap }}>
                    {renderPanel(opened)}
                    <Pressable accessibilityRole="button" accessibilityLabel="收合" onPress={() => collapse(keyOf(opened))} style={({ pressed }) => [{ minHeight: minTouch, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface }, pressed && { opacity: 0.7 }]}>
                      <Ionicons name="chevron-up" size={18} color={c.accentText} />
                      <AppText variant="callout" style={{ fontWeight: "800", color: c.accentText }}>
                        收合
                      </AppText>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            );
          })
        : null}
    </View>
  );
}
