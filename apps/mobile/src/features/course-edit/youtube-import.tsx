import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { api, type CourseDetail } from "@/api/client";
import { confirmAsk } from "@/features/confirm";
import { useApi, useSession } from "@/state/session";
import { space } from "@/theme/tokens";
import { AppText, Button, Card, Check, Chips, ErrorView, Field, LoadingView, NoticeBox } from "@/ui";
import { flashText } from "@/ui/flash-notice";
import { EditSheet } from "./edit-sheet";

type Sync = { appPlayer?: number; stripText?: string; courseId?: string; id: string; label: string; url: string; titleFormat: string; sortMode: string; sortLocked: number; lastSyncedAt: string | null; lastImported: number; lastNote: string };
type SyncList = { syncs: Sync[]; keyReady: boolean; formatHelp: string; sortLabels: Record<string, string> };

/** 「教材名稱＝YouTube 影片名稱」勾選時使用的命名規則（{標題}＝影片原標題）。 */
export const TITLE_ONLY = "{標題}";

/**
 * 命名設定（業主 2026-11-23）：勾選「教材名稱＝YouTube 影片名稱」＝規則 {標題}；否則自訂命名規則；
 * 另有「移除文字」（多段用逗號或換行分開，會從最後的名稱裡拿掉）與「預覽」（純文字列出匯入後的教材名稱，不寫入任何資料）。
 * 課程頁的匯入／修改規則與設定頁的新增／修改規則共用。
 */
export function SyncNamingFields({ url, courseId, prefix, format, setFormat, strip, setStrip, help }: { url: string; courseId?: string; prefix?: string; format: string; setFormat: (v: string) => void; strip: string; setStrip: (v: string) => void; help?: string }) {
  const [preview, setPreview] = useState<{ total: number; names: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const same = format.trim() === TITLE_ONLY;
  const run = async () => {
    if (!url.trim()) return setErr("請先貼上播放清單網址");
    setBusy(true);
    setErr(null);
    try {
      setPreview(await api<{ total: number; names: string[] }>("POST", "/admin/youtube-syncs/preview", { url: url.trim(), ...(courseId ? { courseId } : {}), titlePrefix: prefix ?? "", titleFormat: format.trim(), stripText: strip }));
    } catch (e) {
      setPreview(null);
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Check label="教材名稱＝YouTube 影片名稱" value={same} onChange={(v) => setFormat(v ? TITLE_ONLY : "")} />
      {same ? null : <Field label="命名規則（選填，沒填＝「2026年11月 名稱（主持xxx）」）" value={format} onChange={setFormat} placeholder="{年}年{月}月{日}日 王老師小線對焦" />}
      {same || !help ? null : <AppText variant="caption" tone="muted">{help}</AppText>}
      <Field label="移除文字（選填；多段用逗號或換行分開）" value={strip} onChange={setStrip} placeholder="例如：【直播】, 完整版" />
      <Button variant="secondary" label="預覽教材名稱" icon="eye-outline" loading={busy} onPress={() => void run()} fullWidth />
      {err ? <AppText variant="caption" tone="danger">{err}</AppText> : null}
      {preview ? (
        <Card style={{ gap: 4 }}>
          <AppText variant="caption" tone="muted">{preview.total ? `匯入後的教材名稱（共 ${preview.total} 支${preview.total > preview.names.length ? `，只列前 ${preview.names.length} 支` : ""}）` : "沒有新的影片可匯入"}</AppText>
          {preview.names.map((n, i) => <AppText key={`${i}-${n}`} variant="callout">{`${i + 1}. ${n}`}</AppText>)}
        </Card>
      ) : null}
    </>
  );
}

/**
 * 「使用行動大學播放器」勾選（業主 2026-11-24，全站同一個元件）：新增教材貼 YouTube 連結、匯入／同步 YouTube 清單都用它，預設勾選。
 * 勾選＝影片存成影片來源，在 App 內用行動大學播放器播放（沒有權限的人拿不到 YouTube 網址）；
 * 不勾＝存成外部連結，點教材會開新網頁到 YouTube 的網頁播放器。
 */
export function AppPlayerCheck({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={{ gap: space.xs }}>
      <Check label="使用行動大學播放器" value={value} onChange={onChange} />
      {!value ? <AppText variant="caption" tone="muted">沒有勾選：點教材會開啟新網頁視窗，到 YouTube 的網頁播放器觀看。</AppText> : null}
    </View>
  );
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("zh-TW", { hour12: false }) : "還沒同步過");

/**
 * 匯入 YouTube 播放清單（業主 2026-11-23，B：「新增教材」面板裡的入口）：貼播放清單網址，立刻把影片匯成這張教材卡的教材，
 * 同時建立一份同步設定——之後清單有新影片，在課程設定「YouTube 播放清單」或「設定 › 同步 YouTube 清單」按「同步」就會補進來。
 */
export function YoutubeImportSheet({ course, onClose, onDone }: { course: CourseDetail; onClose: () => void; onDone?: () => void }) {
  const { invalidate } = useSession();
  const list = useApi<SyncList>(`/admin/courses/${course.id}/youtube-syncs`);
  const [url, setUrl] = useState("");
  const [format, setFormat] = useState(TITLE_ONLY); // 預設勾選「教材名稱＝YouTube 影片名稱」（業主 2026-11-23）
  const [strip, setStrip] = useState("");
  const [sortMode, setSortMode] = useState("date_desc");
  const [appPlayer, setAppPlayer] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (!url.trim()) return setError("請貼上播放清單網址");
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ imported?: number; note?: string }>("POST", "/admin/youtube-syncs", { url: url.trim(), courseId: course.id, titlePrefix: course.title, ...(format.trim() ? { titleFormat: format.trim() } : {}), stripText: strip, sortMode, appPlayer, syncNow: true });
      flashText(r.imported ? `已匯入 ${r.imported} 支影片，並加入同步清單` : r.note || "已加入同步清單");
      invalidate();
      onDone?.();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <EditSheet title="匯入 YouTube 播放清單" onClose={onClose} onSave={submit} saveLabel="匯入" dirty={!!url.trim()} busy={busy} error={error}>
      {list.data && !list.data.keyReady ? <NoticeBox tone="warning" text="尚未設定 YouTube 金鑰，目前無法匯入。" /> : null}
      <Field label="YouTube 播放清單網址" value={url} onChange={setUrl} placeholder="https://www.youtube.com/playlist?list=…" />
      <SyncNamingFields url={url} courseId={course.id} prefix={course.title} format={format} setFormat={setFormat} strip={strip} setStrip={setStrip} help={list.data?.formatHelp} />
      {list.data ? <Chips title="排序規則" label="排序規則" options={Object.entries(list.data.sortLabels).map(([key, label]) => ({ key, label }))} value={sortMode} onChange={setSortMode} /> : null}
      <AppPlayerCheck value={appPlayer} onChange={setAppPlayer} />
      <AppText variant="caption" tone="muted">匯入的影片會放在這張教材卡的最上面（不開區塊）；已經加過的影片不會重複。這份清單也會出現在「設定 › 同步 YouTube 清單」。</AppText>
    </EditSheet>
  );
}

