import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { confirmSheet } from "@/features/confirm";
import { MODE_PROFILES } from "@/lib/app-mode";
import { ELDER_MAX, ELDER_MIN, elderTextScale, getElder, setElder, systemFontScale } from "@/lib/elder-mode";
import { useTheme } from "@/theme/theme";
import { radius, space } from "@/theme/tokens";
import { UI_SCALE } from "@/theme/ui-scale";
import { AppText } from "@/ui/text";
import { Button } from "@/ui/button";
import { Check } from "@/ui/check";
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
 * 字體大小卡（至尊模式頁，業主 2026-11-24）：大的「－／＋」，邊看範例字邊調；按「套用」才套用到全站
 * （全站要重新排版，所以不是每按一下就換）。「跟著手機的字體大小」勾選後一樣按套用。
 */
export function FontSizeCard() {
  const { c } = useTheme();
  const saved = getElder();
  const [draft, setDraft] = useState(() => saved);
  const step = (d: number) => setDraft((p) => ({ ...p, size: Math.min(ELDER_MAX, Math.max(ELDER_MIN, Math.round((p.size + d) * 10) / 10)) }));
  const eff = elderTextScale({ ...draft, on: true });
  const changed = draft.size !== saved.size || draft.followSystem !== saved.followSystem;
  const sys = systemFontScale();
  const sampleSize = Math.round(17 * UI_SCALE * eff);
  return (
    <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
      <AppText variant="headline">
        字體大小　<AppText variant="headline" tone="accent">{`${Math.round(eff * 100)}%`}</AppText>
      </AppText>
      <View style={[styles.sample, { backgroundColor: c.surfaceMuted }]}>
        <AppText numberOfLines={1} style={{ fontSize: sampleSize, lineHeight: Math.round(sampleSize * 1.3), fontWeight: "700" }} {...({ dataSet: { noScale: "" } } as object)}>
          範例：認識好營養
        </AppText>
      </View>
      <View style={styles.row}>
        <StepButton label="字變小" icon="remove" disabled={draft.size <= ELDER_MIN} onPress={() => step(-0.1)} outline />
        <StepButton label="字變大" icon="add" disabled={draft.size >= ELDER_MAX} onPress={() => step(0.1)} />
      </View>
      <Check label={sys !== 1 ? `跟著手機的字體大小（手機目前 ${Math.round(sys * 100)}%）` : "跟著手機的字體大小"} value={draft.followSystem} onChange={(v) => setDraft((p) => ({ ...p, followSystem: v }))} />
      {changed ? <Button label="套用這個字體大小" icon="checkmark" onPress={() => setElder({ size: draft.size, followSystem: draft.followSystem })} fullWidth /> : null}
    </View>
  );
}

/** －／＋ 大按鈕（長輩好按：高 64、整個按鈕都能點）。 */
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
      <Ionicons name={icon} size={34} color={outline ? c.accent : c.textOnAccent} {...({ uiOnly: true } as object)} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: radius.lg, padding: space.md, gap: space.md },
  sample: { borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.sm, overflow: "hidden" },
  row: { flexDirection: "row", gap: space.sm },
  step: { flex: 1, minHeight: 64, borderRadius: radius.lg, borderWidth: 3, alignItems: "center", justifyContent: "center" },
});
