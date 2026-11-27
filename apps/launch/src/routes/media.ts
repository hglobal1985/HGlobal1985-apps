/** 行動大學 API 路由：圖片與相簿：封面、相簿、縮圖、短網址、圖片資訊（杜杜龍 2026-11-27 從 api.ts 拆出；順序會影響比對，同一檔內照原本順序）。 */
import { reserveThumb, thumbUsage } from "../thumb-quota.ts";
import { scenePending } from "../scene-vision.ts";
import { photoOcrPending } from "../photo-ocr.ts";
import { loadJob, recompressStatus, runRecompress, saveJob } from "../recompress.ts";
import { renameForType, shrinkImage } from "../image-store.ts";
import { HQ_SLUG, RESERVED_SLUGS, SLUG_RE } from "../short-links.ts";
import { urlNameVariants } from "../romanize.ts";
import { type ThumbBadge, type ThumbBadgeKind, type ThumbBadgeRow, THUMB_WIDE_WIDTHS, type CoverMediaKind, type CoverScope, type AlbumInfo, type AlbumSubfolders, type AlbumPermissions } from "../contract.ts";
import { isRecipePrefix, recipeByShortPath } from "../recipes.ts";
import { centerKey, centerList } from "../central.ts";
import { LINK_DEFAULT_TITLE, classifyLink, parseHttpsUrl } from "../links.ts";
import { fetchLinkInfo } from "../link-title.ts";
import { loadFileSettings, normalizeFileSettings, saveFileSettings } from "../material-files.ts";
import type { StorageKind } from "../files.ts";
import { isCoverKey, isKeyInUse, listInUseCards, listUnusedCovers, type InUseCard } from "../cover-library.ts";
import { ocrEdmImage, ocrPending } from "../edm-vision.ts";
import { loadConfig } from "../ui-config.ts";
import { imageSize } from "../image-size.ts";
import { sniffImage, verifyAudioUrl } from "../media.ts";
import { listMuxAssets, MuxApiError } from "../mux.ts";
import { type CoverRow, FOLDER_NAME_MAX, addCoverRow, albumPermMap, albumRefOf, albumsIndex, assertCentralCenters, audit, backfillCourseUrls, coverItem, coverItems, coverKindOf, coverMediaInfo, coverRoom, dim, fail, fillImageDims, imageInfoByKey, isBlockKey, iso, keywordKind, keywordText, listShortLinks, pubUrl, putInFolder, randomId, ranks, readJson, reconcileCenterEdm, requireCoverOwner, requireCoverRowOwner, requireFolderManage, requireMember, requireSuperAdmin, rightsOf, slugTarget, subfoldersOf, text, thumbBadgeTarget, thumbFormat, thumbOutput, thumbSig, thumbTransform } from "../api-core.ts";
import type { Handler } from "../api-core.ts";

