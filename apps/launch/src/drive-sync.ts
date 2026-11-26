import type { D1Database, Env } from "./d1.ts";
import { classifyLink } from "./links.ts";
import { nextPos, placeInBlock, placeOnTop, runYoutubeSync, sortMaterialsByDate } from "./imports.ts";

/**
 * 同步 Google 雲端資料夾（杜杜龍 2026-11-26）：讀「知道連結的人可檢視」的資料夾，每個檔案一列教材（只存 Drive 連結，不複製檔案）。
 * 需要 Cloudflare Secret `GOOGLE_DRIVE_API_KEY`（Google Drive API 金鑰，設定一次，所有資料夾共用）。
 */
const short = () => crypto.randomUUID().slice(0, 6);

export const DRIVE_FORMAT_HELP = "可用：{年}、{月}（檔名開頭的 YYYYMM，沒有就用檔案修改日）、{標題}（檔名，不含副檔名）";
/** 白金溝通會的固定格式；其他資料夾預設只用檔名。 */
export const PLATINUM_FORMAT = "簡報{年}年{月}月 白金溝通會";

export const folderIdOf = (url: string): string | null => /\/folders\/([\w-]{10,})/.exec(url)?.[1] ?? /[?&]id=([\w-]{10,})/.exec(url)?.[1] ?? null;

export type DriveFile = { id: string; name: string; modified: string | null };

/** 檔名 → 年月（開頭 YYYYMM，例如「202611 線上白金溝通會（…）.pdf」）；沒有就用修改日。 */
export function parseDriveName(name: string, modified: string | null): { year: string; month: string; title: string; ym: string } {
  const title = name.replace(/\.[A-Za-z0-9]{1,5}$/, "").trim();
  const m = /^(20\d{2})(0[1-9]|1[0-2])(?!\d)/.exec(title);
  const d = /^(\d{4})-(\d{2})/.exec(modified ?? "");
  const year = m ? m[1]! : d ? d[1]! : "";
  const month = m ? String(Number(m[2])) : d ? String(Number(d[2])) : "";
  return { year, month, title, ym: year && month ? `${year}-${month.padStart(2, "0")}-01` : "" };
}

export function driveTitle(format: string, f: DriveFile): string {
  const p = parseDriveName(f.name, f.modified);
  const out = format
    .replace(/\{年\}\s*年?/g, p.year ? `${p.year}年` : "")
    .replace(/\{月\}\s*月?/g, p.month ? `${p.month}月` : "")
    .replace(/\{標題\}/g, p.title);
  return out.replace(/\s+/g, " ").trim() || p.title;
}

const driveUrl = (id: string) => `https://drive.google.com/file/d/${id}/view`;

/** 讀資料夾裡的檔案（含最多 3 層子資料夾）；失敗回 error 說明（白話）。 */
export async function readDriveFolder(key: string, folderId: string): Promise<{ files: DriveFile[] } | { error: string }> {
  const files: DriveFile[] = [];
  const queue: { id: string; depth: number }[] = [{ id: folderId, depth: 0 }];
  let folders = 0;
  while (queue.length && folders < 40) {
    const cur = queue.shift()!;
    folders++;
    let token = "";
    for (let page = 0; page < 20; page++) {
      const qs = new URLSearchParams({ q: `'${cur.id}' in parents and trashed = false`, fields: "nextPageToken,files(id,name,mimeType,modifiedTime)", pageSize: "200", supportsAllDrives: "true", includeItemsFromAllDrives: "true", key });
      if (token) qs.set("pageToken", token);
      let res: Response;
      try {
        res = await fetch(`https://www.googleapis.com/drive/v3/files?${qs}`);
      } catch {
        return { error: "連不上 Google，請稍後再試" };
      }
      if (!res.ok) {
        if (cur.depth > 0) break;
        if (res.status === 404) return { error: "找不到這個資料夾，請確認連結正確" };
        if (res.status === 403 || res.status === 400) return { error: "Google 拒絕讀取：請確認 Google Drive API 已啟用、金鑰正確，且資料夾共用設為「知道連結的任何人可檢視」" };
        return { error: `Google 回應錯誤（${res.status}）` };
      }
      const j = (await res.json()) as { nextPageToken?: string; files?: { id: string; name: string; mimeType: string; modifiedTime?: string }[] };
      for (const f of j.files ?? []) {
        if (f.mimeType === "application/vnd.google-apps.folder") {
          if (cur.depth < 3) queue.push({ id: f.id, depth: cur.depth + 1 });
        } else files.push({ id: f.id, name: f.name, modified: f.modifiedTime ?? null });
      }
      if (!j.nextPageToken) break;
      token = j.nextPageToken;
    }
  }
  return { files };
}

