/** 行動大學 API 路由：管理：課程、章節、系列、關鍵字、品牌標誌（杜杜龍 2026-11-27 從 api.ts 拆出；順序會影響比對，同一檔內照原本順序）。 */
import { ensureBrandCards } from "../brand-cards.ts";
import { ensureTreasureLinks, syncSeriesOrderFromTreasure, treasureCourseId } from "../treasure-box.ts";
import { renameForType, shrinkImage, shrinkStored } from "../image-store.ts";
import { type InviteInfo, type BrandLogo, REVIEW_ROLES, type ReviewRole, ZONES } from "../contract.ts";
import { rankOptionList } from "../central.ts";
import type { D1PreparedStatement } from "../d1.ts";
import { LINK_DEFAULT_TITLE, classifyLink, parseHttpsUrl } from "../links.ts";
import { fetchLinkTitle } from "../link-title.ts";
import { ImportError, loadFileSettings, openUserDriveFile, streamToR2 } from "../material-files.ts";
import { classifyFile, fileTooBig, FILE_NO_VIDEO, safeFileName } from "../files.ts";
import { TranscribeError, transcribeNext, transcriptView } from "../transcribe.ts";
import { DEFAULT_FIELDS, OTHER as EDM_OTHER, loadFields, normalizeFields, saveFields, structurePending, structureStats } from "../edm-structure.ts";
import { AI_MODELS, AiStopped, loadSelection } from "../ai-models.ts";
import { loadConfig } from "../ui-config.ts";
import { sniffImage } from "../media.ts";
import { checkMuxPlayback, muxThumbnail } from "../mux.ts";
import { type BrandRow, type CommentRow, type CoverRect, KEYWORD_COLUMN, MB, type MediaType, SUMMARY_TITLE, assertCentralRank, attachmentKeys, audit, backfillCourseUrls, blockBrand, blockCats, brandUrl, cleanTitle, courseDeleteImpact, courseDetail, courseRightsFor, courseSubKey, createCourse, createFileMaterial, dayOrNull, deleteR2Files, duplicateCourse, fail, isListCourse, iso, joinCats, keywordKind, keywordText, listCourses, listKeywords, materialImageOverride, materialSlot, noteJobTitle, notifyNewContent, pubUrl, randomId, ranks, readJson, registrationCount, renumber, requireAdmin, requireCourseArt, requireCourseCreator, requireCourseManager, requireCourseStaff, requireLessonManager, requireMember, requireSuperAdmin, reviewDesk, rewriteCategories, rightsOf, rosterCsv, rosterOf, rosterRemove, seriesApply, seriesRosterJoin, sha256, text, toComment, updateCourse, updateLesson, youtubeId } from "../api-core.ts";
import type { Handler } from "../api-core.ts";