export const mediaRoutes: [string, RegExp, Handler][] = [
  [
    "GET",
    /^\/list-cover-bgs$/,
    async (ctx) => {
      // 清單文字封面可選的底圖（管理員在「設定 › 清單封面底圖」上傳；所有登入會員都能選）。
      requireMember(ctx);
      const { results } = await ctx.db.prepare("SELECT id, name, image_key, art_version FROM list_cover_bgs ORDER BY sort_order, created_at").all<{ id: string; name: string; image_key: string; art_version: number }>();
      return results.map((r) => ({ id: r.id, name: r.name, url: pubUrl(r.image_key, r.art_version) }));
    },
  ],
  [
    "GET",
    /^\/admin\/list-cover-bgs$/,
    async (ctx) => {
      requireSuperAdmin(ctx);
      const { results } = await ctx.db.prepare("SELECT b.id, b.name, b.image_key, b.art_version, (SELECT COUNT(*) FROM my_lists l WHERE l.cover_bg_id = b.id AND l.cover_mode = 'text') AS used FROM list_cover_bgs b ORDER BY b.sort_order, b.created_at").all<{ id: string; name: string; image_key: string; art_version: number; used: number }>();
      return results.map((r) => ({ id: r.id, name: r.name, url: pubUrl(r.image_key, r.art_version), used: r.used }));
    },
  ],
  [
    "POST",
    /^\/admin\/list-cover-bgs$/,
    async (ctx) => {
      // 上傳一張清單專用封面底圖（原始檔放在請求內容，名稱放網址參數 name）。
      const s = requireSuperAdmin(ctx);
      const bucket = ctx.env.MEDIA ?? fail(503, "storage_not_ready", "圖片儲存空間尚未啟用");
      const data = new Uint8Array(await ctx.req.arrayBuffer());
      const max = 8 * 1024 * 1024;
      if (!data.byteLength || data.byteLength > max) fail(413, "invalid_size", `圖片大小需在 ${max / 1024 / 1024}MB 以內`);
      const img = sniffImage(data) ?? fail(400, "invalid_image", "請上傳 JPG、PNG 或 WebP 圖片");
      const name = (text(ctx.url.searchParams.get("name"), 30) ?? "").trim() || "未命名底圖";
      const id = `g${randomId(7)}`;
      const shrunk = await shrinkImage(ctx.env, data.buffer as ArrayBuffer, img.type, "general");
      const key = `listbg/${id}/${crypto.randomUUID()}.${renameForType(`x.${img.ext}`, shrunk.type).split(".").pop()}`;
      await bucket.put(key, shrunk.data, { httpMetadata: { contentType: shrunk.type } });
      const max2 = await ctx.db.prepare("SELECT COALESCE(MAX(sort_order), 0) AS m FROM list_cover_bgs").first<{ m: number }>();
      await ctx.db.batch([ctx.db.prepare("INSERT INTO list_cover_bgs (id, name, image_key, sort_order) VALUES (?, ?, ?, ?)").bind(id, name, key, (max2?.m ?? 0) + 1), audit(ctx.db, s.sub, "list_bg.create", "list_cover_bg", id, name)]);
      return { id };
    },
  ],
  [
    "PATCH",
    /^\/admin\/list-cover-bgs\/(g[\w]{4,20})$/,
    async (ctx, [id]) => {
      const s = requireSuperAdmin(ctx);
      const body = await readJson<{ name?: unknown }>(ctx.req);
      const name = text(body.name, 30);
      if (!name) return fail(400, "name_required", "請輸入底圖名稱");
      const r = await ctx.db.prepare("UPDATE list_cover_bgs SET name = ? WHERE id = ?").bind(name, id).run();
      if (r.meta?.changes === 0) return fail(404, "not_found", "找不到這張底圖");
      await audit(ctx.db, s.sub, "list_bg.rename", "list_cover_bg", id, name).run();
      return { ok: true };
    },
  ],
  [
    "DELETE",
    /^\/admin\/list-cover-bgs\/(g[\w]{4,20})$/,
    async (ctx, [id]) => {
      // 刪除底圖：正在用它的文字封面改回純色，檔案一併從雲端儲存刪除。
      const s = requireSuperAdmin(ctx);
      const old = await ctx.db.prepare("SELECT image_key FROM list_cover_bgs WHERE id = ?").bind(id).first<{ image_key: string }>();
      if (!old) return fail(404, "not_found", "找不到這張底圖");
      await ctx.db.batch([ctx.db.prepare("UPDATE my_lists SET cover_bg_id = NULL WHERE cover_bg_id = ?").bind(id), ctx.db.prepare("DELETE FROM list_cover_bgs WHERE id = ?").bind(id), audit(ctx.db, s.sub, "list_bg.delete", "list_cover_bg", id)]);
      await ctx.env.MEDIA?.delete(old.image_key).catch(() => undefined);
      return { ok: true };
    },
  ],
  [
    "GET",
    /^\/short-links$/,
    async (ctx) => (await ctx.db.prepare("SELECT kind, value, slug FROM short_links ORDER BY kind, slug").all<{ kind: string; value: string; slug: string }>()).results,
  ],
  // ---------- 封面輪播與相簿（杜杜龍 2026-11-21）：中心、系列、課程共用 cover_media ----------
  [
    "GET",
    /^\/cover-media$/,
    async (ctx) => {
      // 公開：封面輪播與中心「相簿」讀同一份資料。?kind=center|series|course&key=中心名稱|系列名稱|課程編號
      const kind = coverKindOf(ctx.url.searchParams.get("kind"));
      const key = (ctx.url.searchParams.get("key") ?? "").trim().slice(0, 100);
      if (!key) return [];
      // 區塊照片（杜杜龍 2026-11-24）：沒有權限的人也看得到全部預覽縮圖，畫面蓋鎖頭遮罩（LockMask）與原因，所以這裡不再擋清單。
      const lookup = kind === "center" ? centerKey(key) : key;
      if (kind === "center") await reconcileCenterEdm(ctx.db, lookup).catch(() => undefined); // 課程 EDM 自動併入中心 EDM 空間
      await fillImageDims(ctx.env, ctx.db, kind, lookup);
      // 還沒辨識的中心 EDM 圖（舊的、課程併入的）每次讀取在背景補辨識幾張，慢慢補齊。
      if (kind === "center" && ctx.defer) ctx.defer(ocrPending(ctx.env, ctx.db, 2).catch(() => undefined));
      return coverItems(ctx.db, kind, lookup);
    },
  ],
  [
    "GET",
    /^\/albums$/,
    async (ctx) => albumsIndex(ctx),
  ],
  [
    "GET",
    /^\/admin\/albums\/permissions$/,
    async (ctx) => {
      // 相簿「誰可以上傳」總覽（杜杜龍 2026-11-25，只有超級管理員）：各大類別與各資料夾目前的最低獎銜設定。
      requireSuperAdmin(ctx);
      const [idx, perms, rk] = await Promise.all([albumsIndex(ctx), albumPermMap(ctx.db), ranks(ctx.db)]);
      return {
        ranks: [...rk.values()].filter((r) => r.code !== "none").map((r) => ({ code: r.code, name: r.name })),
        groups: [...idx.groups.map((g) => ({ id: g.id, label: g.label, uploadMinRank: perms.get(`group:${g.id}`) ?? "" })), { id: "recipe", label: "食譜（直接發佈、審核投稿、管理分類）", uploadMinRank: perms.get("group:recipe") ?? "" }],
        folders: idx.groups.flatMap((g) => g.folders.map((f) => ({ id: f.id, title: f.title, groupId: g.id, count: f.count, uploadMinRank: perms.get(f.id) ?? null }))),
      } satisfies AlbumPermissions;
    },
  ],
  [
    "PUT",
    /^\/admin\/albums\/permission$/,
    async (ctx) => {
      // 設定某個大類別（group:…）或某個資料夾的最低上傳獎銜；uploadMinRank＝""：只有原本的管理權限；null：資料夾沿用類別設定。
      const s = requireSuperAdmin(ctx);
      const b = await readJson<{ key?: unknown; uploadMinRank?: unknown }>(ctx.req);
      const key = typeof b.key === "string" ? b.key.slice(0, 200) : "";
      if (!/^(group:(edm|cover|series|course|block|treasure|recipe)|(center|series|course|block):.{1,160})$/.test(key)) return fail(400, "invalid_key", "相簿代碼不正確");
      if (b.uploadMinRank === null && !key.startsWith("group:")) {
        await ctx.db.prepare("DELETE FROM album_permissions WHERE key = ?").bind(key).run();
      } else {
        const code = typeof b.uploadMinRank === "string" ? b.uploadMinRank : "";
        if (code && !(await ranks(ctx.db)).has(code)) return fail(400, "invalid_rank", "獎銜不正確");
        await ctx.db.prepare("INSERT INTO album_permissions (key, upload_min_rank, updated_by, updated_at) VALUES (?1, ?2, ?3, datetime('now')) ON CONFLICT(key) DO UPDATE SET upload_min_rank = ?2, updated_by = ?3, updated_at = datetime('now')").bind(key, code, s.sub).run();
      }
      await audit(ctx.db, s.sub, "album.permission", "album", key, String(b.uploadMinRank)).run();
      return { ok: true };
    },
  ],
  [
    "GET",
    /^\/admin\/albums\/info$/,
    async (ctx) => {
      // 相簿資訊總覽（杜杜龍 2026-11-25，只有超級管理員）：R2 佔用、上傳者姓名數量與排名、最近一次上傳、檔案大小排序、瀏覽數排序，以及上傳權限。
      requireSuperAdmin(ctx);
      const id = (ctx.url.searchParams.get("id") ?? "").slice(0, 200);
      const f = (await albumsIndex(ctx)).groups.flatMap((g) => g.folders).find((x) => x.id === id);
      if (!f) return fail(404, "not_found", "找不到這個相簿");
      const where = f.kind === "center" ? "owner_kind = 'center' AND center_key = ? AND scope = ?" : f.kind === "series" ? "owner_kind = 'series' AND owner_key = ?" : "owner_kind = 'course' AND owner_key = ?";
      const args = f.kind === "center" ? [id.split(":").slice(1, -1).join(":"), f.scope ?? "edm"] : [f.key];
      const [tot, up, big, hot, perms] = await Promise.all([
        ctx.db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(bytes), 0) AS bytes, MAX(created_at) AS last FROM cover_media WHERE ${where}`).bind(...args).first<{ n: number; bytes: number; last: string | null }>(),
        ctx.db.prepare(`SELECT COALESCE(NULLIF((SELECT name FROM member_profiles WHERE sub = cm.created_by), ''), NULLIF(MAX(cm.uploader_name), ''), '（不明）') AS name, COUNT(*) AS n, COALESCE(SUM(cm.bytes), 0) AS bytes FROM cover_media cm WHERE ${where} GROUP BY cm.created_by ORDER BY n DESC, bytes DESC LIMIT 30`).bind(...args).all<{ name: string; n: number; bytes: number }>(),
        ctx.db.prepare(`SELECT id, r2_key, bytes FROM cover_media WHERE ${where} AND kind = 'image' ORDER BY bytes DESC LIMIT 10`).bind(...args).all<{ id: string; r2_key: string; bytes: number }>(),
        ctx.db.prepare(`SELECT id, r2_key, views FROM cover_media WHERE ${where} AND kind = 'image' ORDER BY views DESC, created_at DESC LIMIT 10`).bind(...args).all<{ id: string; r2_key: string; views: number }>(),
        albumPermMap(ctx.db),
      ]);
      const own = perms.get(id) ?? null;
      const groupRank = perms.get(`group:${f.groupId}`) ?? "";
      return {
        id,
        title: f.title,
        count: tot?.n ?? 0,
        bytes: tot?.bytes ?? 0,
        lastUploadAt: tot?.last ?? null,
        uploaders: up.results.map((r) => ({ name: r.name, count: r.n, bytes: r.bytes })),
        bySize: big.results.map((r) => ({ id: r.id, url: pubUrl(r.r2_key, 0), bytes: r.bytes })),
        byViews: hot.results.map((r) => ({ id: r.id, url: pubUrl(r.r2_key, 0), views: r.views })),
        uploadMinRank: own,
        effectiveRank: own ?? groupRank,
        groupId: f.groupId,
        groupRank,
      } satisfies AlbumInfo;
    },
  ],
  [
    "POST",
    /^\/cover-media\/([\w-]{1,40})\/view$/,
    async (ctx, [id]) => {
      // 相簿照片瀏覽數 +1（看圖畫面看過一次；同一次開啟網站同一張只送一次，由前端控制）。
      await ctx.db.prepare("UPDATE cover_media SET views = views + 1 WHERE id = ? AND kind = 'image'").bind(id).run();
      return { ok: true };
    },
  ],
  [
    "GET",
    /^\/albums\/subfolders$/,
    async (ctx) => {
      // 區塊相簿的子資料夾（杜杜龍 2026-11-26）：?key＝區塊相簿的照片鍵。
      const key = (ctx.url.searchParams.get("key") ?? "").slice(0, 60);
      if (!key || !(await isBlockKey(ctx.db, key))) return { folders: [], uncat: { count: 0, thumbs: [] }, canManage: false } satisfies AlbumSubfolders;
      return subfoldersOf(ctx, key);
    },
  ],
  [
    "POST",
    /^\/admin\/album-folders$/,
    async (ctx) => {
      const b = await readJson<{ key?: unknown; name?: unknown }>(ctx.req);
      const key = typeof b.key === "string" ? b.key.slice(0, 60) : "";
      const name = typeof b.name === "string" ? b.name.trim() : "";
      if (!key || !(await isBlockKey(ctx.db, key))) return fail(400, "invalid_key", "只有區塊相簿可以建立資料夾");
      const s = await requireFolderManage(ctx, key);
      if (!name) return fail(400, "name_required", "請輸入資料夾名稱");
      if (name.length > FOLDER_NAME_MAX || name === "未分類") return fail(400, "invalid_name", `名稱最多 ${FOLDER_NAME_MAX} 字，且不能叫「未分類」`);
      if (await ctx.db.prepare("SELECT 1 AS ok FROM album_folders WHERE owner_key = ? AND name = ?").bind(key, name).first()) return fail(409, "name_taken", "這個區塊已經有同名的資料夾");
      const id = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
      await ctx.db.prepare("INSERT INTO album_folders (id, owner_key, name, created_by) VALUES (?, ?, ?, ?)").bind(id, key, name, s.sub).run();
      return { id, ...(await subfoldersOf(ctx, key)) };
    },
  ],
  [
    "PUT",
    /^\/admin\/album-folders\/([\w-]{1,40})$/,
    async (ctx, [id]) => {
      const row = await ctx.db.prepare("SELECT owner_key FROM album_folders WHERE id = ?").bind(id).first<{ owner_key: string }>();
      if (!row) return fail(404, "not_found", "找不到這個資料夾");
      await requireFolderManage(ctx, row.owner_key);
      const b = await readJson<{ name?: unknown }>(ctx.req);
      const name = typeof b.name === "string" ? b.name.trim() : "";
      if (!name) return fail(400, "name_required", "請輸入資料夾名稱");
      if (name.length > FOLDER_NAME_MAX || name === "未分類") return fail(400, "invalid_name", `名稱最多 ${FOLDER_NAME_MAX} 字，且不能叫「未分類」`);
      if (await ctx.db.prepare("SELECT 1 AS ok FROM album_folders WHERE owner_key = ? AND name = ? AND id <> ?").bind(row.owner_key, name, id).first()) return fail(409, "name_taken", "這個區塊已經有同名的資料夾");
      await ctx.db.prepare("UPDATE album_folders SET name = ? WHERE id = ?").bind(name, id).run();
      return subfoldersOf(ctx, row.owner_key);
    },
  ],
  [
    "DELETE",
    /^\/admin\/album-folders\/([\w-]{1,40})$/,
    async (ctx, [id]) => {
      // 刪除資料夾：裡面的照片回到「未分類」，不刪照片。
      const row = await ctx.db.prepare("SELECT owner_key FROM album_folders WHERE id = ?").bind(id).first<{ owner_key: string }>();
      if (!row) return fail(404, "not_found", "找不到這個資料夾");
      await requireFolderManage(ctx, row.owner_key);
      await ctx.db.batch([ctx.db.prepare("UPDATE cover_media SET folder_id = '' WHERE folder_id = ? AND owner_key = ?").bind(id, row.owner_key), ctx.db.prepare("DELETE FROM album_folders WHERE id = ?").bind(id)]);
      return subfoldersOf(ctx, row.owner_key);
    },
  ],
  [
    "POST",
    /^\/admin\/album-folders\/move$/,
    async (ctx) => {
      // 把照片移到資料夾（folderId＝null 或 ""：移回未分類）。
      const b = await readJson<{ key?: unknown; ids?: unknown; folderId?: unknown }>(ctx.req);
      const key = typeof b.key === "string" ? b.key.slice(0, 60) : "";
      const ids = Array.isArray(b.ids) ? b.ids.filter((x): x is string => typeof x === "string").slice(0, 500) : [];
      const fid = typeof b.folderId === "string" ? b.folderId : "";
      if (!key || !ids.length || !(await isBlockKey(ctx.db, key))) return fail(400, "invalid_key", "請選擇要移動的照片");
      await requireFolderManage(ctx, key);
      if (fid && !(await ctx.db.prepare("SELECT 1 AS ok FROM album_folders WHERE id = ? AND owner_key = ?").bind(fid, key).first())) return fail(404, "not_found", "找不到這個資料夾");
      await ctx.db.batch(ids.map((id) => ctx.db.prepare("UPDATE cover_media SET folder_id = ? WHERE id = ? AND owner_kind = 'course' AND owner_key = ?").bind(fid, id, key)));
      return subfoldersOf(ctx, key);
    },
  ],
  [
    "GET",
    /^\/albums\/folder$/,
    async (ctx) => {
      // 相簿專區的一個資料夾（杜杜龍 2026-11-25）：沒有權限的人禁止進入（鎖定的課程、區塊相簿回 403 與原因）。
      const id = (ctx.url.searchParams.get("id") ?? "").slice(0, 200);
      const f = (await albumsIndex(ctx)).groups.flatMap((g) => g.folders).find((x) => x.id === id);
      if (!f) return fail(404, "not_found", "找不到這個相簿");
      if (f.locked) return fail(403, "locked", f.lockReason || "沒有權限進入這個相簿");
      const kind: CoverMediaKind = f.kind === "block" ? "course" : f.kind;
      const lookup = f.kind === "center" ? centerKey(f.key) : f.key;
      return { folder: f, items: await coverItems(ctx.db, kind, lookup, f.scope) };
    },
  ],
  [
    "GET",
    /^\/albums\/search$/,
    async (ctx) => {
      // 搜尋「全部相簿」（杜杜龍 2026-11-25）：比對照片的場景標籤、照片文字（OCR）、EDM 活動日期；沒有權限（鎖定）的相簿不列。
      const tokens = (ctx.url.searchParams.get("q") ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean).slice(0, 4);
      if (!tokens.length || tokens.join("").length < 2) return { items: [] };
      const like = (t: string) => `%${t.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
      const { results: byText } = await ctx.db
        .prepare(`SELECT cm.id, cm.scope, cm.kind, cm.r2_key, cm.poster_key, cm.width, cm.height, cm.duration_sec, cm.scene_text, cm.ocr_text, cm.event_date, COALESCE(NULLIF(mp.name, ''), cm.uploader_name) AS uploader_name, COALESCE(NULLIF(mp.avatar, ''), cm.uploader_avatar) AS uploader_avatar, cm.owner_kind, cm.center_key, cm.owner_key FROM cover_media cm LEFT JOIN member_profiles mp ON mp.sub = cm.created_by WHERE cm.kind = 'image' AND ${tokens.map(() => "lower(cm.scene_text || ' ' || cm.ocr_text || ' ' || COALESCE(cm.event_date, '')) LIKE ? ESCAPE '\\'").join(" AND ")} ORDER BY cm.created_at DESC LIMIT 400`)
        .bind(...tokens.map(like))
        .all<{ id: string; scope: CoverScope; kind: "image"; r2_key: string; poster_key: string | null; width: number; height: number; duration_sec: number; scene_text: string; ocr_text: string; event_date: string | null; uploader_name: string | null; uploader_avatar: string | null; owner_kind: string; center_key: string | null; owner_key: string }>();
      // 語意比對（杜杜龍 2026-11-26）：搜「下午茶」也找得到寫「午茶交流會」的 EDM；只加入還沒被文字比對找到的照片，沒登入或 AI 沒回應就略過。
      const semIds = ctx.session ? await (await import("../semantic-search.ts")).semanticMediaIds(ctx.env, ctx.db, ctx.url.searchParams.get("q") ?? "").catch(() => [] as string[]) : [];
      const haveIds = new Set(byText.map((r) => r.id));
      const moreIds = semIds.filter((id) => !haveIds.has(id)).slice(0, 100);
      const byMeaning = moreIds.length
        ? (await ctx.db.prepare(`SELECT cm.id, cm.scope, cm.kind, cm.r2_key, cm.poster_key, cm.width, cm.height, cm.duration_sec, cm.scene_text, cm.ocr_text, cm.event_date, COALESCE(NULLIF(mp.name, ''), cm.uploader_name) AS uploader_name, COALESCE(NULLIF(mp.avatar, ''), cm.uploader_avatar) AS uploader_avatar, cm.owner_kind, cm.center_key, cm.owner_key FROM cover_media cm LEFT JOIN member_profiles mp ON mp.sub = cm.created_by WHERE cm.kind = 'image' AND cm.id IN (${moreIds.map(() => "?").join(",")})`).bind(...moreIds).all<{ id: string; scope: CoverScope; kind: "image"; r2_key: string; poster_key: string | null; width: number; height: number; duration_sec: number; scene_text: string; ocr_text: string; event_date: string | null; uploader_name: string | null; uploader_avatar: string | null; owner_kind: string; center_key: string | null; owner_key: string }>()).results
        : [];
      const results = [...byText, ...byMeaning];
      const folders = new Map((await albumsIndex(ctx)).groups.flatMap((g) => g.folders).map((f) => [f.id, f]));
      const items = [];
      for (const r of results) {
        const fid = r.owner_kind === "center" ? `center:${r.center_key}:${r.scope === "edm" ? "edm" : "cover"}` : r.owner_kind === "series" ? `series:${r.owner_key}` : folders.has(`course:${r.owner_key}`) ? `course:${r.owner_key}` : `block:${r.owner_key}`;
        const f = folders.get(fid);
        if (!f || f.locked) continue;
        items.push({ ...coverItem(r), folderId: f.id, folderTitle: f.title });
      }
      return { items: items.slice(0, 300) };
    },
  ],
  [
    "GET",
    /^\/albums\/semantic$/,
    async (ctx) => {
      // 相簿「此頁」搜尋的語意比對（杜杜龍 2026-11-26）：回意思相近的照片編號，畫面只在自己已打開的相簿裡挑出這些照片（權限照相簿本身）。
      if (!ctx.session) return { ids: [] };
      const { semanticMediaIds } = await import("../semantic-search.ts");
      return { ids: await semanticMediaIds(ctx.env, ctx.db, ctx.url.searchParams.get("q") ?? "").catch(() => [] as string[]) };
    },
  ],
  [
    "PUT",
    /^\/admin\/cover-media$/,
    async (ctx) => {
      // 上傳一張照片（內文是圖片檔；瀏覽器已先壓縮，伺服器再照設定壓縮一次）。?kind&key&w&h
      const o = await requireCoverOwner(ctx);
      const bucket = ctx.env.MEDIA ?? fail(503, "storage_not_ready", "圖片儲存空間尚未啟用");
      const data = new Uint8Array(await ctx.req.arrayBuffer());
      if (!data.byteLength || data.byteLength > 8 * 1024 * 1024) fail(413, "invalid_size", "圖片大小需在 8MB 以內（上傳時會自動壓縮）");
      const img = sniffImage(data) ?? fail(400, "invalid_image", "請上傳 JPG、PNG 或 WebP 圖片");
      await coverRoom(ctx.db, o);
      // 相簿照片獨立的存檔格式與畫質（杜杜龍 2026-11-25；先只套用成交百寶箱，確認沒問題才全站）。
      const app = (await loadConfig(ctx.db)).app;
      const ref = await albumRefOf(ctx.db, o.kind, o.lookup, o.scope);
      const albumOn = app.albumScope === "all" || (app.albumScope === "treasure" && ref.groupId === "treasure");
      const shrunk = await shrinkImage(ctx.env, data.buffer as ArrayBuffer, img.type, "center", false, albumOn ? { format: app.albumFormat, quality: app.albumQuality } : undefined);
      const key = `album/${crypto.randomUUID().slice(0, 8)}/${crypto.randomUUID()}.${renameForType("x.jpg", shrunk.type).split(".").pop()}`;
      await bucket.put(key, shrunk.data, { httpMetadata: { contentType: shrunk.type } });
      const id = await addCoverRow(ctx.db, o, { kind: "image", r2Key: key, posterKey: null, width: dim(ctx.url.searchParams.get("w")), height: dim(ctx.url.searchParams.get("h")), durationSec: 0, bytes: shrunk.data.byteLength, by: o.s.sub });
      await putInFolder(ctx, o, id); // 區塊相簿：上傳預設進目前所在的子資料夾（?folder=）
      // 中心 EDM：上傳後在背景用視覺模型辨識文字與活動日期（搜尋與依日期排序用）；失敗不影響上傳。
      if (o.kind === "center" && o.scope === "edm" && ctx.defer) ctx.defer(ocrEdmImage(ctx.env, ctx.db, id).catch(() => undefined));
      if (o.kind === "course" && ctx.defer) ctx.defer(Promise.all([scenePending(ctx.env, ctx.db, 2), photoOcrPending(ctx.env, ctx.db, 2)]).catch(() => undefined)); // 區塊照片：上傳後背景辨識場景（杜杜龍 2026-11-24）
      return { id, items: await coverItems(ctx.db, o.kind, o.lookup) };
    },
  ],
  [
    "PUT",
    /^\/admin\/cover-media\/video$/,
    async (ctx) => {
      // 上傳一支短影音（在上傳者的瀏覽器內已依「設定 › 儲存空間管理 › 封面輪播與短影音」壓縮）。?kind&key&w&h&dur
      const o = await requireCoverOwner(ctx);
      const bucket = ctx.env.MEDIA ?? fail(503, "storage_not_ready", "檔案儲存空間尚未啟用");
      const cfg = (await loadConfig(ctx.db)).app;
      const dur = Math.round(Number(ctx.url.searchParams.get("dur")) || 0);
      if (dur > cfg.videoMaxSec + 2) fail(413, "video_too_long", `影片太長，上限 ${cfg.videoMaxSec} 秒`);
      const data = new Uint8Array(await ctx.req.arrayBuffer());
      if (!data.byteLength) fail(400, "invalid_video", "沒有收到影片");
      if (data.byteLength > cfg.videoMaxMb * 1024 * 1024) fail(413, "video_too_large", `影片壓縮後仍超過 ${cfg.videoMaxMb}MB，請剪短或降低畫質後再試`);
      const isMp4 = data.byteLength > 12 && String.fromCharCode(data[4]!, data[5]!, data[6]!, data[7]!) === "ftyp";
      const isWebm = data.byteLength > 4 && data[0] === 0x1a && data[1] === 0x45 && data[2] === 0xdf && data[3] === 0xa3;
      if (!isMp4 && !isWebm) fail(400, "invalid_video", "請上傳 MP4 或 WebM 影片");
      await coverRoom(ctx.db, o);
      const key = `album/${crypto.randomUUID().slice(0, 8)}/${crypto.randomUUID()}.${isMp4 ? "mp4" : "webm"}`;
      await bucket.put(key, data.buffer as ArrayBuffer, { httpMetadata: { contentType: isMp4 ? "video/mp4" : "video/webm" } });
      const id = await addCoverRow(ctx.db, o, { kind: "video", r2Key: key, posterKey: null, width: dim(ctx.url.searchParams.get("w")), height: dim(ctx.url.searchParams.get("h")), durationSec: Math.min(dur, 600), bytes: data.byteLength, by: o.s.sub });
      return { id, items: await coverItems(ctx.db, o.kind, o.lookup) };
    },
  ],
  [
    "GET",
    /^\/admin\/recompress\/status$/,
    async (ctx) => {
      // 舊照片重新壓縮的進度（杜杜龍 2026-11-25，只有超級管理員）。
      requireSuperAdmin(ctx);
      return recompressStatus(ctx.db);
    },
  ],
  [
    "POST",
    /^\/admin\/recompress\/(start|stop)$/,
    async (ctx, [action]) => {
      // 開始／暫停全站舊照片重新壓縮。⚠ 覆蓋原檔、不可復原；排程每 10 分鐘分批處理，按「開始」後也會先在背景跑一批。
      const s = requireSuperAdmin(ctx);
      const cur = await loadJob(ctx.db);
      if (action === "start") {
        if (!ctx.env.IMAGES) return fail(503, "images_not_ready", "圖片轉檔服務尚未啟用");
        await saveJob(ctx.db, { running: true, startedAt: cur.running ? cur.startedAt : new Date().toISOString(), stoppedAt: null });
        if (ctx.defer) ctx.defer(runRecompress(ctx.env, ctx.db, 25).catch(() => undefined));
      } else await saveJob(ctx.db, { running: false, startedAt: cur.startedAt, stoppedAt: new Date().toISOString() });
      await audit(ctx.db, s.sub, `recompress.${action}`, "cover_media", "all").run();
      return recompressStatus(ctx.db);
    },
  ],
  [
    "PUT",
    /^\/admin\/cover-media\/([\w-]{1,40})\/poster$/,
    async (ctx, [id]) => {
      // 影片的預覽圖（第一格畫面，瀏覽器擷取）：影片還沒載入時先顯示它。
      const row = await ctx.db.prepare("SELECT owner_kind, center_key, owner_key, scope, kind, poster_key FROM cover_media WHERE id = ?").bind(id).first<CoverRow>();
      if (!row || row.kind !== "video") return fail(404, "not_found", "找不到這支影片");
      const s = await requireCoverRowOwner(ctx, row);
      const bucket = ctx.env.MEDIA ?? fail(503, "storage_not_ready", "圖片儲存空間尚未啟用");
      const data = new Uint8Array(await ctx.req.arrayBuffer());
      if (!data.byteLength || data.byteLength > 2 * 1024 * 1024) fail(413, "invalid_size", "預覽圖需在 2MB 以內");
      const img = sniffImage(data) ?? fail(400, "invalid_image", "請上傳 JPG 或 PNG 圖片");
      const key = `album/${crypto.randomUUID().slice(0, 8)}/${crypto.randomUUID()}.${img.type === "image/png" ? "png" : "jpg"}`;
      await bucket.put(key, data.buffer as ArrayBuffer, { httpMetadata: { contentType: img.type } });
      await ctx.db.prepare("UPDATE cover_media SET poster_key = ? WHERE id = ?").bind(key, id).run();
      if (row.poster_key) await bucket.delete(row.poster_key).catch(() => undefined);
      void s;
      return { ok: true };
    },
  ],
  [
    "PUT",
    /^\/admin\/cover-media\/([\w-]{1,40})\/meta$/,
    async (ctx, [id]) => {
      // 上傳時瀏覽器讀出的原始檔資訊與 EXIF（杜杜龍 2026-11-24）：存成 JSON，給圖片「資訊」面板顯示。
      const row = await ctx.db.prepare("SELECT owner_kind, center_key, owner_key, scope, kind FROM cover_media WHERE id = ?").bind(id).first<CoverRow>();
      if (!row) return fail(404, "not_found", "找不到這張照片");
      await requireCoverRowOwner(ctx, row);
      const body = await readJson<{ exif?: unknown; file?: unknown }>(ctx.req);
      const meta = JSON.stringify({ exif: body.exif && typeof body.exif === "object" ? body.exif : {}, file: body.file && typeof body.file === "object" ? body.file : {} });
      if (meta.length > 12000) return fail(413, "too_large", "資訊太大");
      await ctx.db.prepare("UPDATE cover_media SET meta = ? WHERE id = ?").bind(meta, id).run();
      return { ok: true };
    },
  ],
  [
    "GET",
    /^\/(?:admin\/)?cover-media\/([\w-]{1,40})\/info$/,
    async (ctx, [id]) => coverMediaInfo(ctx, id),
  ],
  [
    "GET",
    /^\/image-info$/,
    async (ctx) => imageInfoByKey(ctx),
  ],
  [
    "POST",
    /^\/admin\/cover-media\/order$/,
    async (ctx) => {
      // 排序：ids＝新的完整順序（只重排這個封面自己的項目；不在清單裡的排最後）。
      const o = await requireCoverOwner(ctx, true);
      const body = await readJson<{ ids?: unknown }>(ctx.req);
      const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string") : [];
      const cur = (await coverItems(ctx.db, o.kind, o.lookup, o.scope)).map((x) => x.id);
      const next = [...ids.filter((x) => cur.includes(x)), ...cur.filter((x) => !ids.includes(x))];
      await ctx.db.batch(next.map((id, i) => ctx.db.prepare("UPDATE cover_media SET position = ? WHERE id = ?").bind(i, id)));
      return { items: await coverItems(ctx.db, o.kind, o.lookup) };
    },
  ],
  [
    "PUT",
    /^\/admin\/cover-media\/([\w-]{1,40})\/replace$/,
    async (ctx, [id]) => {
      // 更換照片（杜杜龍 2026-11-23）：內文是新的圖片檔（瀏覽器已壓縮）。綁定課程的 EDM 同時換掉那堂課的 EDM。?w&h
      const row = await ctx.db.prepare("SELECT owner_kind, center_key, owner_key, kind, r2_key, course_id FROM cover_media WHERE id = ?").bind(id).first<CoverRow & { r2_key: string; course_id: string | null }>();
      if (!row) return fail(404, "not_found", "找不到這個項目");
      if (row.kind !== "image") return fail(400, "image_only", "只能更換照片");
      const s = await requireCoverRowOwner(ctx, row);
      const bucket = ctx.env.MEDIA ?? fail(503, "storage_not_ready", "圖片儲存空間尚未啟用");
      const data = new Uint8Array(await ctx.req.arrayBuffer());
      if (!data.byteLength || data.byteLength > 8 * 1024 * 1024) fail(413, "invalid_size", "圖片大小需在 8MB 以內（上傳時會自動壓縮）");
      const img = sniffImage(data) ?? fail(400, "invalid_image", "請上傳 JPG、PNG 或 WebP 圖片");
      const shrunk = await shrinkImage(ctx.env, data.buffer as ArrayBuffer, img.type, row.course_id ? "edm" : "center");
      const ext = renameForType("x.jpg", shrunk.type).split(".").pop();
      const key = row.course_id ? `edm/${row.course_id}/${crypto.randomUUID()}.${ext}` : `album/${crypto.randomUUID().slice(0, 8)}/${crypto.randomUUID()}.${ext}`;
      await bucket.put(key, shrunk.data, { httpMetadata: { contentType: shrunk.type } });
      const size = imageSize(new Uint8Array(shrunk.data as ArrayBuffer)) ?? { width: dim(ctx.url.searchParams.get("w")), height: dim(ctx.url.searchParams.get("h")) };
      await ctx.db.batch([
        ctx.db.prepare("UPDATE cover_media SET r2_key = ?, width = ?, height = ?, bytes = ?, ocr_status = CASE WHEN owner_key LIKE 'rcp:%' THEN 'skip' ELSE '' END, ocr_text = '', event_date = NULL WHERE id = ?").bind(key, size.width, size.height, shrunk.data.byteLength, id),
        ...(row.course_id ? [ctx.db.prepare("UPDATE courses SET edm_key = ?, cover_rect = NULL, art_version = art_version + 1 WHERE id = ?").bind(key, row.course_id)] : []),
        audit(ctx.db, s.sub, "cover_media.replace", row.owner_kind, row.center_key ?? row.owner_key, id),
      ]);
      const shared = await ctx.db.prepare("SELECT 1 AS ok FROM center_art WHERE edm_key = ? OR cover_key = ?").bind(row.r2_key, row.r2_key).first();
      if (!shared) await bucket.delete(row.r2_key).catch(() => undefined);
      const kind = row.owner_kind as CoverMediaKind;
      return { id, items: await coverItems(ctx.db, kind, kind === "center" ? row.center_key ?? "" : row.owner_key) };
    },
  ],
  [
    "GET",
    /^\/cover-media\/config$/,
    async (ctx) => {
      // 中心封面「是否輪播 EDM」（杜杜龍 2026-11-23）：公開讀取；沒有設定＝預設打勾（true）。?center=中心名稱
      const key = (ctx.url.searchParams.get("center") ?? "").trim().slice(0, 100);
      if (!key) return { showEdm: true };
      const row = await ctx.db.prepare("SELECT show_edm FROM center_cover_cfg WHERE center_key = ?").bind(centerKey(key)).first<{ show_edm: number }>();
      return { showEdm: row ? row.show_edm === 1 : true };
    },
  ],
  [
    "PUT",
    /^\/admin\/cover-media\/config$/,
    async (ctx) => {
      // 設定中心封面要不要連 EDM 分頁的照片一起輪播；權限＝能編輯該中心封面的人。body: { kind: "center", key, showEdm }
      const o = await requireCoverOwner(ctx, true);
      if (o.kind !== "center") return fail(400, "center_only", "只有中心封面可以設定");
      const body = await readJson<{ showEdm?: unknown }>(ctx.req);
      const show = body.showEdm === false ? 0 : 1;
      await ctx.db.batch([
        ctx.db.prepare("INSERT INTO center_cover_cfg (center_key, show_edm) VALUES (?, ?) ON CONFLICT(center_key) DO UPDATE SET show_edm = excluded.show_edm").bind(o.lookup, show),
        audit(ctx.db, o.s.sub, "cover_media.show_edm", "center", o.lookup, String(show)),
      ]);
      return { showEdm: show === 1 };
    },
  ],
  [
    "DELETE",
    /^\/admin\/cover-media\/([\w-]{1,40})$/,
    async (ctx, [id]) => {
      const row = await ctx.db.prepare("SELECT owner_kind, center_key, owner_key, r2_key, poster_key, course_id FROM cover_media WHERE id = ?").bind(id).first<CoverRow & { r2_key: string; course_id: string | null }>();
      if (!row) return fail(404, "not_found", "找不到這個項目");
      const s = await requireCoverRowOwner(ctx, row);
      // 綁定課程的 EDM 不能刪（杜杜龍 2026-11-23），只能更換照片。
      if (row.course_id) return fail(409, "bound_to_course", "這張 EDM 已經綁定課程，無法刪除，只能更換照片");
      await ctx.db.batch([ctx.db.prepare("DELETE FROM cover_media WHERE id = ?").bind(id), audit(ctx.db, s.sub, "cover_media.delete", row.owner_kind, row.center_key ?? row.owner_key, id)]);
      // 檔案徹底刪除；中心原本的首頁圖（相簿第一張）還被中心首頁圖設定用著時不刪。
      for (const k of [row.r2_key, row.poster_key]) {
        if (!k) continue;
        const shared = await ctx.db.prepare("SELECT 1 AS ok FROM center_art WHERE edm_key = ? OR cover_key = ?").bind(k, k).first();
        if (!shared) await ctx.env.MEDIA?.delete(k).catch(() => undefined);
      }
      const kind = row.owner_kind as CoverMediaKind;
      return { items: await coverItems(ctx.db, kind, kind === "center" ? row.center_key ?? "" : row.owner_key) };
    },
  ],
  [
    "GET",
    /^\/media\/album$/,
    async (ctx) => {
      // 相簿裡的短影音（公開，支援 Range，手機播放與拖曳進度條需要）。只服務資料庫裡有的檔案。
      const key = ctx.url.searchParams.get("k") ?? "";
      const bucket = ctx.env.MEDIA;
      if (!bucket || !/^album\/[\w-]+\/[\w.-]+$/.test(key)) return new Response("Not found", { status: 404 });
      if (!(await ctx.db.prepare("SELECT 1 AS ok FROM cover_media WHERE r2_key = ?").bind(key).first())) return new Response("Not found", { status: 404 });
      const head = await bucket.head(key);
      if (!head) return new Response("Not found", { status: 404 });
      const type = head.httpMetadata?.contentType ?? "video/mp4";
      const size = head.size;
      const m = /^bytes=(\d*)-(\d*)$/.exec(ctx.req.headers.get("range") ?? "");
      const base = { "content-type": type, "accept-ranges": "bytes", "cache-control": "public, max-age=31536000, immutable", "x-content-type-options": "nosniff" };
      if (m && (m[1] || m[2])) {
        let start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
        let end = m[1] && m[2] ? Math.min(size - 1, Number(m[2])) : size - 1;
        if (!(start <= end) || start >= size) return new Response(null, { status: 416, headers: { ...base, "content-range": `bytes */${size}` } });
        start = Math.max(0, start);
        end = Math.min(size - 1, end);
        const part = await bucket.get(key, { range: { offset: start, length: end - start + 1 } });
        if (!part) return new Response("Not found", { status: 404 });
        return new Response(part.body, { status: 206, headers: { ...base, "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(end - start + 1) } });
      }
      const obj = await bucket.get(key);
      if (!obj) return new Response("Not found", { status: 404 });
      return new Response(obj.body, { headers: { ...base, "content-length": String(size) } });
    },
  ],
  [
    "GET",
    /^\/short-links\/([A-Za-z0-9-]{2,30})\/([A-Za-z0-9-]{2,80})$/,
    async (ctx, [slug, name]) => {
      // 食譜短網址：/icook/001（前綴在「設定 › 分享預設值」；舊前綴也認得）→ 食譜編號。
      const rp = await recipeByShortPath(ctx.db, slug!, name!);
      if (rp) return { recipeId: rp };
      // 課程專屬網址：中心縮寫（或總部 hq）+ 英譯姓名-編號 → 課程編號。網址不分大小寫。
      // 素材的第二層網址：系列縮寫 + 素材名稱 → 素材編號（改名前的舊名稱也認得）。
      const serRow = slug.toLowerCase() === HQ_SLUG ? null : await slugTarget(ctx.db, slug, "series");
      if (serRow) {
        const m = (await ctx.db.prepare("SELECT id FROM courses WHERE series = ? AND mat_url = ? COLLATE NOCASE").bind(serRow.value, name).first<{ id: string }>()) ?? (await ctx.db.prepare("SELECT course_id AS id FROM material_url_aliases WHERE series = ? AND name = ? COLLATE NOCASE").bind(serRow.value, name).first<{ id: string }>());
        if (m) return { courseId: m.id };
        return fail(404, "not_found", "找不到這個網址");
      }
      const row = slug.toLowerCase() === HQ_SLUG ? { value: "" } : await slugTarget(ctx.db, slug, "center");
      const course = row
        ? row.value
          ? await ctx.db.prepare(`SELECT id FROM courses WHERE host_center_key = ? AND url_name COLLATE NOCASE IN (${urlNameVariants(name).map(() => "?").join(",")})`).bind(centerKey(row.value), ...urlNameVariants(name)).first<{ id: string }>()
          : await ctx.db.prepare(`SELECT id FROM courses WHERE host_center_key IS NULL AND url_name COLLATE NOCASE IN (${urlNameVariants(name).map(() => "?").join(",")})`).bind(...urlNameVariants(name)).first<{ id: string }>()
        : null;
      if (course) return { courseId: course.id };
      // 改名前的舊網址（別名）：照樣打得開。
      if (row) {
        const alias = await ctx.db.prepare(`SELECT course_id FROM course_url_aliases WHERE scope = ? AND url_name COLLATE NOCASE IN (${urlNameVariants(name).map(() => "?").join(",")})`).bind(row.value ? centerKey(row.value) : "", ...urlNameVariants(name)).first<{ course_id: string }>();
        if (alias) return { courseId: alias.course_id };
      }
      return fail(404, "not_found", "找不到這個網址");
    },
  ],
  [
    "GET",
    /^\/short-links\/([A-Za-z0-9-]{2,30})$/,
    async (ctx, [slug]) => {
      const row = await slugTarget(ctx.db, slug);
      return row ?? fail(404, "not_found", "找不到這個短網址");
    },
  ],
  [
    "GET",
    /^\/admin\/link-title$/,
    async (ctx) => {
      // 貼上教材連結時，由伺服器代為讀取網頁標題（瀏覽器直接讀會被網站的跨網域限制擋住）。只有管理者可用，避免被當成公開的網頁代理。
      const s = requireMember(ctx);
      if (s.role !== "admin" && !(await rightsOf(ctx)).any) return fail(403, "forbidden", "只有課程管理者可以使用");
      const u = parseHttpsUrl(ctx.url.searchParams.get("url"));
      if (!u) return fail(400, "invalid_url", "請輸入 https 開頭的有效網址");
      const type = classifyLink(u);
      const info = await fetchLinkInfo(u, fetch, ctx.env.YOUTUBE_API_KEY);
      return { type, title: info.title, date: info.date, defaultTitle: LINK_DEFAULT_TITLE[type] };
    },
  ],
  [
    "GET",
    /^\/media\/file$/,
    async () =>
      // 舊的教材檔案下載網址（只靠隨機碼保護，連結被轉傳別人也能下載）已停用：一律改走「權限檢查＋一次性下載連結」（/materials/:id/ticket）。
      new Response("這個下載網址已停用。請回到行動大學，在課程頁重新按「下載」。", { status: 410, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } }),
  ],
  [
    "GET",
    /^\/media\/dl$/,
    async (ctx) => {
      // 一次性下載：連結只用一次、約 2 分鐘內有效；用過之後只有「同一個網路、30 分鐘內的續傳」才會放行（手機斷線續傳用），轉傳給別人打開一律失效。
      const gone = (msg: string, status = 410) => new Response(`${msg}\n請回到行動大學重新按「下載」。`, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
      const id = ctx.url.searchParams.get("t") ?? "";
      const t = id.length >= 16 ? await ctx.db.prepare("SELECT id, att_id, member_sub, member_name, expires_at, used_at, used_ip FROM download_tickets WHERE id = ?").bind(id).first<{ id: string; att_id: string; member_sub: string; member_name: string; expires_at: string; used_at: string | null; used_ip: string | null }>() : null;
      if (!t) return gone("下載連結無效或已失效。");
      const ip = ctx.req.headers.get("cf-connecting-ip") ?? "";
      const now = iso();
      let first = false;
      if (t.used_at) {
        const resume = !!ctx.req.headers.get("range") && !!ip && t.used_ip === ip && Date.parse(now) - Date.parse(t.used_at) < 30 * 60_000;
        if (!resume) return gone("下載連結已經使用過，無法再次開啟。");
      } else {
        if (t.expires_at < now) return gone("下載連結已逾時。");
        const claimed = await ctx.db.prepare("UPDATE download_tickets SET used_at = ?, used_ip = ? WHERE id = ? AND used_at IS NULL").bind(now, ip, id).run();
        if (claimed.meta?.changes !== 1) return gone("下載連結已經使用過，無法再次開啟。");
        first = true;
      }
      const att = await ctx.db.prepare("SELECT id, course_id, name, size, r2_key, content_type FROM lesson_attachments WHERE id = ? AND kind = 'file'").bind(t.att_id).first<{ id: string; course_id: string; name: string; size: number; r2_key: string | null; content_type: string }>();
      if (!att || !att.r2_key) return gone("檔案已經被刪除。", 404);
      const bucket = ctx.env.MEDIA;
      const head = bucket ? await bucket.head(att.r2_key) : null;
      if (!bucket || !head) return gone("檔案已經不存在。", 404);
      if (first) await ctx.db.prepare("INSERT INTO material_downloads (id, att_id, course_id, member_sub, member_name, name, size) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), att.id, att.course_id, t.member_sub, t.member_name, att.name, att.size).run();
      const headers: Record<string, string> = { "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(att.name)}`, "cache-control": "no-store", "x-content-type-options": "nosniff", "accept-ranges": "bytes", "content-type": att.content_type || head.httpMetadata?.contentType || "application/octet-stream" };
      // 斷線續傳：只放行從某個位置接著下載（bytes=N- 或 bytes=N-M）。
      const m = /^bytes=(\d+)-(\d*)$/.exec(ctx.req.headers.get("range") ?? "");
      if (m) {
        const offset = Number(m[1]);
        const end = Math.min(head.size - 1, m[2] ? Number(m[2]) : head.size - 1);
        if (offset >= head.size || end < offset) return new Response("Range Not Satisfiable", { status: 416, headers: { "content-range": `bytes */${head.size}` } });
        const part = await bucket.get(att.r2_key, { range: { offset, length: end - offset + 1 } });
        if (!part) return gone("檔案已經不存在。", 404);
        return new Response(part.body, { status: 206, headers: { ...headers, "content-range": `bytes ${offset}-${end}/${head.size}`, "content-length": String(end - offset + 1) } });
      }
      const obj = await bucket.get(att.r2_key);
      if (!obj) return gone("檔案已經不存在。", 404);
      return new Response(obj.body, { headers: { ...headers, "content-length": String(head.size) } });
    },
  ],
  [
    "PUT",
    /^\/admin\/files\/settings$/,
    async (ctx) => {
      // 設定 › 儲存空間管理 › 上傳與下載設定（超級管理員）。
      const me = requireSuperAdmin(ctx);
      const next = normalizeFileSettings({ ...(await loadFileSettings(ctx.db)), ...(await readJson<Record<string, unknown>>(ctx.req)) });
      await saveFileSettings(ctx.db, next);
      await audit(ctx.db, me.sub, "files.settings", "files", "1").run();
      return next;
    },
  ],
  [
    "GET",
    /^\/admin\/storage$/,
    async (ctx) => {
      // 儲存空間管理（超級管理員）：各中心已使用的容量與各類型佔比。檔案大小以雲端儲存的實際大小為準，歸屬由資料庫對應。
      requireSuperAdmin(ctx);
      const bucket = ctx.env.MEDIA ?? fail(503, "storage_not_ready", "檔案儲存空間尚未啟用");
      const sizes = new Map<string, number>();
      let cursor: string | undefined;
      for (let i = 0; i < 100; i++) {
        const page = await bucket.list({ cursor, limit: 1000 });
        for (const o of page.objects) sizes.set(o.key, o.size);
        if (!page.truncated) break;
        cursor = page.cursor;
      }
      const owners = new Map<string, { owner: string; kind: StorageKind }>();
      const [courses, lessons, atts, centers, series, brands, schedules, albums] = await Promise.all([
        ctx.db.prepare("SELECT id, host_center_key, edm_key, cover_key FROM courses").all<{ id: string; host_center_key: string | null; edm_key: string | null; cover_key: string | null }>(),
        ctx.db.prepare("SELECT l.course_id, l.cover_key, l.poster_key, l.media_type, l.media_ref FROM lessons l").all<{ course_id: string; cover_key: string | null; poster_key: string | null; media_type: string; media_ref: string | null }>(),
        ctx.db.prepare("SELECT course_id, r2_key, att_type FROM lesson_attachments WHERE r2_key IS NOT NULL").all<{ course_id: string; r2_key: string; att_type: string }>(),
        ctx.db.prepare("SELECT center_key, edm_key, cover_key FROM center_art").all<{ center_key: string; edm_key: string | null; cover_key: string | null }>(),
        ctx.db.prepare("SELECT edm_key, cover_key FROM series_art").all<{ edm_key: string | null; cover_key: string | null }>(),
        ctx.db.prepare("SELECT logo_key, bg_key FROM brand_logos").all<{ logo_key: string | null; bg_key: string | null }>(),
        ctx.db.prepare("SELECT center_key, image_key FROM center_schedules").all<{ center_key: string; image_key: string }>(),
        ctx.db.prepare("SELECT cm.owner_kind, cm.center_key, cm.owner_key, cm.kind, cm.r2_key, cm.poster_key, c.host_center_key AS course_center FROM cover_media cm LEFT JOIN courses c ON cm.owner_kind = 'course' AND c.id = cm.owner_key").all<{ owner_kind: string; center_key: string | null; owner_key: string; kind: string; r2_key: string; poster_key: string | null; course_center: string | null }>(),
      ]);
      const HQ = "寰宇總部";
      const centerOf = new Map(courses.results.map((c) => [c.id, c.host_center_key || HQ]));
      const put = (key: string | null | undefined, owner: string, kind: StorageKind) => key && owners.set(key, { owner, kind });
      for (const c of courses.results) {
        put(c.edm_key, c.host_center_key || HQ, "image");
        put(c.cover_key, c.host_center_key || HQ, "image");
      }
      for (const l of lessons.results) {
        const o = centerOf.get(l.course_id) ?? HQ;
        put(l.cover_key, o, "image");
        put(l.poster_key, o, "image");
        if (l.media_type === "audio") put(l.media_ref, o, "audio");
      }
      for (const a of atts.results) put(a.r2_key, centerOf.get(a.course_id) ?? HQ, a.att_type === "image" ? "image" : "doc");
      for (const c of centers.results) {
        put(c.edm_key, c.center_key, "image");
        put(c.cover_key, c.center_key, "image");
      }
      for (const x of series.results) {
        put(x.edm_key, HQ, "image");
        put(x.cover_key, HQ, "image");
      }
      for (const x of schedules.results) put(x.image_key, x.center_key, "image");
      for (const x of albums.results) {
        const who = x.owner_kind === "center" ? x.center_key ?? HQ : x.owner_kind === "course" ? x.course_center || HQ : HQ;
        put(x.r2_key, who, x.kind === "video" ? "other" : "image");
        put(x.poster_key, who, "image");
      }
      for (const b of brands.results) {
        put(b.logo_key, HQ, "image");
        put(b.bg_key, HQ, "image");
      }
      const rows = new Map<string, { center: string; total: number; image: number; doc: number; audio: number; other: number }>();
      const totals = { image: 0, doc: 0, audio: 0, other: 0 };
      let total = 0;
      for (const [key, size] of sizes) {
        const o = owners.get(key) ?? { owner: "（沒有歸屬的檔案）", kind: "other" as StorageKind };
        const r = rows.get(o.owner) ?? { center: o.owner, total: 0, image: 0, doc: 0, audio: 0, other: 0 };
        r[o.kind] += size;
        r.total += size;
        rows.set(o.owner, r);
        totals[o.kind] += size;
        total += size;
      }
      return { totalBytes: total, objectCount: sizes.size, byType: totals, byCenter: [...rows.values()].sort((a, b) => b.total - a.total), fileSettings: await loadFileSettings(ctx.db) };
    },
  ],
  [
    "GET",
    /^\/admin\/cover-library$/,
    async (ctx) => {
      // 封面庫（杜杜龍 2026-11-19，超級管理員）：未使用的封面檔＋正在使用中的系列卡／課程卡／清單卡封面（三種分開）。
      requireSuperAdmin(ctx);
      const bucket = ctx.env.MEDIA ?? fail(503, "storage_not_ready", "圖片儲存空間尚未啟用");
      const [unused, cards] = await Promise.all([listUnusedCovers(ctx.db, bucket), listInUseCards(ctx.db)]);
      const card = (c: InUseCard) => ({ kind: c.kind, id: c.id, title: c.title, edmUrl: c.edmKey ? pubUrl(c.edmKey, c.version) : null, coverUrl: c.coverKey ? pubUrl(c.coverKey, c.version) : null });
      return { unused: unused.items, unusedTotal: unused.total, series: cards.filter((c) => c.kind === "series").map(card), courses: cards.filter((c) => c.kind === "course").map(card), lists: cards.filter((c) => c.kind === "list").map(card) };
    },
  ],
  [
    "GET",
    /^\/admin\/cover-library\/file$/,
    async (ctx) => {
      // 未使用的封面檔的預覽圖（一般的公開圖片網址只服務使用中的檔案，所以另外給超級管理員看）。
      requireSuperAdmin(ctx);
      const key = ctx.url.searchParams.get("k") ?? "";
      if (!isCoverKey(key)) return fail(400, "invalid_key", "檔案名稱不正確");
      const obj = (await ctx.env.MEDIA?.get(key)) ?? fail(404, "not_found", "找不到這個檔案");
      return new Response(obj.body, { headers: { "content-type": obj.httpMetadata?.contentType ?? "image/jpeg", "cache-control": "private, max-age=300", "x-content-type-options": "nosniff" } });
    },
  ],
  [
    "DELETE",
    /^\/admin\/cover-library$/,
    async (ctx) => {
      // 永久刪除一個「未使用」的封面檔：真的從雲端儲存（R2）刪除，無法復原；還在使用中的一律不准刪。
      const s = requireSuperAdmin(ctx);
      const key = ctx.url.searchParams.get("k") ?? "";
      if (!isCoverKey(key)) return fail(400, "invalid_key", "檔案名稱不正確");
      const bucket = ctx.env.MEDIA ?? fail(503, "storage_not_ready", "圖片儲存空間尚未啟用");
      if (await isKeyInUse(ctx.db, key)) return fail(409, "in_use", "這個封面檔還在使用中，不能刪除");
      await bucket.delete(key);
      await ctx.db.batch([audit(ctx.db, s.sub, "cover_library.delete", "r2", key)]);
      return { ok: true };
    },
  ],
  [
    "GET",
    /^\/media\/pub$/,
    async (ctx) => {
      // 課程封面與 EDM 是公開圖片（課程列表本來就要顯示；EDM 開放下載）。只服務資料庫裡仍在使用的檔案。
      const key = ctx.url.searchParams.get("k") ?? "";
      const bucket = ctx.env.MEDIA;
      if (!bucket || !/^(edm|cover|series|center|lesson|brand|schedule|album|listbg|listcover)\/[\w-]+\/[\w.-]+$/.test(key)) return new Response("Not found", { status: 404 });
      const used = (await ctx.db.prepare("SELECT 1 AS ok FROM courses WHERE edm_key = ? OR cover_key = ? UNION SELECT 1 FROM series_art WHERE edm_key = ? OR cover_key = ? UNION SELECT 1 FROM center_art WHERE edm_key = ? OR cover_key = ? UNION SELECT 1 FROM lessons WHERE cover_key = ? OR poster_key = ? UNION SELECT 1 FROM brand_logos WHERE logo_key = ? OR bg_key = ?").bind(key, key, key, key, key, key, key, key, key, key).first()) ?? (key.startsWith("schedule/") ? await ctx.db.prepare("SELECT 1 AS ok FROM center_schedules WHERE image_key = ?").bind(key).first() : key.startsWith("album/") ? await ctx.db.prepare("SELECT 1 AS ok FROM cover_media WHERE r2_key = ? OR poster_key = ?").bind(key, key).first() : key.startsWith("listbg/") ? await ctx.db.prepare("SELECT 1 AS ok FROM list_cover_bgs WHERE image_key = ?").bind(key).first() : key.startsWith("listcover/") ? await ctx.db.prepare("SELECT 1 AS ok FROM my_lists WHERE cover_key = ?").bind(key).first() : null) ?? (await ctx.db.prepare("SELECT 1 AS ok FROM cover_media WHERE r2_key = ? OR poster_key = ?").bind(key, key).first()); // D1 一個查詢最多串 5 個 UNION，課表另外查
      const obj = used ? await bucket.get(key) : null;
      if (!obj) return new Response("Not found", { status: 404 });
      // 即時縮圖（杜杜龍 2026-11-20 小範圍試用）：?w=寬度（只接受設定頁勾選的幾種，避免縮圖次數暴增）。
      // 縮不了、超過免費額度或設定有問題，一律回原圖，網站不會壞；錯誤原因記下來給「設定 › Cloudflare即時縮圖」顯示。
      const w = Number(ctx.url.searchParams.get("w"));
      const type = obj.httpMetadata?.contentType ?? "image/jpeg";
      if (ctx.env.IMAGES && w && /^image\/(jpeg|png|webp)$/.test(type)) {
       try {
        const t = (await loadConfig(ctx.db)).app.thumb;
        if (t.widths.includes(w) || THUMB_WIDE_WIDTHS.includes(w)) {
          const fmt = thumbFormat(t.format);
          // 快取（Cache API）出任何問題都當作沒有快取，不能讓整個請求丟出錯誤（錯誤會變成 1101，圖片整片空白）。
          let cacheKey: Request | null = null;
          let cache: Cache | null = null;
          try {
            cacheKey = new Request(`${ctx.url.origin}/__thumb/${encodeURIComponent(key)}?v=${ctx.url.searchParams.get("v") ?? ""}&w=${w}&s=${thumbSig(t)}&f=${fmt}`);
            cache = (caches as unknown as { default: Cache }).default;
            const hit = await cache.match(cacheKey);
            // 快取取出的回應標頭是唯讀的，後面統一加標頭（cors、server-timing）會丟出例外＝1101、圖片空白；複製成可修改的回應再回傳。
            if (hit) return new Response(hit.body, hit);
          } catch (e) {
            console.log("thumb_cache_failed", e instanceof Error ? e.message : String(e));
            cache = null;
          }
          // 縮圖額度（杜杜龍 2026-11-24）：封面 > 中心 EDM > 其他相簿；這一級到上限就不縮、回原圖（短快取，之後額度恢復或調整再縮）。
          if (!(await reserveThumb(ctx.db, t.quota, key, w).catch(() => true))) {
            return new Response(obj.body, { headers: { "content-type": type, "cache-control": "public, max-age=600", "x-content-type-options": "nosniff", "x-thumb": "quota" } });
          }
          try {
            const src = await ctx.env.IMAGES.input(obj.body).transform(thumbTransform(t, w)).output({ format: `image/${fmt}`, ...thumbOutput(t) });
            const body = await src.response().arrayBuffer();
            const done = new Response(body, { headers: { "content-type": `image/${fmt}`, "cache-control": "public, max-age=31536000, immutable", "x-content-type-options": "nosniff", "x-thumb": `w=${w},f=${fmt},kb=${Math.round(body.byteLength / 1024)}` } });
            if (cache && cacheKey) await cache.put(cacheKey, done.clone()).catch(() => undefined);
            return done;
          } catch (e) {
            const message = String((e as Error).message ?? e).slice(0, 300);
            console.log("thumb_failed", key, w, message);
            await ctx.db.prepare("INSERT INTO ui_settings (key, value, updated_at) VALUES ('thumb_health', ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").bind(JSON.stringify({ at: new Date().toISOString(), key, w, message })).run().catch(() => undefined);
            const again = await bucket.get(key);
            if (!again) return new Response("Not found", { status: 404 });
            return new Response(again.body, { headers: { "content-type": again.httpMetadata?.contentType ?? "image/jpeg", "cache-control": "public, max-age=300", "x-content-type-options": "nosniff", "x-thumb": "fallback" } });
          }
        }
       } catch (e) {
        // 縮圖流程任何地方出錯（Worker 丟出例外會變成 1101、圖片整片空白）：記下原因、一律回原圖。
        const message = String((e as Error)?.message ?? e).slice(0, 300);
        console.log("thumb_crashed", key, message);
        await ctx.db.prepare("INSERT INTO ui_settings (key, value, updated_at) VALUES ('thumb_health', ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").bind(JSON.stringify({ at: new Date().toISOString(), key, w, message })).run().catch(() => undefined);
        const again = await bucket.get(key);
        if (!again) return new Response("Not found", { status: 404 });
        return new Response(again.body, { headers: { "content-type": again.httpMetadata?.contentType ?? "image/jpeg", "cache-control": "public, max-age=300", "x-content-type-options": "nosniff", "x-thumb": "fallback" } });
       }
      }
      return new Response(obj.body, {
        headers: { "content-type": obj.httpMetadata?.contentType ?? "image/jpeg", "cache-control": "public, max-age=31536000, immutable", "x-content-type-options": "nosniff" },
      });
    },
  ],
  [
    "GET",
    /^\/admin\/thumb\/usage$/,
    async (ctx) => {
      // 設定 › Cloudflare即時縮圖：本月縮圖用量（各優先等級與各細項的張數、總額度、剩餘額度）。
      requireSuperAdmin(ctx);
      return thumbUsage(ctx.db, (await loadConfig(ctx.db)).app.thumb.quota);
    },
  ],
  [
    "GET",
    /^\/admin\/thumb\/status$/,
    async (ctx) => {
      // 設定 › Cloudflare即時縮圖：綁定是否可用、最近一次縮圖失敗的原因、試算用的範例封面。
      requireSuperAdmin(ctx);
      const row = await ctx.db.prepare("SELECT value FROM ui_settings WHERE key = 'thumb_health'").first<{ value: string }>();
      let lastError: unknown = null;
      try {
        lastError = row ? JSON.parse(row.value) : null;
      } catch {
        lastError = null;
      }
      const { results } = await ctx.db.prepare("SELECT cover_key AS k, art_version AS v FROM courses WHERE cover_key IS NOT NULL AND status = 'published' ORDER BY updated_at DESC LIMIT 8").all<{ k: string; v: number }>();
      return { binding: !!ctx.env.IMAGES, lastError, samples: results.map((r) => pubUrl(r.k, r.v)), totalCovers: Number((await ctx.db.prepare("SELECT (SELECT COUNT(*) FROM courses WHERE cover_key IS NOT NULL) + (SELECT COUNT(*) FROM courses WHERE edm_key IS NOT NULL AND cover_key IS NULL) + (SELECT COUNT(*) FROM series_art WHERE cover_key IS NOT NULL OR edm_key IS NOT NULL) + (SELECT COUNT(*) FROM lessons WHERE cover_key IS NOT NULL) AS n").first<{ n: number }>())?.n ?? 0) };
    },
  ],
  [
    "DELETE",
    /^\/admin\/thumb\/status$/,
    async (ctx) => {
      requireSuperAdmin(ctx);
      await ctx.db.prepare("DELETE FROM ui_settings WHERE key = 'thumb_health'").run();
      return { ok: true };
    },
  ],
  [
    "GET",
    /^\/media\/audio$/,
    async (ctx) => {
      // 以短效簽名網址授權（播放器無法帶 Authorization 標頭），支援 Range 以便拖曳進度。
      const key = await verifyAudioUrl(ctx.env, ctx.url);
      const bucket = ctx.env.MEDIA;
      if (!key || !bucket) return new Response("Forbidden", { status: 403 });
      const range = /^bytes=(\d*)-(\d*)$/.exec(ctx.req.headers.get("range") ?? "");
      const head = await bucket.head(key);
      if (!head) return new Response("Not found", { status: 404 });
      const size = head.size;
      let start = 0;
      let end = size - 1;
      if (range && (range[1] || range[2])) {
        start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
        end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
        if (start > end) return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
      }
      const obj = await bucket.get(key, { range: { offset: start, length: end - start + 1 } });
      if (!obj) return new Response("Not found", { status: 404 });
      const headers = new Headers({
        "content-type": head.httpMetadata?.contentType ?? "audio/mpeg",
        "accept-ranges": "bytes",
        "content-length": String(end - start + 1),
        "cache-control": "private, max-age=3600",
      });
      if (range && (range[1] || range[2])) headers.set("content-range", `bytes ${start}-${end}/${size}`);
      return new Response(obj.body, { status: range && (range[1] || range[2]) ? 206 : 200, headers });
    },
  ],
  [
    "GET",
    /^\/admin\/mux\/assets$/,
    async (ctx) => {
      requireSuperAdmin(ctx);
      const cursor = ctx.url.searchParams.get("cursor") ?? undefined;
      if (cursor && !/^[\w-]{1,200}$/.test(cursor)) fail(400, "invalid_cursor", "分頁參數不正確");
      try {
        return await listMuxAssets(ctx.env, cursor);
      } catch (e) {
        if (!(e instanceof MuxApiError)) throw e;
        if (e.code === "mux_api_not_configured") return fail(503, e.code, "尚未設定 Mux API 存取權杖，無法讀取影片清單");
        if (e.code === "mux_api_unauthorized") return fail(503, e.code, "Mux API 存取權杖無效或權限不足");
        return fail(503, e.code, "Mux 暫時無法連線，請稍後再試");
      }
    },
  ],
  // ---------- 縮圖符號（杜杜龍 2026-11-23）：系列卡、課程卡、中心卡的小縮圖符號與顏色 ----------
  [
    "GET",
    /^\/thumb-badges$/,
    async (ctx): Promise<ThumbBadge[]> => {
      const { results } = await ctx.db.prepare("SELECT kind, key, symbol, fg, bg FROM thumb_badges").all<ThumbBadge>();
      return results;
    },
  ],
  [
    "GET",
    /^\/admin\/thumb-badges$/,
    async (ctx): Promise<ThumbBadgeRow[]> => {
      // 設定頁總覽：所有課程、系列、中心與各自目前的縮圖符號（超級管理員）。
      const s = requireSuperAdmin(ctx);
      const [courses, series, badges, centers] = await Promise.all([
        ctx.db.prepare("SELECT id, title, series FROM courses ORDER BY series, title").all<{ id: string; title: string; series: string }>(),
        ctx.db.prepare("SELECT DISTINCT series FROM courses WHERE series <> '' ORDER BY series").all<{ series: string }>(),
        ctx.db.prepare("SELECT kind, key, symbol, fg, bg FROM thumb_badges").all<ThumbBadge>(),
        s.kind === "central" ? centerList(s.token).catch(() => [] as string[]) : Promise.resolve([] as string[]),
      ]);
      const map = new Map(badges.results.map((b) => [`${b.kind}:${b.key}`, b]));
      const row = (kind: ThumbBadgeKind, key: string, label: string, sub: string): ThumbBadgeRow => ({ kind, key, label, sub, badge: map.get(`${kind}:${key}`) ?? null });
      return [
        ...centers.map((c) => row("center", centerKey(c), c, "中心卡")),
        ...series.results.map((r) => row("series", r.series, r.series, "系列卡")),
        ...courses.results.map((r) => row("course", r.id, r.title, r.series ? `課程卡・${r.series}` : "課程卡")),
      ];
    },
  ],
  [
    "PUT",
    /^\/admin\/thumb-badges$/,
    async (ctx) => {
      const b = await readJson<{ kind?: unknown; key?: unknown; symbol?: unknown; fg?: unknown; bg?: unknown }>(ctx.req);
      const { kind, key, s } = await thumbBadgeTarget(ctx, b.kind, b.key);
      const symbol = typeof b.symbol === "string" ? b.symbol.trim() : "";
      if (!symbol) fail(400, "symbol_required", "請輸入符號（emoji 或最多 4 個字）");
      if ([...symbol].length > 4) fail(400, "symbol_too_long", "符號最多 4 個字");
      const hex = (v: unknown, d: string) => (typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toUpperCase() : d);
      const fg = hex(b.fg, "#FFFFFF");
      const bg = hex(b.bg, "#0C603C");
      await ctx.db.batch([
        ctx.db.prepare("INSERT INTO thumb_badges (kind, key, symbol, fg, bg, updated_by) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(kind, key) DO UPDATE SET symbol = excluded.symbol, fg = excluded.fg, bg = excluded.bg, updated_by = excluded.updated_by, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')").bind(kind, key, symbol, fg, bg, s.sub),
        audit(ctx.db, s.sub, "thumb_badge.set", kind, key),
      ]);
      return { kind, key, symbol, fg, bg } satisfies ThumbBadge;
    },
  ],
  [
    "DELETE",
    /^\/admin\/thumb-badges$/,
    async (ctx) => {
      const { kind, key, s } = await thumbBadgeTarget(ctx, ctx.url.searchParams.get("kind"), ctx.url.searchParams.get("key"));
      await ctx.db.batch([ctx.db.prepare("DELETE FROM thumb_badges WHERE kind = ? AND key = ?").bind(kind, key), audit(ctx.db, s.sub, "thumb_badge.clear", kind, key)]);
      return { ok: true };
    },
  ],
  ["GET", /^\/admin\/short-links$/, async (ctx) => (requireSuperAdmin(ctx), listShortLinks(ctx))],
  [
    "PUT",
    /^\/admin\/short-links$/,
    async (ctx) => {
      const s = requireSuperAdmin(ctx);
      const body = await readJson<Record<string, unknown>>(ctx.req);
      const kind = body.kind === "center" ? "center" : keywordKind(body.kind);
      if (kind === "location") fail(400, "invalid_kind", "只有分類、系列與中心可以設定短網址");
      const value = keywordText(body.value);
      if (kind === "center") await assertCentralCenters(ctx, [value]);
      let slug = typeof body.slug === "string" ? body.slug.trim() : ""; // 照輸入的大小寫保存與顯示；比對時不分大小寫
      // 欄位空白按儲存＝系統隨機產生一個預設縮寫（杜杜龍 2026-11-26）：6 位小寫英數字、不與網站頁面或別人的縮寫（含舊縮寫）重複。
      if (!slug) {
        for (let i = 0; i < 20 && !slug; i++) {
          const cand = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => "abcdefghjkmnpqrstuvwxyz23456789"[b % 31]).join("");
          if (!RESERVED_SLUGS.has(cand) && !(await slugTarget(ctx.db, cand))) slug = cand;
        }
        if (!slug) return fail(500, "slug_generate_failed", "產生縮寫失敗，請再按一次");
      }
      if (RESERVED_SLUGS.has(slug.toLowerCase())) fail(400, "reserved_slug", `「${slug}」是網站頁面名稱，請換一個縮寫`);
      if (!SLUG_RE.test(slug)) fail(400, "invalid_slug", "縮寫只能用英文字母（大小寫都可以）、數字與連字號（-），長度 2～30 字");
      const taken = await slugTarget(ctx.db, slug);
      if (await isRecipePrefix(ctx.db, slug)) fail(409, "slug_taken", `「${slug}」是食譜短網址的路徑`);
      if (taken && !(taken.kind === kind && taken.value === value)) fail(409, "slug_taken", `「${slug}」已被「${taken.value}」使用`);
      // 改縮寫：舊縮寫記成別名，已經分享出去的舊網址照樣打得開、自動轉到現在的網址（杜杜龍 2026-11-26）。
      const prev = await ctx.db.prepare("SELECT slug FROM short_links WHERE kind = ? AND value = ?").bind(kind, value).first<{ slug: string }>();
      await ctx.db.batch([
        ...(prev && prev.slug.toLowerCase() !== slug.toLowerCase() ? [ctx.db.prepare("INSERT OR REPLACE INTO short_link_aliases (slug, kind, value) VALUES (?, ?, ?)").bind(prev.slug, kind, value)] : []),
        ctx.db.prepare("DELETE FROM short_link_aliases WHERE slug = ? COLLATE NOCASE").bind(slug), // 改回舊縮寫：不再是別名
        ctx.db.prepare("DELETE FROM short_links WHERE kind = ? AND value = ?").bind(kind, value),
        ctx.db.prepare("INSERT INTO short_links (slug, kind, value) VALUES (?, ?, ?)").bind(slug, kind, value),
        audit(ctx.db, s.sub, "short_link.set", "short_link", kind, `${value} → ${slug}`),
      ]);
      // 中心縮寫設定好了：補上這個中心還沒有專屬網址的課程。
      if (kind === "center") await backfillCourseUrls(ctx, centerKey(value));
      return listShortLinks(ctx);
    },
  ],
  [
    "POST",
    /^\/admin\/short-links\/remove$/,
    async (ctx) => {
      const s = requireSuperAdmin(ctx);
      const body = await readJson<Record<string, unknown>>(ctx.req);
      const kind = body.kind === "center" ? "center" : keywordKind(body.kind);
      const value = keywordText(body.value);
      // 「清除」＝這個短網址不要了：現在的縮寫與改名前的舊縮寫一起失效（只是「改成別的縮寫」才會保留舊的）。
      await ctx.db.batch([ctx.db.prepare("DELETE FROM short_links WHERE kind = ? AND value = ?").bind(kind, value), ctx.db.prepare("DELETE FROM short_link_aliases WHERE kind = ? AND value = ?").bind(kind, value), audit(ctx.db, s.sub, "short_link.remove", "short_link", kind, value)]);
      return listShortLinks(ctx);
    },
  ],
];