/** 課程設定「YouTube 播放清單」（C）：這張教材卡的同步清單——匯入新的、立刻同步、修改規則、刪除。 */
export function YoutubeSyncSheet({ course, onClose }: { course: CourseDetail; onClose: () => void }) {
  const { invalidate } = useSession();
  const list = useApi<SyncList>(`/admin/courses/${course.id}/youtube-syncs`);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Sync | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const run = async (s: Sync) => {
    setBusyId(s.id);
    try {
      const r = await api<{ imported: number; note: string }>("POST", `/admin/youtube-syncs/${s.id}/sync`);
      flashText(r.imported ? `已同步 ${r.imported} 支新影片` : r.note || "沒有新的影片");
      invalidate();
      list.reload();
    } catch (e) {
      flashText((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };
  const remove = async (s: Sync) => {
    if (!(await confirmAsk("刪除同步設定", "確定刪除這份同步設定？已經匯入的教材不會被刪掉。", "刪除"))) return;
    try {
      await api("DELETE", `/admin/youtube-syncs/${s.id}`);
      list.reload();
    } catch (e) {
      flashText((e as Error).message);
    }
  };
  const removeAll = async (s: Sync) => {
    if (!(await confirmAsk("刪除清單與關聯教材", "會刪除這份同步設定，以及這張卡裡來源是這個播放清單影片的所有教材（含學員的相關紀錄），無法復原。確定刪除？", "全部刪除"))) return;
    setBusyId(s.id);
    try {
      const r = await api<{ deleted: number }>("POST", `/admin/youtube-syncs/${s.id}/delete-with-materials`);
      flashText(`已刪除清單與 ${r.deleted} 個教材`);
      invalidate();
      list.reload();
    } catch (e) {
      flashText((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };
  return (
    <EditSheet title="YouTube 播放清單" onClose={onClose} hideSave>
      {!list.data ? (
        list.error ? <ErrorView message={list.error} onRetry={list.reload} /> : <LoadingView />
      ) : (
        <>
          <AppText variant="callout" tone="muted">貼上 YouTube 播放清單的網址就會匯入影片；之後清單有新影片，按「同步」補進來（已加過的不會重複）。這裡的清單也會出現在「設定 › 同步 YouTube 清單」。</AppText>
          {!list.data.keyReady ? <NoticeBox tone="warning" text="尚未設定 YouTube 金鑰，目前無法同步。" /> : null}
          <Button label="匯入 YouTube 播放清單" icon="logo-youtube" onPress={() => setAdding(true)} fullWidth />
          {list.data.syncs.map((s) => (
            <Card key={s.id} style={{ gap: space.sm }}>
              <AppText variant="caption" tone="muted" numberOfLines={1}>{s.url}</AppText>
              <AppText variant="caption">{`命名規則：${s.titleFormat}`}</AppText>
              <AppText variant="caption">{`排序規則：${list.data!.sortLabels[s.sortMode] ?? s.sortMode}`}</AppText>
              <AppText variant="caption" tone="muted">{`上次同步：${when(s.lastSyncedAt)}${s.lastSyncedAt ? `（新增 ${s.lastImported} 支）` : ""}`}</AppText>
              {s.lastNote ? <AppText variant="caption" tone="muted" numberOfLines={4}>{s.lastNote}</AppText> : null}
              <View style={styles.row}>
                <View style={{ flex: 1 }}><Button variant="secondary" label="修改規則" onPress={() => setEditing(s)} fullWidth /></View>
                <View style={{ flex: 1 }}><Button label="同步" icon="sync" loading={busyId === s.id} onPress={() => void run(s)} fullWidth /></View>
              </View>
              <Button variant="cancel" label="只刪除清單" onPress={() => void remove(s)} fullWidth />
              <Button variant="cancel" label="刪除清單與關聯教材" loading={busyId === s.id} onPress={() => void removeAll(s)} fullWidth />
            </Card>
          ))}
          {!list.data.syncs.length ? <AppText variant="callout" tone="muted">這張教材卡還沒有匯入過播放清單。</AppText> : null}
        </>
      )}
      {adding ? <YoutubeImportSheet course={course} onClose={() => setAdding(false)} onDone={list.reload} /> : null}
      {editing && list.data ? <RulesSheet sync={editing} help={list.data.formatHelp} sortLabels={list.data.sortLabels} onClose={() => setEditing(null)} onDone={() => { setEditing(null); list.reload(); }} /> : null}
    </EditSheet>
  );
}

function RulesSheet({ sync, help, sortLabels, onClose, onDone }: { sync: Sync; help: string; sortLabels: Record<string, string>; onClose: () => void; onDone: () => void }) {
  const [fmt, setFmt] = useState(sync.titleFormat);
  const [strip, setStrip] = useState(sync.stripText ?? "");
  const [sortMode, setSortMode] = useState(sync.sortMode);
  const [appPlayer, setAppPlayer] = useState(sync.appPlayer !== 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (!fmt.trim()) return setError("請輸入命名規則");
    setBusy(true);
    setError(null);
    try {
      await api("PATCH", `/admin/youtube-syncs/${sync.id}`, { titleFormat: fmt.trim(), stripText: strip, sortMode, appPlayer });
      flashText("已儲存同步規則");
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <EditSheet title="修改同步規則" onClose={onClose} onSave={submit} dirty={fmt.trim() !== sync.titleFormat || sortMode !== sync.sortMode || strip !== (sync.stripText ?? "") || appPlayer !== (sync.appPlayer !== 0)} busy={busy} error={error}>
      <SyncNamingFields url={sync.url} courseId={sync.courseId} format={fmt} setFormat={setFmt} strip={strip} setStrip={setStrip} help={help} />
      <Chips title="排序規則" label="排序規則" options={Object.entries(sortLabels).map(([key, label]) => ({ key, label }))} value={sortMode} onChange={setSortMode} />
      <AppPlayerCheck value={appPlayer} onChange={setAppPlayer} />
      <AppText variant="caption" tone="muted">只影響之後匯入的教材；要解除手動排序鎖定或重新命名已匯入的，請到「設定 › 同步 YouTube 清單」。</AppText>
    </EditSheet>
  );
}

const styles = StyleSheet.create({ row: { flexDirection: "row", gap: space.sm } });
