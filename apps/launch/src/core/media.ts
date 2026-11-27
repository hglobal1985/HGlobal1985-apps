/** 行動大學 API 共用核心：封面輪播與相簿（杜杜龍 2026-11-27 從 api-core.ts 依功能拆出；api-core.ts 會全部轉出，舊的 import 不用改）。 */
import { treasureCourseId } from "../treasure-box.ts";
import { type ThumbBadgeKind, THUMB_BADGE_KINDS, type CoverMediaKind, type CoverScope, type CoverMediaItem, type AlbumFolder, type AlbumSubfolders, type AlbumsResponse } from "../contract.ts";
import { recipePrefixes, recipeIdOfKey } from "../recipes.ts";
import { recipeShortPath, type RecipeDetail } from "../contract.ts";
import { centerKey } from "../central.ts";
import type { D1Database, Env } from "../d1.ts";
import { cleanOcrText, fmtOf, loadFields, structureEdm, type Structured } from "../edm-structure.ts";
import { loadSettings as loadAiSettings, todayUsed as aiTodayUsed } from "../ai-models.ts";
import { loadConfig } from "../ui-config.ts";
import { imageSize } from "../image-size.ts";
import { type Ctx, type Session, audit, eligibilityFor, fail, ranks, requireMember, requireSuperAdmin } from "./base.ts";
import { lockStateOfKey, lockStatesOf, pubUrl, requireCourseArt, rightsOf } from "./course-admin.ts";
import { assertCentralCenters } from "./library.ts";

