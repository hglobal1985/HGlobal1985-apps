import Ionicons from "@expo/vector-icons/Ionicons";
import { useRef, useState, type ElementRef } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { BottomSheet } from "./bottom-sheet";
import { useTheme } from "@/theme/theme";
import { minTouch, radius, space } from "@/theme/tokens";
import { AppText } from "./text";

/** short＝收起時顯示在框內的短文字（例如「11 月」），展開的選單仍顯示完整的 label。 */
/** hint＝展開選單裡靠右顯示的小字（例如「3 堂」）。 */
export type SelectBadge = { text: string; tone: "accent" | "warn" | "new" };
export type SelectOption = { key: string; label: string; short?: string; hint?: string; /** 靠右的小色塊標籤（例如「學習中 2」「未上架 1」「新」）。 */ badges?: SelectBadge[] };
export type SelectProps = {
  label?: string;
  value: string;
  options: SelectOption[];
  onChange: (key: string) => void;
  /** 選項裡沒有符合 value 時顯示的文字。 */
  placeholder?: string;
  /** 篩選中：框變深綠實心白字，右邊出現 ✕（點了呼叫 onClear 清除篩選）。 */
  active?: boolean;
  onClear?: () => void;
};

/** 下拉選單（App 與網頁一律用這個）：點開後從畫面下方彈出選項面板（不使用瀏覽器或系統內建的選單），目前選的項目打勾，開啟時自動捲到該項。 */
export function Select({ label, value, options, onChange, placeholder = "請選擇", active = false, onClear }: SelectProps) {
  const { c } = useTheme();
  const [open, setOpen] = useState(false);
  const scroller = useRef<ElementRef<typeof ScrollView>>(null);
  const current = options.find((o) => o.key === value);
  const index = Math.max(0, options.findIndex((o) => o.key === value));
  return (
    <View style={styles.wrap}>
      {label ? (
        <AppText variant="caption" tone="muted">
          {label}
        </AppText>
      ) : null}
      {active && onClear ? (
        <View style={[styles.box, { backgroundColor: c.accent, borderColor: c.accent }]}>
          <Pressable accessibilityRole="button" accessibilityLabel={`${label ?? current?.label ?? "篩選"}（篩選中，點一下更換）`} onPress={() => setOpen(true)} style={styles.activeMain}>
            <AppText variant="body" numberOfLines={1} style={{ color: c.textOnAccent, fontWeight: "700" }}>
              {current?.short ?? current?.label ?? placeholder}
            </AppText>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="清除篩選" onPress={onClear} hitSlop={8} style={styles.clear}>
            <Ionicons name="close" size={16} color={c.textOnAccent} />
          </Pressable>
        </View>
      ) : (
      <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={() => setOpen(true)} style={[styles.box, { backgroundColor: c.surface, borderColor: c.border }]}>
        <AppText variant="body" numberOfLines={1} style={{ flex: 1, color: current ? c.text : c.textMuted }}>
          {current?.short ?? current?.label ?? placeholder}
        </AppText>
        <Ionicons name="chevron-down" size={18} color={c.textMuted} />
      </Pressable>
      )}
      {open ? (
        <BottomSheet onClose={() => setOpen(false)}>
          {label ? <AppText variant="headline">{label}</AppText> : null}
          <ScrollView ref={scroller} style={{ maxHeight: 380 }} onLayout={() => scroller.current?.scrollTo({ y: Math.max(0, (index - 2) * ITEM_H), animated: false })}>
            {options.map((o) => {
              const on = o.key === value;
              return (
                <Pressable
                  key={o.key}
                  accessibilityRole="menuitem"
                  accessibilityState={{ selected: on }}
                  onPress={() => {
                    setOpen(false);
                    onChange(o.key);
                  }}
                  style={[styles.item, { borderBottomColor: c.border, backgroundColor: on ? c.accentSoft : "transparent" }]}
                >
                  <AppText variant="body" style={{ flex: 1, fontWeight: on ? "700" : "400", color: on ? c.accentText : c.text }}>
                    {o.label}
                  </AppText>
                  {o.badges?.map((b) => (
                    <View key={b.text} style={[styles.badge, { backgroundColor: b.tone === "warn" ? c.warning : b.tone === "new" ? "#E5484D" : c.accentSoft }]}>
                      <AppText variant="caption" style={{ color: b.tone === "accent" ? c.accentText : "#fff", fontWeight: "700" }}>
                        {b.text}
                      </AppText>
                    </View>
                  ))}
                  {o.hint ? (
                    <AppText variant="callout" tone="muted" style={{ marginRight: space.sm }}>
                      {o.hint}
                    </AppText>
                  ) : null}
                  {on ? <Ionicons name="checkmark" size={22} color={c.accent} /> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </BottomSheet>
      ) : null}
    </View>
  );
}

const ITEM_H = minTouch + 4;
const styles = StyleSheet.create({
  activeMain: { flex: 1, minHeight: minTouch - 2, justifyContent: "center", paddingLeft: space.xs },
  clear: { width: 28, height: 28, borderRadius: 14, backgroundColor: "rgba(255,255,255,0.28)", alignItems: "center", justifyContent: "center" },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, marginRight: 6 },
  wrap: { gap: 4, flex: 1, minWidth: 0 },
  box: { minHeight: minTouch, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.sm, flexDirection: "row", alignItems: "center", gap: space.xs },
  item: { minHeight: minTouch + 4, paddingHorizontal: space.md, flexDirection: "row", alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth, borderRadius: radius.sm },
});
