import { useEffect, useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import { api } from "@/api/client";
import { useTheme } from "@/theme/theme";
import { minTouch, radius, space, type } from "@/theme/tokens";
import { AppText, Button } from "@/ui";
import { showToast } from "@/ui/toast";

/** 教育中心地址（編輯中心頁，與 EDM 同一個面板）：中心還沒有課程時，中心頁會顯示這個地址；留空儲存＝清除。 */
export function CenterAddressField({ center, current, onSaved }: { center: string; current: string; onSaved: () => void }) {
  const { c } = useTheme();
  const [draft, setDraft] = useState(current);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => setDraft(current), [current]);
  const save = async (address: string) => {
    setBusy(true);
    setErr(null);
    try {
      await api("PUT", `/admin/center-info?center=${encodeURIComponent(center)}`, { address });
      onSaved();
      showToast(address.trim() ? "已更新中心地址" : "已清除中心地址");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={{ gap: space.xs }}>
      <AppText variant="callout">中心地址</AppText>
      <TextInput
        value={draft}
        onChangeText={(v) => setDraft(v.slice(0, 120))}
        placeholder="例如：台北市中山區某某路 1 號 3 樓"
        placeholderTextColor={c.textMuted}
        accessibilityLabel="中心地址"
        style={[styles.input, type.body, { color: c.text, borderColor: c.border, backgroundColor: c.surface }]}
      />
      <View style={styles.row}>
        <Button label="儲存地址" icon="checkmark-outline" loading={busy} disabled={busy || draft.trim() === current} onPress={() => save(draft)} />
        {current ? <Button variant="ghost" label="清除" disabled={busy} onPress={() => save("")} /> : null}
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
