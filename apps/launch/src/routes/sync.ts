/** 行動大學 API 路由：YouTube／雲端硬碟同步與匯入（杜杜龍 2026-11-27 從 api.ts 拆出；順序會影響比對，同一檔內照原本順序）。 */
import { loadFileSettings } from "../material-files.ts";
import { MB, attachmentKeys, audit, deleteR2Files, fail, iso, randomId, readJson, renumber, requireCourseManager, requireCourseStaff, requireDriveSyncManager, requireSuperAdmin, requireSyncManager } from "../api-core.ts";
import type { Handler } from "../api-core.ts";

export const syncRoutes: [string, RegExp, Handler][] = [
  [
    "GET",
    /^\/admin\/youtube-syncs$/,
    async (ctx) => {
      requireSuperAdmin(ctx);
      const { results } = await ctx.db
        .prepare("SELECT y.id, y.label, y.url, y.course_id AS courseId, c.title AS courseTitle, y.title_prefix AS titlePrefix, y.title_format AS titleFormat, y.strip_text AS stripText, y.sort_mode AS sortMode, y.sort_locked AS sortLocked, y.use_app_player AS appPlayer, y.last_synced_at AS lastSyncedAt, y.last_imported AS lastImported, y.last_note AS lastNote FROM youtube_syncs y JOIN courses c ON c.id = y.course_id ORDER BY y.created_at")
        .all<{ id: string; label: string; url: string; courseId: string; courseTitle: string; titlePrefix: string; titleFormat: string; stripText: string; sortMode: string; appPlayer: number; sortLocked: number; lastSyncedAt: string | null; lastImported: number; lastNote: string }>();
      const { defaultSyncFormat, SYNC_FORMAT_HELP, SYNC_SORT_LABEL } = await import("../imports.ts");
      return { syncs: results.map((r) => ({ ...r, titleFormat: r.titleFormat || defaultSyncFormat(r.titlePrefix) })), keyReady: !!ctx.env.YOUTUBE_API_KEY, formatHelp: SYNC_FORMAT_HELP, sortLabels: SYNC_SORT_LABEL };
    },
  ],
  [
    "POST",
    /^\/admin\/youtube-syncs\/preview$/,
    async (ctx) => {
      // 預覽匯入後的教材名稱（杜杜龍 2026-11-23）：純文字清單、不寫入任何資料；命名邏輯與匯入共用（syncNamesFor）。
      const body = await readJson<{ url?: unknown; courseId?: unknown; titleFormat?: unknown; stripText?: unknown; titlePrefix?: unknown }>(ctx.req);
      if (typeof body.courseId === "string" && body.courseId) await requireCourseManager(ctx, body.courseId);
      else requireSuperAdmin(ctx);
      const { playlistIdOf, readPlaylist, defaultSyncFormat, syncNamesFor, parseStrip } = await import("../imports.ts");
      const playlistId = typeof body.url === "string" ? playlistIdOf(body.url) : null;
      if (!playlistId) return fail(400, "invalid_playlist", "請貼上 YouTube 播放清單的網址（網址裡要有 list=…）");
      if (!ctx.env.YOUTUBE_API_KEY) return fail(503, "youtube_key_missing", "尚未設定 YouTube 金鑰，無法預覽");
      const have = new Set<string>();
      if (typeof body.courseId === "string" && body.courseId) {
        const { existingVideoIds } = await import("../imports.ts");
        for (const id of await existingVideoIds(ctx.db, body.courseId)) have.add(id);
      }
      const read = await readPlaylist(ctx.env.YOUTUBE_API_KEY, playlistId, have);
      if ("error" in read) return fail(502, "playlist_unreadable", read.error);
      const fmt = (typeof body.titleFormat === "string" ? body.titleFormat.trim() : "").slice(0, 120) || defaultSyncFormat(typeof body.titlePrefix === "string" ? body.titlePrefix.trim().slice(0, 80) : "");
      const items = [...read.items].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
      const existing = new Set<string>();
      if (typeof body.courseId === "string" && body.courseId) for (const r of (await ctx.db.prepare("SELECT title FROM lessons WHERE course_id = ?").bind(body.courseId).all<{ title: string }>()).results) existing.add(r.title);
      const names = syncNamesFor(items, fmt, parseStrip(typeof body.stripText === "string" ? body.stripText : ""), existing);
      return { total: items.length, names: names.slice(0, 30) };
    },
  ],
  [
    "POST",
    /^\/admin\/youtube-syncs$/,
    async (ctx) => {
      // 新增一份同步設定（杜杜龍 2026-11-20，超級管理員）：貼播放清單網址，選「放進哪一張教材卡」（或直接新建一張）與教材名稱前綴。
      // 課程頁的「匯入 YouTube 播放清單」（杜杜龍 2026-11-23）：有該課程修改權限的人也能為「這張卡」新增並立刻匯入（syncNow）；新建教材卡仍只有超級管理員。
      const body = await readJson<{ url?: unknown; courseId?: unknown; newCardTitle?: unknown; titlePrefix?: unknown; titleFormat?: unknown; stripText?: unknown; sortMode?: unknown; label?: unknown; syncNow?: unknown; appPlayer?: unknown }>(ctx.req);
      const s = typeof body.courseId === "string" && body.courseId ? await requireCourseManager(ctx, body.courseId) : requireSuperAdmin(ctx);
      const { playlistIdOf, defaultSyncFormat, asSortMode } = await import("../imports.ts");
      const playlistId = typeof body.url === "string" ? playlistIdOf(body.url) : null;
      if (!playlistId) return fail(400, "invalid_playlist", "請貼上 YouTube 播放清單的網址（網址裡要有 list=…）");
      let courseId = typeof body.courseId === "string" ? body.courseId : "";
      const newTitle = typeof body.newCardTitle === "string" ? body.newCardTitle.trim().slice(0, 80) : "";
      if (!courseId && !newTitle) return fail(400, "card_required", "請選擇要放進的教材卡，或輸入新教材卡的名稱");
      if (courseId && !(await ctx.db.prepare("SELECT 1 AS ok FROM courses WHERE id = ?").bind(courseId).first())) return fail(404, "not_found", "找不到這張教材卡");
      if (!courseId) {
        // 新建一張教材卡：獨立一張（沒有系列）、已上架、所有會員可看、免費；其餘到教材卡的設定裡調整。
        courseId = `c${randomId(7)}`;
        const max = await ctx.db.prepare("SELECT COALESCE(MAX(sort_order), 0) AS m FROM courses").first<{ m: number }>();
        await ctx.db.batch([
          ctx.db.prepare("INSERT INTO courses (id, sort_order, status, created_by_sub, edited_by_name, edited_at, title, is_list, view_scope, is_public, allow_president, zone, price_twd, min_rank_code, series) VALUES (?, ?, 'published', ?, ?, ?, ?, 0, 'members', 0, 1, 'hglobal', 0, 'none', '')").bind(courseId, (max?.m ?? 0) + 1, s.sub, s.name.slice(0, 60), iso(), newTitle),
          audit(ctx.db, s.sub, "course.create", "course", courseId, newTitle),
        ]);
      }
      const prefix = (typeof body.titlePrefix === "string" ? body.titlePrefix.trim() : "").slice(0, 80) || newTitle;
      const id = `ys${randomId(8)}`;
      const format = (typeof body.titleFormat === "string" ? body.titleFormat.trim() : "").slice(0, 120) || defaultSyncFormat(prefix);
      await ctx.db.prepare("INSERT INTO youtube_syncs (id, label, url, playlist_id, course_id, title_prefix, title_format, sort_mode, strip_text, use_app_player) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id, typeof body.label === "string" ? body.label.trim().slice(0, 60) : "", String(body.url).trim().slice(0, 300), playlistId, courseId, prefix, format, asSortMode(body.sortMode), typeof body.stripText === "string" ? body.stripText.slice(0, 300) : "", body.appPlayer === false ? 0 : 1).run();
      await audit(ctx.db, s.sub, "youtube_sync.create", "youtube_sync", id, playlistId).run();
      if (body.syncNow === true) {
        const { runYoutubeSync } = await import("../imports.ts");
        const out = await runYoutubeSync(ctx.env, id);
        return { id, courseId, imported: out.imported, note: out.note };
      }
      return { id, courseId };
    },
  ],
  [
    "POST",
    /^\/admin\/youtube-syncs\/([\w-]+)\/sync$/,
    async (ctx, [id]) => {
      await requireSyncManager(ctx, id!);
      const { runYoutubeSync } = await import("../imports.ts");
      const out = await runYoutubeSync(ctx.env, id!);
      return out;
    },
  ],
  [
    "PATCH",
    /^\/admin\/youtube-syncs\/([\w-]+)$/,
    async (ctx, [id]) => {
      // 修改這份同步的規則：命名規則、排序規則、解除手動排序鎖定（杜杜龍 2026-11-20）。命名只影響之後匯入的；已匯入的要按「依規則重新命名」。
      const s = await requireSyncManager(ctx, id!);
      const body = await readJson<{ titleFormat?: unknown; stripText?: unknown; sortMode?: unknown; unlock?: unknown; appPlayer?: unknown }>(ctx.req);
      if (typeof body.appPlayer === "boolean") await ctx.db.prepare("UPDATE youtube_syncs SET use_app_player = ? WHERE id = ?").bind(body.appPlayer ? 1 : 0, id).run();
      if (typeof body.stripText === "string") await ctx.db.prepare("UPDATE youtube_syncs SET strip_text = ? WHERE id = ?").bind(body.stripText.slice(0, 300), id).run();
      const { asSortMode } = await import("../imports.ts");
      const format = typeof body.titleFormat === "string" ? body.titleFormat.trim().slice(0, 120) : "";
      if (body.titleFormat !== undefined && !format) return fail(400, "format_required", "請輸入命名規則");
      if (format) await ctx.db.prepare("UPDATE youtube_syncs SET title_format = ? WHERE id = ?").bind(format, id).run();
      if (body.sortMode !== undefined) await ctx.db.prepare("UPDATE youtube_syncs SET sort_mode = ? WHERE id = ?").bind(asSortMode(body.sortMode), id).run();
      if (body.unlock === true) await ctx.db.prepare("UPDATE youtube_syncs SET sort_locked = 0 WHERE id = ?").bind(id).run();
      await audit(ctx.db, s.sub, "youtube_sync.rules", "youtube_sync", id!, JSON.stringify({ f: format || undefined, m: body.sortMode, u: body.unlock })).run();
      return { ok: true };
    },
  ],
  [
    "POST",
    /^\/admin\/youtube-syncs\/([\w-]+)\/rename$/,
    async (ctx, [id]) => {
      await requireSyncManager(ctx, id!);
      const { renameYoutubeSync } = await import("../imports.ts");
      return renameYoutubeSync(ctx.env, id!);
    },
  ],
  [
    "POST",
    /^\/admin\/youtube-syncs\/([\w-]+)\/delete-with-materials$/,
    async (ctx, [id]) => {
      // 刪除清單與關聯教材（杜杜龍 2026-11-23）：重新讀播放清單，這張卡裡來源是清單內影片的 YouTube 教材全部刪除，再刪同步設定。
      // 讀不到播放清單就整個不動（避免只刪一半）；教材沒有記錄「是哪份同步匯入的」，所以以影片編號比對。
      const s = await requireSyncManager(ctx, id!);
      const sync = await ctx.db.prepare("SELECT course_id, playlist_id FROM youtube_syncs WHERE id = ?").bind(id).first<{ course_id: string; playlist_id: string }>();
      if (!sync) return fail(404, "not_found", "找不到這份同步設定");
      if (!ctx.env.YOUTUBE_API_KEY) return fail(503, "youtube_key_missing", "尚未設定 YouTube 金鑰，無法判斷哪些教材屬於這份清單；請改用「只刪除清單」");
      const { readPlaylist } = await import("../imports.ts");
      const read = await readPlaylist(ctx.env.YOUTUBE_API_KEY, sync.playlist_id, new Set());
      if ("error" in read) return fail(502, "playlist_unreadable", `${read.error}；為了不誤刪，什麼都沒有刪除`);
      const vids = read.items.map((i) => i.id);
      const files: string[] = [];
      let deleted = 0;
      for (let i = 0; i < vids.length; i += 60) {
        const chunk = vids.slice(i, i + 60);
        const marks = chunk.map(() => "?").join(",");
        const { results } = await ctx.db.prepare(`SELECT id, cover_key, poster_key FROM lessons WHERE course_id = ? AND kind = 'material' AND media_type = 'youtube' AND media_ref IN (${marks})`).bind(sync.course_id, ...chunk).all<{ id: string; cover_key: string | null; poster_key: string | null }>();
        for (const r of results) {
          files.push(...(await attachmentKeys(ctx.db, "lesson_id", r.id)), ...[r.cover_key, r.poster_key].filter((k): k is string => !!k));
        }
        if (results.length) await ctx.db.batch(results.map((r) => ctx.db.prepare("DELETE FROM lessons WHERE id = ?").bind(r.id)));
        deleted += results.length;
      }
      await ctx.db.batch([ctx.db.prepare("DELETE FROM youtube_syncs WHERE id = ?").bind(id), audit(ctx.db, s.sub, "youtube_sync.delete_with_materials", "youtube_sync", id!, String(deleted))]);
      await renumber(ctx.db, sync.course_id);
      await deleteR2Files(ctx.env, files);
      return { ok: true, deleted };
    },
  ],
  [
    "DELETE",
    /^\/admin\/youtube-syncs\/([\w-]+)$/,
    async (ctx, [id]) => {
      await requireSyncManager(ctx, id!);
      await ctx.db.prepare("DELETE FROM youtube_syncs WHERE id = ?").bind(id).run();
      return { ok: true };
    },
  ],
  [
    "GET",
    /^\/admin\/drive-syncs$/,
    async (ctx) => {
      // 設定 › 同步雲端資料夾（杜杜龍 2026-11-26，超級管理員）：列出所有同步設定與每份「已同步幾項」。
      requireSuperAdmin(ctx);
      const { results } = await ctx.db
        .prepare("SELECT d.id, d.label, d.url, d.course_id AS courseId, c.title AS courseTitle, d.block_id AS blockId, COALESCE(b.title, '') AS blockTitle, d.title_format AS titleFormat, d.last_synced_at AS lastSyncedAt, d.last_imported AS lastImported, d.last_total AS lastTotal, d.last_note AS lastNote FROM drive_syncs d JOIN courses c ON c.id = d.course_id LEFT JOIN lessons b ON b.id = d.block_id ORDER BY d.created_at")
        .all<{ id: string }>();
      const { DRIVE_FORMAT_HELP, PLATINUM_FORMAT, getAutoSync } = await import("../drive-sync.ts");
      return { syncs: results, keyReady: !!ctx.env.GOOGLE_DRIVE_API_KEY, formatHelp: DRIVE_FORMAT_HELP, platinumFormat: PLATINUM_FORMAT, weekly: (await getAutoSync(ctx.db)).weekly };
    },
  ],
  [
    "POST",
    /^\/admin\/drive-syncs$/,
    async (ctx) => {
      const body = await readJson<{ url?: unknown; courseId?: unknown; blockId?: unknown; titleFormat?: unknown; label?: unknown; syncNow?: unknown }>(ctx.req);
      const s = typeof body.courseId === "string" && body.courseId ? await requireCourseManager(ctx, body.courseId) : requireSuperAdmin(ctx);
      const { folderIdOf } = await import("../drive-sync.ts");
      const folderId = typeof body.url === "string" ? folderIdOf(body.url) : null;
      if (!folderId) return fail(400, "invalid_folder", "請貼上 Google 雲端資料夾的連結（網址裡要有 /folders/…）");
      const courseId = typeof body.courseId === "string" ? body.courseId : "";
      if (!courseId || !(await ctx.db.prepare("SELECT 1 AS ok FROM courses WHERE id = ?").bind(courseId).first())) return fail(400, "card_required", "請選擇要放進的教材卡");
      const blockId = typeof body.blockId === "string" ? body.blockId : "";
      if (blockId && !(await ctx.db.prepare("SELECT 1 AS ok FROM lessons WHERE id = ? AND course_id = ? AND kind = 'section'").bind(blockId, courseId).first())) return fail(400, "block_not_found", "找不到這個區塊");
      const id = `ds${randomId(8)}`;
      const format = (typeof body.titleFormat === "string" ? body.titleFormat.trim() : "").slice(0, 120) || "{標題}";
      await ctx.db.prepare("INSERT INTO drive_syncs (id, label, url, folder_id, course_id, block_id, title_format) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(id, typeof body.label === "string" ? body.label.trim().slice(0, 60) : "", String(body.url).trim().slice(0, 300), folderId, courseId, blockId, format).run();
      await audit(ctx.db, s.sub, "drive_sync.create", "drive_sync", id, folderId).run();
      if (body.syncNow === true) {
        const { runDriveSync } = await import("../drive-sync.ts");
        return { id, ...(await runDriveSync(ctx.env, id)) };
      }
      return { id };
    },
  ],
  [
    "POST",
    /^\/admin\/drive-syncs\/([\w-]+)\/sync$/,
    async (ctx, [id]) => {
      await requireDriveSyncManager(ctx, id!);
      const { runDriveSync } = await import("../drive-sync.ts");
      return runDriveSync(ctx.env, id!);
    },
  ],
  [
    "PATCH",
    /^\/admin\/drive-syncs\/([\w-]+)$/,
    async (ctx, [id]) => {
      const s = await requireDriveSyncManager(ctx, id!);
      const body = await readJson<{ titleFormat?: unknown; blockId?: unknown; label?: unknown }>(ctx.req);
      const cur = await ctx.db.prepare("SELECT course_id FROM drive_syncs WHERE id = ?").bind(id).first<{ course_id: string }>();
      if (!cur) return fail(404, "not_found", "找不到這份同步設定");
      if (typeof body.titleFormat === "string") {
        const f = body.titleFormat.trim().slice(0, 120);
        if (!f) return fail(400, "format_required", "請輸入命名規則");
        await ctx.db.prepare("UPDATE drive_syncs SET title_format = ? WHERE id = ?").bind(f, id).run();
      }
      if (typeof body.blockId === "string") {
        if (body.blockId && !(await ctx.db.prepare("SELECT 1 AS ok FROM lessons WHERE id = ? AND course_id = ? AND kind = 'section'").bind(body.blockId, cur.course_id).first())) return fail(400, "block_not_found", "找不到這個區塊");
        await ctx.db.prepare("UPDATE drive_syncs SET block_id = ? WHERE id = ?").bind(body.blockId, id).run();
      }
      if (typeof body.label === "string") await ctx.db.prepare("UPDATE drive_syncs SET label = ? WHERE id = ?").bind(body.label.trim().slice(0, 60), id).run();
      await audit(ctx.db, s.sub, "drive_sync.rules", "drive_sync", id!, "").run();
      return { ok: true };
    },
  ],
  [
    "POST",
    /^\/admin\/drive-syncs\/([\w-]+)\/delete-with-materials$/,
    async (ctx, [id]) => {
      // 刪除清單與關聯教材：重新讀資料夾，這張卡裡連結指向資料夾內檔案的教材全部刪除，再刪同步設定。讀不到就整個不動。
      const s = await requireDriveSyncManager(ctx, id!);
      const sync = await ctx.db.prepare("SELECT course_id, folder_id FROM drive_syncs WHERE id = ?").bind(id).first<{ course_id: string; folder_id: string }>();
      if (!sync) return fail(404, "not_found", "找不到這份同步設定");
      if (!ctx.env.GOOGLE_DRIVE_API_KEY) return fail(503, "drive_key_missing", "尚未設定 Google Drive 金鑰，無法判斷哪些教材屬於這個資料夾；請改用「只刪除清單」");
      const { readDriveFolder } = await import("../drive-sync.ts");
      const read = await readDriveFolder(ctx.env.GOOGLE_DRIVE_API_KEY, sync.folder_id);
      if ("error" in read) return fail(502, "folder_unreadable", `${read.error}；為了不誤刪，什麼都沒有刪除`);
      let deleted = 0;
      for (const f of read.files) {
        const row = await ctx.db.prepare("SELECT lesson_id FROM lesson_attachments WHERE course_id = ? AND kind = 'link' AND link_url LIKE ?").bind(sync.course_id, `https://drive.google.com/file/d/${f.id}/%`).first<{ lesson_id: string }>();
        if (!row) continue;
        await ctx.db.prepare("DELETE FROM lessons WHERE id = ? AND kind = 'material'").bind(row.lesson_id).run();
        deleted++;
      }
      await ctx.db.batch([ctx.db.prepare("DELETE FROM drive_syncs WHERE id = ?").bind(id), audit(ctx.db, s.sub, "drive_sync.delete_with_materials", "drive_sync", id!, String(deleted))]);
      await renumber(ctx.db, sync.course_id);
      return { ok: true, deleted };
    },
  ],
  [
    "DELETE",
    /^\/admin\/drive-syncs\/([\w-]+)$/,
    async (ctx, [id]) => {
      await requireDriveSyncManager(ctx, id!);
      await ctx.db.prepare("DELETE FROM drive_syncs WHERE id = ?").bind(id).run();
      return { ok: true };
    },
  ],
  [
    "GET",
    /^\/admin\/sync-settings$/,
    async (ctx) => {
      requireSuperAdmin(ctx);
      const { getAutoSync } = await import("../drive-sync.ts");
      return getAutoSync(ctx.db);
    },
  ],
  [
    "PUT",
    /^\/admin\/sync-settings$/,
    async (ctx) => {
      // 自動同步開關（杜杜龍 2026-11-26）：YouTube 清單與雲端資料夾共用，開＝每週自動同步一次。
      const s = requireSuperAdmin(ctx);
      const body = await readJson<{ weekly?: unknown }>(ctx.req);
      const { setAutoSync } = await import("../drive-sync.ts");
      await setAutoSync(ctx.db, body.weekly !== false);
      await audit(ctx.db, s.sub, "sync_settings.update", "sync_settings", "auto", body.weekly === false ? "off" : "weekly").run();
      return { weekly: body.weekly !== false };
    },
  ],
  [
    "GET",
    /^\/admin\/drive-import\/config$/,
    async (ctx) => {
      // 「從我的 Google 雲端硬碟選擇」需要的公開設定（OAuth 用戶端 ID、Picker 金鑰、專案編號）；缺任何一個＝這個來源尚未啟用。
      await requireCourseStaff(ctx);
      const set = await loadFileSettings(ctx.db);
      const { GOOGLE_CLIENT_ID: clientId, GOOGLE_PICKER_API_KEY: apiKey, GOOGLE_PROJECT_NUMBER: appId } = ctx.env;
      return { ready: !!(clientId && apiKey && appId), clientId: clientId ?? "", apiKey: apiKey ?? "", appId: appId ?? "", maxBytes: set.importMaxMb * MB };
    },
  ],
  [
    "GET",
    /^\/admin\/drive-import\/progress$/,
    async (ctx) => {
      // 匯入的轉存進度（畫面每秒查一次）：只有發起的人查得到；total＝0 代表大小未知（例如 Google 文件轉檔）。
      const me = await requireCourseStaff(ctx);
      const row = await ctx.db.prepare("SELECT written, total FROM import_progress WHERE id = ? AND member_sub = ?").bind(ctx.url.searchParams.get("id") ?? "", me.sub).first<{ written: number; total: number }>();
      return row ?? { written: 0, total: 0 };
    },
  ],
];