// ---------- 封面輪播與相簿的共用函式 ----------
export type CoverRow = { owner_kind: string; center_key: string | null; owner_key: string; scope?: string; kind?: string; poster_key?: string | null };
export const coverKindOf = (v: string | null): CoverMediaKind => (v === "series" || v === "course" ? v : "center");
export const dim = (v: string | null) => Math.min(20000, Math.max(0, Math.round(Number(v) || 0)));
/** 相簿專區的資料夾彙整（杜杜龍 2026-11-25）：大類別順序＝設定的 albumOrder，資料夾一律按張數多到少；每個資料夾帶鎖定狀態與可否上傳。 */
export async function albumsIndex(ctx: Ctx): Promise<AlbumsResponse> {
  type G = { ok: string; scope: CoverScope; ck: string | null; k: string; n: number; thumbs: string | null };
  const [rows, arts, courses, blocks, cfg, treasure, perms] = await Promise.all([
    ctx.db
      .prepare("SELECT cm.owner_kind AS ok, cm.scope AS scope, cm.center_key AS ck, cm.owner_key AS k, COUNT(*) AS n, (SELECT GROUP_CONCAT(r2_key, '|') FROM (SELECT x.r2_key FROM cover_media x WHERE x.kind = 'image' AND x.owner_kind = cm.owner_kind AND x.scope = cm.scope AND COALESCE(x.center_key, '') = COALESCE(cm.center_key, '') AND x.owner_key = cm.owner_key ORDER BY x.position LIMIT 4)) AS thumbs FROM cover_media cm GROUP BY cm.owner_kind, cm.scope, cm.center_key, cm.owner_key")
      .all<G>(),
    ctx.db.prepare("SELECT center_key, center_label FROM center_art").all<{ center_key: string; center_label: string }>(),
    ctx.db.prepare("SELECT id, title FROM courses WHERE status = 'published'").all<{ id: string; title: string }>(),
    ctx.db.prepare("SELECT l.id, l.title, l.course_id, c.title AS course_title FROM lessons l JOIN courses c ON c.id = l.course_id WHERE l.kind = 'section' AND c.status = 'published'").all<{ id: string; title: string; course_id: string; course_title: string }>(),
    loadConfig(ctx.db),
    treasureCourseId(ctx.db).catch(() => null),
    albumPermMap(ctx.db),
  ]);
  const rights = ctx.session ? await rightsOf(ctx) : null;
  const label = new Map(arts.results.map((a) => [a.center_key, a.center_label]));
  const courseTitle = new Map(courses.results.map((c) => [c.id, c.title]));
  const block = new Map(blocks.results.map((b) => [b.id, b]));
  const locks = await lockStatesOf(ctx, [...new Set([...rows.results.filter((r) => r.ok === "course" && courseTitle.has(r.k)).map((r) => r.k), ...rows.results.filter((r) => r.ok === "course" && block.has(r.k)).map((r) => block.get(r.k)!.course_id)])]);
  const lockOf = (courseId: string) => {
    const l = locks.get(courseId);
    return l && l.locked ? { locked: true, lockReason: l.lines.join("、") || "沒有權限進入這個相簿" } : { locked: false };
  };
  const groups: Record<string, AlbumFolder[]> = { edm: [], cover: [], series: [], course: [], block: [], treasure: [], recipe: [] }; // recipe 永遠空（食譜不是照片資料夾，只佔順序）
  for (const r of rows.results) {
    const thumbs = r.thumbs ? r.thumbs.split("|").map((k) => pubUrl(k, 0)) : [];
    const base = { count: r.n, thumb: thumbs[0] ?? null, thumbs };
    if (r.ok === "center" && r.ck) {
      const title = label.get(r.ck) ?? r.ck;
      const scope: CoverScope = r.scope === "edm" ? "edm" : "cover";
      const canEdit = !!rights && (rights.admin || (!!rights.center && centerKey(rights.center.label) === r.ck && (rights.staff || !!rights.editor?.editOthers)));
      groups[scope]!.push({ id: `center:${r.ck}:${scope}`, kind: "center", key: title, scope, title, groupId: scope, ...base, locked: false, canEdit });
    } else if (r.ok === "series" && r.k) groups.series!.push({ id: `series:${r.k}`, kind: "series", key: r.k, title: r.k, groupId: "series", ...base, locked: false, canEdit: !!rights?.admin });
    else if (r.ok === "course") {
      const ct = courseTitle.get(r.k);
      const b = block.get(r.k);
      if (ct) groups.course!.push({ id: `course:${r.k}`, kind: "course", key: r.k, title: ct, groupId: "course", ...base, courseId: r.k, ...lockOf(r.k), canEdit: !!rights?.admin });
      else if (b) {
        // 成交百寶箱的區塊相簿單獨一個類別，不混在「課程區塊相簿」裡（杜杜龍 2026-11-25）。
        const gid = b.course_id === treasure ? "treasure" : "block";
        groups[gid]!.push({ id: `block:${r.k}`, kind: "block", key: r.k, title: b.title, subtitle: gid === "treasure" ? undefined : b.course_title, groupId: gid, ...base, courseId: b.course_id, ...lockOf(b.course_id), canEdit: !!rights?.admin });
      }
    }
  }
  // 獎銜達標的人可以上傳（相簿齒輪的「上傳權限」；資料夾自己的設定優先於類別）。
  if (ctx.session && perms.size) {
    const codes = [...new Set([...perms.values()].filter(Boolean))];
    const elig = await eligibilityFor(ctx.session, await ranks(ctx.db), codes);
    for (const list of Object.values(groups))
      for (const f of list) {
        const eff = perms.get(f.id) ?? perms.get(`group:${f.groupId}`);
        if (eff && elig.get(eff) === true && !f.locked) f.canEdit = true;
      }
  }
  const sort = (a: AlbumFolder, b: AlbumFolder) => b.count - a.count || a.title.localeCompare(b.title, "zh-Hant");
  const defs: [string, string][] = [["edm", "中心 EDM"], ["cover", "中心封面照片"], ["series", "系列封面照片"], ["course", "課程封面照片"], ["block", "課程區塊相簿"], ["treasure", "成交百寶箱"], ["recipe", "食譜"]];
  const order = cfg.albumOrder ?? [];
  const pos = (id: string) => (order.includes(id) ? order.indexOf(id) : 100 + defs.findIndex((d) => d[0] === id));
  const out = defs
    .map(([id, l]) => ({ id, label: l, folders: groups[id]!.sort(sort) }))
    .filter((g) => g.folders.length)
    .sort((a, b) => pos(a.id) - pos(b.id));
  const orderAll = [...out.map((g) => g.id), "recipe"].sort((a, b) => pos(a) - pos(b)); // 食譜專區不是照片資料夾，但和其他類別一起排順序
  return { total: out.reduce((n, g) => n + g.folders.reduce((m, f) => m + f.count, 0), 0), groups: out, order: orderAll };
}
/** 全站 AI 辨識（文字 OCR、場景）還沒處理的張數與預估完成時間（圖片資訊「藍字」區給所有人看；杜杜龍 2026-11-26）。速度取最近 3 小時實際完成的張數。 */
export async function aiQueueInfo(db: D1Database, edm: boolean): Promise<{ pending: number; perHour: number; etaMin: number | null; quotaOut: boolean; sceneOn: boolean; ocrOn: boolean }> {
  // 只算「這張圖所屬那一類」的待辨識張數：中心 EDM 只有文字辨識；相簿（區塊）照片有文字＋場景（杜杜龍 2026-11-26）。
  const since = new Date(Date.now() - 3 * 3600_000).toISOString();
  const [q, st, used, ss] = await Promise.all([
    db
      .prepare(
        `SELECT
          SUM(CASE WHEN kind = 'image' AND ocr_status = '' AND ((owner_kind = 'center' AND scope = 'edm') OR owner_kind = 'course') THEN 1 ELSE 0 END) AS po,
          SUM(CASE WHEN kind = 'image' AND owner_kind = 'course' AND scene_status = '' THEN 1 ELSE 0 END) AS ps,
          SUM(CASE WHEN kind = 'image' AND owner_kind = 'center' AND scope = 'edm' AND ocr_status = '' THEN 1 ELSE 0 END) AS pe,
          SUM(CASE WHEN ocr_status = 'done' AND ocr_at >= ?1 THEN 1 ELSE 0 END) AS dof,
          SUM(CASE WHEN scene_status = 'done' AND scene_at >= ?1 THEN 1 ELSE 0 END) AS dsc
        FROM cover_media`,
      )
      .bind(since)
      .first<{ po: number | null; ps: number | null; pe: number | null; dof: number | null; dsc: number | null }>(),
    loadAiSettings(db),
    aiTodayUsed(db),
    (await import("../search-settings.ts")).loadSearchSettings(db),
  ]);
  const sceneOn = ss.aiOnScene !== false;
  const ocrOn = edm ? ss.aiOnEdm !== false : ss.photoOcrEnabled !== false;
  const pending = edm ? (q?.pe ?? 0) : (q?.po ?? 0) - (q?.pe ?? 0) + (sceneOn ? (q?.ps ?? 0) : 0);
  const perHour = Math.round((((q?.dof ?? 0) + (edm ? 0 : sceneOn ? (q?.dsc ?? 0) : 0)) / 3) * 10) / 10;
  return { pending, perHour, etaMin: pending && perHour > 0 ? Math.ceil((pending / perHour) * 60) : null, quotaOut: !!st.capEnabled && used >= st.dailyCap, sceneOn, ocrOn };
}

