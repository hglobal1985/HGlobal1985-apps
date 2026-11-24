import { Pressable, View } from "react-native";
import { useTheme } from "@/theme/theme";
import { radius } from "@/theme/tokens";
import { UI_SCALE } from "@/theme/ui-scale";
import { AppText } from "./text";

/**
 * 【至尊模式專用控制項模組】（業主 2026-11-24 永久指示：至尊模式頁面上方的標籤、下拉、搜尋框一律同款，不可另做）。
 * 樣式＝首頁／課程搜尋框：粗 4px 綠框、大圓角、高度隨 UI_SCALE、字用 headline。
 * 用到的地方：`ElderTabs`（通知頁標籤）、`Dropdown big`（至尊模式的 Select，見 ui/dropdown.tsx）、搜尋框（features/elder/elder-search.tsx）。
 */
export const ELDER_FIELD = {
  borderWidth: 4,
  radius: radius.lg + 6,
  /** 輸入框、下拉的高度。 */
  height: () => Math.round(80 * UI_SCALE),
  /** 標籤鈕的高度（一列四顆）。 */
  tabHeight: () => Math.round(72 * UI_SCALE),
};

export type ElderTab<K extends string> = { key: K; label: string; /** 未處理數量（紅點，貼在右上角）。 */ count?: number };

/** 至尊模式的標籤列：同一列平分寬度，選中＝實心綠底，數量紅點貼在鈕的右上角（不佔橫向寬度）。 */
export function ElderTabs<K extends string>({ tabs, value, onChange }: { tabs: ElderTab<K>[]; value: K; onChange: (k: K) => void }) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: "row", gap: 6 }} accessibilityRole="radiogroup">
      {tabs.map((t) => {
        const on = t.key === value;
        const n = t.count ?? 0;
        return (
          <Pressable
            key={t.key}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`${t.label}${n ? `，${n} 則未處理` : ""}`}
            onPress={() => onChange(t.key)}
            style={{ flex: 1, minWidth: 0, minHeight: ELDER_FIELD.tabHeight(), borderRadius: ELDER_FIELD.radius, borderWidth: ELDER_FIELD.borderWidth, borderColor: c.accent, backgroundColor: on ? c.accent : c.surface, alignItems: "center", justifyContent: "center" }}
          >
            <AppText variant="headline" numberOfLines={1} style={{ fontWeight: "800", color: on ? c.textOnAccent : c.text }}>
              {t.label}
            </AppText>
            {n ? (
              <View style={{ position: "absolute", top: -6, right: -2, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, backgroundColor: on ? c.textOnAccent : c.danger, alignItems: "center", justifyContent: "center" }}>
                <AppText variant="caption" style={{ color: on ? c.accent : "#fff", fontWeight: "800", fontSize: 11, lineHeight: 14 }}>
                  {n > 99 ? "99+" : n}
                </AppText>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}