/** 這張卡已經有的 Drive 檔案編號（用連結比對，不重複匯入）。 */
async function existingDriveIds(db: D1Database, courseId: string): Promise<Set<string>> {
  const { results } = await db.prepare("SELECT link_url FROM lesson_attachments WHERE course_id = ? AND kind = 'link' AND link_url LIKE 'https://drive.google.com/file/d/%'").bind(courseId).all<{ link_url: string }>();
  const have = new Set<string>();
  for (const r of results) {
    const m = /\/file\/d\/([\w-]+)/.exec(r.link_url ?? "");
    if (m) have.add(m[1]!);
  }
  return have;
}

/** 區塊內的教材依日期由新到舊排（區塊＝到下一個區塊標題之前）；沒有日期的放最後。 */
async function sortBlockByDate(db: D1Database, courseId: string, blockId: string): Promise<void> {
  const { results } = await db.prepare("SELECT id, kind, is_full, event_date FROM lessons WHERE course_id = ? ORDER BY position").bind(courseId).all<{ id: string; kind: string; is_full: number; event_date: string | null }>();
  const at = results.findIndex((r) => r.id === blockId);
  if (at < 0) return;
  let end = at + 1;
  while (end < results.length && results[end]!.kind !== "section" && results[end]!.is_full !== 1) end++;
  const seg = results.slice(at + 1, end);
  const sorted = [...seg].sort((a, b) => (b.event_date || "").localeCompare(a.event_date || ""));
  if (sorted.every((r, i) => r.id === seg[i]!.id)) return;
  const order = [...results.slice(0, at + 1), ...sorted, ...results.slice(end)].map((r) => r.id);
  await db.batch([db.prepare("UPDATE lessons SET position = -position WHERE course_id = ?").bind(courseId), ...order.map((id, i) => db.prepare("UPDATE lessons SET position = ? WHERE id = ?").bind(i + 1, id))]);
}

