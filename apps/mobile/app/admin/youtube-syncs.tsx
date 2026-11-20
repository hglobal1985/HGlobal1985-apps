import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { api, type CourseSummary } from "@/api/client";
import { confirmAsk } from "@/features/confirm";
import { EditSheet } from "@/features/course-edit/edit-sheet";
import { useApi, useSession } from "@/state/session";
import { space } from "@/theme/tokens";
import { AppText, Button, Card, Chips, EmptyState, ErrorView, Field, LoadingView, NoticeBox, Screen } from "@/ui";
import { flashText } from "@/ui/flash-notice";

type Sync = { id: string; label: string; url: string; courseId: string; courseTitle: string; titlePrefix: string; lastSyncedAt: string | null; lastImported: number; lastNote: string };

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("zh-TW", { hour12: false }) : "還沒同步過");

/**
 * 設定 › 同步 YouTube 清單（業主 2026-11-20，超級管理員）：貼上播放清單網址、選要放進哪一張教材卡（或直接新建一張），
 * 之後清單有新影片，按該列的「同步」就會把新影片匯成教材（已經同步過的不重複）。教材名稱格式：「2026年11月 清單名稱（主持xxx）」。
 */
export default function YoutubeSyncsScreen() {
  const { member } = useSession();
  const isSuper = !!member?.titles.includes("超級管理員");
  const list = useApi<{ syncs: Sync[]; keyReady: boolean }>(isSuper ? "/admin/youtube-syncs" : null);
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  if (!isSuper) return <Screen header={false}><EmptyState icon="lock-closed-outline" title="只有超級管理員可以設定" /></Screen>;
  if (!list.data) return <Screen header={false}>{list.error ? <ErrorView message={list.error} onRetry={list.reload} /> : <LoadingView />}</Screen>;
  const run = async (s: Sync) => {
    setBusyId(s.id);
    try {
      const r = await api<{ imported: number; note: string }>("POST", `/admin/youtube-syncs/${s.id}/sync`);
      flashText(r.imported ? `已同步 ${r.imported} 支新影片` : r.note || "沒有新的影片");
      list.reload();
    } catch (e) {
      flashText((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };
  const remove = async (s: Sync) => {
    if (!(await confirmAsk("刪除同步設定", `確定刪除「${s.label || s.courseTitle}」的同步設定？已經匯入的教材不會被刪掉。`, "刪除"))) return;
    try {
      await api("DELETE", `/admin/youtube-syncs/${s.id}`);
      list.reload();
    } catch (e) {
      flashText((e as Error).message);
    }
  };
  return (
    <Screen header={false}>
      <AppText variant="callout" tone="muted">
        貼上 YouTube 播放清單的網址，之後清單有新影片，到這裡按「同步」就會自動加進教材卡（已經加過的影片不會重複）。
      </AppText>
      {!list.data.keyReady ? <NoticeBox tone="warning" text="尚未設定 YouTube 金鑰，目前無法同步。" /> : null}
      <Button label="新增同步清單" icon="add-circle-outline" onPress={() => setAdding(true)} fullWidth />
      {list.data.syncs.length ? (
        list.data.syncs.map((s) => (
          <Card key={s.id} style={{ gap: space.sm }}>
            <AppText variant="headline">{s.label || s.courseTitle}</AppText>
            <AppText variant="caption" tone="muted">{`放進：${s.courseTitle}`}</AppText>
            <AppText variant="caption" tone="muted" numberOfLines={1}>{s.url}</AppText>
            <AppText variant="caption" tone="muted">{`上次同步：${when(s.lastSyncedAt)}${s.lastSyncedAt ? `（新增 ${s.lastImported} 支）` : ""}`}</AppText>
            {s.lastNote ? <AppText variant="caption" tone="muted" numberOfLines={6}>{s.lastNote}</AppText> : null}
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Button variant="cancel" label="刪除" onPress={() => void remove(s)} fullWidth />
              </View>
              <View style={{ flex: 1 }}>
                <Button label="同步" icon="sync" loading={busyId === s.id} onPress={() => void run(s)} fullWidth />
              </View>
            </View>
          </Card>
        ))
      ) : (
        <EmptyState icon="logo-youtube" title="還沒有同步清單" body="按上面的「新增同步清單」開始。" />
      )}
      {adding ? <AddSheet onClose={() => setAdding(false)} onDone={() => { setAdding(false); list.reload(); }} /> : null}
    </Screen>
  );
}

function AddSheet({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const cards = useApi<CourseSummary[]>("/admin/courses");
  const [url, setUrl] = useState("");
  const [mode, setMode] = useState<"new" | "old">("new");
  const [newTitle, setNewTitle] = useState("");
  const [courseId, setCourseId] = useState("");
  const [prefix, setPrefix] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const noChapter = (cards.data ?? []).filter((x) => x.isList);
  const submit = async () => {
    if (!url.trim()) return setError("請貼上播放清單網址");
    if (mode === "new" && !newTitle.trim()) return setError("請輸入新教材卡的名稱");
    if (mode === "old" && !courseId) return setError("請選擇要放進的教材卡");
    setBusy(true);
    setError(null);
    try {
      await api("POST", "/admin/youtube-syncs", { url: url.trim(), ...(mode === "new" ? { newCardTitle: newTitle.trim() } : { courseId }), titlePrefix: prefix.trim() || (mode === "new" ? newTitle.trim() : "") });
      flashText("已新增，按「同步」就會匯入影片");
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <EditSheet title="新增同步清單" onClose={onClose} onSave={submit} saveLabel="新增" dirty={!!url.trim()} busy={busy} error={error}>
      <Field label="YouTube 播放清單網址" value={url} onChange={setUrl} placeholder="https://www.youtube.com/playlist?list=…" />
      <Chips label="放進哪一張教材卡" options={[{ key: "new", label: "新建一張教材卡" }, { key: "old", label: "放進現有的教材卡" }]} value={mode} onChange={(v) => setMode(v as "new" | "old")} />
      {mode === "new" ? (
        <Field label="新教材卡的名稱" value={newTitle} onChange={setNewTitle} placeholder="例如：會長翡翠鑽石會議" />
      ) : (
        <Chips label="現有的教材卡（只列純教材卡）" options={noChapter.map((x) => ({ key: x.id, label: x.title }))} value={courseId} onChange={setCourseId} />
      )}
      <Field label="教材名稱（選填，預設同教材卡名稱）" value={prefix} onChange={setPrefix} placeholder="例如：會長翡翠鑽石會議" />
      <AppText variant="caption" tone="muted">
        教材名稱格式：「2026年11月 名稱（主持xxx）」；年月與主持人從影片標題判讀，判讀不到就省略。
      </AppText>
    </EditSheet>
  );
}

const styles = StyleSheet.create({ row: { flexDirection: "row", gap: space.sm } });
