/**
 * 封面庫（業主 2026-11-19）：在上傳／編輯封面的介面，超級管理員可以從「未使用的封面檔」與「正在使用中的系列卡、課程卡、清單卡封面」挑一張來用；
 * 未使用的封面檔可以直接永久刪除（真的刪掉雲端儲存 R2 上的檔案）。
 * 這個檔案只負責「哪些檔案在用、哪些沒在用」的判斷與列表；畫面共用元件是 features/admin/cover-library.web.tsx。
 */
import type { D1Database, R2Bucket } from "./d1.ts";

/** 封面類圖片放在這幾個資料夾（brand／file／bg／system 等不是封面，不列入也不會被刪）。 */
export const COVER_PREFIXES = ["edm/", "cover/", "series/", "center/", "lesson/"] as const;
const KEY_RE = /^(edm|cover|series|center|lesson)\/[\w-]+\/[\w.-]+\.(jpg|jpeg|png|webp)$/i;
export const isCoverKey = (key: string) => KEY_RE.test(key);

/** 這個檔案屬於哪一種封面（畫面上標示用）。 */
export function coverKindLabel(key: string): string {
  const head = key.split("/")[0];
  const base = key.split("/").pop() ?? "";
  if (head === "edm") return "課程／清單 EDM";
  if (head === "cover") return "課程／清單封面";
  if (head === "series") return base.startsWith("cover-") ? "系列封面" : "系列 EDM";
  if (head === "center") return base.startsWith("cover-") ? "中心封面" : "中心首頁圖";
  return "章節／區塊封面";
}

/** 資料庫裡所有還在引用的圖片檔（任何一個地方在用就算使用中）。 */
export async function usedImageKeys(db: D1Database): Promise<Set<string>> {
  const rows = await db.batch([
    db.prepare("SELECT edm_key AS a, cover_key AS b FROM courses"),
    db.prepare("SELECT edm_key AS a, cover_key AS b FROM series_art"),
    db.prepare("SELECT edm_key AS a, cover_key AS b FROM center_art"),
    db.prepare("SELECT cover_key AS a, poster_key AS b FROM lessons"),
    db.prepare("SELECT logo_key AS a, bg_key AS b FROM brand_logos"),
  ]);
  const used = new Set<string>();
  for (const r of rows) for (const x of r.results as { a: string | null; b: string | null }[]) for (const k of [x.a, x.b]) if (k) used.add(k);
  return used;
}

/** 單一檔案現在有沒有在用（刪除前的最後確認）。 */
export async function isKeyInUse(db: D1Database, key: string): Promise<boolean> {
  return (await usedImageKeys(db)).has(key);
}

export type UnusedCover = { key: string; label: string; size: number; uploadedAt: string | null };

/** 列出雲端儲存裡「封面資料夾中、資料庫沒有任何地方在用」的圖片，新上傳的在前，最多 300 張。 */
export async function listUnusedCovers(db: D1Database, bucket: R2Bucket): Promise<{ items: UnusedCover[]; total: number }> {
  const used = await usedImageKeys(db);
  const out: UnusedCover[] = [];
  for (const prefix of COVER_PREFIXES) {
    let cursor: string | undefined;
    for (let i = 0; i < 100; i++) {
      const page = await bucket.list({ prefix, cursor, limit: 1000 });
      for (const o of page.objects) {
        if (!o.key.startsWith(prefix) || !isCoverKey(o.key) || used.has(o.key)) continue;
        out.push({ key: o.key, label: coverKindLabel(o.key), size: o.size, uploadedAt: o.uploaded ? new Date(o.uploaded).toISOString() : null });
      }
      if (!page.truncated) break;
      cursor = page.cursor;
    }
  }
  out.sort((a, b) => (b.uploadedAt ?? "").localeCompare(a.uploadedAt ?? ""));
  return { items: out.slice(0, 300), total: out.length };
}

export type InUseCard = { kind: "series" | "course" | "list"; id: string; title: string; edmKey: string | null; coverKey: string | null; version: number };

/** 正在使用封面的系列卡、課程卡、清單卡（三種分開，畫面分區顯示）。 */
export async function listInUseCards(db: D1Database): Promise<InUseCard[]> {
  const [series, courses] = await db.batch([
    db.prepare("SELECT a.series AS id, COALESCE(NULLIF(s.title, ''), a.series) AS title, a.edm_key, a.cover_key, a.art_version AS v FROM series_art a LEFT JOIN series_settings s ON s.series = a.series WHERE a.edm_key IS NOT NULL OR a.cover_key IS NOT NULL ORDER BY a.series"),
    db.prepare("SELECT id, title, is_list, edm_key, cover_key, art_version AS v FROM courses WHERE (edm_key IS NOT NULL OR cover_key IS NOT NULL) AND status <> 'archived' ORDER BY title"),
  ]);
  const cards: InUseCard[] = [];
  for (const r of series!.results as { id: string; title: string; edm_key: string | null; cover_key: string | null; v: number | null }[]) cards.push({ kind: "series", id: r.id, title: r.title, edmKey: r.edm_key, coverKey: r.cover_key, version: r.v ?? 1 });
  for (const r of courses!.results as { id: string; title: string; is_list: number; edm_key: string | null; cover_key: string | null; v: number | null }[]) cards.push({ kind: r.is_list === 1 ? "list" : "course", id: r.id, title: r.title, edmKey: r.edm_key, coverKey: r.cover_key, version: r.v ?? 1 });
  return cards;
}
