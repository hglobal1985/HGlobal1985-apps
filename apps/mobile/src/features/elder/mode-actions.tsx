import Ionicons from "@expo/vector-icons/Ionicons";
import { useBorderW } from "@/lib/elder-mode";
import { router } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";
import { MODE_PROFILES } from "@/lib/app-mode";
import { ANCHOR_ID, rememberAnchor } from "@/lib/keep-scroll";
import { ELDER_DEFAULT, ELDER_MAX, ELDER_MIN, elderTextScale, setElder, systemFontScale, useElder } from "@/lib/elder-mode";
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

/** 換回超派模式：不需確認，直接切換（業主 2026-11-24 更正，取代原本的確認面板）。 */
export async function askSwitchToMaker() {
  setElder({ on: false });
  router.replace("/");
  setTimeout(() => flashText(`已換回${MODE_PROFILES.super.name}模式`), 300);
}

/**
 * 字體與螢幕設定卡（至尊模式頁，業主 2026-11-24 改版）：設定一動就即時套用，沒有「套用」鈕。由上到下：
 * 「跟著手機字體大小」（粗體字，勾選＝以手機的設定為準，下面的範例、＋／－、快速大小都刷淡不能用）→
 * 小的「－／＋」＋「字體大小 150%」同一列 → 範例字 → 快速大小（標準／大／特大）→「文字加粗」。
 */
/** 勾「跟著手機」之前的自訂大小。 */
let savedSize: number | null = null;

export function FontSizeCard() {
  const bw = useBorderW(1);
  // 改字體會重建畫面；改之前記住這張卡在螢幕上的位置，重建後捲回來讓它留在原處（業主 2026-11-24）。
  const setKeep = (patch: Parameters<typeof setElder>[0]) => (rememberAnchor(), setElder(patch));
  const { c } = useTheme();
  const prefs = useElder();
  const eff = elderTextScale({ ...prefs, on: true });
  const sys = systemFontScale();
  const sampleSize = Math.round(17 * UI_SCALE * eff);
  const follow = prefs.followSystem;
  const step = (d: number) => setKeep({ size: Math.min(ELDER_MAX, Math.max(ELDER_MIN, Math.round((prefs.size + d) * 10) / 10)) });
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
    <View nativeID={ANCHOR_ID} style={[styles.card, { backgroundColor: c.surface, borderColor: c.border, borderWidth: bw }]}>
      {toggle("文字加粗", prefs.bold, (v) => setKeep({ bold: v }))}
      {toggle("跟著手機字體大小", follow, (v) => {
        // 勾選＝字體設定立刻復原成預設（舊的自訂大小先記起來）；取消勾選＝還原剛才的自訂大小（業主 2026-11-24）。
        if (v) {
          savedSize = prefs.size;
          setKeep({ followSystem: true, size: ELDER_DEFAULT });
        } else setKeep({ followSystem: false, size: savedSize ?? prefs.size });
      }, sys !== 1 ? `手機目前 ${Math.round(sys * 100)}%` : undefined)}
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
            <Pressable key={p.label} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => setKeep({ size: p.size })} style={[styles.chip, { borderWidth: bw }, { borderColor: c.accent, backgroundColor: on ? c.accent : c.surface }]}>
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
  const bw = useBorderW(2);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.step, { borderWidth: bw, backgroundColor: outline ? c.surface : c.accent, borderColor: c.accent, opacity: disabled ? 0.4 : 1 }]}
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
