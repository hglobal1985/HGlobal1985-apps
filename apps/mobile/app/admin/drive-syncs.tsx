import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { api, type CourseSummary } from "@/api/client";
import { confirmAsk, confirmDanger } from "@/features/confirm";
import { EditSheet } from "@/features/course-edit/edit-sheet";
import { SyncAutoCard } from "@/features/sync-auto";
import { useApi, useSession } from "@/state/session";
import { space } from "@/theme/tokens";
import { AppText, Button, Card, Chips, EmptyState, ErrorView, Field, LoadingView, NoticeBox, Screen } from "@/ui";
import { flashText } from "@/ui/flash-notice";

type Sync = { id: string; label: string; url: string; courseId: string; courseTitle: string; blockId: string; blockTitle: string; titleFormat: string; lastSyncedAt: string | null; lastImported: number; lastTotal: number; lastNote: string };
type Data = { syncs: Sync[]; keyReady: boolean; formatHelp: string; platinumFormat: string; weekly: boolean };

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("zh-TW", { hour12: false }) : "還沒同步過");

/**
 * 設定 › 同步雲端資料夾（杜杜龍 2026-11-26，超級管理員）：貼上 Google 雲端資料夾連結，選要放進的教材卡（與區塊），
 * 按「同步」把資料夾裡的檔案一列列匯成教材（只存 Drive 連結，檔案留在雲端）。每份顯示「已同步 N 項」；也會每週自動同步（開關在最上面）。
 */
