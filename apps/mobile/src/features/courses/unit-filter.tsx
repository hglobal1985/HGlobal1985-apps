import { Pressable, StyleSheet, View } from "react-native";
import { useTheme } from "@/theme/theme";
import { minTouch, radius, space } from "@/theme/tokens";
import { AppText, Icon } from "@/ui";

/**
 * 「單元」模式的篩選：三個勾選（由左到右：主講人、總結、短影音），強制排成同一排、不換行（業主 2026-11-16 定案，取代原本的三顆眼睛按鈕）。
 * - 主講人：只顯示主講人章節。
 * - 總結：只顯示「總結與銷售課程」章節。可與主講人同時勾選（兩者都勾＝兩種章節都顯示）。
 * - 短影音：只顯示短影音，其餘不顯示；不能和另外兩個同時存在（勾短影音會取消另外兩個，勾另外兩個會取消短影音）。
 * 都沒勾＝全部顯示。值（存在手機本機）用「+」連接：speaker、summary、shorts；都沒有＝all。舊版的值讀得懂（舊的「不看…」忽略）。
 */
export type UnitFilterValue = string;
type Unit = { speaker: boolean; summary: boolean; shorts: boolean };

const parse = (v: string | null | undefined): Unit => {
  const set = new Set((v ?? "").split(/[+_]/));
  const u = { speaker: set.has("speaker"), summary: set.has("summary"), shorts: set.has("shorts") };
  return u.shorts ? { speaker: false, summary: false, shorts: true } : u; // 短影音不能與其他並存
};
const compose = (u: Unit): UnitFilterValue => {
  const parts = [u.speaker ? "speaker" : "", u.summary ? "summary" : "", u.shorts ? "shorts" : ""].filter(Boolean);
  return parts.length ? parts.join("+") : "all";
};

/** 單元清單套用篩選：勾了主講人／總結＝符合其中任何一種就顯示；勾了短影音＝只顯示短影音。 */
export const unitFilterPass = (f: UnitFilterValue, l: { isSpeaker?: boolean; isShorts?: boolean; isSummary?: boolean }) => {
  const u = parse(f);
  if (u.shorts) return !!l.isShorts;
  if (u.speaker || u.summary) return (u.speaker && !!l.isSpeaker) || (u.summary && !!l.isSummary);
  return true;
};

/** 讀取已存的選擇（不認得的值視為全部）。 */
export const parseUnitFilter = (v: string | null | undefined): UnitFilterValue => compose(parse(v));

export function UnitFilter({ value, onChange }: { value: UnitFilterValue; onChange: (v: UnitFilterValue) => void }) {
  const u = parse(value);
  return (
    <View style={styles.row}>
      <CheckItem label="主講人" checked={u.speaker} onPress={() => onChange(compose({ speaker: !u.speaker, summary: u.summary, shorts: false }))} />
      <CheckItem label="總結" checked={u.summary} onPress={() => onChange(compose({ speaker: u.speaker, summary: !u.summary, shorts: false }))} />
      <CheckItem label="短影音" checked={u.shorts} onPress={() => onChange(compose(u.shorts ? { speaker: false, summary: false, shorts: false } : { speaker: false, summary: false, shorts: true }))} />
    </View>
  );
}

function CheckItem({ label, checked, onPress }: { label: string; checked: boolean; onPress: () => void }) {
  const { c } = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.item, { backgroundColor: checked ? c.accentSoft : c.surface, borderColor: checked ? c.accent : c.border }]}
    >
      <Icon name={checked ? "checkbox" : "square-outline"} size={24} color={checked ? c.accent : c.textMuted} />
      <AppText variant="callout" style={{ color: checked ? c.accentText : c.text, fontWeight: "700", flexShrink: 0 }}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // 強制同一排、不換行；文字與勾選框貼近邊框（內距 4、間距 4），文字一律完整顯示、不縮小字體、不用「…」。
  // 各項先依內容寬度，剩下的空間平均分配（flexBasis auto + flexGrow）。
  row: { flexDirection: "row", flexWrap: "nowrap", gap: 6, paddingTop: space.xs },
  item: { flexGrow: 1, flexShrink: 1, flexBasis: "auto", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, minHeight: minTouch, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 4 },
});
