import { useRef, useState } from "react";
import { useBorderW } from "@/lib/elder-mode";
import { type HostInstance, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { useTheme } from "@/theme/theme";
import { radius, space } from "@/theme/tokens";
import { ELDER_FIELD } from "./elder-controls";
import { AppText } from "./text";
import { Icon } from "./icon";

/**
 * 【全站統一的下拉選單模組】（杜杜龍 2026-11-24 永久指示：獎銜／中心／系統的下拉樣式就是標準，所有「原地展開」的下拉都用這個，不可另做）。
 * 原本寫在 features/profile-prompt.tsx，現搬到這裡共用；會員資料表單、至尊模式的 Select 都從這裡來。
 * 樣式：深綠 2px 框、白底、選中項淡綠底、再按一次收起。
 */
const FIELD_H = 40;
/**
 * 自訂下拉選單（不用系統原生選單）：依螢幕剩餘空間自動往下或往上展開；選項超過 12 個時上方有搜尋框。
 */
export function Dropdown({ options, value, label, disabled, onPick, open, onOpenChange, pop, keepWidth, flow, big }: { /** 至尊模式大尺寸：跟首頁／課程的搜尋框同款（粗綠框、高 80）。 */ big?: boolean; /** 一欄堆疊版面（至尊模式頁）：選項直接展開在欄位下方、把後面的內容往下推，不浮在畫面上被別的元件蓋住。 */ flow?: boolean; pop?: "left" | "center" | "right"; /** 勾了「無」等狀態：欄位寬度鎖在勾選前的寬度（杜杜龍 2026-11-23），不隨文字縮短。 */ keepWidth?: boolean; options: { value: string; label: string }[]; value: string; label: string; disabled?: boolean; onPick: (v: string) => void; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { c } = useTheme();
  const bw = useBorderW(1);
  const bw2 = useBorderW(2);
  const { height: winH, width: winW } = useWindowDimensions();
  const box = useRef<HostInstance>(null);
  const lastW = useRef(0); // 最近一次「正常顯示」時的欄位寬度
    const [pos, setPos] = useState({ up: false, max: 240, left: 0, w: 220 });
  const toggle = () => {
    if (open) return onOpenChange(false);
    box.current?.measureInWindow((x, y, w, h) => {
      const below = winH - (y + h) - 24;
      const above = y - 24;
      const up = below < 240 && above > below;
      // 窄欄（三欄表單）的選項面板：寬度放寬，並以欄位為中心、夾在螢幕左右各 16 之內（不再超出畫面）。
      // 選項面板寬度＝剛好放得下最長的選項（不小於欄位本身），並夾在螢幕左右各 16 之內。
      const est = Math.max(0, ...options.map((o) => [...o.label].reduce((n, ch) => n + (/[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/.test(ch) ? 16 : 9), 0))) + 36;
      const popW = Math.min(winW - 32, Math.max(w, est));
      const left = Math.min(Math.max(x, 16), winW - 16 - popW) - x;
      setPos({ up, max: Math.max(140, Math.min(300, up ? above : below)), left, w: popW });
      onOpenChange(true);
    });
  };
  return (
    <View ref={box} collapsable={false} style={flow ? { width: "100%" } : pop ? { alignSelf: "stretch", minWidth: 0, zIndex: open ? 50 : 1 } : { flex: 1, zIndex: open ? 50 : 1 }}>
      <Pressable onLayout={(e) => { if (!keepWidth) lastW.current = Math.round(e.nativeEvent.layout.width); }} onPress={() => !disabled && toggle()} accessibilityRole="button" accessibilityState={{ disabled: !!disabled, expanded: open }} style={[styles.input, big ? { minHeight: ELDER_FIELD.height(), borderWidth: ELDER_FIELD.borderWidth, borderColor: c.accent, borderRadius: ELDER_FIELD.radius } : null, { borderColor: big ? c.accent : c.border, borderWidth: big ? ELDER_FIELD.borderWidth : bw, backgroundColor: disabled ? c.surfaceMuted : c.surface, flexDirection: "row", alignItems: "center", gap: pop ? 2 : space.sm, opacity: disabled ? 0.7 : 1 }, pop ? { paddingHorizontal: 8 } : null]}>
        <AppText variant={big ? "headline" : undefined} style={pop ? { flex: 1, minWidth: 0 } : { flex: 1 }} numberOfLines={big ? 2 : 1} tone={disabled || !value ? "muted" : undefined}>
          {label}
        </AppText>
        <Icon name={open ? "chevron-up" : "chevron-down"} size={pop ? 14 : big ? 28 : 20} color={c.textMuted} />
      </Pressable>
      {open ? (
        <View
          style={[
            styles.dropdown,
            flow
              ? { position: "relative", width: "100%", marginTop: 4, maxHeight: 360, borderWidth: big ? ELDER_FIELD.borderWidth : bw2, borderColor: big ? c.accent : c.accentText, backgroundColor: c.surface }
              : [pop ? { width: pos.w, left: pos.left, right: "auto" as never } : null, pos.up ? { bottom: FIELD_H + 4 } : { top: FIELD_H + 4 }, { maxHeight: pos.max, borderWidth: bw2, borderColor: c.accentText, backgroundColor: c.surface, shadowColor: "#000", shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 8 }],
          ]}
        >
          <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled">
            {options.map((o) => (
              <Pressable key={o.value} onPress={() => (onPick(o.value), onOpenChange(false))} accessibilityRole="button" style={[styles.opt, o.value === value && { backgroundColor: c.accentSoft }]}>
                <AppText numberOfLines={big ? 2 : 1} variant={big ? "headline" : undefined}>{o.label}</AppText>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}


const styles = StyleSheet.create({
  input: { minHeight: FIELD_H, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md, fontSize: 16 },
  dropdown: { position: "absolute", left: 0, right: 0, borderWidth: 1, borderRadius: radius.md, zIndex: 60, overflow: "hidden" },
  opt: { minHeight: 44, paddingHorizontal: space.md, justifyContent: "center" },
});