export default function DriveSyncsScreen() {
  const { member } = useSession();
  const isSuper = !!member?.titles.includes("超級管理員");
  const list = useApi<Data>(isSuper ? "/admin/drive-syncs" : null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Sync | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  if (!isSuper) return <Screen header={false}><EmptyState icon="lock-closed-outline" title="只有超級管理員可以設定" /></Screen>;
  if (!list.data) return <Screen header={false}>{list.error ? <ErrorView message={list.error} onRetry={list.reload} /> : <LoadingView />}</Screen>;
  const run = async (s: Sync) => {
    setBusyId(s.id);
    try {
      const r = await api<{ imported: number; total: number; note: string }>("POST", `/admin/drive-syncs/${s.id}/sync`);
      flashText(r.imported ? `已同步 ${r.imported} 個新檔案（共 ${r.total} 項）` : r.note || "沒有新的檔案");
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
      await api("DELETE", `/admin/drive-syncs/${s.id}`);
      list.reload();
    } catch (e) {
      flashText((e as Error).message);
    }
  };
  const removeAll = async (s: Sync) => {
    if (!(await confirmDanger("刪除清單與關聯教材", `會刪除「${s.label || s.courseTitle}」的同步設定，以及「${s.courseTitle}」裡連結指向這個資料夾檔案的所有教材（含學員的相關紀錄），無法復原。確定刪除？`, "全部刪除"))) return;
    setBusyId(s.id);
    try {
      const r = await api<{ deleted: number }>("POST", `/admin/drive-syncs/${s.id}/delete-with-materials`);
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
        貼上 Google 雲端資料夾的連結（資料夾共用要設成「知道連結的任何人可檢視」），按「同步」就把裡面的檔案一個個加成教材；已經加過的不會重複。
      </AppText>
      {!list.data.keyReady ? <NoticeBox tone="warning" text="尚未設定 Google Drive 金鑰（Cloudflare Secret：GOOGLE_DRIVE_API_KEY），目前無法同步。" /> : null}
      <SyncAutoCard />
      <Button label="新增同步資料夾" icon="add-circle-outline" onPress={() => setAdding(true)} fullWidth />
      {list.data.syncs.length ? (
        list.data.syncs.map((s) => (
          <Card key={s.id} style={{ gap: space.sm }}>
            <AppText variant="headline">{s.label || s.courseTitle}</AppText>
            <AppText variant="caption" tone="muted">{`放進：${s.courseTitle}${s.blockTitle ? `　›　${s.blockTitle}` : ""}`}</AppText>
            <AppText variant="caption" tone="muted" numberOfLines={1}>{s.url}</AppText>
            <AppText variant="caption">{`命名規則：${s.titleFormat}`}</AppText>
            <AppText variant="callout" style={{ fontWeight: "700" }}>{s.lastSyncedAt ? `已同步 ${s.lastTotal} 項（資料夾裡共 ${s.lastTotal} 個檔案，上次新增 ${s.lastImported} 個）` : "還沒同步過"}</AppText>
            <AppText variant="caption" tone="muted">{`上次同步：${when(s.lastSyncedAt)}`}</AppText>
            {s.lastNote ? <AppText variant="caption" tone="muted" numberOfLines={6}>{s.lastNote}</AppText> : null}
            <View style={styles.row}>
              <View style={{ flex: 1 }}><Button label="修改規則" variant="secondary" onPress={() => setEditing(s)} fullWidth /></View>
              <View style={{ flex: 1 }}><Button label="同步" icon="sync" loading={busyId === s.id} onPress={() => void run(s)} fullWidth /></View>
            </View>
            <View style={styles.row}>
              <View style={{ flex: 1 }}><Button variant="cancel" label="只刪除清單" onPress={() => void remove(s)} fullWidth /></View>
              <View style={{ flex: 1 }}><Button variant="cancel" label="刪除清單與關聯教材" loading={busyId === s.id} onPress={() => void removeAll(s)} fullWidth /></View>
            </View>
          </Card>
        ))
      ) : (
        <EmptyState icon="folder-open-outline" title="還沒有同步資料夾" body="按上面的「新增同步資料夾」開始。" />
      )}
      {editing ? <RuleSheet sync={editing} help={list.data.formatHelp} platinum={list.data.platinumFormat} onClose={() => setEditing(null)} onDone={() => { setEditing(null); list.reload(); }} /> : null}
      {adding ? <AddSheet help={list.data.formatHelp} platinum={list.data.platinumFormat} onClose={() => setAdding(false)} onDone={() => { setAdding(false); list.reload(); }} /> : null}
    </Screen>
  );
}

/** 選教材卡之後，列出那張卡的區塊（不選＝放整張卡最前面）。 */
function BlockPick({ courseId, value, onChange }: { courseId: string; value: string; onChange: (v: string) => void }) {
  const d = useApi<{ lessons: { id: string; title: string; section?: boolean; material?: boolean }[] }>(courseId ? `/courses/${courseId}` : null);
  const blocks = (d.data?.lessons ?? []).filter((l) => l.section && l.material);
  if (!courseId || !blocks.length) return courseId ? <AppText variant="caption" tone="muted">這張卡還沒有區塊，同步的教材會放在整張卡最前面。</AppText> : null;
  return <Chips title="放進哪個區塊" label="放進哪個區塊" options={[{ key: "", label: "不放區塊（最前面）" }, ...blocks.map((b) => ({ key: b.id, label: b.title }))]} value={value} onChange={onChange} />;
}

function RuleSheet({ sync, help, platinum, onClose, onDone }: { sync: Sync; help: string; platinum: string; onClose: () => void; onDone: () => void }) {
  const [fmt, setFmt] = useState(sync.titleFormat);
  const [block, setBlock] = useState(sync.blockId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (!fmt.trim()) return setError("請輸入命名規則");
    setBusy(true);
    setError(null);
    try {
      await api("PATCH", `/admin/drive-syncs/${sync.id}`, { titleFormat: fmt.trim(), blockId: block });
      flashText("已儲存同步規則");
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <EditSheet title="修改同步規則" onClose={onClose} onSave={submit} dirty={fmt.trim() !== sync.titleFormat || block !== sync.blockId} busy={busy} error={error}>
      <Field label="教材命名規則" value={fmt} onChange={setFmt} placeholder={platinum} />
      <Chips label="快速套用" options={[{ key: platinum, label: "白金溝通會：簡報x年x月 白金溝通會（括號文字）" }, { key: "{標題}", label: "直接用檔名" }]} value={fmt} onChange={setFmt} />
      <AppText variant="caption" tone="muted">{`${help}。只影響之後新同步的檔案。`}</AppText>
      <BlockPick courseId={sync.courseId} value={block} onChange={setBlock} />
    </EditSheet>
  );
}

function AddSheet({ help, platinum, onClose, onDone }: { help: string; platinum: string; onClose: () => void; onDone: () => void }) {
  const cards = useApi<CourseSummary[]>("/admin/courses");
  const [url, setUrl] = useState("");
  const [courseId, setCourseId] = useState("");
  const [block, setBlock] = useState("");
  const [fmt, setFmt] = useState("{標題}");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const noChapter = (cards.data ?? []).filter((x) => x.isList);
  const submit = async () => {
    if (!url.trim()) return setError("請貼上雲端資料夾連結");
    if (!courseId) return setError("請選擇要放進的教材卡");
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ imported?: number; total?: number; note?: string }>("POST", "/admin/drive-syncs", { url: url.trim(), courseId, blockId: block, titleFormat: fmt.trim() || "{標題}", syncNow: true });
      flashText(r.imported ? `已新增並同步 ${r.imported} 個檔案` : r.note || "已新增");
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <EditSheet title="新增同步資料夾" onClose={onClose} onSave={submit} saveLabel="新增並同步" dirty={!!url.trim()} busy={busy} error={error}>
      <Field label="Google 雲端資料夾連結" value={url} onChange={setUrl} placeholder="https://drive.google.com/drive/folders/…" />
      <Chips label="放進哪一張教材卡（只列純教材卡）" options={noChapter.map((x) => ({ key: x.id, label: x.title }))} value={courseId} onChange={(v) => { setCourseId(v); setBlock(""); }} />
      <BlockPick courseId={courseId} value={block} onChange={setBlock} />
      <Field label="教材命名規則" value={fmt} onChange={setFmt} placeholder="{標題}" />
      <Chips label="快速套用" options={[{ key: platinum, label: "白金溝通會：簡報x年x月 白金溝通會（括號文字）" }, { key: "{標題}", label: "直接用檔名" }]} value={fmt} onChange={setFmt} />
      <AppText variant="caption" tone="muted">{help}</AppText>
    </EditSheet>
  );
}

const styles = StyleSheet.create({ row: { flexDirection: "row", gap: space.sm } });
