import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { api, type CourseSummary } from "@/api/client";
import { confirmAsk, confirmDanger } from "@/features/confirm";
import { EditSheet } from "@/features/course-edit/edit-sheet";
import { SyncAutoCard } from "@/features/sync-auto";
import { AppPlayerCheck, SyncNamingFields, TITLE_ONLY } from "@/features/course-edit/youtube-import";
import { useApi, useSession } from "@/state/session";
import { space } from "@/theme/tokens";
import { AppText, Button, Card, Chips, EmptyState, ErrorView, Field, LoadingView, NoticeBox, Screen } from "@/ui";
import { flashText } from "@/ui/flash-notice";

type Sync = { appPlayer?: number; stripText?: string; id: string; label: string; url: string; courseId: string; courseTitle: string; titlePrefix: string; titleFormat: string; sortMode: string; sortLocked: number; lastSyncedAt: string | null; lastImported: number; lastNote: string };

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("zh-TW", { hour12: false }) : "還沒同步過");

/**
 * 設定 › 同步 YouTube 清單（杜杜龍 2026-11-20，超級管理員）：貼上播放清單網址、選要放進哪一張教材卡（或直接新建一張），
 * 之後清單有新影片，按該列的「同步」就會把新影片匯成教材（已經同步過的不重複）。每份清單各自有「命名規則」與「排序規則」，可在清單卡上修改；你手動調整過順序的卡會自動鎖定，同步不會重排。
 */