export async function runDriveSync(env: Env, syncId: string): Promise<{ imported: number; total: number; note: string }> {
  const db = env.DB;
  const sync = await db.prepare("SELECT folder_id, course_id, block_id, title_format FROM drive_syncs WHERE id = ?").bind(syncId).first<{ folder_id: string; course_id: string; block_id: string; title_format: string }>();
  if (!sync) return { imported: 0, total: 0, note: "找不到這個同步設定" };
  const finish = async (out: { imported: number; total: number; note: string }) => {
    await db.prepare("UPDATE drive_syncs SET last_synced_at = ?, last_imported = ?, last_total = ?, last_note = ? WHERE id = ?").bind(new Date().toISOString(), out.imported, out.total, out.note.slice(0, 600), syncId).run();
    return out;
  };
  if (!env.GOOGLE_DRIVE_API_KEY) return finish({ imported: 0, total: 0, note: "尚未設定 Google Drive 金鑰" });
  const read = await readDriveFolder(env.GOOGLE_DRIVE_API_KEY, sync.folder_id);
  if ("error" in read) return finish({ imported: 0, total: 0, note: read.error });
  const total = read.files.length;
  const have = await existingDriveIds(db, sync.course_id);
  const fresh = read.files.filter((f) => !have.has(f.id)).sort((a, b) => parseDriveName(b.name, b.modified).ym.localeCompare(parseDriveName(a.name, a.modified).ym));
  if (!fresh.length) return finish({ imported: 0, total, note: "沒有新的檔案（都已經同步過了）" });
  const fmt = sync.title_format || "{標題}";
  const pos = await nextPos(db, sync.course_id);
  const ids = fresh.map(() => `${sync.course_id}-${short()}`);
  const lines: string[] = [];
  await db.batch(
    fresh.flatMap((f, i) => {
      const p = parseDriveName(f.name, f.modified);
      const name = driveTitle(fmt, f).slice(0, 120);
      lines.push(`${name}｜${f.name}`);
      return [
        db.prepare("INSERT INTO lessons (id, course_id, position, title, duration_minutes, media_type, event_date, kind) VALUES (?, ?, ?, ?, 0, 'demo', ?, 'material')").bind(ids[i]!, sync.course_id, pos + i, name, p.ym || null),
        db.prepare("INSERT INTO lesson_attachments (id, lesson_id, course_id, name, kind, link_url, att_type, created_by) VALUES (?, ?, ?, ?, 'link', ?, ?, 'system')").bind(crypto.randomUUID(), ids[i]!, sync.course_id, p.title.slice(0, 120), driveUrl(f.id), classifyLink(new URL(driveUrl(f.id)))),
      ];
    }),
  );
  // 最新的在最上面（杜杜龍 2026-11-20 全站規則）：有指定區塊放進該區塊並依日期排；沒指定就放整張卡最前面。
  if (sync.block_id) {
    await placeInBlock(db, sync.course_id, sync.block_id, ids);
    await sortBlockByDate(db, sync.course_id, sync.block_id);
  } else {
    await placeOnTop(db, sync.course_id, ids);
    await sortMaterialsByDate(db, sync.course_id);
  }
  return finish({ imported: fresh.length, total, note: lines.join("\n").slice(0, 600) });
}

/** 自動同步設定（設定頁開關，存在 ui_settings；預設每週一次）。YouTube 與雲端資料夾共用。 */
export async function getAutoSync(db: D1Database): Promise<{ weekly: boolean }> {
  const row = await db.prepare("SELECT value FROM ui_settings WHERE key = 'sync_auto'").first<{ value: string }>();
  try {
    const v = row ? (JSON.parse(row.value) as { weekly?: unknown }) : {};
    return { weekly: v.weekly !== false };
  } catch {
    return { weekly: true };
  }
}
export async function setAutoSync(db: D1Database, weekly: boolean): Promise<void> {
  await db.prepare("INSERT INTO ui_settings (key, value) VALUES ('sync_auto', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')").bind(JSON.stringify({ weekly })).run();
}

/** 排程：每週自動同步一次（超過 7 天沒同步的 YouTube 清單與雲端資料夾，每次最多各 2 份）。 */
export async function processWeeklySyncs(env: Env): Promise<number> {
  const { weekly } = await getAutoSync(env.DB);
  if (!weekly) return 0;
  const cutoff = new Date(Date.now() - 7 * 86_400_000).toISOString();
  let n = 0;
  if (env.YOUTUBE_API_KEY) {
    const { results } = await env.DB.prepare("SELECT id FROM youtube_syncs WHERE last_synced_at IS NOT NULL AND last_synced_at < ? ORDER BY last_synced_at LIMIT 2").bind(cutoff).all<{ id: string }>();
    for (const r of results) (await runYoutubeSync(env, r.id), n++);
  }
  if (env.GOOGLE_DRIVE_API_KEY) {
    const { results } = await env.DB.prepare("SELECT id FROM drive_syncs WHERE last_synced_at IS NOT NULL AND last_synced_at < ? ORDER BY last_synced_at LIMIT 2").bind(cutoff).all<{ id: string }>();
    for (const r of results) (await runDriveSync(env, r.id), n++);
  }
  return n;
}
