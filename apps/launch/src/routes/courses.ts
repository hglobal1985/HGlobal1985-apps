/** 行動大學 API 路由：課程：課程頁、教材、留言、分類品牌、系列（杜杜龍 2026-11-27 從 api.ts 拆出；順序會影響比對，同一檔內照原本順序）。 */
import type { SeriesArt, SeriesSetting } from "../contract.ts";
import { itemIconType } from "../link-rules.ts";
import { loadFileSettings } from "../material-files.ts";
import { audioUrl } from "../media.ts";
import { muxPlaybackUrl } from "../mux.ts";
import { DEMO_VIDEO_PATH, MB, VIEW_BASE, bumpView, canWatch, cancelOrder, courseDetail, fail, grantAchievements, iso, keywordChoices, lessonOf, listComments, listCourses, loadBrands, notify, openFreeCourse, parseCoverRect, pubUrl, randomId, ranks, readJson, requireCourseForComments, requireMember, resumePoint, text } from "../api-core.ts";
import type { Handler } from "../api-core.ts";

export const coursesRoutes: [string, RegExp, Handler][] = [
  ["GET", /^\/courses$/, async (ctx) => listCourses(ctx, false)],
  [
    "GET",
    /^\/courses\/([\w-]+)$/,
    async (ctx, [id]) => {
      // 已報名／學習過但被隱藏的恢復顯示；與讀取課程同時進行（課程頁的資料不受這兩個欄位影響）。
      const [, detail] = await Promise.all([openFreeCourse(ctx, id!).catch(() => undefined), courseDetail(ctx, id!)]);
      return detail;
    },
  ],
  [
    "POST",
    /^\/courses\/([\w-]+)\/hide-learning$/,
    async (ctx, [courseId]) => {
      const s = requireMember(ctx);
      const c = await ctx.db.prepare("SELECT price_twd FROM courses WHERE id = ?").bind(courseId).first<{ price_twd: number }>();
      if (!c) return fail(404, "not_found", "找不到這門課程");
      const enrolled = await ctx.db.prepare("SELECT 1 AS ok FROM enrollments WHERE member_sub = ? AND course_id = ?").bind(s.sub, courseId).first();
      if (enrolled) {
        if (c.price_twd !== 0) fail(403, "paid_course", "付費課程不能從學習中隱藏");
        await ctx.db.prepare("UPDATE enrollments SET hidden = 1 WHERE member_sub = ? AND course_id = ?").bind(s.sub, courseId).run();
      } else {
        // 沒報名、只是播放過的課程（管理員或公開課程）：隱藏播放紀錄那一筆。
        const r = await ctx.db.prepare("UPDATE learning_started SET hidden = 1 WHERE member_sub = ? AND course_id = ?").bind(s.sub, courseId).run();
        if (r.meta?.changes === 0) return c.price_twd !== 0 ? fail(403, "paid_course", "付費課程不能從學習中隱藏") : fail(404, "not_enrolled", "這門課程不在你的學習中");
      }
      return { ok: true };
    },
  ],
  [
    "POST",
    /^\/courses\/([\w-]+)\/lessons\/([\w-]+)\/started$/,
    async (ctx, [courseId, lessonId]) => {
      const s = requireMember(ctx);
      courseId = (await lessonOf(ctx, courseId, lessonId)).course_id; // 找不到章節時會丟錯；連結區塊的項目換成真正所屬的清單
      if (!(await canWatch(ctx, courseId))) fail(403, "not_enrolled", "請先報名並通過審核");
      // 播放超過 1%：納入學習中（已被隱藏的也恢復顯示）。
      await ctx.db
        .prepare("INSERT INTO learning_started (member_sub, course_id) VALUES (?, ?) ON CONFLICT(member_sub, course_id) DO UPDATE SET hidden = 0")
        .bind(s.sub, courseId)
        .run();
      await ctx.db.prepare("UPDATE enrollments SET hidden = 0 WHERE member_sub = ? AND course_id = ? AND hidden = 1").bind(s.sub, courseId).run();
      return { ok: true };
    },
  ],
  [
    "POST",
    /^\/courses\/([\w-]+)\/lessons\/([\w-]+)\/watch$/,
    async (ctx, [courseId, lessonId]) => {
      const s = requireMember(ctx);
      const body = await readJson<{ ratio?: unknown; position?: unknown }>(ctx.req);
      const ratio = Number(body.ratio);
      if (!Number.isFinite(ratio) || ratio < 0) fail(400, "invalid_ratio", "播放進度不正確");
      const pos = Number(body.position);
      const position = Number.isFinite(pos) && pos >= 0 && pos < 24 * 3600 ? Math.round(pos * 10) / 10 : null;
      courseId = (await lessonOf(ctx, courseId, lessonId)).course_id; // 找不到章節時會丟錯；連結區塊的項目換成真正所屬的清單
      if (!(await canWatch(ctx, courseId))) fail(403, "not_enrolled", "請先報名並通過審核");
      // 只會往前（取最大值），不會因為倒轉重看而退步。
      await ctx.db
        // ratio 只會往前（取最大值）；position_sec 是「最後播放到哪」（續播用，倒轉重看也照實記錄）。
        .prepare("INSERT INTO lesson_watch (member_sub, lesson_id, course_id, ratio, position_sec) VALUES (?, ?, ?, ?, ?) ON CONFLICT(member_sub, lesson_id) DO UPDATE SET ratio = MAX(ratio, excluded.ratio), position_sec = COALESCE(excluded.position_sec, position_sec), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')")
        .bind(s.sub, lessonId, courseId, Math.min(1, ratio), position)
        .run();
      return { ok: true };
    },
  ],
  [
    "POST",
    /^\/courses\/([\w-]+)\/lessons\/([\w-]+)\/complete$/,
    async (ctx, [courseId, lessonId]) => {
      const s = requireMember(ctx);
      courseId = (await lessonOf(ctx, courseId, lessonId)).course_id; // 找不到章節時會丟錯；連結區塊的項目換成真正所屬的清單
      if (!(await canWatch(ctx, courseId))) fail(403, "not_enrolled", "請先報名並通過審核");
      await ctx.db
        .prepare("INSERT OR IGNORE INTO lesson_progress (member_sub, lesson_id, course_id) VALUES (?, ?, ?)")
        .bind(s.sub, lessonId, courseId)
        .run();
      // 達成徽章條件就通知本人（失敗不影響進度記錄）。
      await grantAchievements(ctx, s.sub).catch(() => undefined);
      return { ok: true };
    },
  ],
  [
    "GET",
    /^\/courses\/([\w-]+)\/lessons\/([\w-]+)\/playback$/,
    async (ctx, [courseId, lessonId]) => {
      const lesson = await lessonOf(ctx, courseId, lessonId);
      courseId = lesson.course_id;
      if (!(await canWatch(ctx, courseId))) fail(ctx.session ? 403 : 401, ctx.session ? "not_enrolled" : "unauthenticated", ctx.session ? "請先報名並通過審核" : "請先登入");
      // 續播記憶（杜杜龍 2026-11-17）：還沒看完的這一堂，從上次播放到的秒數接著播（離起點不到 5 秒、離結尾不到 10 秒就從頭）。
      const resumeAt = await resumePoint(ctx, lessonId, lesson.start_seconds ?? 0, lesson.end_seconds);
      const seg = { start: lesson.start_seconds, end: lesson.end_seconds, ...(resumeAt != null ? { resumeAt } : {}) };
      if (lesson.media_type === "youtube" && lesson.media_ref) return { kind: "youtube", videoId: lesson.media_ref, ...seg };
      if (lesson.media_type === "mux" && lesson.media_ref) {
        const url = await muxPlaybackUrl(ctx.env, lesson.media_ref);
        if (!url) fail(503, "media_not_ready", "影片授權服務尚未設定，請稍後再試");
        return { kind: "hls", url, ...seg };
      }
      if (lesson.media_type === "audio" && lesson.media_ref) {
        const url = await audioUrl(ctx.env, lesson.media_ref);
        if (!url) fail(503, "media_not_ready", "音檔服務尚未設定，請稍後再試");
        return { kind: "audio", url, ...seg };
      }
      return { kind: "demo", url: DEMO_VIDEO_PATH, label: "示範影片（非正式課程內容）", ...seg };
    },
  ],
  [
    "GET",
    /^\/center-materials$/,
    async (ctx) => {
      // 中心頁「清單」分頁（杜杜龍 2026-11-21）：把指定這批課程裡「所有教材」（章節與其他教材，不含區塊標題與完整版影片）攤平成一份清單。
      // 只回標題、日期、分享者與類型圖示（公開資料）；連結與檔案網址不在這裡，點下去進該課程頁，由課程頁依權限處理。
      const ids = [...new Set((ctx.url.searchParams.get("ids") ?? "").split(",").map((x) => x.trim()).filter((x) => /^[A-Za-z0-9_-]{1,40}$/.test(x)))].slice(0, 300);
      if (!ids.length) return { items: [] };
      const rankMap = await ranks(ctx.db);
      const me = ctx.session;
      const sub = me?.sub ?? "";
      const scopeSql = !me
        ? "c.view_scope = 'all'"
        : me.role === "admin"
          ? "c.view_scope NOT IN ('link_login', 'link_guest')"
          : `(c.view_scope IN ('all', 'members'${me.hglobal ? ", 'hglobal'" : ""}${me.center ? ", 'center'" : ""}) OR (c.view_scope NOT IN ('link_login', 'link_guest') AND c.id IN (SELECT course_id FROM enrollments WHERE member_sub = ?)))`;
      // 連同區塊標題一起讀（依課程、順序）：區塊底下的教材帶 block 名稱，畫面用「區塊或課程名稱」分組。
      const { results } = await ctx.db
        .prepare(
          `SELECT l.id AS id, l.course_id AS courseId, c.title AS courseTitle, l.position AS position, l.title AS title, l.kind AS kind, l.sharer AS sharer, l.sharer_rank AS sharerRank, COALESCE(l.event_date, c.event_start) AS eventDate, l.media_type AS mediaType,
            ((l.media_type <> 'demo' AND l.media_ref IS NOT NULL) OR l.duration_minutes > 0 OR EXISTS (SELECT 1 FROM lesson_attachments a WHERE a.lesson_id = l.id AND a.kind IN ('link', 'file'))) AS ok,
            (SELECT a.att_type FROM lesson_attachments a WHERE a.lesson_id = l.id AND a.kind IN ('link', 'file') ORDER BY a.created_at LIMIT 1) AS attType
           FROM lessons l JOIN courses c ON c.id = l.course_id
           WHERE c.status = 'published' AND c.id IN (${ids.map(() => "?").join(",")}) AND ${scopeSql} AND l.kind IN ('chapter', 'material', 'section') AND l.is_full = 0
           ORDER BY l.course_id, l.position`,
        )
        .bind(...ids, ...(me && me.role !== "admin" ? [sub] : []))
        .all<{ id: string; courseId: string; courseTitle: string; position: number; title: string; kind: string; sharer: string; sharerRank: string; eventDate: string | null; mediaType: string; ok: number; attType: string | null }>();
      const items: object[] = [];
      let curCourse = "";
      let block: string | null = null;
      let blockId: string | null = null;
      for (const r of results) {
        if (r.courseId !== curCourse) {
          curCourse = r.courseId;
          block = null;
          blockId = null;
        }
        if (r.kind === "section") {
          block = r.title;
          blockId = r.id;
          continue;
        }
        if (!r.ok) continue;
        const icon = itemIconType((r.attType ?? undefined) as never, r.mediaType, true);
        items.push({
          id: r.id,
          courseId: r.courseId,
          courseTitle: r.courseTitle,
          block,
          blockId,
          title: r.title,
          kind: r.kind,
          sharer: r.sharer,
          sharerRankName: rankMap.get(r.sharerRank)?.name ?? "",
          eventDate: r.eventDate,
          ...(icon ? { iconType: icon } : {}),
        });
      }
      return { items };
    },
  ],
  // 全部課程的「分類」下拉：與「關鍵字管理」的分類清單同步（含目前沒有課程使用的分類）。
  ["GET", /^\/categories$/, async (ctx) => keywordChoices(ctx, "category", null)],
  // 品牌清單（杜杜龍 2026-11-18）：選品牌與篩選用，只回有上傳 logo 的品牌。
  ["GET", /^\/brands$/, async (ctx) => (await loadBrands(ctx.db)).map((b) => ({ id: b.id, name: b.name }))],
  [
    "POST",
    /^\/courses\/([\w-]+)\/cancel-registration$/,
    async (ctx, [courseId]) => {
      // 從課程頁取消：找出自己這門課可取消的報名。
      const s = requireMember(ctx);
      const row = await ctx.db
        .prepare("SELECT o.id FROM orders o JOIN order_items i ON i.order_id = o.id WHERE o.member_sub = ? AND i.course_id = ? AND (o.status = 'pending' OR (o.status = 'opened' AND (o.pay_method = 'free' OR o.join_method = 'invite'))) LIMIT 1")
        .bind(s.sub, courseId)
        .first<{ id: string }>();
      if (!row) return fail(409, "not_cancellable", "找不到可以取消的報名（已繳費開通的報名請聯絡報名窗口）");
      return cancelOrder(ctx, row.id);
    },
  ],
  ["GET", /^\/courses\/([\w-]+)\/comments$/, async (ctx, [id]) => listComments(ctx, id)],
  [
    "POST",
    /^\/courses\/([\w-]+)\/comments$/,
    async (ctx, [courseId]) => {
      const s = await requireCourseForComments(ctx, courseId);
      const body = text((await readJson<{ body?: unknown }>(ctx.req)).body, 500) || fail(400, "empty", "請輸入留言內容");
      const recent = await ctx.db.prepare("SELECT COUNT(*) AS n FROM course_comments WHERE member_sub = ? AND created_at > ?").bind(s.sub, iso(new Date(Date.now() - 600_000))).first<{ n: number }>();
      if ((recent?.n ?? 0) >= 5) fail(429, "too_many", "留言太頻繁了，請稍後再試");
      await ctx.db.prepare("INSERT INTO course_comments (id, course_id, member_sub, member_name, body, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), courseId, s.sub, s.name, body, iso()).run();
      return listComments(ctx, courseId);
    },
  ],
  [
    "DELETE",
    /^\/comments\/([\w-]+)$/,
    async (ctx, [id]) => {
      const s = requireMember(ctx);
      const res = await ctx.db.prepare("DELETE FROM course_comments WHERE id = ? AND member_sub = ?").bind(id, s.sub).run();
      if (res.meta?.changes === 0) fail(404, "not_found", "找不到這則留言");
      return { ok: true };
    },
  ],
  [
    "POST",
    /^\/comments\/([\w-]+)\/report$/,
    async (ctx, [id]) => {
      const s = requireMember(ctx);
      const c = await ctx.db.prepare("SELECT c.member_sub, c.body, k.title FROM course_comments c JOIN courses k ON k.id = c.course_id WHERE c.id = ? AND c.status = 'visible'").bind(id).first<{ member_sub: string; body: string; title: string }>();
      if (!c) return fail(404, "not_found", "找不到這則留言");
      if (c.member_sub === s.sub) fail(400, "own_comment", "不能檢舉自己的留言");
      const reason = text((await readJson<{ reason?: unknown }>(ctx.req)).reason, 200) ?? "";
      const first = !(await ctx.db.prepare("SELECT 1 AS ok FROM comment_reports WHERE comment_id = ? LIMIT 1").bind(id).first());
      await ctx.db.batch([
        ctx.db.prepare("INSERT OR IGNORE INTO comment_reports (comment_id, reporter_sub, reason) VALUES (?, ?, ?)").bind(id, s.sub, reason),
        // 同一則留言只在第一次被檢舉時通知總部，避免洗版。
        ...(first ? [notify(ctx.db, { role: "admin" }, "有留言被檢舉", `${c.title}：${c.body.slice(0, 60)}`, "/admin/comments")] : []),
      ]);
      return { ok: true };
    },
  ],
  [
    "POST",
    /^\/comments\/([\w-]+)\/block$/,
    async (ctx, [id]) => {
      const s = requireMember(ctx);
      const c = await ctx.db.prepare("SELECT member_sub FROM course_comments WHERE id = ?").bind(id).first<{ member_sub: string }>();
      if (!c) return fail(404, "not_found", "找不到這則留言");
      if (c.member_sub === s.sub) fail(400, "own_comment", "不能封鎖自己");
      await ctx.db.prepare("INSERT OR IGNORE INTO comment_blocks (member_sub, blocked_sub) VALUES (?, ?)").bind(s.sub, c.member_sub).run();
      return { ok: true };
    },
  ],
  [
    "POST",
    /^\/materials\/([\w-]+)\/ticket$/,
    async (ctx, [attId]) => {
      // 下載教材檔案：先檢查權限（沿用該課程／清單的規則：誰能瀏覽、獎銜、報名、付費審核），通過才發一次性下載連結。
      const s = ctx.session;
      if (!s) return fail(401, "unauthenticated", "請先登入後再下載");
      const att = await ctx.db.prepare("SELECT id, lesson_id, course_id, name, size FROM lesson_attachments WHERE id = ? AND kind = 'file'").bind(attId).first<{ id: string; lesson_id: string; course_id: string; name: string; size: number }>();
      if (!att) return fail(404, "not_found", "找不到這個檔案");
      // 權限一律以「課程頁實際給這位會員看到的內容」為準：有拿到下載網址（沒被鎖住）才能下載。
      const detail = await courseDetail(ctx, att.course_id);
      const lesson = detail.lessons.find((l) => l.id === att.lesson_id);
      if (!lesson?.linkUrl) return fail(403, "forbidden", "你目前沒有下載這個檔案的權限（可能尚未報名，或獎銜、身分不符）");
      const set = await loadFileSettings(ctx.db);
      if (s.role !== "admin" && (set.dailyDownloads > 0 || set.dailyDownloadMb > 0)) {
        const use = await ctx.db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS bytes FROM material_downloads WHERE member_sub = ? AND created_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day')").bind(s.sub).first<{ n: number; bytes: number }>();
        if (set.dailyDownloads > 0 && (use?.n ?? 0) >= set.dailyDownloads) return fail(429, "download_limit", "你今天下載的次數已達上限，請明天再試");
        if (set.dailyDownloadMb > 0 && (use?.bytes ?? 0) + att.size > set.dailyDownloadMb * MB) return fail(429, "download_limit", "你今天下載的流量已達上限，請明天再試");
      }
      const id = `${randomId(16)}${randomId(16)}`;
      await ctx.db.batch([
        ctx.db.prepare("DELETE FROM download_tickets WHERE expires_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day')"),
        ctx.db.prepare("INSERT INTO download_tickets (id, att_id, member_sub, member_name, expires_at) VALUES (?, ?, ?, ?, ?)").bind(id, att.id, s.sub, s.name.slice(0, 60), iso(new Date(Date.now() + set.ticketSec * 1000))),
      ]);
      return { url: `${ctx.url.origin}/api/v2/media/dl?t=${id}`, name: att.name };
    },
  ],
  [
    "GET",
    /^\/series-settings$/,
    async (ctx) => {
      const { results } = await ctx.db.prepare("SELECT series, title, show_in_all FROM series_settings").all<{ series: string; title: string; show_in_all: number }>();
      return results.map((r): SeriesSetting => ({ series: r.series, title: r.title, showInAll: r.show_in_all === 1 }));
    },
  ],
  [
    "GET",
    /^\/series-art$/,
    async (ctx): Promise<SeriesArt[]> => {
      const { results } = await ctx.db
        .prepare("SELECT series, edm_key, art_version, cover_key, cover_rect, edm_view_y FROM series_art ORDER BY series")
        .all<{ series: string; edm_key: string; art_version: number; cover_key: string | null; cover_rect: string | null; edm_view_y: number }>();
      return results.map((r) => ({
        series: r.series,
        edmUrl: pubUrl(r.edm_key, r.art_version),
        coverUrl: r.cover_key ? pubUrl(r.cover_key, r.art_version) : null,
        coverRect: parseCoverRect(r.cover_rect),
        edmViewY: r.edm_view_y,
      }));
    },
  ],
  [
    "POST",
    /^\/course-views$/,
    async (ctx) => {
      // 從課程連結直接進入課程頁，也算進「該課程主辦中心封面」與「所屬系列封面」的點閱（杜杜龍 2026-11-17：不分訪客、可重複、重新整理就 +1）。
      const body = await readJson<{ courseId?: unknown }>(ctx.req);
      const id = typeof body.courseId === "string" ? body.courseId.slice(0, 40) : "";
      const row = id ? await ctx.db.prepare("SELECT host_center_key AS hk, series FROM courses WHERE id = ? AND status = 'published'").bind(id).first<{ hk: string | null; series: string }>() : null;
      if (!row) return { ok: false };
      if (row.hk) await bumpView(ctx.db, "center", row.hk);
      if (row.series?.trim()) await bumpView(ctx.db, "series", row.series.trim());
      // 課程／清單自己頁面的點閱（封面統一顯示；杜杜龍 2026-11-18）。
      return { ok: true, total: VIEW_BASE + (await bumpView(ctx.db, "course", id)) };
    },
  ],
  [
    "POST",
    /^\/series-views$/,
    async (ctx) => {
      // 系列頁點閱計數：每進入一次就 +1（與中心頁相同規則，訪客也算）；回傳累計次數。
      const body = await readJson<{ series?: unknown }>(ctx.req);
      const name = typeof body.series === "string" ? body.series.trim().slice(0, 60) : "";
      if (!name) fail(400, "invalid_series", "請指定系列");
      return { total: VIEW_BASE + (await bumpView(ctx.db, "series", name)) };
    },
  ],
];
