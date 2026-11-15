import { useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import { api } from "@/api/client";
import { centerTitle } from "@/features/format";
import { useCenterNames } from "@/state/center-names";
import { useTheme } from "@/theme/theme";
import { minTouch, radius, space, type } from "@/theme/tokens";
import { AppText, Button } from "@/ui";
import { showToast } from "@/ui/toast";

/**
 * 教育中心名稱（編輯中心頁）：自訂這個中心在整個行動大學顯示的名稱；留空儲存＝還原預設「去掉數字代碼＋教育中心」。
 * 只是顯示名稱，不會改中央會員系統的中心清單與中心代碼。
 */
export function CenterNameField({ center }: { center: string }) {
  const { c } = useTheme();
  const { names, reload } = useCenterNames();
  const key = center.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
  const current = names[key] ?? "";
  const [draft, setDraft] = useState(current);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async (name: string) => {
    setBusy(true);
    setErr(null);
    try {
      await api("PUT", `/admin/center-name?center=${encodeURIComponent(center)}`, { name });
      reload();
      showToast(name.trim() ? "已更新教育中心名稱" : "已還原預設名稱");
      if (!name.trim()) setDraft("");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const fallback = centerTitle(center);
  return (
    <View style={{ gap: space.xs }}>
      <AppText variant="callout">教育中心名稱</AppText>
      <TextInput
        value={draft}
        onChangeText={(v) => setDraft(v.slice(0, 30))}
        placeholder={`預設：${fallback}`}
        placeholderTextColor={c.textMuted}
        accessibilityLabel="教育中心名稱"
        style={[styles.input, type.body, { color: c.text, borderColor: c.border, backgroundColor: c.surface }]}
      />
      <AppText variant="caption" tone="muted">
        儲存後，整個行動大學顯示這個中心的地方（中心清單、課程卡、分享預覽…）都會一起改成這個名稱；留空就是預設格式。
      </AppText>
      <View style={styles.row}>
        <Button label="儲存名稱" icon="checkmark-outline" loading={busy} disabled={busy || draft.trim() === current} onPress={() => save(draft)} />
        {current ? <Button variant="ghost" label="還原預設" disabled={busy} onPress={() => save("")} /> : null}
      </View>
      {err ? (
        <AppText variant="caption" tone="danger">
          {err}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  input: { minHeight: minTouch, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm, flexWrap: "wrap" },
});