export default function YoutubeSyncsScreen() {
  const { member } = useSession();
  const isSuper = !!member?.titles.includes("超級管理員");
  const list = useApi<{ syncs: Sync[]; keyReady: boolean; formatHelp: string; sortLabels: Record<string, string> }>(isSuper ? "/admin/youtube-syncs" : null);
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Sync | null>(null);
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
  const renameAll = async (s: Sync) => {
    if (!(await confirmAsk("重新命名已匯入的教材", `依命名規則「${s.titleFormat}」，把「${s.courseTitle}」裡這份清單已匯入的教材全部改名？`, "改名"))) return;
    setBusyId(s.id);
    try {
      const r = await api<{ renamed: number; note: string }>("POST", `/admin/youtube-syncs/${s.id}/rename`);
      flashText(r.note);
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
  const removeAll = async (s: Sync) => {
    if (!(await confirmDanger("刪除清單與關聯教材", `會刪除「${s.label || s.courseTitle}」的同步設定，以及「${s.courseTitle}」裡來源是這個播放清單影片的所有教材（含學員的相關紀錄），無法復原。確定刪除？`, "全部刪除"))) return;
    setBusyId(s.id);
    try {
      const r = await api<{ deleted: number }>("POST", `/admin/youtube-syncs/${s.id}/delete-with-materials`);
      flashText(`已刪除清單與 ${r.deleted} 個教材`);
      list.reload();
    } catch (e) {
      flashText((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };
  return (
    <Screen header={false}>
      <AppText variant="callout" tone="muted">
        貼上 YouTube 播放清單的網址，之後清單有新影片，到這裡按「同步」就會自動加進教材卡（已經加過的影片不會重複）。
      </AppText>
      {!list.data.keyReady ? <NoticeBox tone="warning" text="尚未設定 YouTube 金鑰，目前無法同步。" /> : null}
      <SyncAutoCard />
      <Button label="新增同步清單" icon="add-circle-outline" onPress={() => setAdding(true)} fullWidth />
      {list.data.syncs.length ? (
        list.data.syncs.map((s) => (
          <Card key={s.id} style={{ gap: space.sm }}>
            <AppText variant="headline">{s.label || s.courseTitle}</AppText>
            <AppText variant="caption" tone="muted">{`放進：${s.courseTitle}`}</AppText>
            <AppText variant="caption" tone="muted" numberOfLines={1}>{s.url}</AppText>
            <AppText variant="caption">{`命名規則：${s.titleFormat}`}</AppText>
            <AppText variant="caption">{`排序規則：${list.data!.sortLabels[s.sortMode] ?? s.sortMode}`}</AppText>
            {s.sortLocked ? <AppText variant="caption" tone="muted">已鎖定手動排序：你手動調整過這張卡的順序，同步不會重排你排好的，只會把新影片依日期插入正確位置。要恢復自動整張依日期排序，請按「修改規則」解除鎖定。</AppText> : null}
            <AppText variant="caption" tone="muted">{`上次同步：${when(s.lastSyncedAt)}${s.lastSyncedAt ? `（新增 ${s.lastImported} 支）` : ""}`}</AppText>
            {s.lastNote ? <AppText variant="caption" tone="muted" numberOfLines={6}>{s.lastNote}</AppText> : null}
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Button label="修改規則" variant="secondary" onPress={() => setEditing(s)} fullWidth />
              </View>
              <View style={{ flex: 1 }}>
                <Button label="依規則重新命名" variant="secondary" loading={busyId === s.id} onPress={() => void renameAll(s)} fullWidth />
              </View>
            </View>
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Button variant="cancel" label="只刪除清單" onPress={() => void remove(s)} fullWidth />
              </View>
              <View style={{ flex: 1 }}>
                <Button label="同步" icon="sync" loading={busyId === s.id} onPress={() => void run(s)} fullWidth />
              </View>
            </View>
            <Button variant="cancel" label="刪除清單與關聯教材" loading={busyId === s.id} onPress={() => void removeAll(s)} fullWidth />
          </Card>
        ))
      ) : (
        <EmptyState icon="logo-youtube" title="還沒有同步清單" body="按上面的「新增同步清單」開始。" />
      )}
      {editing ? <FormatSheet sync={editing} help={list.data.formatHelp} sortLabels={list.data.sortLabels} onClose={() => setEditing(null)} onDone={() => { setEditing(null); list.reload(); }} /> : null}
      {adding ? <AddSheet help={list.data.formatHelp} sortLabels={list.data.sortLabels} onClose={() => setAdding(false)} onDone={() => { setAdding(false); list.reload(); }} /> : null}
    </Screen>
  );
}

function FormatSheet({ sync, help, sortLabels, onClose, onDone }: { sync: Sync; help: string; sortLabels: Record<string, string>; onClose: () => void; onDone: () => void }) {
  const [fmt, setFmt] = useState(sync.titleFormat);
  const [strip, setStrip] = useState(sync.stripText ?? "");
  const [sortMode, setSortMode] = useState(sync.sortMode);
  const [unlock, setUnlock] = useState(false);
  const [appPlayer, setAppPlayer] = useState(sync.appPlayer !== 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (!fmt.trim()) return setError("請輸入命名規則");
    setBusy(true);
    setError(null);
    try {
      await api("PATCH", `/admin/youtube-syncs/${sync.id}`, { titleFormat: fmt.trim(), stripText: strip, sortMode, appPlayer, ...(unlock ? { unlock: true } : {}) });
      flashText("已儲存同步規則");
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <EditSheet title="修改同步規則" onClose={onClose} onSave={submit} dirty={fmt.trim() !== sync.titleFormat || sortMode !== sync.sortMode || unlock || appPlayer !== (sync.appPlayer !== 0) || strip !== (sync.stripText ?? "")} busy={busy} error={error}>
      <SyncNamingFields url={sync.url} courseId={sync.courseId} format={fmt} setFormat={setFmt} strip={strip} setStrip={setStrip} help={help} />
      <AppText variant="caption" tone="muted">{"範例：「{年}年{月}月{日}日 王老師小線對焦」→「2026年3月14日 王老師小線對焦」。只影響之後匯入的教材；已匯入的請按「依規則重新命名」。"}</AppText>
      <AppPlayerCheck value={appPlayer} onChange={setAppPlayer} />
      <Chips title="排序規則" label="排序規則" options={Object.entries(sortLabels).map(([key, label]) => ({ key, label }))} value={sortMode} onChange={setSortMode} />
      <AppText variant="caption" tone="muted">你在課程頁手動調整過這張卡的順序，系統會自動「鎖定手動排序」：之後同步不會重排你排好的：「依日期」規則會把新影片依日期插入正確位置；選「放最上面／最後面」就照選的放。</AppText>
      {sync.sortLocked ? <Chips title="手動排序鎖定" label="手動排序鎖定" options={[{ key: "keep", label: "維持鎖定（保留我排好的）" }, { key: "unlock", label: "解除鎖定（恢復自動排序）" }]} value={unlock ? "unlock" : "keep"} onChange={(v) => setUnlock(v === "unlock")} /> : null}
    </EditSheet>
  );
}

function AddSheet({ help, sortLabels, onClose, onDone }: { help: string; sortLabels: Record<string, string>; onClose: () => void; onDone: () => void }) {
  const [sortMode, setSortMode] = useState("date_desc");
  const [appPlayer, setAppPlayer] = useState(true);
  const cards = useApi<CourseSummary[]>("/admin/courses");
  const [url, setUrl] = useState("");
  const [mode, setMode] = useState<"new" | "old">("new");
  const [newTitle, setNewTitle] = useState("");
  const [courseId, setCourseId] = useState("");
  const [prefix, setPrefix] = useState("");
  const [format, setFormat] = useState(TITLE_ONLY); // 預設勾選「教材名稱＝YouTube 影片名稱」（杜杜龍 2026-11-23）
  const [strip, setStrip] = useState("");
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
      await api("POST", "/admin/youtube-syncs", { url: url.trim(), ...(mode === "new" ? { newCardTitle: newTitle.trim() } : { courseId }), titlePrefix: prefix.trim() || (mode === "new" ? newTitle.trim() : ""), ...(format.trim() ? { titleFormat: format.trim() } : {}), stripText: strip, sortMode, appPlayer });
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
      <SyncNamingFields url={url} courseId={mode === "old" ? courseId : undefined} prefix={prefix.trim() || (mode === "new" ? newTitle.trim() : "")} format={format} setFormat={setFormat} strip={strip} setStrip={setStrip} help={help} />
      <Chips title="排序規則" label="排序規則" options={Object.entries(sortLabels).map(([key, label]) => ({ key, label }))} value={sortMode} onChange={setSortMode} />
      <AppPlayerCheck value={appPlayer} onChange={setAppPlayer} />
    </EditSheet>
  );
}

const styles = StyleSheet.create({ row: { flexDirection: "row", gap: space.sm } });
