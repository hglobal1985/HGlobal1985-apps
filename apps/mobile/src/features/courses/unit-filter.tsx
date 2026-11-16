import { Pressable, StyleSheet, View } from "react-native";
import { useTheme } from "@/theme/theme";
import { minTouch, radius, space } from "@/theme/tokens";
import { AppText, Icon } from "@/ui";

/**
 * 「單元」模式的篩選：三顆「眼睛」按鈕（業主 2026-11-16 定案）。
 * 「短影音」「總結與銷售」兩顆每按一下循環三種狀態：
 *   灰色「…開關」（沒篩選，全部顯示）→ 綠色「只看…」→ 斜線「不看…」→ 回到灰色。
 * 「主講」按鈕兩種狀態：灰色「全部顯示」↔ 綠色「只看主講」。
 * 互斥規則：開「只看短影音」或「只看總結與銷售」時，主講按鈕強制關閉、變淡灰色不能按（強制關閉後不會自動恢復）；
 * 主講開著時，總結與銷售按鈕跳過「只看」直接到「不看」（主講與總結與銷售是不同堂，同時只看會永遠是空的）。
 * 值的寫法（存在手機本機）：用「+」連接 speaker／shorts／noshorts／summary／nosummary；都沒有＝all。舊版的五個值仍然讀得懂。
 */
export type UnitFilterValue = string;
type Tri = "off" | "only" | "hide";
type Unit = { shorts: Tri; speaker: boolean; summary: Tri };

const parse = (v: string | null | undefined): Unit => {
  const set = new Set((v ?? "").split(/[+_]/));
  return { shorts: set.has("shorts") ? "only" : set.has("noshorts") ? "hide" : "off", speaker: set.has("speaker"), summary: set.has("summary") ? "only" : set.has("nosummary") ? "hide" : "off" };
};
const compose = (u: Unit): UnitFilterValue => {
  const parts = [u.speaker ? "speaker" : "", u.shorts === "only" ? "shorts" : u.shorts === "hide" ? "noshorts" : "", u.summary === "only" ? "summary" : u.summary === "hide" ? "nosummary" : ""].filter(Boolean);
  return parts.length ? parts.join("+") : "all";
};

/** 單元清單套用篩選。 */
export const unitFilterPass = (f: UnitFilterValue, l: { isSpeaker?: boolean; isShorts?: boolean; isSummary?: boolean }) => {
  const u = parse(f);
  if (u.speaker && !l.isSpeaker) return false;
  if (u.shorts === "only" ? !l.isShorts : u.shorts === "hide" ? !!l.isShorts : false) return false;
  return u.summary === "only" ? !!l.isSummary : u.summary === "hide" ? !l.isSummary : true;
};

/** 讀取已存的選擇（不認得的值視為全部；同時「只看」會讓主講強制關閉）。 */
export const parseUnitFilter = (v: string | null | undefined): UnitFilterValue => {
  const u = parse(v);
  return compose(u.shorts === "only" || u.summary === "only" ? { ...u, speaker: false } : u);
};

export function UnitFilter({ value, onChange }: { value: UnitFilterValue; onChange: (v: UnitFilterValue) => void }) {
  const u = parse(value);
  const speakerOff = u.shorts === "only" || u.summary === "only";
  const nextShorts: Tri = u.shorts === "off" ? "only" : u.shorts === "only" ? "hide" : "off";
  const nextSummary: Tri = u.summary === "off" ? (u.speaker ? "hide" : "only") : u.summary === "only" ? "hide" : "off";
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <FilterButton
          kind={u.shorts === "only" ? "on" : u.shorts === "hide" ? "hide" : "off"}
          label={u.shorts === "only" ? "只看短影音" : u.shorts === "hide" ? "不看短影音" : "短影音開關"}
          onPress={() => onChange(compose({ ...u, shorts: nextShorts, speaker: nextShorts === "only" ? false : u.speaker }))} // 開「只看短影音」＝主講強制關閉
        />
        <FilterButton kind={speakerOff ? "disabled" : u.speaker ? "on" : "off"} label={u.speaker ? "只看主講" : "全部顯示"} onPress={() => onChange(compose({ ...u, speaker: !u.speaker }))} />
      </View>
      <View style={styles.row}>
        <FilterButton
          kind={u.summary === "only" ? "on" : u.summary === "hide" ? "hide" : "off"}
          label={u.summary === "only" ? "只看總結與銷售" : u.summary === "hide" ? "不看總結與銷售" : "總結與銷售開關"}
          onPress={() => onChange(compose({ ...u, summary: nextSummary, speaker: nextSummary === "only" ? false : u.speaker }))} // 開「只看總結與銷售」＝主講強制關閉
        />
      </View>
    </View>
  );
}

/** on＝綠色眼睛張開；off＝灰色眼睛（不劃線）；hide＝眼睛劃斜線（不看）；disabled＝更淡的灰色、不能按。 */
function FilterButton({ label, kind, onPress }: { label: string; kind: "on" | "off" | "hide" | "disabled"; onPress: () => void }) {
  const { c } = useTheme();
  const on = kind === "on";
  const disabled = kind === "disabled";
  const hide = kind === "hide";
  const fg = on ? c.textOnAccent : hide ? c.accentText : disabled ? c.border : c.textMuted;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: on || hide, disabled }}
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={[styles.item, { backgroundColor: on ? c.accent : hide ? c.accentSoft : disabled ? c.surfaceMuted : c.surface, borderColor: on ? c.accent : hide ? c.accent : disabled ? c.surfaceMuted : c.border }]}
    >
      <Icon name={hide ? "eye-off" : "eye"} size={22} color={fg} />
      <AppText variant="callout" numberOfLines={1} style={{ color: fg, fontWeight: "700" }}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm, paddingTop: space.xs },
  row: { flexDirection: "row", gap: space.sm },
  item: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, minHeight: minTouch, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.sm },
});