export const adminCoursesRoutes: [string, RegExp, Handler][] = [
  [
    "GET",
    /^\/admin\/courses\/([\w-]+)\/youtube-syncs$/,
    async (ctx, [courseId]) => {
      // 這張教材卡自己的同步清單（課程設定「YouTube 播放清單」用）。
      await requireCourseManager(ctx, courseId!);
      const { results } = await ctx.db
        .prepare("SELECT y.id, y.label, y.url, y.course_id AS courseId, c.title AS courseTitle, y.title_prefix AS titlePrefix, y.title_format AS titleFormat, y.strip_text AS stripText, y.sort_mode AS sortMode, y.sort_locked AS sortLocked, y.use_app_player AS appPlayer, y.last_synced_at AS lastSyncedAt, y.last_imported AS lastImported, y.last_note AS lastNote FROM youtube_syncs y JOIN courses c ON c.id = y.course_id WHERE y.course_id = ? ORDER BY y.rowid DESC")
        .bind(courseId)
        .all<{ id: string; label: string; url: string; courseId: string; courseTitle: string; titlePrefix: string; titleFormat: string; stripText: string; sortMode: string; appPlayer: number; sortLocked: number; lastSyncedAt: string | null; lastImported: number; lastNote: string }>();
      const { defaultSyncFormat, SYNC_FORMAT_HELP, SYNC_SORT_LABEL } = await import("../imports.ts");
      return { syncs: results.map((r) => ({ ...r, titleFormat: r.titleFormat || defaultSyncFormat(r.titlePrefix) })), keyReady: !!ctx.env.YOUTUBE_API_KEY, formatHelp: SYNC_FORMAT_HELP, sortLabels: SYNC_SORT_LABEL };
    },
  ],
  [
    "GET",
    /^\/admin\/comments$/,
    async (ctx) => {
      const s = requireAdmin(ctx);
      const { results } = await ctx.db
        .prepare(
          `SELECT c.id, c.course_id, c.member_sub, c.member_name, c.body, c.status, c.created_at, k.title AS course_title,
           (SELECT COUNT(*) FROM comment_reports r WHERE r.comment_id = c.id) AS reports
           FROM course_comments c JOIN courses k ON k.id = c.course_id
           WHERE c.status = 'hidden' OR EXISTS (SELECT 1 FROM comment_reports r WHERE r.comment_id = c.id)
           ORDER BY c.created_at DESC LIMIT 200`,
        )
        .all<CommentRow>();
      return results.map((r) => toComment(r, s));
    },
  ],
  [
    "PATCH",
    /^\/admin\/comments\/([\w-]+)$/,
    async (ctx, [id]) => {
      const s = requireAdmin(ctx);
      const body = await readJson<{ hidden?: unknown; dismiss?: unknown }>(ctx.req);
      const statements = [audit(ctx.db, s.sub, body.dismiss === true ? "comment.dismiss_reports" : body.hidden === true ? "comment.hide" : "comment.show", "comment", id)];
      if (body.dismiss === true) statements.push(ctx.db.prepare("DELETE FROM comment_reports WHERE comment_id = ?").bind(id));
      else statements.push(ctx.db.prepare("UPDATE course_comments SET status = ?, hidden_by_sub = ? WHERE id = ?").bind(body.hidden === true ? "hidden" : "visible", body.hidden === true ? s.sub : null, id));
      await ctx.db.batch(statements);
      return { ok: true };
    },
  ],
  [
    "PATCH",
    /^\/admin\/lessons\/([\w-]+)$/,
    async (ctx, [id]) => updateLesson(ctx, id, await requireLessonManager(ctx, id)),
  ],
  [
    "DELETE",
    /^\/admin\/lessons\/([\w-]+)$/,
    async (ctx, [id]) => {
      const admin = requireAdmin(ctx);
      const lesson = await ctx.db.prepare("SELECT course_id, media_type, media_ref FROM lessons WHERE id = ?").bind(id).first<{ course_id: string; media_type: string; media_ref: string | null }>();
      if (!lesson) return fail(404, "not_found", "找不到這個章節");
      const files = await attachmentKeys(ctx.db, "lesson_id", id);
      const lart = await ctx.db.prepare("SELECT cover_key, poster_key FROM lessons WHERE id = ?").bind(id).first<{ cover_key: string | null; poster_key: string | null }>();
      files.push(...[lart?.cover_key, lart?.poster_key].filter((k): k is string => !!k));
      await ctx.db.batch([ctx.db.prepare("DELETE FROM lessons WHERE id = ?").bind(id), audit(ctx.db, admin.sub, "lesson.delete", "lesson", id)]);
      await renumber(ctx.db, lesson.course_id);
      // 完整版課程影片可能與章節共用同一個音檔：還有別的章節在用就不刪檔。
      const shared = lesson.media_ref ? await ctx.db.prepare("SELECT 1 AS ok FROM lessons WHERE media_ref = ? LIMIT 1").bind(lesson.media_ref).first() : null;
      if (lesson.media_type === "audio" && lesson.media_ref && !shared) await ctx.env.MEDIA?.delete(lesson.media_ref).catch(() => undefined);
      await deleteR2Files(ctx.env, files); // 附件檔案與封面徹底從儲存空間刪除
      return { ok: true };
    },
  ],
  [
    "GET",
    /^\/admin\/lessons\/([\w-]+)\/check$/,
    async (ctx, [id]) => {
      await requireLessonManager(ctx, id);
      const l = await ctx.db.prepare("SELECT media_type, media_ref FROM lessons WHERE id = ?").bind(id).first<{ media_type: string; media_ref: string | null }>();
      if (!l) return fail(404, "not_found", "找不到這個章節");
      if (l.media_type === "mux" && l.media_ref) return checkMuxPlayback(ctx.env, l.media_ref);
      if (l.media_type === "audio" && l.media_ref) {
        const head = await ctx.env.MEDIA?.head(l.media_ref);
        return head ? { ok: true, message: `音檔正常（${Math.round(head.size / 1024 / 1024)} MB）` } : { ok: false, message: "找不到音檔，請重新上傳" };
      }
      return { ok: true, message: "這個來源不需要檢查" };
    },
  ],
  [
    "POST",
    /^\/admin\/lessons\/([\w-]+)\/audio\/start$/,
    async (ctx, [id]) => {
      const admin = await requireLessonManager(ctx, id);
      const bucket = ctx.env.MEDIA ?? fail(503, "storage_not_ready", "音檔儲存空間尚未啟用");
      const body = await readJson<{ fileName?: unknown; contentType?: unknown; size?: unknown }>(ctx.req);
      const type = typeof body.contentType === "string" ? body.contentType : "";
      if (!/^audio\/[\w.+-]+$/.test(type)) fail(400, "invalid_audio", "請選擇音訊檔（例如 MP3、M4A）");
      if (typeof body.size !== "number" || body.size <= 0 || body.size > 2 * 1024 ** 3) fail(400, "invalid_size", "音檔大小需小於 2GB");
      if (!(await ctx.db.prepare("SELECT 1 AS ok FROM lessons WHERE id = ?").bind(id).first())) fail(404, "not_found", "找不到這個章節");
      const ext = (/\.([a-z0-9]{1,5})$/i.exec(String(body.fileName ?? ""))?.[1] ?? "audio").toLowerCase();
      const key = `audio/${id}/${crypto.randomUUID()}.${ext}`;
      const upload = await bucket.createMultipartUpload(key, { httpMetadata: { contentType: type } });
      await audit(ctx.db, admin.sub, "lesson.audio_upload_start", "lesson", id, key).run();
      return { key, uploadId: upload.uploadId };
    },
  ],
  [
    "PUT",
    /^\/admin\/lessons\/([\w-]+)\/audio\/part$/,
    async (ctx, [id]) => {
      await requireLessonManager(ctx, id);
      const bucket = ctx.env.MEDIA ?? fail(503, "storage_not_ready", "音檔儲存空間尚未啟用");
      const key = ctx.url.searchParams.get("key") ?? "";
      const uploadId = ctx.url.searchParams.get("uploadId") ?? "";
      const part = Number(ctx.url.searchParams.get("part"));
      if (!key.startsWith(`audio/${id}/`) || !uploadId || !Number.isInteger(part) || part < 1 || part > 10000) fail(400, "invalid_part", "上傳參數不正確");
      const uploaded = await bucket.resumeMultipartUpload(key, uploadId).uploadPart(part, await ctx.req.arrayBuffer());
      return { partNumber: uploaded.partNumber, etag: uploaded.etag };
    },
  ],
  [
    "POST",
    /^\/admin\/lessons\/([\w-]+)\/audio\/complete$/,
    async (ctx, [id]) => {
      const admin = await requireLessonManager(ctx, id);
      const bucket = ctx.env.MEDIA ?? fail(503, "storage_not_ready", "音檔儲存空間尚未啟用");
      const body = await readJson<{ key?: unknown; uploadId?: unknown; parts?: unknown; durationSeconds?: unknown }>(ctx.req);
      const key = typeof body.key === "string" ? body.key : "";
      if (!key.startsWith(`audio/${id}/`) || typeof body.uploadId !== "string" || !Array.isArray(body.parts) || !body.parts.length) fail(400, "invalid_upload", "上傳參數不正確");
      const parts = (body.parts as { partNumber: number; etag: string }[]).map((x) => ({ partNumber: Number(x.partNumber), etag: String(x.etag) }));
      await bucket.resumeMultipartUpload(key, body.uploadId as string).complete(parts);
      const old = await ctx.db.prepare("SELECT media_type, media_ref FROM lessons WHERE id = ?").bind(id).first<{ media_type: string; media_ref: string | null }>();
      const seconds = typeof body.durationSeconds === "number" && body.durationSeconds > 0 ? body.durationSeconds : null;
      await ctx.db.batch([
        ctx.db
          .prepare("UPDATE lessons SET media_type = 'audio', media_ref = ?, start_seconds = NULL, end_seconds = NULL, duration_minutes = COALESCE(?, duration_minutes) WHERE id = ?")
          .bind(key, seconds ? Math.max(1, Math.ceil(seconds / 60)) : null, id),
        audit(ctx.db, admin.sub, "lesson.audio_uploaded", "lesson", id, key),
      ]);
      if (old?.media_type === "audio" && old.media_ref && old.media_ref !== key) await bucket.delete(old.media_ref).catch(() => undefined);
      return { ok: true, key };
    },
  ],
  [
    "GET",
    /^\/admin\/sharer-names$/,
    async (ctx) => {
      // 分享者姓名打字建議：行動大學裡已經用過的分享者與主講人姓名（去重、用得多的在前）。日後講師名單（講師資料表）建好，改由那邊提供。
      const s = requireMember(ctx);
      if (s.role !== "admin" && !(await rightsOf(ctx)).any) return fail(403, "forbidden", "只有課程管理者可以使用");
      const q = (ctx.url.searchParams.get("q") ?? "").trim().slice(0, 30);
      const { results } = await ctx.db
        .prepare(
          "SELECT name, COUNT(*) AS n FROM (SELECT sharer AS name FROM lessons WHERE kind = 'chapter' AND is_speaker = 0 UNION ALL SELECT teacher AS name FROM courses) WHERE name <> '' AND instr(name, ?) > 0 GROUP BY name ORDER BY n DESC, name LIMIT 20",
        )
        .bind(q)
        .all<{ name: string; n: number }>();
      return results.map((r) => r.name);
    },
  ],
  [
    "POST",
    /^\/admin\/courses\/([\w-]+)\/materials$/,
    async (ctx, [courseId]) => {
      // 新增「其他教材」：只有外部連結與名稱（名稱空白＝自動抓取，抓不到用類型的預設名稱）。教材與連結一次建立。
      const admin = await requireCourseManager(ctx, courseId);
      const body = await readJson<{ url?: unknown; title?: unknown; eventDate?: unknown; appPlayer?: unknown }>(ctx.req);
      const u = parseHttpsUrl(body.url);
      if (!u) return fail(400, "invalid_url", "請輸入 https 開頭的有效網址");
      const title = cleanTitle(body.title) || cleanTitle(await fetchLinkTitle(u)) || LINK_DEFAULT_TITLE[classifyLink(u)];
      const itemDate = body.eventDate === undefined ? null : dayOrNull(body.eventDate); // 項目自己的日期（杜杜龍 2026-11-17：素材可單獨設定日期）
      const course = await ctx.db.prepare("SELECT c.is_list, (SELECT COALESCE(MAX(position), 0) FROM lessons WHERE course_id = c.id) AS maxpos FROM courses c WHERE c.id = ?").bind(courseId).first<{ maxpos: number; is_list: number }>();
      if (!course) return fail(404, "not_found", "找不到這門課程");
      const id = `${courseId}-${randomId(6)}`;
      // 清單卡貼 YouTube 影片：存成影片來源，在 App 內原地播放（計入學習進度）；其他連結照常開外部網頁。
      // 「使用行動大學播放器」（杜杜龍 2026-11-24，預設勾選）：沒勾＝存成外部連結，點了開新網頁到 YouTube。
      const yt = body.appPlayer === false ? null : youtubeId(u.toString());
      // 「完整版課程影片」永遠是教材的最後一列：新教材插在它前面，它往後挪一格。
      const slot = await materialSlot(ctx.db, courseId);
      const attId = crypto.randomUUID();
      await ctx.db.batch([
        ...slot.pre,
        ctx.db.prepare("INSERT INTO lessons (id, course_id, position, title, sharer, sharer_rank, sharer_title, duration_minutes, media_type, media_ref, event_date, auto_cover, kind) VALUES (?, ?, ?, ?, '', '', '', 0, ?, ?, ?, 0, 'material')").bind(id, courseId, slot.at, title, yt ? "youtube" : "demo", yt, itemDate),
        ...(yt ? [] : [ctx.db.prepare("INSERT INTO lesson_attachments (id, lesson_id, course_id, name, kind, link_url, att_type, created_by) VALUES (?, ?, ?, ?, 'link', ?, ?, ?)").bind(attId, id, courseId, title, u.toString(), classifyLink(u), admin.sub)]),
        audit(ctx.db, admin.sub, "material.create", "lesson", id, `${classifyLink(u)}:${title}`),
      ]);
      await notifyNewContent(ctx, courseId, "教材");
      return courseDetail(ctx, courseId);
    },
  ],
  [
    "PUT",
    /^\/admin\/lessons\/([\w-]+)\/material$/,
    async (ctx, [id]) => {
      // 修改「其他教材」：名稱與外部連結（連結換了就取代舊的；舊教材的影音、音檔、附件設定不再編輯，保留在系統裡）。
      const admin = await requireLessonManager(ctx, id);
      const lesson = await ctx.db.prepare("SELECT l.course_id, l.kind, l.is_full, l.media_type, l.media_ref, c.is_list FROM lessons l JOIN courses c ON c.id = l.course_id WHERE l.id = ?").bind(id).first<{ course_id: string; kind: string; is_full: number; media_type: string; media_ref: string | null; is_list: number }>();
      if (!lesson) return fail(404, "not_found", "找不到這個教材");
      if (lesson.kind !== "material" || lesson.is_full === 1) return fail(400, "not_link_material", "這一列不是外部連結教材");
      const body = await readJson<{ url?: unknown; title?: unknown; eventDate?: unknown; appPlayer?: unknown }>(ctx.req);
      const u = parseHttpsUrl(body.url);
      if (!u) return fail(400, "invalid_url", "請輸入 https 開頭的有效網址");
      const title = cleanTitle(body.title) || cleanTitle(await fetchLinkTitle(u)) || LINK_DEFAULT_TITLE[classifyLink(u)];
      // 清單卡：YouTube 影片存成影片來源（App 內播放；同一支影片保留原本的分鐘數與區間），其他連結存成外部連結。
      const yt = body.appPlayer === false ? null : youtubeId(u.toString()); // 沒勾「使用行動大學播放器」＝存成外部連結（杜杜龍 2026-11-24）
      const sameVideo = !!yt && lesson.media_type === "youtube" && lesson.media_ref === yt;
      await ctx.db.batch([
        ctx.db.prepare("UPDATE lessons SET title = ? WHERE id = ?").bind(title, id),
        ...(body.eventDate !== undefined ? [ctx.db.prepare("UPDATE lessons SET event_date = ? WHERE id = ?").bind(dayOrNull(body.eventDate), id)] : []),
        ctx.db.prepare("UPDATE lessons SET yt_checked_at = NULL WHERE id = ?").bind(id),
        ...(yt && !sameVideo ? [ctx.db.prepare("UPDATE lessons SET media_type = 'youtube', media_ref = ?, duration_minutes = 0, start_seconds = NULL, end_seconds = NULL WHERE id = ?").bind(yt, id)] : []),
        ...(!yt && lesson.media_type === "youtube" ? [ctx.db.prepare("UPDATE lessons SET media_type = 'demo', media_ref = NULL, duration_minutes = 0, start_seconds = NULL, end_seconds = NULL WHERE id = ?").bind(id)] : []),
        ctx.db.prepare("DELETE FROM lesson_attachments WHERE lesson_id = ? AND kind = 'link'").bind(id),
        ...(yt ? [] : [ctx.db.prepare("INSERT INTO lesson_attachments (id, lesson_id, course_id, name, kind, link_url, att_type, created_by) VALUES (?, ?, ?, ?, 'link', ?, ?, ?)").bind(crypto.randomUUID(), id, lesson.course_id, title, u.toString(), classifyLink(u), admin.sub)]),
        audit(ctx.db, admin.sub, "material.update", "lesson", id, `${classifyLink(u)}:${title}`),
      ]);
      return courseDetail(ctx, lesson.course_id);
    },
  ],
  [
    "POST",
    /^\/admin\/courses\/([\w-]+)\/material-file$/,
    async (ctx, [courseId]) => {
      // 上傳檔案當教材（杜杜龍 2026-11-18）：圖片、照片、文件；不能是影片；單檔 30MB 內（圖片在瀏覽器已先壓縮）。
      const admin = await requireCourseManager(ctx, courseId);
      const name = (ctx.url.searchParams.get("name") ?? "").trim().slice(0, 120);
      if (!name) return fail(400, "name_required", "找不到檔案名稱");
      const kind = classifyFile(name);
      if (kind === "video") return fail(400, "video_not_allowed", FILE_NO_VIDEO);
      if (!kind) return fail(400, "file_type_not_allowed", "這種檔案格式不支援。可上傳圖片、PDF、Word、PowerPoint、Excel、文字檔；其他格式請上傳到雲端空間後貼連結");
      const bucket = ctx.env.MEDIA ?? fail(503, "storage_not_ready", "檔案儲存空間尚未啟用");
      const maxMb = (await loadConfig(ctx.db)).app.fileMaxMb; // 單檔上限可在「儲存空間管理」調整（預設 30MB）
      const maxBytes = maxMb * 1024 * 1024;
      const declared = Number(ctx.req.headers.get("content-length") ?? 0);
      if (declared > maxBytes + 1024) return fail(413, "file_too_large", fileTooBig(maxMb));
      const data = await ctx.req.arrayBuffer();
      if (!data.byteLength) return fail(400, "empty_file", "檔案是空的");
      if (data.byteLength > maxBytes) return fail(413, "file_too_large", fileTooBig(maxMb));
      if (!(await ctx.db.prepare("SELECT 1 AS ok FROM courses WHERE id = ?").bind(courseId).first())) return fail(404, "not_found", "找不到這門課程");
      const shrunk = kind.type === "image" ? await shrinkImage(ctx.env, data, kind.ct, "general", false, await materialImageOverride(ctx, courseId)) : { data, type: kind.ct, size: data.byteLength };
      const finalName = kind.type === "image" ? renameForType(name, shrunk.type) : name; // 轉成 JPEG 等格式後，檔名的副檔名跟著換
      const key = `file/${courseId}/${crypto.randomUUID()}/${safeFileName(finalName)}`;
      await bucket.put(key, shrunk.data, { httpMetadata: { contentType: shrunk.type } });
      const id = await createFileMaterial(ctx, admin, courseId, { name: finalName, key, size: shrunk.size, contentType: shrunk.type, attType: kind.type, audit: "material.file_upload" });
      return ctx.url.searchParams.get("lite") === "1" ? { id } : courseDetail(ctx, courseId);
    },
  ],
  [
    "POST",
    /^\/admin\/courses\/([\w-]+)\/drive-import$/,
    async (ctx, [courseId]) => {
      // 從使用者自己的 Google 雲端硬碟匯入教材（杜杜龍 2026-11-18）：使用者在瀏覽器用 Google Picker 挑檔案並授權一次性的存取權杖，
      // 伺服器用它把那個檔案讀出來、轉存進行動大學的儲存空間（R2）並建立教材。權杖只用這一次，不保存、不寫日誌。
      const admin = await requireCourseManager(ctx, courseId);
      const b = await readJson<{ fileId?: unknown; token?: unknown; progressId?: unknown }>(ctx.req);
      const progressId = typeof b.progressId === "string" && /^[\w-]{8,40}$/.test(b.progressId) ? b.progressId : "";
      const fileId = typeof b.fileId === "string" ? b.fileId : "";
      const token = typeof b.token === "string" ? b.token : "";
      if (!/^[\w-]{8,120}$/.test(fileId) || !/^[\w.~+/=-]{20,4096}$/.test(token)) return fail(400, "bad_request", "資料不正確，請重新選擇檔案");
      const bucket = ctx.env.MEDIA ?? fail(503, "storage_not_ready", "檔案儲存空間尚未啟用");
      if (!(await ctx.db.prepare("SELECT 1 AS ok FROM courses WHERE id = ?").bind(courseId).first())) return fail(404, "not_found", "找不到這門課程");
      const set = await loadFileSettings(ctx.db);
      const maxBytes = set.importMaxMb * MB;
      const tooBig = () => fail(413, "file_too_large", fileTooBig(set.importMaxMb));
      try {
        const src = await openUserDriveFile(token, fileId);
        const kind = classifyFile(src.name);
        if (kind === "video") return fail(400, "video_not_allowed", FILE_NO_VIDEO);
        if (!kind) return fail(400, "file_type_not_allowed", "這種檔案格式不支援。可匯入圖片、PDF、Word、PowerPoint、Excel、文字檔（Google 文件、試算表、簡報會自動轉成 PDF、Excel、PowerPoint）");
        if (src.size !== null && src.size > maxBytes) return tooBig();
        const res = await src.open();
        if (res.status === 401) return fail(401, "google_token_invalid", "Google 授權已失效，請重新選擇檔案");
        if (res.status === 403 && src.size === null) return fail(413, "google_export_limit", "這個 Google 檔案太大，無法自動轉檔，請先在 Google 雲端硬碟另存成 PDF 或 Office 檔再選擇");
        if (!res.ok || !res.body) return fail(502, "google_failed", "向 Google 讀取檔案失敗，請稍後再試");
        const key = `file/${courseId}/${crypto.randomUUID()}/${safeFileName(src.name)}`;
        let size: number;
        // 轉存進度：每秒最多寫一次（畫面用 /admin/drive-import/progress 查，顯示進度條）。
        const total = src.size ?? 0;
        let lastReport = 0;
        if (progressId) await ctx.db.batch([ctx.db.prepare("DELETE FROM import_progress WHERE updated_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day')"), ctx.db.prepare("INSERT OR REPLACE INTO import_progress (id, member_sub, written, total) VALUES (?, ?, 0, ?)").bind(progressId, admin.sub, total)]);
        try {
          size = await streamToR2(bucket, key, res.body, kind.ct, maxBytes, async (read) => {
            if (!progressId || Date.now() - lastReport < 1000) return;
            lastReport = Date.now();
            await ctx.db.prepare("UPDATE import_progress SET written = ?, updated_at = ? WHERE id = ?").bind(read, iso(), progressId).run();
          });
        } catch (e) {
          if (e instanceof ImportError && e.code === "file_too_large") return tooBig();
          throw e;
        } finally {
          if (progressId) await ctx.db.prepare("DELETE FROM import_progress WHERE id = ?").bind(progressId).run().catch(() => undefined);
        }
        let finalType = kind.ct;
        let finalName = src.name;
        if (kind.type === "image") {
          const done = await shrinkStored(ctx.env, key, kind.ct, "general", await materialImageOverride(ctx, courseId));
          if (done) {
            size = done.size;
            finalType = done.type;
            finalName = renameForType(src.name, done.type);
          }
        }
        const id = await createFileMaterial(ctx, admin, courseId, { name: finalName, key, size, contentType: finalType, attType: kind.type, audit: "material.drive_import" });
        return { id };
      } catch (e) {
        if (e instanceof ImportError) return fail(e.status, e.code, e.message);
        throw e;
      }
    },
  ],
  [
    "PUT",
    /^\/admin\/courses\/([\w-]+)\/edm$/,
    async (ctx, [id]) => {
      const part = "edm" as const;
      const s = requireMember(ctx);
      await requireCourseArt(ctx, s, id);
      const bucket = ctx.env.MEDIA ?? fail(503, "storage_not_ready", "圖片儲存空間尚未啟用");
      const data = new Uint8Array(await ctx.req.arrayBuffer());
      const max = 8 * 1024 * 1024;
      if (!data.byteLength || data.byteLength > max) fail(413, "invalid_size", `圖片大小需在 ${max / 1024 / 1024}MB 以內（上傳時會自動壓縮）`);
      const img = sniffImage(data) ?? fail(400, "invalid_image", "請上傳 JPG、PNG 或 WebP 圖片");
      const old = await ctx.db.prepare("SELECT edm_key AS k FROM courses WHERE id = ?").bind(id).first<{ k: string | null }>();
      const key = `${part}/${id}/${crypto.randomUUID()}.${img.ext}`;
      const shrunk = await shrinkImage(ctx.env, data.buffer as ArrayBuffer, img.type, "edm");
      await bucket.put(key, shrunk.data, { httpMetadata: { contentType: shrunk.type } });
      await ctx.db.batch([
        ctx.db.prepare("UPDATE courses SET edm_key = ?, cover_rect = NULL, art_version = art_version + 1 WHERE id = ?").bind(key, id),
        audit(ctx.db, s.sub, "course.edm_upload", "course", id, key),
      ]);
      if (old?.k) await bucket.delete(old.k).catch(() => undefined);
      return { ok: true, url: pubUrl(key, 0) };
    },
  ],
  [
    "DELETE",
    /^\/admin\/courses\/([\w-]+)\/edm$/,
    async (ctx, [id, _part]) => {
      const s = requireMember(ctx);
      await requireCourseArt(ctx, s, id);
      const old = await ctx.db.prepare("SELECT edm_key AS k FROM courses WHERE id = ?").bind(id).first<{ k: string | null }>();
      await ctx.db.batch([
        ctx.db.prepare("UPDATE courses SET edm_key = NULL, art_version = art_version + 1 WHERE id = ?").bind(id),
        audit(ctx.db, s.sub, "course.edm_remove", "course", id),
      ]);
      if (old?.k) await ctx.env.MEDIA?.delete(old.k).catch(() => undefined);
      return { ok: true };
    },
  ],
  [
    "PUT",
    /^\/admin\/courses\/([\w-]+)\/cover$/,
    async (ctx, [id]) => {
      // 課程清單用的 16:9 封面：管理員在瀏覽器從 EDM 裁切、壓縮後上傳。
      const s = requireMember(ctx);
      await requireCourseArt(ctx, s, id);
      const bucket = ctx.env.MEDIA ?? fail(503, "storage_not_ready", "圖片儲存空間尚未啟用");
      const data = new Uint8Array(await ctx.req.arrayBuffer());
      if (!data.byteLength || data.byteLength > 3 * 1024 * 1024) fail(413, "invalid_size", "封面大小需在 3MB 以內（上傳時會自動壓縮）");
      const img = sniffImage(data) ?? fail(400, "invalid_image", "請上傳 JPG、PNG 或 WebP 圖片");
      const old = await ctx.db.prepare("SELECT cover_key AS k FROM courses WHERE id = ?").bind(id).first<{ k: string | null }>();
      const key = `cover/${id}/${crypto.randomUUID()}.${img.ext}`;
      const shrunk = await shrinkImage(ctx.env, data.buffer as ArrayBuffer, img.type, "general");
      await bucket.put(key, shrunk.data, { httpMetadata: { contentType: shrunk.type } });
      await ctx.db.batch([ctx.db.prepare("UPDATE courses SET cover_key = ?, art_version = art_version + 1 WHERE id = ?").bind(key, id), audit(ctx.db, s.sub, "course.cover_upload", "course", id, key)]);
      if (old?.k) await bucket.delete(old.k).catch(() => undefined);
      return { ok: true, url: pubUrl(key, 0) };
    },
  ],
  [
    "DELETE",
    /^\/admin\/courses\/([\w-]+)\/cover$/,
    async (ctx, [id]) => {
      const s = requireMember(ctx);
      await requireCourseArt(ctx, s, id);
      const old = await ctx.db.prepare("SELECT cover_key AS k FROM courses WHERE id = ?").bind(id).first<{ k: string | null }>();
      await ctx.db.batch([ctx.db.prepare("UPDATE courses SET cover_key = NULL, art_version = art_version + 1 WHERE id = ?").bind(id), audit(ctx.db, s.sub, "course.cover_remove", "course", id)]);
      if (old?.k) await ctx.env.MEDIA?.delete(old.k).catch(() => undefined);
      return { ok: true };
    },
  ],
  [
    "PUT",
    /^\/admin\/lessons\/([\w-]+)\/art$/,
    async (ctx, [id]) => {
      // 章節封面（課程要先勾選「章節各自設定封面」）：part=cover（橫式 16:9）或 poster（直式）；圖片已在瀏覽器裁切、壓縮。
      const s = requireMember(ctx);
      const part = ctx.url.searchParams.get("part");
      if (part !== "cover" && part !== "poster") return fail(400, "invalid_part", "封面類型不正確");
      const lesson = await ctx.db.prepare("SELECT l.course_id, l.cover_key, l.poster_key, c.chapter_covers, l.kind FROM lessons l JOIN courses c ON c.id = l.course_id WHERE l.id = ?").bind(id).first<{ course_id: string; cover_key: string | null; poster_key: string | null; chapter_covers: number; kind: string }>();
      if (!lesson) return fail(404, "not_found", "找不到這個章節");
      await requireCourseArt(ctx, s, lesson.course_id);
      if (lesson.chapter_covers !== 1 && lesson.kind !== "section") fail(409, "chapter_covers_off", "這門課程尚未勾選「章節各自設定封面」");
      const bucket = ctx.env.MEDIA ?? fail(503, "storage_not_ready", "圖片儲存空間尚未啟用");
      const data = new Uint8Array(await ctx.req.arrayBuffer());
      if (!data.byteLength || data.byteLength > 3 * 1024 * 1024) fail(413, "invalid_size", "封面大小需在 3MB 以內（上傳時會自動壓縮）");
      const img = sniffImage(data) ?? fail(400, "invalid_image", "請上傳 JPG、PNG 或 WebP 圖片");
      const key = `lesson/${id}/${crypto.randomUUID()}.${img.ext}`;
      const shrunk = await shrinkImage(ctx.env, data.buffer as ArrayBuffer, img.type, "general");
      await bucket.put(key, shrunk.data, { httpMetadata: { contentType: shrunk.type } });
      const col = part === "cover" ? "cover_key" : "poster_key";
      const old = part === "cover" ? lesson.cover_key : lesson.poster_key;
      await ctx.db.batch([ctx.db.prepare(`UPDATE lessons SET ${col} = ?, art_version = art_version + 1 WHERE id = ?`).bind(key, id), audit(ctx.db, s.sub, `lesson.${part}_upload`, "lesson", id, key)]);
      if (old) await bucket.delete(old).catch(() => undefined);
      return { ok: true, url: pubUrl(key, 0) };
    },
  ],
  [
    "DELETE",
    /^\/admin\/lessons\/([\w-]+)\/art$/,
    async (ctx, [id]) => {
      const s = requireMember(ctx);
      const part = ctx.url.searchParams.get("part");
      if (part !== "cover" && part !== "poster") return fail(400, "invalid_part", "封面類型不正確");
      const lesson = await ctx.db.prepare("SELECT course_id, cover_key, poster_key FROM lessons WHERE id = ?").bind(id).first<{ course_id: string; cover_key: string | null; poster_key: string | null }>();
      if (!lesson) return fail(404, "not_found", "找不到這個章節");
      await requireCourseArt(ctx, s, lesson.course_id);
      const col = part === "cover" ? "cover_key" : "poster_key";
      const old = part === "cover" ? lesson.cover_key : lesson.poster_key;
      await ctx.db.batch([ctx.db.prepare(`UPDATE lessons SET ${col} = NULL, art_version = art_version + 1 WHERE id = ?`).bind(id), audit(ctx.db, s.sub, `lesson.${part}_remove`, "lesson", id)]);
      if (old) await ctx.env.MEDIA?.delete(old).catch(() => undefined);
      return { ok: true };
    },
  ],
  [
    "GET",
    /^\/admin\/lessons\/([\w-]+)\/mux-frame$/,
    async (ctx, [id]) => {
      // Mux 影片任一秒的截圖（簽名縮圖），讓管理員挑章節封面。只代理圖片，不回傳 Playback ID。
      await requireLessonManager(ctx, id);
      const l = await ctx.db.prepare("SELECT media_type, media_ref FROM lessons WHERE id = ?").bind(id).first<{ media_type: string; media_ref: string | null }>();
      if (!l || l.media_type !== "mux" || !l.media_ref) return fail(400, "not_mux", "這個章節不是 Mux 影片");
      const t = Number(ctx.url.searchParams.get("time"));
      if (!Number.isFinite(t) || t < 0 || t > 86400) return fail(400, "invalid_time", "時間不正確");
      const frame = await muxThumbnail(ctx.env, l.media_ref, t);
      if (!frame) return fail(502, "mux_frame_failed", "取得影片截圖失敗，請稍後再試");
      return new Response(frame.bytes, { headers: { "content-type": frame.type, "cache-control": "no-store" } });
    },
  ],
  ["GET", /^\/admin\/courses$/, async (ctx) => listCourses(ctx, true)],
  [
    "GET",
    /^\/admin\/brand-logos$/,
    async (ctx): Promise<BrandLogo[]> => {
      requireSuperAdmin(ctx);
      const { results } = await ctx.db.prepare("SELECT id, name, logo_key, bg_key, bg_color, bg_color_dark, categories, art_version FROM brand_logos ORDER BY sort_order, created_at").all<BrandRow>();
      return results.map((r) => ({ id: r.id, name: r.name, logoUrl: r.logo_key ? brandUrl(r.logo_key, r.art_version) : null, bgColor: r.bg_color, bgColorDark: r.bg_color_dark, bgUrl: r.bg_key ? brandUrl(r.bg_key, r.art_version) : null}));
    },
  ],
  [
    "POST",
    /^\/admin\/brand-logos$/,
    async (ctx) => {
      const s = requireSuperAdmin(ctx);
      const body = await readJson<{ name?: unknown }>(ctx.req);
      const name = text(body.name, 40);
      if (!name) return fail(400, "name_required", "請輸入品牌名稱");
      const id = `b${randomId(7)}`;
      const max = await ctx.db.prepare("SELECT COALESCE(MAX(sort_order), 0) AS m FROM brand_logos").first<{ m: number }>();
      await ctx.db.batch([ctx.db.prepare("INSERT INTO brand_logos (id, name, sort_order) VALUES (?, ?, ?)").bind(id, name, (max?.m ?? 0) + 1), audit(ctx.db, s.sub, "brand.create", "brand", id, name)]);
      await ensureBrandCards(ctx.env, id).catch(() => undefined); // 新品牌自動有一張資訊卡（杜杜龍 2026-11-18）
      await ensureTreasureLinks(ctx.env, id).catch(() => undefined); // 成交百寶箱也補一個該品牌的區塊與品牌卡最前面的連結區塊
      return { id };
    },
  ],
  [
    "PATCH",
    /^\/admin\/brand-logos\/([\w-]+)$/,
    async (ctx, [id]) => {
      const s = requireSuperAdmin(ctx);
      const body = await readJson<{ name?: unknown; bgColor?: unknown; bgColorDark?: unknown }>(ctx.req);
      const sets: [string, unknown][] = [];
      if (body.name !== undefined) {
        const n = text(body.name, 40);
        if (!n) return fail(400, "name_required", "請輸入品牌名稱");
        sets.push(["name", n]);
        await ctx.db.prepare("UPDATE courses SET title = ? WHERE id = ? AND zone = 'amway_brand'").bind(n, `cb${id}`).run(); // 品牌改名，資訊卡跟著改
      }
      if (body.bgColor !== undefined) {
        if (body.bgColor === null || body.bgColor === "") sets.push(["bg_color", null]);
        else if (typeof body.bgColor === "string" && /^#[0-9a-fA-F]{6}$/.test(body.bgColor)) sets.push(["bg_color", body.bgColor.toUpperCase()]);
        else return fail(400, "invalid_color", "底色請用 #RRGGBB 格式");
      }
      if (body.bgColorDark !== undefined) {
        // 深色模式底色（杜杜龍 2026-11-18）：空白＝不設定（深色模式照原本的底色或底圖）。
        if (body.bgColorDark === null || body.bgColorDark === "") sets.push(["bg_color_dark", null]);
        else if (typeof body.bgColorDark === "string" && /^#[0-9a-fA-F]{6}$/.test(body.bgColorDark)) sets.push(["bg_color_dark", body.bgColorDark.toUpperCase()]);
        else return fail(400, "invalid_color", "深色模式底色請用 #RRGGBB 格式");
      }
      if (!sets.length) return { ok: true };
      const r = await ctx.db.prepare(`UPDATE brand_logos SET ${sets.map(([c]) => `${c} = ?`).join(", ")} WHERE id = ?`).bind(...sets.map(([, v]) => v), id).run();
      if (r.meta?.changes === 0) return fail(404, "not_found", "找不到這個品牌");
      await audit(ctx.db, s.sub, "brand.update", "brand", id, sets.map(([c]) => c).join(",")).run();
      if (body.name !== undefined) await ensureTreasureLinks(ctx.env, id).catch(() => undefined); // 品牌改名，成交百寶箱的區塊名稱跟著改
      return { ok: true };
    },
  ],
  [
    "PUT",
    /^\/admin\/brand-logos\/([\w-]+)\/(logo|bg)$/,
    async (ctx, [id, part]) => {
      const s = requireSuperAdmin(ctx);
      const bucket = ctx.env.MEDIA ?? fail(503, "storage_not_ready", "圖片儲存空間尚未啟用");
      const data = new Uint8Array(await ctx.req.arrayBuffer());
      const max = 8 * 1024 * 1024;
      if (!data.byteLength || data.byteLength > max) fail(413, "invalid_size", `圖片大小需在 ${max / 1024 / 1024}MB 以內`);
      const img = sniffImage(data) ?? fail(400, "invalid_image", "請上傳 JPG、PNG 或 WebP 圖片");
      const col = part === "logo" ? "logo_key" : "bg_key";
      const old = await ctx.db.prepare(`SELECT ${col} AS k FROM brand_logos WHERE id = ?`).bind(id).first<{ k: string | null }>();
      if (!old) return fail(404, "not_found", "找不到這個品牌");
      const key = `brand/${id}/${crypto.randomUUID()}.${img.ext}`;
      const shrunk = await shrinkImage(ctx.env, data.buffer as ArrayBuffer, img.type, "general", true); // 品牌 logo 不轉格式（透明背景要保留）
      await bucket.put(key, shrunk.data, { httpMetadata: { contentType: shrunk.type } });
      await ctx.db.batch([ctx.db.prepare(`UPDATE brand_logos SET ${col} = ?, art_version = art_version + 1 WHERE id = ?`).bind(key, id), audit(ctx.db, s.sub, `brand.${part}_upload`, "brand", id, key)]);
      if (old.k) await bucket.delete(old.k).catch(() => undefined);
      return { ok: true };
    },
  ],
  [
    "DELETE",
    /^\/admin\/brand-logos\/([\w-]+)\/bg$/,
    async (ctx, [id]) => {
      requireSuperAdmin(ctx);
      const old = await ctx.db.prepare("SELECT bg_key AS k FROM brand_logos WHERE id = ?").bind(id).first<{ k: string | null }>();
      await ctx.db.prepare("UPDATE brand_logos SET bg_key = NULL, art_version = art_version + 1 WHERE id = ?").bind(id).run();
      if (old?.k) await ctx.env.MEDIA?.delete(old.k).catch(() => undefined);
      return { ok: true };
    },
  ],
  [
    "DELETE",
    /^\/admin\/brand-logos\/([\w-]+)$/,
    async (ctx, [id]) => {
      const s = requireSuperAdmin(ctx);
      const old = await ctx.db.prepare("SELECT logo_key, bg_key FROM brand_logos WHERE id = ?").bind(id).first<{ logo_key: string | null; bg_key: string | null }>();
      await ctx.db.batch([ctx.db.prepare("UPDATE courses SET brand_id = NULL WHERE brand_id = ?").bind(id), ctx.db.prepare("DELETE FROM brand_logos WHERE id = ?").bind(id), audit(ctx.db, s.sub, "brand.delete", "brand", id)]);
      for (const k of [old?.logo_key, old?.bg_key]) if (k) await ctx.env.MEDIA?.delete(k).catch(() => undefined);
      return { ok: true };
    },
  ],
  [
    "PUT",
    /^\/admin\/series-settings$/,
    async (ctx) => {
      // 系列的標題（只改顯示）與是否顯示在「所有系列」：只有超級管理員（杜杜龍 2026-11-19）。
      const s = requireSuperAdmin(ctx);
      const body = await readJson<{ series?: unknown; title?: unknown; showInAll?: unknown }>(ctx.req);
      const series = typeof body.series === "string" ? body.series.trim().slice(0, 60) : "";
      if (!series) return fail(400, "invalid_request", "請指定系列");
      const title = body.title === undefined ? undefined : String(body.title).trim().slice(0, 60);
      const show = body.showInAll === undefined ? undefined : body.showInAll === true ? 1 : 0;
      await ctx.db.batch([
        ctx.db.prepare("INSERT OR IGNORE INTO series_settings (series) VALUES (?)").bind(series),
        ...(title !== undefined ? [ctx.db.prepare("UPDATE series_settings SET title = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE series = ?").bind(title, series)] : []),
        ...(show !== undefined ? [ctx.db.prepare("UPDATE series_settings SET show_in_all = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE series = ?").bind(show, series)] : []),
        audit(ctx.db, s.sub, "series.settings", "series", series, JSON.stringify({ title, showInAll: show })),
      ]);
      return { ok: true };
    },
  ],
  [
    "POST",
    /^\/admin\/series-hide$/,
    async (ctx) => {
      // 系列頁單獨隱藏／顯示某張卡（只影響系列頁）：只有超級管理員。
      const s = requireSuperAdmin(ctx);
      const body = await readJson<{ id?: unknown; hidden?: unknown }>(ctx.req);
      const id = typeof body.id === "string" ? body.id : "";
      const res = await ctx.db.prepare("UPDATE courses SET series_hidden = ? WHERE id = ?").bind(body.hidden === true ? 1 : 0, id).run();
      if (res.meta?.changes === 0) return fail(404, "not_found", "找不到這張卡");
      await ctx.db.batch([audit(ctx.db, s.sub, "series.hide", "course", id, body.hidden === true ? "hide" : "show")]);
      return { ok: true };
    },
  ],
  [
    "POST",
    /^\/admin\/series-order$/,
    async (ctx) => {
      // 素材系列內的手動排序：只有超級管理員（系列只有他能設定）。ids＝這個系列全部項目的新順序。
      const s = requireSuperAdmin(ctx);
      const body = await readJson<{ series?: unknown; ids?: unknown }>(ctx.req);
      const series = typeof body.series === "string" ? body.series.trim() : "";
      const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string") : [];
      if (!series || !ids.length || ids.length > 500) return fail(400, "invalid_request", "排序內容不正確");
      const { results } = await ctx.db.prepare(`SELECT id FROM courses WHERE series = ? AND id IN (${ids.map(() => "?").join(",")})`).bind(series, ...ids).all<{ id: string }>();
      if (results.length !== new Set(ids).size) return fail(400, "invalid_request", "有項目不屬於這個系列");
      await ctx.db.batch([...ids.map((id, i) => ctx.db.prepare("UPDATE courses SET series_order = ? WHERE id = ?").bind(i + 1, id)), audit(ctx.db, s.sub, "series.order", "series", series, String(ids.length))]);
      return { ok: true };
    },
  ],
  [
    "POST",
    /^\/admin\/zone-move$/,
    async (ctx) => {
      // 跨專區移動（杜杜龍 2026-11-18）：ids＝要搬的課程或清單；同系列的一起搬。只有超級管理員。
      const s = requireSuperAdmin(ctx);
      const body = await readJson<{ zone?: unknown; ids?: unknown }>(ctx.req);
      const zone = typeof body.zone === "string" ? body.zone : "";
      const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string") : [];
      if (!ZONES.some((z) => z.id === zone) || !ids.length || ids.length > 500) return fail(400, "invalid_request", "移動內容不正確");
      const marks = ids.map(() => "?").join(",");
      await ctx.db.batch([
        ctx.db.prepare(`UPDATE courses SET zone = ? WHERE id IN (${marks}) OR (series <> '' AND series IN (SELECT series FROM courses WHERE id IN (${marks})))`).bind(zone, ...ids, ...ids),
        audit(ctx.db, s.sub, "zone.move", "zone", zone, String(ids.length)),
      ]);
      return { ok: true };
    },
  ],
  ["POST", /^\/admin\/courses$/, async (ctx) => createCourse(ctx, await requireCourseCreator(ctx))],
  [
    "GET",
    /^\/admin\/edm-fields$/,
    async (ctx) => {
      // AI 文字辨識的欄位格式（杜杜龍 2026-11-24）：超級管理員自訂；EDM 辨識文字會照這個格式整理。
      requireSuperAdmin(ctx);
      const sel = await loadSelection(ctx.db);
      const model = AI_MODELS.find((m) => m.id === sel.edm_structure);
      return { fields: await loadFields(ctx.db), defaults: DEFAULT_FIELDS, other: EDM_OTHER, stats: await structureStats(ctx.db), model: model ? { id: model.id, name: model.name, cost: model.cost } : null };
    },
  ],
  [
    "PUT",
    /^\/admin\/edm-fields$/,
    async (ctx) => {
      const s = requireSuperAdmin(ctx);
      const body = await readJson<{ fields?: unknown }>(ctx.req);
      if (!Array.isArray(body.fields) || !body.fields.length) fail(400, "invalid_fields", "至少要有一個欄位");
      const fields = normalizeFields(body.fields);
      await saveFields(ctx.db, fields);
      await audit(ctx.db, s.sub, "edm_fields.set", "ui_settings", "edm_fields", JSON.stringify(fields)).run();
      return { fields, stats: await structureStats(ctx.db) };
    },
  ],
  [
    "POST",
    /^\/admin\/edm-fields\/run$/,
    async (ctx) => {
      // 現在就整理幾張還沒套用目前格式的 EDM（一次 5 張，避免一次吃光每日免費額度）。
      requireSuperAdmin(ctx);
      const done = await structurePending(ctx.env, ctx.db, 5);
      return { done, stats: await structureStats(ctx.db) };
    },
  ],
  ["GET", /^\/admin\/lessons\/([\w-]+)\/transcript$/, async (ctx, [id]) => (await requireLessonManager(ctx, id!), transcriptView(ctx.db, id!))],
  [
    "POST",
    /^\/admin\/lessons\/([\w-]+)\/transcript\/next$/,
    async (ctx, [id]) => {
      // 轉下一段逐字稿（前端依序呼叫直到完成）。額度用完回 429，隔天可接著做。
      const admin = await requireLessonManager(ctx, id!);
      const body = await readJson<Record<string, unknown>>(ctx.req).catch(() => ({}) as Record<string, unknown>);
      try {
        const view = await transcribeNext(ctx.env, ctx.db, id!, { restart: body.restart === true });
        if (body.restart === true) await audit(ctx.db, admin.sub, "lesson.transcript_restart", "lesson", id!).run();
        return view;
      } catch (e) {
        if (e instanceof AiStopped) fail(429, "ai_stopped", e.message);
        if (e instanceof TranscribeError) fail(e.code === "not_found" ? 404 : e.code === "ai_failed" ? 502 : 409, e.code, e.message);
        throw e;
      }
    },
  ],
  [
    "POST",
    /^\/admin\/course-urls\/backfill$/,
    async (ctx) => {
      const s = requireSuperAdmin(ctx);
      const n = await backfillCourseUrls(ctx);
      await audit(ctx.db, s.sub, "course_url.backfill", "course", "all", String(n)).run();
      return { total: n };
    },
  ],
  [
    "GET",
    /^\/admin\/central-options$/,
    async (ctx) => {
      const s = await requireCourseStaff(ctx);
      // 獎銜選單與會員中心相同（正本）；測試帳號用本地階梯。
      if (s.kind === "central") {
        const list = await rankOptionList(s.token);
        if (list.length) return { ranks: list.filter((o) => o.value !== "none") };
      }
      return { ranks: [...(await ranks(ctx.db)).values()].filter((r) => r.code !== "none").map((r) => ({ value: r.code, label: r.name })) };
    },
  ],
  ["GET", /^\/admin\/keywords$/, async (ctx) => (requireSuperAdmin(ctx), listKeywords(ctx))],
  [
    "POST",
    /^\/admin\/keywords$/,
    async (ctx) => {
      const s = requireSuperAdmin(ctx);
      const body = await readJson<Record<string, unknown>>(ctx.req);
      const kind = keywordKind(body.kind);
      const value = keywordText(body.value);
      await ctx.db.batch([ctx.db.prepare("INSERT OR IGNORE INTO keywords (kind, value) VALUES (?, ?)").bind(kind, value), audit(ctx.db, s.sub, "keyword.add", "keyword", kind, value)]);
      return listKeywords(ctx);
    },
  ],
  [
    "PATCH",
    /^\/admin\/keywords$/,
    async (ctx) => {
      const s = requireSuperAdmin(ctx);
      const body = await readJson<Record<string, unknown>>(ctx.req);
      const kind = keywordKind(body.kind);
      const from = keywordText(body.from);
      const to = keywordText(body.to);
      const col = KEYWORD_COLUMN[kind];
      const catUpdates = kind === "category" ? await rewriteCategories(ctx, (list) => joinCats([...new Set(list.map((x) => (x === from ? to : x)))])) : [];
      await ctx.db.batch([
        ...(kind === "category" ? catUpdates : [ctx.db.prepare(`UPDATE courses SET ${col} = ? WHERE ${col} = ?`).bind(to, from)]),
        ctx.db.prepare("DELETE FROM keywords WHERE kind = ? AND value = ?").bind(kind, from),
        ctx.db.prepare("INSERT OR IGNORE INTO keywords (kind, value) VALUES (?, ?)").bind(kind, to),
        ...(kind === "category" || kind === "series" ? [ctx.db.prepare("UPDATE OR REPLACE short_links SET value = ? WHERE kind = ? AND value = ?").bind(to, kind, from)] : []),
        ...(kind === "category" || kind === "series" ? [ctx.db.prepare("UPDATE OR REPLACE short_link_aliases SET value = ? WHERE kind = ? AND value = ?").bind(to, kind, from)] : []), // 舊縮寫也跟著改名
        ...(kind === "series" ? [ctx.db.prepare("UPDATE OR REPLACE series_settings SET series = ? WHERE series = ?").bind(to, from), ctx.db.prepare("UPDATE OR REPLACE series_art SET series = ? WHERE series = ?").bind(to, from), ctx.db.prepare("UPDATE OR REPLACE page_views SET key = ? WHERE kind = 'series' AND key = ?").bind(to, from)] : []),
        audit(ctx.db, s.sub, "keyword.rename", "keyword", kind, `${from} → ${to}`),
      ]);
      return listKeywords(ctx);
    },
  ],
  [
    "POST",
    /^\/admin\/keywords\/remove$/,
    async (ctx) => {
      const s = requireSuperAdmin(ctx);
      const body = await readJson<Record<string, unknown>>(ctx.req);
      const kind = keywordKind(body.kind);
      const value = keywordText(body.value);
      const col = KEYWORD_COLUMN[kind];
      const catUpdates = kind === "category" ? await rewriteCategories(ctx, (list) => joinCats(list.filter((x) => x !== value))) : [];
      const artRow = kind === "series" ? await ctx.db.prepare("SELECT edm_key AS k, cover_key AS c FROM series_art WHERE series = ?").bind(value).first<{ k: string; c: string | null }>() : null;
      const artKey = artRow?.k;
      if (artRow?.c) await ctx.env.MEDIA?.delete(artRow.c).catch(() => undefined);
      if (kind === "series") await ctx.db.prepare("DELETE FROM series_art WHERE series = ?").bind(value).run();
      if (artKey) await ctx.env.MEDIA?.delete(artKey).catch(() => undefined);
      await ctx.db.batch([
        ...(kind === "category" ? catUpdates : [ctx.db.prepare(`UPDATE courses SET ${col} = '' WHERE ${col} = ?`).bind(value)]),
        ctx.db.prepare("DELETE FROM keywords WHERE kind = ? AND value = ?").bind(kind, value),
        ctx.db.prepare("DELETE FROM short_links WHERE kind = ? AND value = ?").bind(kind, value),
        ctx.db.prepare("DELETE FROM short_link_aliases WHERE kind = ? AND value = ?").bind(kind, value),
        audit(ctx.db, s.sub, "keyword.remove", "keyword", kind, value),
      ]);
      return listKeywords(ctx);
    },
  ],
  [
    "PUT",
    /^\/admin\/series\/edm$/,
    async (ctx) => {
      const s = requireSuperAdmin(ctx);
      const series = keywordText(ctx.url.searchParams.get("series"));
      const bucket = ctx.env.MEDIA ?? fail(503, "storage_not_ready", "圖片儲存空間尚未啟用");
      const data = new Uint8Array(await ctx.req.arrayBuffer());
      const max = 8 * 1024 * 1024;
      if (!data.byteLength || data.byteLength > max) fail(413, "invalid_size", `圖片大小需在 ${max / 1024 / 1024}MB 以內（上傳時會自動壓縮）`);
      const img = sniffImage(data) ?? fail(400, "invalid_image", "請上傳 JPG、PNG 或 WebP 圖片");
      const old = await ctx.db.prepare("SELECT edm_key AS k FROM series_art WHERE series = ?").bind(series).first<{ k: string }>();
      const key = `series/${crypto.randomUUID().slice(0, 8)}/${crypto.randomUUID()}.${img.ext}`;
      const shrunk = await shrinkImage(ctx.env, data.buffer as ArrayBuffer, img.type, "edm");
      await bucket.put(key, shrunk.data, { httpMetadata: { contentType: shrunk.type } });
      await ctx.db.batch([
        ctx.db
          .prepare("INSERT INTO series_art (series, edm_key) VALUES (?, ?) ON CONFLICT(series) DO UPDATE SET edm_key = excluded.edm_key, art_version = art_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')")
          .bind(series, key),
        ctx.db.prepare("INSERT OR IGNORE INTO keywords (kind, value) VALUES ('series', ?)").bind(series),
        audit(ctx.db, s.sub, "series.edm_upload", "series", series, key),
      ]);
      if (old?.k) await bucket.delete(old.k).catch(() => undefined);
      return { ok: true };
    },
  ],
  [
    "PUT",
    /^\/admin\/series\/cover$/,
    async (ctx) => {
      // 系列頁用的 16:9 封面：與中心完全相同的做法（管理者在瀏覽器從 EDM 裁切、壓縮後上傳，先要有系列 EDM）。
      const s = requireSuperAdmin(ctx);
      const series = keywordText(ctx.url.searchParams.get("series"));
      const bucket = ctx.env.MEDIA ?? fail(503, "storage_not_ready", "圖片儲存空間尚未啟用");
      const old = await ctx.db.prepare("SELECT cover_key AS k FROM series_art WHERE series = ?").bind(series).first<{ k: string | null }>();
      if (!old) fail(409, "no_edm", "請先上傳系列 EDM");
      const data = new Uint8Array(await ctx.req.arrayBuffer());
      if (!data.byteLength || data.byteLength > 3 * 1024 * 1024) fail(413, "invalid_size", "封面大小需在 3MB 以內（上傳時會自動壓縮）");
      const img = sniffImage(data) ?? fail(400, "invalid_image", "請上傳 JPG、PNG 或 WebP 圖片");
      const key = `series/${crypto.randomUUID().slice(0, 8)}/cover-${crypto.randomUUID()}.${img.ext}`;
      const shrunk = await shrinkImage(ctx.env, data.buffer as ArrayBuffer, img.type, "general");
      await bucket.put(key, shrunk.data, { httpMetadata: { contentType: shrunk.type } });
      await ctx.db.batch([
        ctx.db.prepare("UPDATE series_art SET cover_key = ?, art_version = art_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE series = ?").bind(key, series),
        audit(ctx.db, s.sub, "series.cover_upload", "series", series, key),
      ]);
      if (old?.k) await bucket.delete(old.k).catch(() => undefined);
      return { ok: true };
    },
  ],
  [
    "PATCH",
    /^\/admin\/series\/edm$/,
    async (ctx) => {
      // 封面框（占 EDM 寬高的比例）與預設停留位置永遠同步：預設位置＝封面框上緣。
      const s = requireSuperAdmin(ctx);
      const series = keywordText(ctx.url.searchParams.get("series"));
      const body = await readJson<{ coverRect?: unknown }>(ctx.req);
      const r = body.coverRect as Partial<CoverRect> | null | undefined;
      const ok = !!r && [r.x, r.y, r.w].every((n) => typeof n === "number" && Number.isFinite(n)) && r.w! > 0 && r.w! <= 1 && r.x! >= 0 && r.x! + r.w! <= 1.0001 && r.y! >= 0 && r.y! <= 1;
      if (!ok) fail(400, "invalid_cover_rect", "封面裁切範圍不正確");
      const rect = { x: Math.round(r!.x! * 10000) / 10000, y: Math.round(r!.y! * 10000) / 10000, w: Math.round(r!.w! * 10000) / 10000 };
      const res = await ctx.db.prepare("UPDATE series_art SET cover_rect = ?, edm_view_y = ?, art_version = art_version + 1 WHERE series = ?").bind(JSON.stringify(rect), rect.y, series).run();
      if (!res.meta?.changes) fail(409, "no_edm", "請先上傳系列 EDM");
      await ctx.db.batch([audit(ctx.db, s.sub, "series.cover_rect", "series", series, JSON.stringify(rect))]);
      return { ok: true };
    },
  ],
  ["GET", /^\/admin\/courses\/([\w-]+)\/roster$/, async (ctx, [id]) => rosterOf(ctx, id)],
  ["GET", /^\/admin\/courses\/([\w-]+)\/roster\.csv$/, async (ctx, [id]) => rosterCsv(ctx, id)],
  ["DELETE", /^\/admin\/courses\/([\w-]+)\/roster\/([\w-]+)$/, async (ctx, [id, orderId]) => rosterRemove(ctx, id, orderId)],
  ["POST", /^\/admin\/series-apply$/, async (ctx) => seriesApply(ctx)],
  ["POST", /^\/admin\/series-apply-roster$/, async (ctx) => seriesRosterJoin(ctx)],
  [
    "GET",
    /^\/admin\/series-template$/,
    async (ctx) => {
      requireSuperAdmin(ctx);
      const series = ctx.url.searchParams.get("series") ?? "";
      const row = await ctx.db.prepare("SELECT template FROM series_settings WHERE series = ?").bind(series).first<{ template: string }>();
      try {
        return { template: row?.template ? (JSON.parse(row.template) as Record<string, unknown>) : {} };
      } catch {
        return { template: {} };
      }
    },
  ],
  [
    "GET",
    /^\/admin\/courses\/([\w-]+)\/invite$/,
    async (ctx, [id]) => {
      await requireCourseManager(ctx, id);
      const c = await ctx.db.prepare("SELECT invite_only, invite_code FROM courses WHERE id = ?").bind(id).first<{ invite_only: number; invite_code: string }>();
      return c ? ({ inviteOnly: c.invite_only === 1, code: c.invite_code } satisfies InviteInfo) : fail(404, "not_found", "找不到這門課程");
    },
  ],
  [
    "GET",
    /^\/admin\/courses\/([\w-]+)\/review-desk$/,
    async (ctx, [id]) => {
      await requireCourseManager(ctx, id);
      return reviewDesk(ctx, id);
    },
  ],
  [
    "PUT",
    /^\/admin\/courses\/([\w-]+)\/review-roles$/,
    async (ctx, [id]) => {
      // 指定身份：主辦中心的會長／音控／小編也可以審核這門課（總部主辦的課＝各中心的該身份審核自己中心學員的報名）。
      const s = await requireCourseManager(ctx, id);
      const body = await readJson<{ roles?: unknown }>(ctx.req);
      const roles = Array.isArray(body.roles) ? [...new Set(body.roles.filter((r): r is ReviewRole => typeof r === "string" && (REVIEW_ROLES as readonly string[]).includes(r)))] : fail(400, "invalid_roles", "身份格式不正確");
      await ctx.db.batch([ctx.db.prepare("UPDATE courses SET review_roles = ? WHERE id = ?").bind(roles.join(","), id), audit(ctx.db, s.sub, "course.review_roles", "course", id, roles.join(","))]);
      return reviewDesk(ctx, id);
    },
  ],
  [
    "DELETE",
    /^\/admin\/courses\/([\w-]+)\/reviewers\/([\w:.@|-]+)$/,
    async (ctx, [id, sub]) => {
      const s = await requireCourseManager(ctx, id);
      await ctx.db.batch([ctx.db.prepare("DELETE FROM course_reviewers WHERE course_id = ? AND member_sub = ?").bind(id, sub), audit(ctx.db, s.sub, "course.reviewer_remove", "course", id, sub)]);
      return reviewDesk(ctx, id);
    },
  ],
  [
    "POST",
    /^\/admin\/courses\/([\w-]+)\/review-invites$/,
    async (ctx, [id]) => {
      // 指定特定會員：產生一次性的邀請網址（24 小時內有效），用分享功能傳給對方；對方登入後打開就成為這門課的審核人員。
      const s = await requireCourseManager(ctx, id);
      const token = [...crypto.getRandomValues(new Uint8Array(18))].map((b) => b.toString(16).padStart(2, "0")).join("");
      const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
      await ctx.db.batch([
        ctx.db.prepare("INSERT INTO review_invites (token_hash, course_id, created_by_sub, expires_at) VALUES (?, ?, ?, ?)").bind(await sha256(token), id, s.sub, expiresAt),
        audit(ctx.db, s.sub, "course.reviewer_invite", "course", id),
      ]);
      return { path: `/review-invite/${token}`, expiresAt };
    },
  ],
  [
    "DELETE",
    /^\/admin\/series\/edm$/,
    async (ctx) => {
      const s = requireSuperAdmin(ctx);
      const series = keywordText(ctx.url.searchParams.get("series"));
      const old = await ctx.db.prepare("SELECT edm_key AS k, cover_key AS c FROM series_art WHERE series = ?").bind(series).first<{ k: string; c: string | null }>();
      await ctx.db.batch([ctx.db.prepare("DELETE FROM series_art WHERE series = ?").bind(series), audit(ctx.db, s.sub, "series.edm_remove", "series", series)]);
      if (old?.k) await ctx.env.MEDIA?.delete(old.k).catch(() => undefined);
      if (old?.c) await ctx.env.MEDIA?.delete(old.c).catch(() => undefined);
      return { ok: true };
    },
  ],
  [
    "POST",
    /^\/admin\/courses\/([\w-]+)\/duplicate$/,
    async (ctx, [id]) => {
      // 複製（建立下一梯）：要能新增課程，而且看得到（能修改）來源課程。
      const s = await requireCourseCreator(ctx);
      await requireCourseManager(ctx, id!);
      ctx.touched = undefined; // 複製不算修改來源課程
      return duplicateCourse(ctx, id!, s);
    },
  ],
  ["PATCH", /^\/admin\/courses\/([\w-]+)$/, async (ctx, [id]) => updateCourse(ctx, id)],
  [
    "GET",
    /^\/admin\/courses\/([\w-]+)\/delete-impact$/,
    async (ctx, [id]) => {
      const { can } = await courseRightsFor(ctx, id);
      if (!can.edit && !can.remove) fail(403, "forbidden", "沒有管理這門課程的權限");
      return courseDeleteImpact(ctx.db, id);
    },
  ],
  [
    "DELETE",
    /^\/admin\/courses\/([\w-]+)$/,
    async (ctx, [id]) => {
      const { s: admin, can } = await courseRightsFor(ctx, id);
      if (!can.remove) fail(403, "forbidden", "沒有刪除這門課程的權限");
      const impact = await courseDeleteImpact(ctx.db, id);
      // 杜杜龍規定：已有人報名（已開通、免費報名、待審核）的課程不能永久刪除，只能「下架封存」。完全沒人報名才真的刪除。
      const active = await registrationCount(ctx.db, id);
      if (active > 0) fail(409, "has_registrations", `這門課程已有 ${active} 筆報名，不能永久刪除；請改用「下架封存」`);
      const audio = await ctx.db.prepare("SELECT media_ref FROM lessons WHERE course_id = ? AND media_type = 'audio' AND media_ref IS NOT NULL").bind(id).all<{ media_ref: string }>();
      const files = await attachmentKeys(ctx.db, "course_id", id);
      const lessonArt = await ctx.db.prepare("SELECT cover_key, poster_key FROM lessons WHERE course_id = ?").bind(id).all<{ cover_key: string | null; poster_key: string | null }>();
      for (const r of lessonArt.results) files.push(...[r.cover_key, r.poster_key].filter((k): k is string => !!k));
      const art = await ctx.db.prepare("SELECT edm_key, cover_key FROM courses WHERE id = ?").bind(id).first<{ edm_key: string | null; cover_key: string | null }>(); // cover_key 是舊版封面（已不再使用，刪課程時順便清掉）
      // 只含這門課的報名紀錄整筆刪除；同時報名多門課的紀錄只移除這門課並扣掉金額。
      const onlyThis = "id IN (SELECT order_id FROM order_items WHERE course_id = ?1) AND NOT EXISTS (SELECT 1 FROM order_items x WHERE x.order_id = orders.id AND x.course_id <> ?1)";
      const [, , , , , , res] = await ctx.db.batch([
        ctx.db.prepare(`DELETE FROM notifications WHERE (link LIKE '/orders/%' AND substr(link, 9) IN (SELECT id FROM orders WHERE ${onlyThis})) OR (link LIKE '/admin/orders/%' AND substr(link, 15) IN (SELECT id FROM orders WHERE ${onlyThis}))`).bind(id),
        ctx.db.prepare("DELETE FROM enrollments WHERE course_id = ?").bind(id),
        ctx.db.prepare(`DELETE FROM orders WHERE ${onlyThis}`).bind(id),
        ctx.db.prepare("UPDATE orders SET total_twd = MAX(0, total_twd - (SELECT COALESCE(SUM(price_twd), 0) FROM order_items WHERE order_id = orders.id AND course_id = ?1)) WHERE id IN (SELECT order_id FROM order_items WHERE course_id = ?1)").bind(id),
        ctx.db.prepare("DELETE FROM order_items WHERE course_id = ?").bind(id),
        audit(ctx.db, admin.sub, "course.delete", "course", id, JSON.stringify({ title: impact.title, registrations: impact.registrations, students: impact.students, paidTwd: impact.paidTwd })),
        ctx.db.prepare("DELETE FROM courses WHERE id = ?").bind(id),
        ctx.db.prepare("DELETE FROM center_subscriptions WHERE center_key = ?").bind(courseSubKey(id)), // 這門課程自己的訂閱與點閱一併清掉
        ctx.db.prepare("DELETE FROM page_views WHERE kind = 'course' AND key = ?").bind(id),
      ]);
      if (res.meta?.changes === 0) fail(404, "not_found", "找不到這門課程");
      await deleteR2Files(ctx.env, [...files, art?.edm_key, art?.cover_key]);
      for (const a of audio.results) await ctx.env.MEDIA?.delete(a.media_ref).catch(() => undefined);
      return { ok: true };
    },
  ],
  [
    "POST",
    /^\/admin\/courses\/([\w-]+)\/lessons$/,
    async (ctx, [courseId]) => {
      const admin = await requireCourseManager(ctx, courseId);
      const body = await readJson<{ title?: unknown; sharer?: unknown; sharerRank?: unknown; sharerTitle?: unknown; eventDate?: unknown; kind?: unknown; isSpeaker?: unknown; isSummary?: unknown; inSheet?: unknown; brandId?: unknown; categories?: unknown }>(ctx.req);
      const isList = await isListCourse(ctx, courseId);
      const kind = body.kind === "section" ? "section" : body.kind === "material" ? "material" : "chapter";
      const sharer = typeof body.sharer === "string" ? body.sharer.trim().slice(0, 60) : "";
      const sharerTitle = typeof body.sharerTitle === "string" ? body.sharerTitle.trim().slice(0, 50) : "";
      const sharerRank = typeof body.sharerRank === "string" ? body.sharerRank.trim().slice(0, 40) : "";
      await assertCentralRank(ctx, sharerRank);
      if (sharerTitle) await noteJobTitle(ctx, sharerTitle);
      const speakerNew = kind === "chapter" && body.isSpeaker === true;
      const summaryNew = kind === "chapter" && body.isSummary === true;
      const title = summaryNew ? SUMMARY_TITLE : typeof body.title === "string" ? body.title.trim().slice(0, 120) : "";
      if (speakerNew && summaryNew) fail(400, "summary_speaker_exclusive", "主講人與總結與銷售課程不能同時勾選");
      if (!title) fail(400, "title_required", `請輸入${kind === "material" ? "教材" : "章節"}名稱`);
      const eventDate = body.eventDate === undefined ? null : dayOrNull(body.eventDate);
      const course = await ctx.db.prepare("SELECT (SELECT COALESCE(MAX(position), 0) FROM lessons WHERE course_id = c.id) AS maxpos FROM courses c WHERE c.id = ?").bind(courseId).first<{ maxpos: number }>();
      if (!course) return fail(404, "not_found", "找不到這門課程");
      const id = `${courseId}-${randomId(6)}`;
      // 「完整版課程影片」永遠是教材的最後一列：新教材插在它前面，它往後挪一格。
      const full = kind !== "chapter" ? await ctx.db.prepare("SELECT id, position FROM lessons WHERE course_id = ? AND is_full = 1").bind(courseId).first<{ id: string; position: number }>() : null;
      const speaker = speakerNew;
      // 套裝課程：新章節放在第一個區塊的前面（不要掉進最後一個區塊裡）。
      let insertAt = full ? full.position : course.maxpos + 1;
      const shift: D1PreparedStatement[] = [];
      if (kind === "chapter" && !isList) {
        const firstSec = await ctx.db.prepare("SELECT MIN(position) AS p FROM lessons WHERE course_id = ? AND kind = 'section'").bind(courseId).first<{ p: number | null }>();
        if (firstSec?.p != null) {
          insertAt = firstSec.p;
          const rows = (await ctx.db.prepare("SELECT id, position FROM lessons WHERE course_id = ? AND position >= ? ORDER BY position DESC").bind(courseId, insertAt).all<{ id: string; position: number }>()).results;
          shift.push(...rows.map((r) => ctx.db.prepare("UPDATE lessons SET position = ? WHERE id = ?").bind(-r.position - 1, r.id)), ...rows.map((r) => ctx.db.prepare("UPDATE lessons SET position = ? WHERE id = ?").bind(r.position + 1, r.id)));
        }
      }
      await ctx.db.batch([
        ...shift,
        ...(speaker ? [ctx.db.prepare("UPDATE lessons SET is_speaker = 0 WHERE course_id = ? AND kind = 'chapter'").bind(courseId)] : []),
        ...(summaryNew ? [ctx.db.prepare("UPDATE lessons SET is_summary = 0 WHERE course_id = ?").bind(courseId)] : []),
        ...(full ? [ctx.db.prepare("UPDATE lessons SET position = ? WHERE id = ?").bind(course.maxpos + 1, full.id)] : []),
        ctx.db.prepare("INSERT INTO lessons (id, course_id, position, title, sharer, sharer_rank, sharer_title, duration_minutes, media_type, event_date, auto_cover, kind, is_speaker, is_summary, brand_id, categories, in_sheet) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'demo', ?, ?, ?, ?, ?, ?, ?, ?)").bind(id, courseId, insertAt, title || "主講人", sharer, sharerRank, sharerTitle, eventDate, 0, kind, speaker ? 1 : 0, summaryNew ? 1 : 0, kind === "section" ? await blockBrand(ctx, body.brandId) : null, kind === "section" ? blockCats(body.categories) : "", kind === "section" && body.inSheet === false ? 0 : 1),
        audit(ctx.db, admin.sub, "lesson.create", "lesson", id, `${kind}:${title}`),
      ]);
      if (kind !== "section") await notifyNewContent(ctx, courseId, kind === "material" ? "教材" : "章節");
      return courseDetail(ctx, courseId);
    },
  ],
  [
    "POST",
    /^\/admin\/courses\/([\w-]+)\/full-version$/,
    async (ctx, [courseId]) => {
      // 勾選「完整版課程影片」：在教材最後新增一列；章節都用同一支影片時自動帶入（秒數留空＝播整支）。已存在就直接回傳。
      const admin = await requireCourseManager(ctx, courseId);
      if (!(await ctx.db.prepare("SELECT 1 AS ok FROM courses WHERE id = ?").bind(courseId).first())) return fail(404, "not_found", "找不到這門課程");
      if (!(await ctx.db.prepare("SELECT 1 AS ok FROM lessons WHERE course_id = ? AND is_full = 1").bind(courseId).first())) {
        const chapters = await ctx.db
          .prepare("SELECT media_type, media_ref, duration_minutes FROM lessons WHERE course_id = ? AND kind = 'chapter' ORDER BY position")
          .bind(courseId)
          .all<{ media_type: MediaType; media_ref: string | null; duration_minutes: number }>();
        const withMedia = chapters.results.filter((l) => l.media_ref && l.media_type !== "demo");
        const same = withMedia.length > 0 && withMedia.every((l) => l.media_type === withMedia[0]!.media_type && l.media_ref === withMedia[0]!.media_ref);
        const maxpos = (await ctx.db.prepare("SELECT COALESCE(MAX(position), 0) AS p FROM lessons WHERE course_id = ?").bind(courseId).first<{ p: number }>())?.p ?? 0;
        const id = `${courseId}-${randomId(6)}`;
        await ctx.db.batch([
          ctx.db
            .prepare("INSERT INTO lessons (id, course_id, position, title, duration_minutes, media_type, media_ref, kind, is_full) VALUES (?, ?, ?, '完整版課程影片', ?, ?, ?, 'material', 1)")
            .bind(id, courseId, maxpos + 1, same ? withMedia.reduce((n, l) => n + l.duration_minutes, 0) : 0, same ? withMedia[0]!.media_type : "demo", same ? withMedia[0]!.media_ref : null),
          audit(ctx.db, admin.sub, "lesson.create", "lesson", id, "material:完整版課程影片"),
        ]);
      }
      return courseDetail(ctx, courseId);
    },
  ],
  [
    "POST",
    /^\/admin\/lessons\/([\w-]+)\/duplicate$/,
    async (ctx, [id]) => {
      // 複製一堂（章節或教材）：插在原本那堂後面。影片來源（YouTube／Mux）用同一支；音檔是這堂自己的檔案，不共用（複製後請重新上傳）。
      const admin = await requireLessonManager(ctx, id);
      const l = await ctx.db
        .prepare("SELECT course_id, position, title, sharer, sharer_rank, sharer_title, duration_minutes, media_type, media_ref, start_seconds, end_seconds, event_date, auto_cover, kind, is_full FROM lessons WHERE id = ?")
        .bind(id)
        .first<{ course_id: string; position: number; title: string; sharer: string; sharer_rank: string; sharer_title: string; duration_minutes: number; media_type: MediaType; media_ref: string | null; start_seconds: number | null; end_seconds: number | null; event_date: string | null; auto_cover: number; kind: string; is_full: number }>();
      if (!l) return fail(404, "not_found", "找不到這一堂");
      if (l.is_full === 1) fail(400, "full_version", "完整版課程影片不能複製");
      const audio = l.media_type === "audio";
      const newId = `${l.course_id}-${randomId(6)}`;
      const after = await ctx.db.prepare("SELECT id, position FROM lessons WHERE course_id = ? AND position > ? ORDER BY position DESC").bind(l.course_id, l.position).all<{ id: string; position: number }>();
      await ctx.db.batch([
        // 後面的往後挪一格（由大到小，避開 UNIQUE(course_id, position)），再把複製的放在原本那堂的下一格。
        ...after.results.map((r) => ctx.db.prepare("UPDATE lessons SET position = ? WHERE id = ?").bind(r.position + 1, r.id)),
        ctx.db
          .prepare("INSERT INTO lessons (id, course_id, position, title, sharer, sharer_rank, sharer_title, duration_minutes, media_type, media_ref, start_seconds, end_seconds, event_date, auto_cover, kind) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .bind(newId, l.course_id, l.position + 1, `${l.title}（複製）`.slice(0, 120), l.sharer, l.sharer_rank, l.sharer_title, audio ? 0 : l.duration_minutes, audio ? "demo" : l.media_type, audio ? null : l.media_ref, audio ? null : l.start_seconds, audio ? null : l.end_seconds, l.event_date, l.auto_cover, l.kind),
        audit(ctx.db, admin.sub, "lesson.duplicate", "lesson", newId, id),
      ]);
      if (ctx.url.searchParams.get("lite") === "1") return { id: newId }; // 畫面已即時更新，不必回整份課程資料（比較快）
      return courseDetail(ctx, l.course_id);
    },
  ],
  [
    "POST",
    /^\/admin\/courses\/([\w-]+)\/lessons\/order$/,
    async (ctx, [courseId]) => {
      const admin = await requireCourseManager(ctx, courseId);
      const body = await readJson<{ ids?: unknown }>(ctx.req);
      const given = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string") : [];
      // 章節與教材各自排序：傳進來的 ids 必須剛好是同一組（章節或教材）的全部；排好後放回這一組原本佔用的順位，另一組不動。
      const current = await ctx.db.prepare("SELECT id, kind, position FROM lessons WHERE course_id = ? AND is_full = 0").bind(courseId).all<{ id: string; kind: string; position: number }>();
      const byId = new Map(current.results.map((r) => [r.id, r]));
      // 連結區塊（品牌資訊卡）裡的項目屬於來源清單：它們彼此的先後順序換到來源清單（放回它們原本佔用的順位），其餘項目照一般規則。
      const ids = given.filter((i) => byId.has(i));
      const foreign = given.filter((i) => !byId.has(i));
      const foreignStmts: D1PreparedStatement[] = [];
      if (foreign.length) {
        const { results: rows } = await ctx.db
          .prepare(`SELECT id, course_id, position FROM lessons WHERE id IN (${foreign.map(() => "?").join(",")}) AND course_id IN (SELECT s.course_id FROM lessons k JOIN lessons s ON s.id = k.link_block_id WHERE k.course_id = ?)`)
          .bind(...foreign, courseId)
          .all<{ id: string; course_id: string; position: number }>();
        if (rows.length !== new Set(foreign).size) fail(400, "invalid_order", "順序不正確，請重新整理後再試");
        const per = new Map<string, string[]>();
        for (const id of foreign) per.set(rows.find((r) => r.id === id)!.course_id, [...(per.get(rows.find((r) => r.id === id)!.course_id) ?? []), id]);
        for (const [, list] of per) {
          const slots = rows.filter((r) => list.includes(r.id)).map((r) => r.position).sort((x, y) => x - y);
          foreignStmts.push(ctx.db.prepare(`UPDATE lessons SET position = -position WHERE id IN (${list.map(() => "?").join(",")})`).bind(...list), ...list.map((id, i) => ctx.db.prepare("UPDATE lessons SET position = ? WHERE id = ?").bind(slots[i]!, id)));
        }
      }
      if (ids.length) {
        // 套裝課程（杜杜龍 2026-11-19）：章節也可以放進區塊，所以傳進全部項目（章節、區塊、教材）時當成同一組一起排序。
        const mixed = ids.length === current.results.length;
        // 分類區域標題（section）和教材（material）同一組一起排序。
        const grp = (k: string | undefined) => (mixed ? "all" : k === "chapter" || k === undefined ? "chapter" : "material");
        const first = byId.get(ids[0]!)!;
        const group = current.results.filter((r) => grp(r.kind) === grp(first.kind));
        if (ids.length !== group.length || new Set(ids).size !== ids.length || ids.some((i) => grp(byId.get(i)?.kind) !== grp(first.kind))) fail(400, "invalid_order", "順序不正確，請重新整理後再試");
        const slots = group.map((r) => r.position).sort((x, y) => x - y);
        // 先移到負數避開 UNIQUE(course_id, position)，再寫入新順序。
        await ctx.db.batch([
          ctx.db.prepare(`UPDATE lessons SET position = -position WHERE id IN (${ids.map(() => "?").join(",")})`).bind(...ids),
          ...ids.map((id, i) => ctx.db.prepare("UPDATE lessons SET position = ? WHERE id = ?").bind(slots[i]!, id)),
          ...foreignStmts,
          audit(ctx.db, admin.sub, "lesson.reorder", "course", courseId),
        ]);
      } else if (foreignStmts.length) await ctx.db.batch([...foreignStmts, audit(ctx.db, admin.sub, "lesson.reorder", "course", courseId)]);
      else fail(400, "invalid_order", "順序不正確，請重新整理後再試");
      if (courseId === (await treasureCourseId(ctx.db).catch(() => null))) await syncSeriesOrderFromTreasure(ctx.db).catch(() => undefined); // 成交百寶箱區塊順序 → 品牌館卡片順序
      // 使用者手動調整過順序：這張卡的「同步 YouTube 清單」從此不再自動重排，只把新影片放進去（杜杜龍 2026-11-20）。
      await ctx.db.prepare("UPDATE youtube_syncs SET sort_locked = 1 WHERE course_id = ?").bind(courseId).run();
      if (ctx.url.searchParams.get("lite") === "1") return { ok: true };
      return courseDetail(ctx, courseId);
    },
  ],
];
