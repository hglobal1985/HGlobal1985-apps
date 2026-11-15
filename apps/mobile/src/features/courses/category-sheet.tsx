import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import type { CourseSummary } from "@/api/client";
import { useTheme } from "@/theme/theme";
import { minTouch, radius, space } from "@/theme/tokens";
import { AppText, Button } from "@/ui";
import { BottomSheet } from "@/ui/bottom-sheet";

/** 「未分類」的內部代碼（沒有任何分類的課程）。 */
export const NONE = "__none__";
/** 把課程的分類（用「、」分隔）拆成陣列。 */
export const courseCats = (x: { category: string }) => x.category.split("、").map((v) => v.trim()).filter(Boolean);
export const catLabel = (v: string) => (v === NONE ? "未分類" : v);

/** 課程是否同時符合所選的每一個分類（多個＝交集）；沒選＝全部符合；「未分類」只能單獨選。 */
export function matchesCats(x: { category: string }, sel: string[]): boolean {
  if (!sel.length) return true;
  if (sel[0] === NONE) return !courseCats(x).length;
  const mine = courseCats(x);
  return sel.every((s) => mine.includes(s));
}

const COLS = 3;
const GAP = space.sm;

/**
 * 分類篩選（逐步縮小）：點分類框從下方彈出。已選的分類深綠；沒選的分類後面的數字＝「再加上它之後剩幾門」，
 * 加上去會變成 0 門的分類灰色虛線、不能點；不勾＝不篩選；勾兩個以上＝同時有這些分類。
 * 版面：一列固定三個、每個標籤固定大小（勾選前後尺寸、位置完全不變）。
 */
export function CategorySheet({ courses, names, picked, onApply, onClose }: { courses: CourseSummary[]; names: string[]; picked: string[]; onApply: (sel: string[]) => void; onClose: () => void }) {
  const { c } = useTheme();
  const [sel, setSel] = useState<string[]>(picked);
  const [w, setW] = useState(0);
  const count = (s: string[]) => courses.filter((x) => matchesCats(x, s)).length;
  const total = count(sel);
  // 沒有確認鈕：每點一下就立刻套用到後面的清單；點面板外面的灰色區域關閉。
  const change = (next: string[]) => {
    setSel(next);
    onApply(next);
  };
  const toggle = (name: string) => change(sel.includes(name) ? sel.filter((v) => v !== name) : name === NONE ? [NONE] : [...sel, name]);
  const title = sel.length ? `已選：${sel.map(catLabel).join("＋")}（${total} 門）` : "選擇分類";
  const cell = w ? Math.floor((w - GAP * (COLS - 1)) / COLS) : 0;
  return (
    <BottomSheet onClose={onClose}>
      <AppText variant="headline" numberOfLines={2}>
        {title}
      </AppText>
      <ScrollView style={{ maxHeight: 360 }} contentContainerStyle={styles.wrap} onLayout={(e) => setW(Math.floor(e.nativeEvent.layout.width))}>
        {cell
          ? names.map((name) => {
              const on = sel.includes(name);
              const left = on ? count(sel) : name === NONE ? (sel.length ? 0 : count([NONE])) : sel[0] === NONE ? 0 : count([...sel, name]);
              const dead = !on && left === 0;
              return (
                <Pressable
                  key={name}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on, disabled: dead }}
                  accessibilityLabel={`${catLabel(name)}，${left} 門`}
                  disabled={dead}
                  onPress={() => toggle(name)}
                  style={[styles.chip, { width: cell, backgroundColor: on ? c.accent : c.surface, borderColor: on ? c.accent : c.border, borderStyle: dead ? "dashed" : "solid" }]}
                >
                  <AppText variant="callout" numberOfLines={1} style={{ flexShrink: 1, fontWeight: "600", color: on ? c.textOnAccent : dead ? c.textMuted : c.text, opacity: dead ? 0.6 : 1 }}>
                    {catLabel(name)}
                  </AppText>
                  <AppText variant="caption" style={{ color: on ? c.textOnAccent : c.textMuted, opacity: dead ? 0.6 : 1 }}>
                    {left}
                  </AppText>
                </Pressable>
              );
            })
          : null}
      </ScrollView>
      <View style={sel.length ? undefined : { opacity: 0.45 }} pointerEvents={sel.length ? "auto" : "none"}>
        <Button variant="secondary" label="清除" onPress={() => change([])} fullWidth />
      </View>
    </BottomSheet>
  );
}

/**
 * 分類篩選框（放在上方工具列）：沒篩選＝白底「分類 ⌄」；篩選中＝深綠實心白字「培訓＋美容」＋圓形 ✕（一鍵清除）。
 */
export function CategoryFilterBox({ picked, onOpen, onClear }: { picked: string[]; onOpen: () => void; onClear: () => void }) {
  const { c } = useTheme();
  if (!picked.length)
    return (
      <Pressable accessibilityRole="button" accessibilityLabel="分類篩選" onPress={onOpen} style={[styles.box, { backgroundColor: c.surface, borderColor: c.border }]}>
        <AppText variant="body" numberOfLines={1} style={{ flex: 1, color: c.textMuted }}>
          分類
        </AppText>
        <Ionicons name="chevron-down" size={18} color={c.textMuted} />
      </Pressable>
    );
  return (
    <View style={[styles.box, { backgroundColor: c.accent, borderColor: c.accent }]}>
      <Pressable accessibilityRole="button" accessibilityLabel={`分類篩選中：${picked.map(catLabel).join("、")}，點一下更改`} onPress={onOpen} style={styles.main}>
        <AppText variant="body" numberOfLines={1} style={{ color: c.textOnAccent, fontWeight: "700" }}>
          {picked.map(catLabel).join("＋")}
        </AppText>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="清除分類篩選" onPress={onClear} hitSlop={8} style={styles.clear}>
        <Ionicons name="close" size={16} color={c.textOnAccent} />
      </Pressable>
    </View>
  );
}

/** 篩選中的說明列（放在上方工具列下方）：「培訓 ＋ 美容　共 2 門　再縮小」。 */
export function CategoryHintBar({ picked, total, onRefine }: { picked: string[]; total: number; onRefine: () => void }) {
  const { c } = useTheme();
  return (
    <View style={[styles.hint, { backgroundColor: c.accentSoft }]}>
      <AppText variant="callout" numberOfLines={1} style={{ flex: 1, color: c.accentText }}>
        {picked.map(catLabel).join(" ＋ ")}　共 {total} 門
      </AppText>
      <Pressable accessibilityRole="button" accessibilityLabel="再縮小分類" onPress={onRefine} hitSlop={8} style={styles.refine}>
        <AppText variant="callout" style={{ color: c.accentText, fontWeight: "700", textDecorationLine: "underline" }}>
          再縮小
        </AppText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: GAP, paddingVertical: space.xs },
  chip: { height: minTouch, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: space.sm, borderRadius: radius.pill, borderWidth: 1.5 },
  box: { minHeight: minTouch, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.sm, flexDirection: "row", alignItems: "center", gap: space.xs },
  main: { flex: 1, minHeight: minTouch - 2, justifyContent: "center", paddingLeft: space.xs },
  clear: { width: 28, height: 28, borderRadius: 14, backgroundColor: "rgba(255,255,255,0.28)", alignItems: "center", justifyContent: "center" },
  hint: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, minHeight: 40, marginTop: space.sm, borderRadius: radius.md },
  refine: { minHeight: minTouch, justifyContent: "center" },
});
