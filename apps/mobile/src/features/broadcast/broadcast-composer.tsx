import { useState } from "react";
import { StyleSheet, TextInput } from "react-native";
import { api } from "@/api/client";
import { EditSheet } from "@/features/course-edit/edit-sheet";
import { useTheme } from "@/theme/theme";
import { minTouch, radius, space, type } from "@/theme/tokens";
import { AppText, SegmentTabs } from "@/ui";
import { flashText } from "@/ui/flash-notice";
import type { BroadcastScope } from "./use-broadcasts";

/** 新增公告時可以選的範圍：中心／系列要帶名稱（name），label 是畫面上的說明。 */
export type BroadcastTarget = { scope: BroadcastScope; name?: string; label: string };

/**
 * 「新增公告」面板（業主 2026-11-21）：中心頁只有該中心一個選項；其他頁面（系列頁、寰宇大學…）由超級管理員選「目前的系列／中心」或「首頁公告」。
 * 只有一個選項就不顯示選擇列。新增中心／系列公告時，後端會通知訂閱者。
 */
export function BroadcastComposer({ targets, onClose, onDone }: { targets: BroadcastTarget[]; onClose: () => void; onDone: () => void }) {
  const { c } = useTheme();
  const [pick, setPick] = useState(0);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = targets[Math.min(pick, targets.length - 1)]!;
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api("POST", "/admin/broadcasts", { scope: t.scope, name: t.name, text });
      flashText("已新增公告");
      onDone();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <EditSheet title="新增公告" onClose={onClose} onSave={() => void submit()} saveLabel="新增" dirty={!!text.trim()} busy={busy} error={error}>
      {targets.length > 1 ? <SegmentTabs options={targets.map((x, i) => ({ key: String(i), label: x.label }))} value={String(pick)} onChange={(k) => setPick(Number(k))} /> : null}
      <AppText variant="caption" tone="muted">
        {t.scope === "home" ? "顯示在首頁最上方的跑馬燈。" : t.scope === "series" ? "顯示在這個系列頁，以及系列內各課程頁的封面下方；訂閱這個系列的人會收到通知。" : "顯示在這個中心頁，以及這個中心各課程頁的封面下方；訂閱這個中心的人會收到通知。"}
      </AppText>
      <TextInput value={text} onChangeText={setText} placeholder="輸入公告內容（最多 300 字）" placeholderTextColor={c.textMuted} multiline maxLength={300} accessibilityLabel="公告內容" style={[styles.input, type.body, { color: c.text, borderColor: c.border, backgroundColor: c.surface }]} />
    </EditSheet>
  );
}

const styles = StyleSheet.create({
  input: { minHeight: minTouch + 60, borderWidth: 1, borderRadius: radius.md, padding: space.md, textAlignVertical: "top" },
});
