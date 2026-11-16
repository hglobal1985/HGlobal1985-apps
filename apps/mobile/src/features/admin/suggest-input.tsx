import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, TextInput, View, type StyleProp, type TextStyle } from "react-native";
import { api } from "@/api/client";
import { useTheme } from "@/theme/theme";
import { minTouch, radius, space, type } from "@/theme/tokens";
import { AppText } from "@/ui";

/** 把命中的字加粗。 */
function Highlight({ text, q, color }: { text: string; q: string; color: string }) {
  const i = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (i < 0) return <AppText variant="body" style={{ color }}>{text}</AppText>;
  return (
    <AppText variant="body" style={{ color }}>
      {text.slice(0, i)}
      <AppText variant="body" style={{ color, fontWeight: "800" }}>
        {text.slice(i, i + q.length)}
      </AppText>
      {text.slice(i + q.length)}
    </AppText>
  );
}

/**
 * 輸入「一個字」就跳出關連詞的輸入框（業主 2026-11-15：詞庫未來約 50 個，不用膠囊標籤）。
 * 關連詞以下拉清單顯示在輸入框正下方（放在版面內、不浮動，不會被面板底部按鈕或鍵盤遮住），可捲動，點一列填入。
 * 要改關連詞的呈現只改這個元件；目前用在主講人／分享者的「職稱」（詞庫：中央會員系統 job_title）。
 */
/** 關連詞查詢：有輸入（≥1 個字）且游標在欄位內才查，延遲 200ms，回傳最多 50 筆。 */
export function useSuggestions(value: string, pool: "job_title" | "sharer_name", active: boolean): string[] {
  const [list, setList] = useState<string[]>([]);
  const seq = useRef(0);
  const q = value.trim();
  useEffect(() => {
    if (!active || !q) {
      setList([]);
      return;
    }
    const id = ++seq.current;
    const t = setTimeout(() => {
      // 職稱＝中央詞庫；分享者姓名＝行動大學裡已經用過的名字（日後改由講師名單提供）。
      api<string[]>("GET", pool === "sharer_name" ? `/admin/sharer-names?q=${encodeURIComponent(q)}` : `/me/vocab?pool=${pool}&q=${encodeURIComponent(q)}`)
        .then((r) => id === seq.current && setList(r.filter((x) => x !== value).slice(0, 50)))
        .catch(() => id === seq.current && setList([]));
    }, 200);
    return () => clearTimeout(t);
  }, [value, active]); // eslint-disable-line react-hooks/exhaustive-deps
  return list;
}

/** 關連詞下拉清單（滿版寬、最多約 6 列高、可捲動、點一列填入）。 */
export function SuggestList({ list, q, onPick }: { list: string[]; q: string; onPick: (v: string) => void }) {
  const { c } = useTheme();
  if (!list.length) return null;
  return (
    <View style={[styles.list, { borderColor: c.border, backgroundColor: c.surface }]} accessibilityRole="list">
      <ScrollView style={{ maxHeight: 264 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
        {list.map((x, i) => (
          <Pressable key={x} accessibilityRole="button" accessibilityLabel={`選用 ${x}`} onPress={() => onPick(x)} style={[styles.row, i > 0 && { borderTopColor: c.border, borderTopWidth: StyleSheet.hairlineWidth }]}>
            <Highlight text={x} q={q.trim()} color={c.text} />
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

/** 單獨使用的輸入框＋關連詞（欄位下方直接接清單）。 */
export function SuggestInput({ value, onChange, pool, accessibilityLabel, placeholder, maxLength = 50, inputStyle }: { value: string; onChange: (v: string) => void; pool: "job_title"; accessibilityLabel: string; placeholder?: string; maxLength?: number; inputStyle?: StyleProp<TextStyle> }) {
  const [focus, setFocus] = useState(false);
  const list = useSuggestions(value, pool, focus);
  return (
    <View style={{ gap: space.xs }}>
      <SuggestField value={value} onChange={onChange} onFocusChange={setFocus} accessibilityLabel={accessibilityLabel} placeholder={placeholder} maxLength={maxLength} inputStyle={inputStyle} />
      {focus ? <SuggestList list={list} q={value} onPick={(x) => (onChange(x), setFocus(false))} /> : null}
    </View>
  );
}

/** 只有輸入框（清單由外面放，例如兩欄並排時清單要放在整列下方）。 */
export function SuggestField({ value, onChange, onFocusChange, accessibilityLabel, placeholder, maxLength = 50, inputStyle }: { value: string; onChange: (v: string) => void; onFocusChange: (f: boolean) => void; accessibilityLabel: string; placeholder?: string; maxLength?: number; inputStyle?: StyleProp<TextStyle> }) {
  const { c } = useTheme();
  return (
    <TextInput
      value={value}
      onChangeText={(v) => onChange(v.slice(0, maxLength))}
      onFocus={() => onFocusChange(true)}
      onBlur={() => setTimeout(() => onFocusChange(false), 250)}
      placeholder={placeholder}
      placeholderTextColor={c.textMuted}
      accessibilityLabel={accessibilityLabel}
      autoCorrect={false}
      style={[styles.box, type.body, { color: c.text, borderColor: c.border, backgroundColor: c.surface }, inputStyle]}
    />
  );
}

const styles = StyleSheet.create({
  box: { minHeight: minTouch, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md, justifyContent: "center" },
  list: { borderWidth: 1, borderRadius: radius.md, overflow: "hidden" },
  row: { minHeight: minTouch, paddingHorizontal: space.md, justifyContent: "center" },
});
