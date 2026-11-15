import * as DocumentPicker from "expo-document-picker";
import { useCallback, useEffect, useState } from "react";
import { api, type Attachment } from "@/api/client";
import { TYPE_INFO, subtitleOf } from "@/features/attachments";
import { AppText, Button, Card, Field, ListRow, NoticeBox, type IconName } from "@/ui";

/**
 * 【檔案上傳模組】全站「附件教材（網址＋上傳檔案）」的唯一畫面與邏輯（章節編輯、其他教材新增／編輯都用它）。
 * 要新增匯入管道（例如雲端硬碟選檔、Google Picker…）：在下方 FILE_CHANNELS 加一項，所有用到的地方會同步出現，不要在別處另做。
 *
 * 兩種用法：
 * - 已有教材／章節：傳 lessonId，操作馬上存到伺服器。
 * - 新增中（還沒有教材）：傳 staged（用 useStagedAttachments），先暫存在畫面，教材建立後呼叫 commitStagedAttachments 一次送出。
 */
export type StagedAttachment = { id: string; kind: "link" | "file"; title: string; url?: string; file?: Blob; name?: string };

export function useStagedAttachments() {
  const [items, setItems] = useState<StagedAttachment[]>([]);
  return { items, setItems };
}
export type StagedAttachments = ReturnType<typeof useStagedAttachments>;

/** 教材建立後，把暫存的附件依序送出。 */
export async function commitStagedAttachments(lessonId: string, items: StagedAttachment[], onDone?: (id: string) => void): Promise<void> {
  for (const it of items) {
    if (it.kind === "link") await api("POST", `/admin/lessons/${lessonId}/links`, { url: it.url, title: it.title });
    else await api("PUT", `/admin/lessons/${lessonId}/attachments?name=${encodeURIComponent(it.name ?? "file")}${it.title.trim() ? `&title=${encodeURIComponent(it.title.trim())}` : ""}`, it.file);
    onDone?.(it.id);
  }
}

const MAX_BYTES = 50 * 1024 * 1024;

async function pickFile(): Promise<{ file: Blob; name: string } | null> {
  const picked = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
  if (picked.canceled || !picked.assets?.length) return null;
  const asset = picked.assets[0];
  const file: Blob = asset.file ?? (await (await fetch(asset.uri)).blob());
  if (file.size > MAX_BYTES) throw Error("附件大小需在 50MB 以內");
  return { file, name: asset.name };
}

type Row = { id: string; title: string; subtitle: string; icon: IconName; url: string | null; editable: boolean };
type Store = {
  rows: Row[];
  busy: boolean;
  msg: { tone: "success" | "danger"; text: string } | null;
  addLink: (url: string, title: string) => Promise<boolean>;
  addFile: (title: string) => Promise<boolean>;
  remove: (id: string) => void;
  rename?: (id: string, title: string, url: string | null) => Promise<boolean>;
};

/** 匯入管道清單：新增管道＝加一項（需要網址的設 needsUrl；run 成功回 true 會清空輸入欄）。 */
const FILE_CHANNELS: { key: string; label: string; icon: IconName; variant: "primary" | "secondary"; needsUrl?: boolean; run: (store: Store, input: { url: string; title: string }) => Promise<boolean> }[] = [
  { key: "link", label: "新增網址附件", icon: "link-outline", variant: "primary", needsUrl: true, run: (store, { url, title }) => store.addLink(url, title) },
  { key: "file", label: "上傳檔案", icon: "attach-outline", variant: "secondary", run: (store, { title }) => store.addFile(title) },
];

export function FileUploadModule({ lessonId, staged, showHint = true }: { lessonId?: string; staged?: StagedAttachments; showHint?: boolean }) {
  return lessonId ? <LiveFiles lessonId={lessonId} showHint={showHint} /> : staged ? <StagedFiles staged={staged} showHint={showHint} /> : null;
}

function LiveFiles({ lessonId, showHint }: { lessonId: string; showHint: boolean }) {
  const [items, setItems] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Store["msg"]>(null);
  const load = useCallback(() => {
    api<Attachment[]>("GET", `/admin/lessons/${lessonId}/attachments`)
      .then(setItems)
      .catch(() => undefined);
  }, [lessonId]);
  useEffect(load, [load]);
  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg({ tone: "success", text: done });
      load();
      return true;
    } catch (e) {
      setMsg({ tone: "danger", text: (e as Error).message });
      return false;
    } finally {
      setBusy(false);
    }
  };
  const store: Store = {
    rows: items.map((a) => ({ id: a.id, title: a.name, subtitle: subtitleOf(a), icon: TYPE_INFO[a.type].icon, url: a.kind === "link" ? (a.url ?? "") : null, editable: true })),
    busy,
    msg,
    addLink: (url, title) => run(() => api("POST", `/admin/lessons/${lessonId}/links`, { url, title }), "網址附件已新增"),
    addFile: (title) =>
      run(async () => {
        const f = await pickFile();
        if (f) await api("PUT", `/admin/lessons/${lessonId}/attachments?name=${encodeURIComponent(f.name)}${title.trim() ? `&title=${encodeURIComponent(title.trim())}` : ""}`, f.file);
      }, "附件已上傳"),
    remove: (id) => void run(() => api("DELETE", `/admin/attachments/${id}`), "已刪除"),
    rename: (id, title, url) => run(() => api("PATCH", `/admin/attachments/${id}`, { title, ...(url != null ? { url } : {}) }), "已儲存"),
  };
  return <FilesView store={store} showHint={showHint} />;
}

