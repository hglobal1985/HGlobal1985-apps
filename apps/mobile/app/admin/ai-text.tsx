import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { api } from "@/api/client";
import { confirmSheet } from "@/features/confirm";
import { useTheme } from "@/theme/theme";
import { minTouch, radius, space, type } from "@/theme/tokens";
import { AppText, Button, Card, EmptyState, ErrorView, LoadingView, NoticeBox, Screen } from "@/ui";
import { useApi, useSession } from "@/state/session";

type Field = { name: string; hint: string };
type View_ = { fields: Field[]; defaults: Field[]; other: string; stats: { total: number; done: number; pending: number }; model: { id: string; name: string; cost: string } | null };

/**
 * AI 文字辨識（超級管理員，業主 2026-11-24）：自訂 EDM 辨識文字要整理成哪些欄位（日期、時間、主題…）。
 * 存檔後，已辨識的舊 EDM 會在背景自動用新格式重新整理（只跑文字模型，不用再看圖）。歸不進任何欄位的內容固定放在「其他內容」。
 */
export default function AiTextScreen() {
  const { c } = useTheme();
  const { member } = useSession();
  const isSuper = !!member?.titles.includes("超級管理員");
  const { data, error, loading, reload } = useApi<View_>(isSuper ? "/admin/edm-fields" : null);
  const [rows, setRows] = useState<Field[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  useEffect(() => {
    if (data && !rows) setRows(data.fields.map((f) => ({ ...f })));
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!isSuper)
    return (
      <Screen header={false}>
        <EmptyState icon="lock-closed-outline" title="只有超級管理員可以設定 AI 文字辨識" />
      </Screen>
    );
  if (error && !data) return <ErrorView message={error} onRetry={reload} />;
  if (!data || !rows) return <LoadingView />;

  const set = (i: number, patch: Partial<Field>) => setRows(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= rows.length) return;
    const n = [...rows];
    [n[i], n[j]] = [n[j]!, n[i]!];
    setRows(n);
  };
  const dirty = JSON.stringify(rows) !== JSON.stringify(data.fields);
  const names = rows.map((r) => r.name.trim());
  const bad = names.some((n) => !n) || new Set(names).size !== names.length || names.includes(data.other);
  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await api("PUT", "/admin/edm-fields", { fields: rows.map((r) => ({ name: r.name.trim(), hint: r.hint.trim() })) });
      setRows(null);
      reload();
      setMsg({ tone: "success", text: "已儲存。已辨識的舊 EDM 會在背景慢慢用新格式重新整理。" });
    } catch (e) {
      setMsg({ tone: "danger", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const runNow = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ done: number }>("POST", "/admin/edm-fields/run");
      reload();
      setMsg({ tone: "success", text: r.done ? `已整理 ${r.done} 張` : "沒有需要整理的，或今天的 AI 額度已用完" });
    } catch (e) {
      setMsg({ tone: "danger", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const reset = async () => {
    const ok = await confirmSheet({ title: "還原成預設格式", message: "目前的欄位會被換成預設的 10 個欄位（日期、時間、主題…），要按「儲存」才會生效。", confirmLabel: "還原", cancelLabel: "先不要" });
    if (ok) setRows(data.defaults.map((f) => ({ ...f })));
  };
  const input = [styles.input, { borderColor: c.border, backgroundColor: c.surface, color: c.text }];
  return (
    <Screen header={false}>
      <View style={{ gap: space.md }}>
        <AppText variant="title">AI 文字辨識</AppText>
        <AppText variant="callout" tone="muted">
          EDM 上傳後，AI 會先讀出海報上的文字，再照下面的欄位整理好，顯示在「全螢幕看圖 › 圖片資訊」。歸不進任何欄位的內容，固定放在最後的「{data.other}」。
        </AppText>
        {msg ? <NoticeBox tone={msg.tone} text={msg.text} /> : null}
        <Card>
          <AppText variant="callout" style={{ fontWeight: "800" }}>整理進度</AppText>
          <AppText variant="callout" tone="muted">{`已辨識 ${data.stats.total} 張，其中 ${data.stats.done} 張已用目前格式整理${data.stats.pending ? `，${data.stats.pending} 張排隊中（背景每次開啟中心頁會補整理幾張）` : "，全部完成"}。`}</AppText>
          {data.stats.pending ? <Button label="現在整理 5 張" icon="sparkles-outline" onPress={runNow} loading={busy} disabled={busy} fullWidth /> : null}
          <AppText variant="caption" tone="muted">{data.model ? `使用模型：${data.model.name}（${data.model.cost}）。要換模型到「設定 › AI 模型 › EDM 文字整理」。` : ""}</AppText>
          <Button label="到 AI 模型頁換模型" variant="secondary" onPress={() => router.push("/admin/ai-models")} fullWidth />
        </Card>
        <AppText variant="headline">欄位格式（由上到下的顯示順序）</AppText>
        {rows.map((r, i) => (
          <Card key={i}>
            <View style={styles.rowTop}>
              <TextInput value={r.name} onChangeText={(v) => set(i, { name: v })} placeholder="欄位名稱" maxLength={20} style={[...input, { flex: 1, fontWeight: "800" }]} placeholderTextColor={c.textMuted} />
              <Pressable accessibilityRole="button" accessibilityLabel="往上移" onPress={() => move(i, -1)} disabled={i === 0} style={[styles.ic, i === 0 && { opacity: 0.35 }]}>
                <Ionicons name="chevron-up" size={22} color={c.text} />
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="往下移" onPress={() => move(i, 1)} disabled={i === rows.length - 1} style={[styles.ic, i === rows.length - 1 && { opacity: 0.35 }]}>
                <Ionicons name="chevron-down" size={22} color={c.text} />
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="刪除欄位" onPress={() => (rows.length > 1 ? setRows(rows.filter((_, k) => k !== i)) : undefined)} style={styles.ic}>
                <Ionicons name="trash-outline" size={22} color={c.danger} />
              </Pressable>
            </View>
            <TextInput value={r.hint} onChangeText={(v) => set(i, { hint: v })} placeholder="給 AI 的說明（例如：活動舉辦日期，含星期）" maxLength={120} style={input} placeholderTextColor={c.textMuted} multiline />
          </Card>
        ))}
        <Card>
          <AppText variant="callout" style={{ fontWeight: "800" }}>{data.other}（固定，不能改名或刪除）</AppText>
          <AppText variant="caption" tone="muted">無法歸入上面任何欄位的內容都會放在這裡。</AppText>
        </Card>
        {rows.length < 20 ? <Button label="新增欄位" icon="add" variant="secondary" onPress={() => setRows([...rows, { name: "", hint: "" }])} fullWidth /> : null}
        {bad ? <NoticeBox tone="danger" text={`欄位名稱不可空白、不可重複，也不能叫「${data.other}」`} /> : null}
        <View style={{ flexDirection: "row", gap: space.sm }}>
          <View style={{ flex: 1 }}><Button label="還原預設" variant="cancel" onPress={reset} fullWidth /></View>
          <View style={{ flex: 1 }}><Button label="儲存" onPress={save} loading={busy} disabled={busy || !dirty || bad} fullWidth /></View>
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  input: { minHeight: minTouch, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: 8, ...type.body },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 4 },
  ic: { width: minTouch, height: minTouch, alignItems: "center", justifyContent: "center" },
});