export function coverItem(r: { id: string; scope: CoverScope; folder_id?: string | null; created_at?: string | null; uploader_name?: string | null; uploader_avatar?: string | null; scene_text?: string | null; ocr_text?: string | null; event_date?: string | null; course_id?: string | null; course_title?: string | null; kind: "image" | "video"; r2_key: string; poster_key: string | null; width: number; height: number; duration_sec: number }): CoverMediaItem {
  return {
    id: r.id,
    scope: r.scope === "edm" ? "edm" : "cover",
    ...(r.course_id ? { courseId: r.course_id, courseTitle: r.course_title ?? "" } : {}),
    kind: r.kind,
    url: r.kind === "video" ? `/api/v2/media/album?k=${encodeURIComponent(r.r2_key)}` : pubUrl(r.r2_key, 0),
    posterUrl: r.poster_key ? pubUrl(r.poster_key, 0) : null,
    width: r.width,
    height: r.height,
    durationSec: r.duration_sec,
    ...(r.scope === "edm" ? { eventDate: r.event_date ?? null, text: r.ocr_text ?? "" } : r.ocr_text ? { text: r.ocr_text } : {}),
    ...(r.scene_text ? { scene: r.scene_text } : {}),
    ...(r.created_at ? { createdAt: r.created_at } : {}),
    ...(r.folder_id ? { folderId: r.folder_id } : {}),
    ...(r.uploader_name ? { uploader: r.uploader_name, ...(r.uploader_avatar ? { uploaderAvatar: r.uploader_avatar } : {}) } : {}),
  };
}
/** 儲存區（杜杜龍 2026-11-23）：只有中心有「EDM」分頁；系列、課程一律只有 cover。沒帶或不認得時，中心當 edm（舊版 App 的相簿上傳）。 */
export const coverScopeOf = (kind: CoverMediaKind, v: unknown): CoverScope => (kind !== "center" ? "cover" : v === "cover" ? "cover" : "edm");
/** lookup：center＝中心鑰匙（centerKey）；series＝系列名稱；course＝課程編號。scope 有給就只取那一區，沒給＝兩區都取（公開讀取用）。 */
export async function coverItems(db: D1Database, kind: CoverMediaKind, lookup: string, scope?: CoverScope): Promise<CoverMediaItem[]> {
  const where = (kind === "center" ? "cm.owner_kind = 'center' AND cm.center_key = ?" : "cm.owner_kind = ? AND cm.owner_key = ?") + (scope ? " AND cm.scope = ?" : "");
  // 課程 EDM（綁定課程的照片）不受 100 張上限限制，所以讀取上限放寬。
  const st = db.prepare(`SELECT cm.id, cm.scope, cm.kind, cm.r2_key, cm.poster_key, cm.width, cm.height, cm.duration_sec, cm.course_id, cm.ocr_text, cm.event_date, cm.created_at, cm.folder_id, COALESCE(NULLIF(mp.name, ''), cm.uploader_name) AS uploader_name, COALESCE(NULLIF(mp.avatar, ''), cm.uploader_avatar) AS uploader_avatar, c.title AS course_title FROM cover_media cm LEFT JOIN courses c ON c.id = cm.course_id LEFT JOIN member_profiles mp ON mp.sub = cm.created_by WHERE ${where} ORDER BY cm.scope, cm.position, CASE WHEN cm.scope = 'edm' THEN cm.event_date IS NULL ELSE 0 END, CASE WHEN cm.scope = 'edm' THEN cm.event_date END DESC, cm.created_at, cm.rowid LIMIT 2000`);
  const args = [...(kind === "center" ? [lookup] : [kind, lookup]), ...(scope ? [scope] : [])];
  const { results } = await st.bind(...args).all<{ id: string; scope: CoverScope; folder_id: string | null; created_at: string | null; uploader_name: string | null; uploader_avatar: string | null; ocr_text: string | null; event_date: string | null; course_id: string | null; course_title: string | null; kind: "image" | "video"; r2_key: string; poster_key: string | null; width: number; height: number; duration_sec: number }>();
  return results.map(coverItem);
}
/**
 * 課程 EDM 併入中心 EDM 空間（杜杜龍 2026-11-23）：中心主辦、已發佈、有 EDM 的課程，其 EDM 圖自動成為該中心 EDM 空間（scope = edm）的一張，用 course_id 綁定；
 * 課程換圖、改主辦中心、下架、刪除，這裡跟著同步。每次讀中心先用一個便宜的查詢檢查，有差異才寫入（所以已上傳和未來上傳的都會自動併入）。
 */
export async function reconcileCenterEdm(db: D1Database, key: string): Promise<void> {
  const ok = "c.host_center_key = ?1 AND c.status = 'published' AND c.edm_key IS NOT NULL";
  const need = await db
    .prepare(
      `SELECT 1 AS x WHERE EXISTS (SELECT 1 FROM courses c WHERE ${ok} AND NOT EXISTS (SELECT 1 FROM cover_media m WHERE m.course_id = c.id AND m.center_key = ?1 AND m.r2_key = c.edm_key))
       OR EXISTS (SELECT 1 FROM cover_media m WHERE m.owner_kind = 'center' AND m.center_key = ?1 AND m.course_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM courses c WHERE c.id = m.course_id AND ${ok} AND c.edm_key = m.r2_key))`,
    )
    .bind(key)
    .first();
  if (!need) return;
  const base = "(SELECT COALESCE(MAX(position), -1) FROM cover_media WHERE owner_kind = 'center' AND center_key = ?1 AND scope = 'edm')";
  await db.batch([
    // 課程改主辦到這個中心：把原本在別的中心的綁定照片搬過來
    db.prepare(`UPDATE cover_media SET center_key = ?1, scope = 'edm', position = ${base} + 1 WHERE owner_kind = 'center' AND course_id IN (SELECT c.id FROM courses c WHERE ${ok}) AND center_key <> ?1`).bind(key),
    // 課程不在這裡了（改中心、下架、刪除、移除 EDM）：只拿掉綁定的照片紀錄，檔案歸課程管，不刪檔
    db.prepare(`DELETE FROM cover_media WHERE owner_kind = 'center' AND center_key = ?1 AND course_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM courses c WHERE c.id = cover_media.course_id AND ${ok})`).bind(key),
    // 課程換了 EDM：同步新的檔案（寬高重新量）
    db.prepare(`UPDATE cover_media SET r2_key = (SELECT c.edm_key FROM courses c WHERE c.id = cover_media.course_id), width = 0, height = 0, ocr_status = '', ocr_text = '', event_date = NULL WHERE owner_kind = 'center' AND center_key = ?1 AND course_id IS NOT NULL AND r2_key <> (SELECT c.edm_key FROM courses c WHERE c.id = cover_media.course_id)`).bind(key),
    // 還沒綁定的課程 EDM：新增（接在最後面，依課程建立時間）
    db.prepare(
      `INSERT INTO cover_media (id, owner_kind, center_key, owner_key, kind, r2_key, width, height, position, created_by, scope, course_id)
       SELECT lower(hex(randomblob(8))), 'center', ?1, '', 'image', c.edm_key, 0, 0, ${base} + ROW_NUMBER() OVER (ORDER BY c.created_at, c.id), 'course-edm', 'edm', c.id
       FROM courses c WHERE ${ok} AND NOT EXISTS (SELECT 1 FROM cover_media m WHERE m.course_id = c.id)`,
    ).bind(key),
  ]);
}
/** 舊照片沒有記寬高（0）時，從檔頭量出來存回去（一次最多 6 張）；封面輪播要靠它判斷橫式或直式。 */
export async function fillImageDims(env: Env, db: D1Database, kind: CoverMediaKind, lookup: string): Promise<void> {
  const bucket = env.MEDIA;
  if (!bucket) return;
  const where = kind === "center" ? "owner_kind = 'center' AND center_key = ?" : "owner_kind = ? AND owner_key = ?";
  const st = db.prepare(`SELECT id, r2_key FROM cover_media WHERE ${where} AND kind = 'image' AND (width <= 0 OR height <= 0) LIMIT 6`);
  const { results } = await (kind === "center" ? st.bind(lookup) : st.bind(kind, lookup)).all<{ id: string; r2_key: string }>();
  for (const r of results) {
    try {
      const o = await bucket.get(r.r2_key, { range: { offset: 0, length: 131072 } });
      if (!o) continue;
      const size = imageSize(new Uint8Array(await new Response((o as unknown as { body: ReadableStream }).body).arrayBuffer()));
      if (size) await db.prepare("UPDATE cover_media SET width = ?, height = ? WHERE id = ?").bind(Math.min(20000, size.width), Math.min(20000, size.height), r.id).run();
    } catch {
      /* 量不出來就維持原狀，下次再試 */
    }
  }
}
/**
 * 相簿「誰可以上傳」的獎銜設定（杜杜龍 2026-11-25，超級管理員在相簿齒輪設定；成交百寶箱預設白金以上）：
 * 資料夾自己的設定優先於類別；有設定而且會員獎銜達標，就算有上傳權（只限上傳與補預覽圖、資訊，不能刪除、排序別人的照片）。
 */
