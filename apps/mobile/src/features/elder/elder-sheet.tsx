import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { confirmSheet } from "@/features/confirm";
import { MODE_PROFILES } from "@/lib/app-mode";
import { ELDER_MAX, ELDER_MIN, elderTextScale, getElder, setElder, systemFontScale } from "@/lib/elder-mode";
import { useSession } from "@/state/session";
import { useTheme } from "@/theme/theme";
import { radius, space } from "@/theme/tokens";
import { UI_SCALE } from "@/theme/ui-scale";
import { AppText } from "@/ui/text";
import { BottomSheet } from "@/ui/bottom-sheet";
import { Button } from "@/ui/button";
import { Check } from "@/ui/check";
import { flashText } from "@/ui/flash-notice";
import { CrownIcon } from "./crown-icon";

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
  setTimeout(() => flashText(`已換回${MODE_PROFILES.super.name}模式`), 300);
}

/**
 * 至尊模式的面板（按底部「超派」鍵打開）：字體大小（－／＋，邊看範例字邊調）、跟著手機字體大小、
 * 訂單紀錄、帳號（設定頁）、換回超派模式。至尊模式不顯示「設定」分頁，這些都放這裡（業主 2026-11-24，B 方案）。
 * 字體改變等面板關閉才套用到全站（全站要重新排版，面板開著時先用範例字預覽）。
 */
export function ElderSheet({ onClose }: { onClose: () => void }) {
  const { c } = useTheme();
  const { member } = useSession();
  const [draft, setDraft] = useState(() => getElder());
  const step = (d: number) => setDraft((p) => ({ ...p, size: Math.min(ELDER_MAX, Math.max(ELDER_MIN, Math.round((p.size + d) * 10) / 10)) }));
  const eff = elderTextScale({ ...draft, on: true });
  const pct = Math.round(eff * 100);
  const sys = systemFontScale();
  const close = () => {
    setElder({ size: draft.size, followSystem: draft.followSystem });
    onClose();
  };
  const go = (href: "/orders" | "/me") => {
    close();
    router.push(href);
  };
  const sampleSize = Math.round(17 * UI_SCALE * eff);
  return (
    <BottomSheet onClose={close}>
      <View style={styles.head}>
        <CrownIcon size={30} color={c.warning} />
        <AppText variant="title" accessibilityRole="header">
          至尊模式
        </AppText>
      </View>
      <AppText variant="headline">
        字體大小　<AppText variant="headline" tone="accent">{`${pct}%`}</AppText>
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
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Button variant="secondary" icon="document-text-outline" label="訂單紀錄" onPress={() => (member ? go("/orders") : go("/me"))} fullWidth />
        </View>
        <View style={{ flex: 1 }}>
          <Button variant="secondary" icon="person-circle-outline" label={member ? "帳號" : "登入"} onPress={() => go("/me")} fullWidth />
        </View>
      </View>
      <Button
        variant="cancel"
        icon="rocket-outline"
        label="換回超派模式"
        onPress={() => {
          close();
          void askSwitchToMaker();
        }}
        fullWidth
      />
      <Button label="完成" onPress={close} fullWidth />
    </BottomSheet>
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
  head: { flexDirection: "row", alignItems: "center", gap: space.sm },
  sample: { borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.sm, overflow: "hidden" },
  row: { flexDirection: "row", gap: space.sm },
  step: { flex: 1, minHeight: 64, borderRadius: radius.lg, borderWidth: 3, alignItems: "center", justifyContent: "center" },
});
