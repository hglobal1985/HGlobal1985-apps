import { useRef, useState } from "react";
import { api, RequestError } from "@/api/client";
import { AppText, Button, NoticeBox } from "@/ui";

type Start = { session: string; chunkBytes: number };
type Chunk = { done: false; next: number } | { done: true; name: string; size: number };

/** 一個檔案分段上傳：每段約 8MB 經伺服器轉給 Google；網路斷線自動重試，從 Google 已收到的位置繼續。 */
async function uploadOne(file: File, onProgress: (pct: number) => void): Promise<void> {
  const start = await api<Start>("POST", "/admin/drive/uploads", { name: file.name, size: file.size, mime: file.type });
  let offset = 0;
  let retries = 0;
  while (offset < file.size) {
    const end = Math.min(file.size, offset + start.chunkBytes);
    try {
      const r = await api<Chunk>("PUT", `/admin/drive/uploads/chunk?session=${encodeURIComponent(start.session)}&start=${offset}&total=${file.size}`, file.slice(offset, end));
      retries = 0;
      if (r.done) break;
      offset = r.next; // Google 實際已收到的位置（網路中斷重送時可能比這段結尾少）
      onProgress(Math.round((offset / file.size) * 100));
    } catch (e) {
      if (e instanceof RequestError && e.status === 0 && retries < 3) {
        retries += 1;
        await new Promise((ok) => setTimeout(ok, 1500 * retries));
        continue;
      }
      throw e;
    }
  }
  onProgress(100);
}

/**
 * 雲端硬碟上傳模組（業主 2026-11-18，只有網頁版）：選好檔案就依序上傳到業主的 Google 雲端硬碟，
 * 一次可選多個、任何格式（含影片）。某個檔案失敗只顯示原因，其他照常上傳。
 */
export function DriveUpload({ maxBytes, onDone }: { maxBytes: number; onDone: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  const run = async (files: File[]) => {
    setBusy(true);
    setErrors([]);
    const bad: string[] = [];
    let okCount = 0;
    for (let i = 0; i < files.length; i++) {
      const f = files[i]!;
      if (!f.size) {
        bad.push(`「${f.name}」：檔案是空的`);
        continue;
      }
      if (f.size > maxBytes) {
        bad.push(`「${f.name}」：超過單檔上限 ${Math.round(maxBytes / 1024 ** 3)}GB`);
        continue;
      }
      try {
        setMsg(`上傳中（${i + 1}／${files.length}）：${f.name}　0%`);
        await uploadOne(f, (pct) => setMsg(`上傳中（${i + 1}／${files.length}）：${f.name}　${pct}%`));
        okCount += 1;
      } catch (e) {
        bad.push(`「${f.name}」：${(e as Error).message}`);
      }
    }
    setBusy(false);
    setMsg(okCount ? `已上傳 ${okCount} 個檔案到雲端硬碟` : null);
    setErrors(bad);
    if (okCount) onDone();
  };

  return (
    <>
      <Button label="選擇檔案上傳" icon="cloud-upload-outline" loading={busy} disabled={busy} onPress={() => input.current?.click()} fullWidth />
      <input
        ref={input}
        type="file"
        multiple
        style={{ display: "none" }}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length) void run(files);
        }}
      />
      {msg ? (
        <AppText variant="caption" tone="muted">
          {msg}
        </AppText>
      ) : null}
      {busy ? (
        <AppText variant="caption" tone="muted">
          上傳期間請不要關閉或離開這個頁面。
        </AppText>
      ) : null}
      {errors.map((t) => (
        <NoticeBox key={t} tone="danger" text={t} />
      ))}
    </>
  );
}