function StagedFiles({ staged, showHint }: { staged: StagedAttachments; showHint: boolean }) {
  const [msg, setMsg] = useState<Store["msg"]>(null);
  const [busy, setBusy] = useState(false);
  const { items, setItems } = staged;
  const add = (it: Omit<StagedAttachment, "id">) => setItems((x) => [...x, { ...it, id: `s${Date.now()}${x.length}` }]);
  const store: Store = {
    rows: items.map((a) => ({ id: a.id, title: a.title || a.name || a.url || "附件", subtitle: a.kind === "link" ? "網址" : "檔案（新增後上傳）", icon: a.kind === "link" ? "link-outline" : "document-attach-outline", url: null, editable: false })),
    busy,
    msg,
    addLink: async (url, title) => {
      if (!/^https:\/\//i.test(url.trim())) return (setMsg({ tone: "danger", text: "網址需以 https:// 開頭" }), false);
      setMsg(null);
      add({ kind: "link", url: url.trim(), title: title.trim() });
      return true;
    },
    addFile: async (title) => {
      setBusy(true);
      setMsg(null);
      try {
        const f = await pickFile();
        if (!f) return false;
        add({ kind: "file", file: f.file, name: f.name, title: title.trim() });
        return true;
      } catch (e) {
        setMsg({ tone: "danger", text: (e as Error).message });
        return false;
      } finally {
        setBusy(false);
      }
    },
    remove: (id) => setItems((x) => x.filter((i) => i.id !== id)),
  };
  return <FilesView store={store} showHint={showHint} />;
}

function FilesView({ store, showHint }: { store: Store; showHint: boolean }) {
  const [editing, setEditing] = useState<{ id: string; title: string; url: string | null } | null>(null);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  return (
    <>
      {showHint ? (
        <AppText variant="callout" tone="muted">
          附件教材：可加網址（YouTube、Canva、Google 簡報／文件／表單／雲端硬碟、一般網頁；需 https）或上傳檔案（PDF、Word、PowerPoint、Excel、CSV、文字、ZIP、PNG、JPG，單檔 50MB 內）。標題可自訂，圖示依類型自動判斷。
        </AppText>
      ) : null}
      {store.rows.map((a) => (
        <Card key={a.id}>
          <ListRow
            icon={a.icon}
            title={a.title}
            subtitle={a.subtitle}
            onPress={a.editable ? () => setEditing(editing?.id === a.id ? null : { id: a.id, title: a.title, url: a.url }) : undefined}
            right={<Button variant="ghost" label="刪除" disabled={store.busy} onPress={() => store.remove(a.id)} />}
          />
          {editing?.id === a.id ? (
            <>
              <Field label="顯示標題" value={editing.title} onChange={(v) => setEditing({ ...editing, title: v })} />
              {editing.url != null ? <Field label="網址" value={editing.url} onChange={(v) => setEditing({ ...editing, url: v })} placeholder="https://" /> : null}
              <Button
                label="儲存修改"
                disabled={store.busy || !editing.title.trim()}
                onPress={async () => {
                  if (await store.rename?.(editing.id, editing.title, editing.url)) setEditing(null);
                }}
              />
            </>
          ) : null}
        </Card>
      ))}
      <Field label={showHint ? "顯示標題（選填，空白＝依類型自動命名；上傳檔案時空白＝檔名）" : "顯示標題"} value={title} onChange={setTitle} placeholder={showHint ? "例如：第 4 堂簡報" : undefined} />
      <Field label="網址" value={url} onChange={setUrl} placeholder="https://www.canva.com/…" />
      {FILE_CHANNELS.map((ch) => (
        <Button
          key={ch.key}
          variant={ch.variant}
          label={ch.label}
          icon={ch.icon}
          loading={!ch.needsUrl && store.busy}
          disabled={store.busy || (!!ch.needsUrl && !url.trim())}
          onPress={async () => {
            if (await ch.run(store, { url, title })) (setTitle(""), ch.needsUrl && setUrl(""));
          }}
        />
      ))}
      {store.msg ? <NoticeBox tone={store.msg.tone} text={store.msg.text} /> : null}
    </>
  );
}