export async function albumPermMap(db: D1Database): Promise<Map<string, string>> {
  const { results } = await db.prepare("SELECT key, upload_min_rank FROM album_permissions").all<{ key: string; upload_min_rank: string }>();
  return new Map(results.map((r) => [r.key, r.upload_min_rank]));
}
/** 一個封面位置（kind＋key＋scope）對應的相簿資料夾編號與大類別。 */
export async function albumRefOf(db: D1Database, kind: CoverMediaKind, key: string, scope: CoverScope | string | undefined): Promise<{ folderId: string; groupId: string; blockOff?: boolean }> {
  if (kind === "center") {
    const sc = scope === "edm" ? "edm" : "cover";
    return { folderId: `center:${centerKey(key)}:${sc}`, groupId: sc };
  }
  if (kind === "series") return { folderId: `series:${key}`, groupId: "series" };
  const blk = await db.prepare("SELECT l.course_id, c.block_photos FROM lessons l JOIN courses c ON c.id = l.course_id WHERE l.id = ? AND l.kind = 'section'").bind(key).first<{ course_id: string; block_photos: number }>();
  if (blk) return { folderId: `block:${key}`, groupId: blk.course_id === (await treasureCourseId(db).catch(() => null)) ? "treasure" : "block", blockOff: blk.block_photos !== 1 };
  return { folderId: `course:${key}`, groupId: "course" };
}
export async function albumRankAllows(ctx: Ctx, ref: { folderId: string; groupId: string; blockOff?: boolean }): Promise<boolean> {
  if (!ctx.session || ref.blockOff) return false;
  const perms = await albumPermMap(ctx.db);
  const eff = perms.get(ref.folderId) ?? perms.get(`group:${ref.groupId}`);
  if (!eff) return false;
  const elig = await eligibilityFor(ctx.session, await ranks(ctx.db), [eff]);
  return elig.get(eff) === true;
}
/** 教材圖片（上傳檔案當教材、雲端硬碟匯入）的壓縮：格式與畫質直接套用「相簿存檔格式」（杜杜龍 2026-11-25）；套用範圍跟著相簿的範圍設定（試行期只有成交百寶箱的課程）。 */
export async function materialImageOverride(ctx: Ctx, courseId: string | null | undefined): Promise<{ format: "jpeg" | "webp" | "avif"; quality: number } | undefined> {
  const app = (await loadConfig(ctx.db)).app;
  if (app.albumScope === "off") return undefined;
  if (app.albumScope === "treasure" && courseId !== (await treasureCourseId(ctx.db).catch(() => null))) return undefined;
  return { format: app.albumFormat, quality: app.albumQuality };
}
/** 區塊相簿子資料夾（杜杜龍 2026-11-26）：只有區塊相簿（cover_media 的 course 類、owner_key 是區塊編號）有；最多一層；名稱最多 20 字、同一區塊不可重複。 */
export const FOLDER_NAME_MAX = 20;
export async function requireFolderManage(ctx: Ctx, key: string): Promise<Session> {
  const s = requireMember(ctx);
  try {
    await requireCourseArt(ctx, s, await courseOfCoverKey(ctx.db, key));
    return s;
  } catch (e) {
    if (await albumRankAllows(ctx, await albumRefOf(ctx.db, "course", key, "cover"))) return s; // 白金以上等「上傳權限」達標的人也能管理資料夾、移動照片
    throw e;
  }
}
export async function isBlockKey(db: D1Database, key: string): Promise<boolean> {
  return !!(await db.prepare("SELECT 1 AS ok FROM lessons WHERE id = ? AND kind = 'section'").bind(key).first());
}
export async function putInFolder(ctx: Ctx, o: { kind: CoverMediaKind; ownerKey: string }, photoId: string): Promise<void> {
  const fid = (ctx.url.searchParams.get("folder") ?? "").slice(0, 40);
  if (!fid || o.kind !== "course") return;
  const ok = await ctx.db.prepare("SELECT 1 AS ok FROM album_folders WHERE id = ? AND owner_key = ?").bind(fid, o.ownerKey).first();
  if (ok) await ctx.db.prepare("UPDATE cover_media SET folder_id = ? WHERE id = ?").bind(fid, photoId).run();
}
export async function subfoldersOf(ctx: Ctx, key: string): Promise<AlbumSubfolders> {
  const [fs, counts, thumbs] = await Promise.all([
    ctx.db.prepare("SELECT id, name FROM album_folders WHERE owner_key = ?").bind(key).all<{ id: string; name: string }>(),
    ctx.db.prepare("SELECT folder_id AS f, COUNT(*) AS n FROM cover_media WHERE owner_kind = 'course' AND owner_key = ? AND scope = 'cover' AND kind = 'image' GROUP BY folder_id").bind(key).all<{ f: string; n: number }>(),
    ctx.db.prepare("SELECT folder_id AS f, r2_key FROM cover_media WHERE owner_kind = 'course' AND owner_key = ? AND scope = 'cover' AND kind = 'image' ORDER BY position").bind(key).all<{ f: string; r2_key: string }>(),
  ]);
  const n = new Map(counts.results.map((r) => [r.f, r.n]));
  const t = new Map<string, string[]>();
  for (const r of thumbs.results) {
    const l = t.get(r.f) ?? [];
    if (l.length < 4) l.push(pubUrl(r.r2_key, 0));
    t.set(r.f, l);
  }
  let canManage = false;
  try {
    if (ctx.session) {
      await requireFolderManage(ctx, key);
      canManage = true;
    }
  } catch {
    canManage = false;
  }
  return {
    folders: fs.results.map((f) => ({ id: f.id, name: f.name, count: n.get(f.id) ?? 0, thumbs: t.get(f.id) ?? [] })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh-Hant")),
    uncat: { count: n.get("") ?? 0, thumbs: t.get("") ?? [] },
    canManage,
  };
}
/**
 * 食譜專區的權限（杜杜龍 2026-11-26）：管理者＝超級管理員、總部管理員，或「食譜」上傳獎銜（相簿齒輪 group:recipe）達標的會員——可直接發佈、審核投稿、新增與改名分類、修改任何食譜。
 * 一般會員可以投稿（進「待審核」），投稿者自己在草稿與待審核時可修改、刪除；核准後只有管理者能改。
 */
export async function recipeManager(ctx: Ctx): Promise<boolean> {
  if (!ctx.session) return false;
  if (ctx.session.roles.includes("super_admin") || (await rightsOf(ctx)).admin) return true;
  return albumRankAllows(ctx, { folderId: "recipe", groupId: "recipe" });
}
export type RecipeRow = { author_center_label: string; number: number | null; id: string; title: string; category_id: string; body: string; status: "draft" | "pending" | "published"; author_sub: string; author_name: string; updated_at: string };
export async function recipeRow(ctx: Ctx, id: string): Promise<RecipeRow> {
  return (await ctx.db.prepare("SELECT number, id, title, category_id, body, status, author_sub, author_name, author_center_label, updated_at FROM recipes WHERE id = ?").bind(id).first<RecipeRow>()) ?? fail(404, "not_found", "找不到這道食譜");
}
export async function requireRecipeEdit(ctx: Ctx, id: string): Promise<{ s: Session; row: RecipeRow; manager: boolean }> {
  const s = requireMember(ctx);
  const row = await recipeRow(ctx, id);
  const manager = await recipeManager(ctx);
  if (!manager && !(row.author_sub === s.sub && row.status !== "published")) fail(403, "forbidden", "這道食譜已經發佈，只有管理者能修改");
  return { s, row, manager };
}
export async function recipeDetail(ctx: Ctx, row: RecipeRow): Promise<RecipeDetail> {
  const manager = await recipeManager(ctx);
  const mine = !!ctx.session && row.author_sub === ctx.session.sub;
  if (row.status !== "published" && !manager && !mine) fail(404, "not_found", "找不到這道食譜");
  const cat = row.category_id ? await ctx.db.prepare("SELECT name FROM recipe_categories WHERE id = ?").bind(row.category_id).first<{ name: string }>() : null;
  const shortPath = row.number && row.status === "published" ? recipeShortPath((await recipePrefixes(ctx.db)).cur, row.number) : null;
  return { authorCenter: row.author_center_label, admin: !!ctx.session?.roles.includes("super_admin"), id: row.id, number: row.number, shortPath, title: row.title, categoryId: row.category_id, categoryName: cat?.name ?? "", body: row.body, status: row.status, authorName: row.author_name, updatedAt: row.updated_at, canEdit: manager || (mine && row.status !== "published"), manager };
}
/** 這次請求要管理的封面（含權限檢查）：中心＝能編輯該中心封面的人；系列＝超級管理員；課程＝有該課程修改權的人。 */
export async function requireCoverOwner(ctx: Ctx, fromBody = false) {
  const base = ctx;
  try {
    return await requireCoverOwnerBase(base, fromBody);
  } catch (e) {
    // 上傳（不是排序、刪除）：原本沒權限，但相簿「上傳權限」設定的獎銜達標也可以。
    if (!fromBody && ctx.session) {
      const kind = coverKindOf(ctx.url.searchParams.get("kind"));
      const key = (ctx.url.searchParams.get("key") ?? "").trim().slice(0, 100);
      const scope = coverScopeOf(kind, ctx.url.searchParams.get("scope"));
      if (key && (await albumRankAllows(ctx, await albumRefOf(ctx.db, kind, key, scope)))) {
        const ck = kind === "center" ? centerKey(key) : null;
        return { s: ctx.session, kind, lookup: ck ?? key, centerKey: ck, ownerKey: kind === "center" ? "" : key, scope };
      }
    }
    throw e;
  }
}
export async function requireCoverOwnerBase(ctx: Ctx, fromBody = false): Promise<{ s: Session; kind: CoverMediaKind; lookup: string; centerKey: string | null; ownerKey: string; scope: CoverScope }> {
  let kind: CoverMediaKind;
  let key: string;
  let scopeRaw: unknown;
  if (fromBody) {
    const c = ctx.req.clone();
    const b = (await c.json().catch(() => ({}))) as { kind?: unknown; key?: unknown; scope?: unknown };
    kind = coverKindOf(typeof b.kind === "string" ? b.kind : null);
    key = typeof b.key === "string" ? b.key.trim().slice(0, 100) : "";
    scopeRaw = b.scope;
  } else {
    kind = coverKindOf(ctx.url.searchParams.get("kind"));
    key = (ctx.url.searchParams.get("key") ?? "").trim().slice(0, 100);
    scopeRaw = ctx.url.searchParams.get("scope");
  }
  const scope = coverScopeOf(kind, scopeRaw);
  if (!key) fail(400, "invalid_key", "請指定要放封面的位置");
  if (kind === "center") {
    const { s, center } = await requireCenterArt(ctx, key);
    return { s, kind, lookup: center.key, centerKey: center.key, ownerKey: "", scope };
  }
  if (kind === "series") {
    const s = requireSuperAdmin(ctx);
    return { s, kind, lookup: key, centerKey: null, ownerKey: key, scope };
  }
  const s = requireMember(ctx);
  const rid = recipeIdOfKey(key);
  if (rid) await requireRecipeEdit(ctx, rid); // 食譜照片（杜杜龍 2026-11-26）：管理者，或投稿者自己在草稿／待審核時
  else await requireCourseArt(ctx, s, await courseOfCoverKey(ctx.db, key));
  return { s, kind, lookup: key, centerKey: null, ownerKey: key, scope };
}
/** 刪除、換預覽圖時：依資料列所屬的封面檢查權限。 */
export async function requireCoverRowOwner(ctx: Ctx, row: CoverRow): Promise<Session> {
  try {
    return await requireCoverRowOwnerBase(ctx, row);
  } catch (e) {
    // 補預覽圖、資訊（PUT）：上傳權限設定達標的人也可以（刪除不行）。
    if (ctx.req.method === "PUT" && ctx.session) {
      const kind: CoverMediaKind = row.owner_kind === "center" ? "center" : row.owner_kind === "series" ? "series" : "course";
      const key = kind === "center" ? (row.center_key ?? "") : row.owner_key;
      if (key && (await albumRankAllows(ctx, kind === "center" ? { folderId: `center:${row.center_key}:${row.scope === "edm" ? "edm" : "cover"}`, groupId: row.scope === "edm" ? "edm" : "cover" } : await albumRefOf(ctx.db, kind, key, row.scope)))) return ctx.session;
    }
    throw e;
  }
}
export async function requireCoverRowOwnerBase(ctx: Ctx, row: CoverRow): Promise<Session> {
  const s = requireMember(ctx);
  if (row.owner_kind === "center") {
    const rights = await rightsOf(ctx);
    const mine = rights.center && row.center_key === centerKey(rights.center.label);
    if (!rights.admin && !(mine && (rights.staff || rights.editor?.editOthers))) fail(403, "forbidden", "只能修改自己中心的封面");
  } else if (row.owner_kind === "series") requireSuperAdmin(ctx);
  else if (recipeIdOfKey(row.owner_key)) await requireRecipeEdit(ctx, recipeIdOfKey(row.owner_key)!);
  else await requireCourseArt(ctx, s, await courseOfCoverKey(ctx.db, row.owner_key));
  return s;
}
/** 圖片資訊（相簿照片）：管理者看完整內容；其他人拿掉 GPS 與帳號編號，鎖住課程的照片不給。 */
/** R2 裡這個檔案目前的格式：type＝R2 記錄的 Content-Type，ext＝檔名副檔名（type 查不到時的備援），bytes＝實際大小。 */
export async function storedInfo(env: Env, key: string, fallbackBytes: number): Promise<{ type: string; ext: string; bytes: number }> {
  const head = key && env.MEDIA ? await env.MEDIA.head(key).catch(() => null) : null;
  return { type: head?.httpMetadata?.contentType ?? "", ext: (/\.([A-Za-z0-9]{2,5})$/.exec(key)?.[1] ?? "").toLowerCase(), bytes: head?.size ?? fallbackBytes };
}
export async function coverMediaInfo(ctx: Ctx, id: string) {
  // 圖片資訊面板（杜杜龍 2026-11-24；2026-11-25 開放給所有人含訪客）：管理這個相簿的人看完整內容；
  // 其他人看到同樣的面板，但 EXIF 的 GPS 位置（緯度、經度、海拔）與上傳者帳號編號會拿掉，沒權限看的課程照片也不給。
  const r = await ctx.db
    .prepare("SELECT cm.id, cm.owner_kind, cm.center_key, cm.owner_key, cm.scope, cm.kind, cm.width, cm.height, cm.duration_sec, cm.bytes, cm.position, cm.created_by, cm.created_at, cm.uploader_name, cm.meta, cm.r2_key, cm.course_id, cm.ocr_text, cm.ocr_fields, cm.ocr_fmt, cm.ocr_status, cm.ocr_model, cm.ocr_at, cm.scene_status, cm.scene_text, cm.event_date, c.title AS course_title, (SELECT display_name FROM sessions WHERE member_sub = cm.created_by ORDER BY expires_at DESC LIMIT 1) AS session_name, (SELECT name FROM member_profiles WHERE sub = cm.created_by) AS profile_name FROM cover_media cm LEFT JOIN courses c ON c.id = cm.course_id WHERE cm.id = ?")
    .bind(id)
    .first<Record<string, string | number | null>>();
  if (!r) return fail(404, "not_found", "找不到這張照片");
  let manager = true;
  try {
    await requireCoverRowOwner(ctx, r as unknown as CoverRow);
  } catch {
    manager = false;
    if (r.owner_kind === "course") {
      const blk = await ctx.db.prepare("SELECT course_id FROM lessons WHERE id = ? AND kind = 'section'").bind(String(r.owner_key)).first<{ course_id: string }>();
      const lk = await lockStateOfKey(ctx, blk?.course_id ?? String(r.owner_key));
      if (lk.locked && !lk.manages) return fail(403, "locked", lk.lines[0] ?? "沒有權限");
    }
  }
  const fieldsNow = await loadFields(ctx.db);
  let meta: { exif?: Record<string, unknown>; file?: Record<string, unknown> } = {};
  try {
    meta = r.meta ? (JSON.parse(String(r.meta)) as typeof meta) : {};
  } catch {
    meta = {};
  }
  // 還沒用目前格式整理過：背景補整理（額度用完或沒綁定 AI 就略過）
  if (r.kind === "image" && r.ocr_text && r.ocr_fmt !== fmtOf(fieldsNow) && ctx.defer) ctx.defer(structureEdm(ctx.env, ctx.db, String(r.id)).catch(() => undefined));
  const byRaw = String(r.created_by ?? "");
  const system = byRaw === "migration" || byRaw === "course-edm";
  return {
    id: r.id,
    kind: r.kind,
    scope: r.scope,
    width: r.width,
    height: r.height,
    durationSec: r.duration_sec,
    bytes: r.bytes,
    position: r.position,
    ownerKind: r.owner_kind,
    ownerKey: r.owner_kind === "center" ? r.center_key : r.owner_key,
    uploader: system ? (byRaw === "course-edm" ? "系統（由課程 EDM 自動併入）" : "系統（舊資料搬移）") : String(r.profile_name || r.uploader_name || r.session_name || ""),
    uploaderSub: system || !manager ? "" : byRaw,
    uploadedAt: r.created_at,
    courseId: r.course_id,
    courseTitle: r.course_title,
    ocrStatus: r.ocr_status,
    sceneStatus: String(r.scene_status ?? ""),
    sceneText: String(r.scene_text ?? ""),
    queue: await aiQueueInfo(ctx.db, r.owner_kind === "center" && r.scope === "edm"),
    ocrModel: r.ocr_model,
    ocrAt: r.ocr_at,
    eventDate: r.event_date,
    ocrText: cleanOcrText(String(r.ocr_text ?? "")),
    structured: (() => {
      // 套入「AI 文字辨識」欄位格式後的內容（杜杜龍 2026-11-24）：沒整理好時 fields 是 null，畫面改顯示清理過的原文。
      try {
        const st = r.ocr_fields ? (JSON.parse(String(r.ocr_fields)) as Structured) : null;
        return { fields: st?.f ?? null, other: st?.o ?? "", stale: r.ocr_fmt !== fmtOf(fieldsNow) };
      } catch {
        return { fields: null, other: "", stale: true };
      }
    })(),
    // 目前存在 R2 的檔案格式（杜杜龍 2026-11-25，所有人都看得到）：以 R2 實際的檔案類型為準，查不到就看檔名副檔名。
    stored: await storedInfo(ctx.env, String(r.r2_key ?? ""), Number(r.bytes) || 0),
    file: meta.file ?? {},
    exif: manager ? meta.exif ?? {} : Object.fromEntries(Object.entries(meta.exif ?? {}).filter(([k]) => !/^(latitude|longitude|GPS)/i.test(k))),
  };
}

/**
 * 任何圖片都有「圖片資訊」（杜杜龍 2026-11-25：所有的照片都要有驚嘆號）：用儲存檔名（網址的 k）查。
 * 是相簿照片 → 走 coverMediaInfo；否則（課程封面、EDM、系列／中心封面、品牌 logo、課表…）回基本資訊：儲存空間裡的檔案大小、類型、上傳時間與所屬項目。
 */
export async function imageInfoByKey(ctx: Ctx) {
  const k = (ctx.url.searchParams.get("k") ?? "").slice(0, 300);
  if (!k) return fail(400, "invalid_key", "缺少圖片");
  const cm = await ctx.db.prepare("SELECT id FROM cover_media WHERE r2_key = ? OR poster_key = ? LIMIT 1").bind(k, k).first<{ id: string }>();
  if (cm) return coverMediaInfo(ctx, cm.id);
  const one = async (sql: string) => (await ctx.db.prepare(sql).bind(k).first<{ a: string | null; b: string | null }>()) ?? null;
  let owner: { kind: "center" | "series" | "course"; key: string; label: string; courseId?: string } | null = null;
  const c = await one("SELECT id AS a, title AS b FROM courses WHERE (cover_key = ?1 OR edm_key = ?1) AND status = 'published' LIMIT 1");
  const ln = !c ? await one("SELECT c.id AS a, c.title || ' › ' || l.title AS b FROM lessons l JOIN courses c ON c.id = l.course_id WHERE l.cover_key = ?1 AND c.status = 'published' LIMIT 1") : null;
  const sr = !c && !ln ? await one("SELECT series AS a, series AS b FROM series_art WHERE cover_key = ?1 OR edm_key = ?1 LIMIT 1") : null;
  const ct = !c && !ln && !sr ? await one("SELECT center_key AS a, center_key AS b FROM center_art WHERE cover_key = ?1 OR edm_key = ?1 LIMIT 1") : null;
  const br = !c && !ln && !sr && !ct ? await one("SELECT id AS a, name AS b FROM brand_logos WHERE logo_key = ?1 OR bg_key = ?1 LIMIT 1") : null;
  const sc = !c && !ln && !sr && !ct && !br ? await one("SELECT center_key AS a, ym AS b FROM center_schedules WHERE image_key = ?1 LIMIT 1") : null;
  if (c) owner = { kind: "course", key: c.b ?? "", label: c.b ?? "", courseId: c.a ?? undefined };
  else if (ln) owner = { kind: "course", key: ln.b ?? "", label: ln.b ?? "", courseId: ln.a ?? undefined };
  else if (sr) owner = { kind: "series", key: sr.a ?? "", label: sr.a ?? "" };
  else if (ct) owner = { kind: "center", key: ct.a ?? "", label: ct.a ?? "" };
  else if (br) owner = { kind: "course", key: `品牌：${br.b ?? ""}`, label: br.b ?? "" };
  else if (sc) owner = { kind: "center", key: `${sc.a ?? ""} ${sc.b ?? ""} 課表`, label: sc.a ?? "" };
  const head = await ctx.env.MEDIA?.head(k).catch(() => null);
  if (!head && !owner) return fail(404, "not_found", "找不到這張圖片的資料");
  return {
    id: k,
    kind: "image",
    scope: "cover",
    width: 0,
    height: 0,
    durationSec: 0,
    bytes: head?.size ?? 0,
    position: 0,
    ownerKind: owner?.kind ?? "course",
    ownerKey: owner?.key ?? "",
    uploader: "",
    uploaderSub: "",
    uploadedAt: (head as { uploaded?: Date } | null | undefined)?.uploaded?.toISOString() ?? "",
    courseId: owner?.courseId ?? null,
    courseTitle: owner?.kind === "course" ? owner.label : null,
    ocrStatus: "none",
    ocrModel: "",
    ocrAt: null,
    eventDate: null,
    ocrText: "",
    structured: { fields: null, other: "", stale: false },
    stored: await storedInfo(ctx.env, k, head?.size ?? 0),
    file: { type: head?.httpMetadata?.contentType ?? "", bytes: head?.size ?? 0 },
    exif: {},
    basic: true,
  };
}

/**
 * 區塊照片（杜杜龍 2026-11-24）：cover_media 的 course 類，owner_key 除了課程編號，也可以是「區塊編號」（該區塊底下的照片，與中心 EDM 共用上傳模組）。
 * 回傳要檢查權限的課程編號；區塊所屬課程沒有開放（courses.block_photos）就擋下。連結區塊要傳來源區塊編號（照片只存來源一份）。
 */
export async function courseOfCoverKey(db: D1Database, key: string): Promise<string> {
  if (await db.prepare("SELECT 1 AS ok FROM courses WHERE id = ?").bind(key).first()) return key;
  const blk = await db.prepare("SELECT l.course_id, c.block_photos FROM lessons l JOIN courses c ON c.id = l.course_id WHERE l.id = ? AND l.kind = 'section'").bind(key).first<{ course_id: string; block_photos: number }>();
  if (!blk) return key;
  if (blk.block_photos !== 1) fail(403, "block_photos_off", "這門課程還沒有開放區塊新增照片");
  return blk.course_id;
}
// 照片張數不設上限（杜杜龍 2026-11-25）。
export async function coverRoom(_db: D1Database, _o: { kind: CoverMediaKind; lookup: string; scope: CoverScope }): Promise<void> {}
export async function addCoverRow(db: D1Database, o: { s: Session; kind: CoverMediaKind; centerKey: string | null; ownerKey: string; scope: CoverScope }, x: { kind: "image" | "video"; r2Key: string; posterKey: string | null; width: number; height: number; durationSec: number; bytes: number; by: string }): Promise<string> {
  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const where = o.kind === "center" ? "owner_kind = 'center' AND center_key = ?" : "owner_kind = ? AND owner_key = ?";
  const st = db.prepare(`SELECT COALESCE(MAX(position), -1) + 1 AS p FROM cover_media WHERE ${where} AND scope = ?`);
  const pos = (await (o.kind === "center" ? st.bind(o.centerKey, o.scope) : st.bind(o.kind, o.ownerKey, o.scope)).first<{ p: number }>())?.p ?? 0;
  await db.batch([
    db.prepare("INSERT INTO cover_media (id, owner_kind, center_key, owner_key, kind, r2_key, poster_key, width, height, duration_sec, bytes, position, created_by, scope) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id, o.kind, o.centerKey, o.ownerKey, x.kind, x.r2Key, x.posterKey, x.width, x.height, x.durationSec, x.bytes, pos, x.by, o.scope),
    db.prepare("UPDATE cover_media SET uploader_name = ?, uploader_avatar = ? WHERE id = ?").bind((o.s.name ?? "").slice(0, 60), o.s.kind === "central" ? (o.s.avatarUrl ?? "").slice(0, 500) : "", id),
    audit(db, x.by, "cover_media.add", o.kind, o.centerKey ?? o.ownerKey, id),
    ...(o.ownerKey.startsWith("rcp:") ? [db.prepare("UPDATE cover_media SET ocr_status = 'skip' WHERE id = ?").bind(id)] : []), // 食譜照片不做文字辨識（只做場景）
  ]);
  return id;
}

/** 縮圖符號的權限：課程＝能編輯那門課的人；系列＝超級管理員；中心＝該中心的編輯者（與中心封面相同）。 */
export async function thumbBadgeTarget(ctx: Ctx, kindRaw: unknown, keyRaw: unknown): Promise<{ s: Session; kind: ThumbBadgeKind; key: string }> {
  const kind = THUMB_BADGE_KINDS.find((k) => k === kindRaw) ?? fail(400, "invalid_kind", "種類不正確");
  const raw = typeof keyRaw === "string" ? keyRaw.trim().slice(0, 100) : "";
  if (!raw) fail(400, "key_required", "缺少對象");
  if (kind === "course") {
    if (!(await ctx.db.prepare("SELECT 1 AS ok FROM courses WHERE id = ?").bind(raw).first())) fail(404, "not_found", "找不到這門課程");
    await requireCourseArt(ctx, requireMember(ctx), raw);
    return { s: requireMember(ctx), kind, key: raw };
  }
  if (kind === "series") {
    const s = requireSuperAdmin(ctx);
    if (!(await ctx.db.prepare("SELECT 1 AS ok FROM courses WHERE series = ? LIMIT 1").bind(raw).first())) fail(404, "not_found", "找不到這個系列卡");
    return { s, kind, key: raw };
  }
  const { s, center } = await requireCenterArt(ctx, raw);
  return { s, kind, key: center.key };
}
export async function requireCenterArt(ctx: Ctx, label: string | null): Promise<{ s: Session; center: { key: string; label: string } }> {
  const s = requireMember(ctx);
  const rights = await rightsOf(ctx);
  const want = (label ?? "").trim().slice(0, 100);
  if (!want) fail(400, "center_required", "請先選擇中心");
  if (rights.admin) {
    await assertCentralCenters(ctx, [want]);
    return { s, center: { key: centerKey(want), label: want } };
  }
  const mine = rights.center && centerKey(want) === centerKey(rights.center.label);
  if (!mine || !(rights.staff || rights.editor?.editOthers)) fail(403, "forbidden", "只能修改自己中心的 EDM");
  return { s, center: { key: centerKey(rights.center!.label), label: rights.center!.label } };
}

// ---------- admin: courses & lessons ----------

export const THEMES = ["sage", "rose", "gold", "blue", "clay", "violet"];
export function randomId(n: number): string {
  const a = "abcdefghjkmnpqrstuvwxyz23456789";
  return [...crypto.getRandomValues(new Uint8Array(n))].map((b) => a[b % a.length]).join("");
}
/** 活動日期：YYYY-MM-DD 或 null（清除）。 */
