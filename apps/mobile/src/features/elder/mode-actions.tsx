import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";
import { confirmSheet } from "@/features/confirm";
import { MODE_PROFILES } from "@/lib/app-mode";
import { ELDER_MAX, ELDER_MIN, elderTextScale, setElder, systemFontScale, useElder } from "@/lib/elder-mode";
import { useTheme } from "@/theme/theme";
import { radius, space } from "@/theme/tokens";
import { UI_SCALE } from "@/theme/ui-scale";
import { AppText } from "@/ui/text";
import { flashText } from "@/ui/flash-notice";

/** 從超派模式切到至尊模式（底部「至尊」鍵）：直接切換並回到首頁（大搜尋框）。 */
export function switchToElder() {
  setElder({ on: true });
  router.navigate("/");
  setTimeout(() => flashText(`已切換到${MODE_PROFILES.elder.name}模式`), 300);
}

/** 換回超派模式前先確認（業主 2026-11-24：避免長輩誤按）。 */
export async function askSwitchToMaker() {
  const ok = await confirmSheet({ title: `要換成「${MODE_PROFILES.super.name}模式」嗎？`, message: "字會變小，並顯示全部功能：我的清單、留言板、書櫃、學習成就、設定…", confirmLabel: "換過去", cancelLabel: "取消" });
  if (!ok) return;
  setElder({ on: false });
  router.replace("/");
  setTimeout(() => flashText(`已換回${MODE_PROFILES.super.name}模式`), 300);
}

/**
 * 字體與螢幕設定卡（至尊模式頁，業主 2026-11-24 改版）：設定一動就即時套用，沒有「套用」鈕。由上到下：
 * 「跟著手機字體大小」（粗體字，勾選＝以手機的設定為準，下面的範例、＋／－、快速大小都刷淡不能用）→
 * 小的「－／＋」＋「字體大小 150%」同一列 → 範例字 → 快速大小（標準／大／特大）→「文字加粗」。
 */
export function FontSizeCard() {
  const { c } = useTheme();
  const prefs = useElder();
  const eff = elderTextScale({ ...prefs, on: true });
  const sys = systemFontScale();
  const sampleSize = Math.round(17 * UI_SCALE * eff);
  const follow = prefs.followSystem;
  const step = (d: number) => setElder({ size: Math.min(ELDER_MAX, Math.max(ELDER_MIN, Math.round((prefs.size + d) * 10) / 10)) });
  const dim = follow ? { opacity: 0.35 } : null;
  const toggle = (label: string, value: boolean, onChange: (v: boolean) => void, note?: string) => (
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: value }} onPress={() => onChange(!value)} style={styles.toggle}>
      <Ionicons name={value ? "checkbox" : "square-outline"} size={30} color={value ? c.accent : c.textMuted} {...({ uiOnly: true } as object)} />
      <View style={{ flex: 1 }}>
        <AppText variant="headline" style={{ fontWeight: "900" }}>
          {label}
        </AppText>
        {note ? <AppText variant="caption" tone="muted">{note}</AppText> : null}
      </View>
    </Pressable>
  );
  return (
    <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
      {toggle("文字加粗", prefs.bold, (v) => setElder({ bold: v }))}
      {toggle("跟著手機字體大小", follow, (v) => setElder({ followSystem: v }), sys !== 1 ? `手機目前 ${Math.round(sys * 100)}%` : undefined)}
      <View style={[styles.row, { alignItems: "center" }, dim]} pointerEvents={follow ? "none" : "auto"}>
        <StepButton label="字變小" icon="remove" disabled={follow || prefs.size <= ELDER_MIN} onPress={() => step(-0.1)} outline />
        <StepButton label="字變大" icon="add" disabled={follow || prefs.size >= ELDER_MAX} onPress={() => step(0.1)} />
        <AppText variant="headline" style={{ flex: 1 }} numberOfLines={1}>
          字體大小　<AppText variant="headline" tone="accent">{`${Math.round(eff * 100)}%`}</AppText>
        </AppText>
      </View>
      <View style={[styles.sample, { backgroundColor: c.surfaceMuted }, dim]}>
        <AppText numberOfLines={1} style={{ fontSize: sampleSize, lineHeight: Math.round(sampleSize * 1.3), fontWeight: "700" }} {...({ dataSet: { noScale: "" } } as object)}>
          範例：認識好營養
        </AppText>
      </View>
      <View style={[styles.row, dim]} pointerEvents={follow ? "none" : "auto"}>
        {PRESETS.map((p) => {
          const on = !follow && Math.abs(prefs.size - p.size) < 0.05;
          return (
            <Pressable key={p.label} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => setElder({ size: p.size })} style={[styles.chip, { borderColor: c.accent, backgroundColor: on ? c.accent : c.surface }]}>
              <AppText variant="callout" style={{ fontWeight: "800", color: on ? c.textOnAccent : c.accentText }} numberOfLines={1}>
                {p.label}
              </AppText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** 快速大小（至尊模式字體倍數）。 */
const PRESETS = [
  { label: "標準", size: 1.5 },
  { label: "大", size: 1.8 },
  { label: "特大", size: 2.2 },
];

/** －／＋ 小按鈕（高 48，整個按鈕都能點）。 */
function StepButton({ label, icon, onPress, disabled, outline }: { label: string; icon: "add" | "remove"; onPress: () => void; disabled?: boolean; outline?: boolean }) {
  const { c } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.step, { backgroundColor: outline ? c.surface : c.accent, borderColor: c.accent, opacity: disabled ? 0.4 : 1 }]}
    >
      <Ionicons name={icon} size={26} color={outline ? c.accent : c.textOnAccent} {...({ uiOnly: true } as object)} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: radius.lg, padding: space.md, gap: space.md },
  sample: { borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.sm, overflow: "hidden" },
  row: { flexDirection: "row", gap: space.sm },
  step: { width: 52, height: 48, borderRadius: radius.md, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  toggle: { flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 52 },
  chip: { flex: 1, minHeight: 48, borderRadius: radius.md, borderWidth: 2, alignItems: "center", justifyContent: "center", paddingHorizontal: space.xs },
});
