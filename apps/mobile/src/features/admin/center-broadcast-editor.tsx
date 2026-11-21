import { useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import { api } from "@/api/client";
import { confirmAsk } from "@/features/confirm";
import { useBroadcasts } from "@/features/broadcast/use-broadcasts";
import { useTheme } from "@/theme/theme";
import { minTouch, radius, space, type } from "@/theme/tokens";
import { AppText, Button, NoticeBox } from "@/ui";
import Ionicons from "@expo/vector-icons/Ionicons";
import { FLASH_ICON, showFlash } from "@/ui/flash-notice";

/**
 * 中心頁「編輯」裡的廣播公告設定（業主 2026-11-17）：可以新增多則公告輪播、改內容、刪除，並設定每則停留幾秒（預設 2 秒）。
 * 每個動作按下就立刻儲存。新增公告時，訂閱這個中心的人會收到通知。
 */
export function CenterBroadcastEditor({ center, onChanged }: { center: string; onChanged: () => void }) {
  const { c } = useTheme();
  const list = useBroadcasts({ center });
  const [text, setText] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const d = list.data;
  const run = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      list.reload();
      onChanged();
      if (done) showFlash({ icon: <Ionicons name="megaphone" size={FLASH_ICON - 3} color="#E0A800" />, title: done });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const submit = () =>
    run(async () => {
      if (editId) await api("PATCH", `/admin/broadcasts/${editId}`, { text });
      else await api("POST", "/admin/broadcasts", { scope: "center", name: center, text });
      setText("");
      setEditId(null);
    }, editId ? "已更新公告" : "已新增公告");
  const remove = async (id: string) => {
    if (!(await confirmAsk("刪除公告", "確定刪除這則廣播公告？", "刪除"))) return;
    await run(() => api("DELETE", `/admin/broadcasts/${id}`), "已刪除");
  };
  const secs = d?.seconds ?? 2;
  const setSecs = (n: number) => run(() => api("PUT", "/admin/center-broadcast-seconds", { center, seconds: Math.min(60, Math.max(1, n)) }));
  return (
    <View style={styles.wrap} accessibilityLabel="廣播公告設定">
      <AppText variant="title">廣播公告</AppText>
      <AppText variant="caption" tone="muted">
        顯示在中心頁與這個中心各課程頁的封面下方，多則會自動輪播。新增時，訂閱這個中心的人會收到通知。
      </AppText>
      {error ? <NoticeBox tone="danger" text={error} /> : null}
      <View style={styles.secRow}>
        <AppText variant="body" style={{ flex: 1 }}>
          每則停留
        </AppText>
        <Button variant="secondary" label="－" disabled={busy || secs <= 1} onPress={() => void setSecs(secs - 1)} />
        <AppText variant="headline" style={{ minWidth: 56, textAlign: "center" }}>
          {secs} 秒
        </AppText>
        <Button variant="secondary" label="＋" disabled={busy || secs >= 60} onPress={() => void setSecs(secs + 1)} />
      </View>
      {d?.items.map((x) => (
        <View key={x.id} style={[styles.item, { borderColor: c.border, backgroundColor: c.surface }]}>
          <AppText variant="caption" tone="muted">
            {x.date}
          </AppText>
          <AppText variant="body">{x.text}</AppText>
          <View style={styles.itemBtns}>
            <Button variant="secondary" label="修改" disabled={busy} onPress={() => (setEditId(x.id), setText(x.text))} />
            <Button variant="ghost" label="刪除" disabled={busy} onPress={() => void remove(x.id)} />
          </View>
        </View>
      ))}
      {d && !d.items.length ? (
        <AppText variant="callout" tone="muted">
          還沒有公告。
        </AppText>
      ) : null}
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder={editId ? "修改公告內容" : "輸入新的公告內容（最多 300 字）"}
        placeholderTextColor={c.textMuted}
        multiline
        maxLength={300}
        accessibilityLabel="公告內容"
        style={[styles.input, type.body, { color: c.text, borderColor: c.border, backgroundColor: c.surface }]}
      />
      <View style={styles.itemBtns}>
        {editId ? <Button variant="cancel" label="取消修改" disabled={busy} onPress={() => (setEditId(null), setText(""))} /> : null}
        <Button label={editId ? "更新公告" : "新增公告"} icon="megaphone-outline" loading={busy} disabled={busy || !text.trim()} onPress={() => void submit()} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm },
  secRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  item: { borderWidth: 1, borderRadius: radius.md, padding: space.md, gap: 4 },
  itemBtns: { flexDirection: "row", gap: space.sm, flexWrap: "wrap" },
  input: { minHeight: minTouch + 40, borderWidth: 1, borderRadius: radius.md, padding: space.md, textAlignVertical: "top" },
});
