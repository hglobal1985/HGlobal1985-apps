/** 行動大學 API 共用核心：關鍵字、審核群組、課程留言板、路由輔助（杜杜龍 2026-11-27 從 api-core.ts 依功能拆出；api-core.ts 會全部轉出，舊的 import 不用改）。 */
import { romanizeName, romanizeTitle } from "../romanize.ts";
import { UNCATEGORIZED, type CourseComment, type Duty, type ReviewGroup, type CourseDetail } from "../contract.ts";
import { libraryNumber } from "../library.ts";
import { ListError, quotaOf } from "../my-lists.ts";
import { memberNumberOf, centerKey } from "../central.ts";
import type { D1Database, D1PreparedStatement } from "../d1.ts";
import { AI_JOBS, AI_MODELS, keyStatuses, loadSelection, usageSummary } from "../ai-models.ts";
import { loadConfig } from "../ui-config.ts";
import { type Ctx, type Session, audit, fail, iso, readJson, requireMember } from "./base.ts";
import { SUMMARY_TITLE, courseDetail, courseRightsFor, ensureCourseUrl, hostCenterOf, notifyEnrolled, notifyNewCourse, pubUrl, rightsOf } from "./course-admin.ts";
import { type MediaType, youtubeId } from "./series.ts";
import { randomId } from "./media.ts";
import { CAT_SEP, assertCentralRank, checkGuidanceGroup, checkPublicFree, courseFields, dayOrNull, deriveIsPublic, joinCats, noteJobTitle, splitCats, text } from "./library.ts";

// ---------- 關鍵字（分類、系列、場地）：超級管理員集中管理 ----------
export const KEYWORD_COLUMN = { category: "category", series: "series", location: "location" } as const;
export type KeywordKind = keyof typeof KEYWORD_COLUMN;
export const keywordKind = (v: unknown): KeywordKind => (v === "category" || v === "series" || v === "location" ? v : fail(400, "invalid_kind", "關鍵字類型不正確"));
export const keywordText = (v: unknown): string => {
  const t = typeof v === "string" ? v.trim().slice(0, 60) : "";
  return t || fail(400, "invalid_keyword", "請輸入關鍵字");
};

/** 課程編輯頁「已有的…」選項：課程已經用過的值＋超級管理員預先建立的（centerKey 不為 null 時，已用過的只算自己中心的課程）。 */
export async function keywordChoices(ctx: Ctx, kind: KeywordKind, centerKey: string | null): Promise<string[]> {
  const col = KEYWORD_COLUMN[kind];
  const used = await ctx.db
    .prepare(`SELECT DISTINCT ${col} AS v FROM courses WHERE ${col} <> ''${centerKey !== null ? " AND host_center_key = ?" : ""}`)
    .bind(...(centerKey !== null ? [centerKey] : []))
    .all<{ v: string }>();
  const preset = await ctx.db.prepare("SELECT value AS v FROM keywords WHERE kind = ?").bind(kind).all<{ v: string }>();
  const usedValues = kind === "category" ? used.results.flatMap((r) => splitCats(r.v)) : used.results.map((r) => r.v);
  return [...new Set([...usedValues, ...preset.results.map((r) => r.v)])].sort((a, b) => a.localeCompare(b, "zh-Hant"));
}

/** 把每門課的分類清單用 fn 改寫（改名、刪除用），只產生真的有變動的更新。 */
export async function rewriteCategories(ctx: Ctx, fn: (list: string[]) => string): Promise<D1PreparedStatement[]> {
  const { results } = await ctx.db.prepare("SELECT id, category FROM courses WHERE category <> ''").all<{ id: string; category: string }>();
  return results.flatMap((r) => {
    const next = fn(splitCats(r.category));
    return next === r.category ? [] : [ctx.db.prepare("UPDATE courses SET category = ? WHERE id = ?").bind(next, r.id)];
  });
}

export type ShortLinkItem = { kind: "category" | "series" | "center"; value: string; slug: string | null };
/** 短網址設定清單：所有分類與系列（含還沒設定縮寫的），各帶目前的縮寫。 */
export async function aiModelsView(ctx: Ctx) {
  return { jobs: AI_JOBS, models: AI_MODELS, selection: await loadSelection(ctx.db), usage: await usageSummary(ctx.db), keys: keyStatuses(ctx.env) };
}

/** 縮寫 → 它指向的分類／系列／中心；現在的縮寫優先，找不到再看「改名前的舊縮寫」（舊網址永遠有效）。 */
export async function slugTarget(db: D1Database, slug: string, kind?: string): Promise<{ kind: string; value: string } | null> {
  const cond = kind ? " AND kind = ?" : "";
  const bind = kind ? [slug, kind] : [slug];
  return (
    (await db.prepare(`SELECT kind, value FROM short_links WHERE slug = ? COLLATE NOCASE${cond}`).bind(...bind).first<{ kind: string; value: string }>()) ??
    (await db.prepare(`SELECT kind, value FROM short_link_aliases WHERE slug = ? COLLATE NOCASE${cond}`).bind(...bind).first<{ kind: string; value: string }>())
  );
}

export async function listShortLinks(ctx: Ctx): Promise<ShortLinkItem[]> {
  const [kw, links] = await Promise.all([listKeywords(ctx), ctx.db.prepare("SELECT slug, kind, value FROM short_links").all<{ slug: string; kind: string; value: string }>()]);
  const slugOf = new Map(links.results.map((r) => [`${r.kind}:${r.value}`, r.slug]));
  const out: ShortLinkItem[] = [];
  for (const kind of ["category", "series"] as const) for (const k of kw[kind]) out.push({ kind, value: k.value, slug: slugOf.get(`${kind}:${k.value}`) ?? null });
  // 中心：課程的主辦中心（名稱在寫入時已確認是會員中心清單內的）＋已上傳 EDM 或已設定短網址的中心。
  const hosts = await ctx.db.prepare("SELECT DISTINCT host_unit AS v FROM courses WHERE host_center_key IS NOT NULL").all<{ v: string }>();
  const arts = await ctx.db.prepare("SELECT center_label AS v FROM center_art").all<{ v: string }>();
  const centers = new Set([...hosts.results.map((r) => hostCenterOf(r.v)), ...arts.results.map((r) => r.v), ...links.results.filter((r) => r.kind === "center").map((r) => r.value)].filter(Boolean));
  for (const v of [...centers].sort((a, b) => a.localeCompare(b, "zh-Hant"))) out.push({ kind: "center", value: v, slug: slugOf.get(`center:${v}`) ?? null });
  return out;
}

export type KeywordItem = { value: string; count: number; preset: boolean; edmUrl?: string | null };
export async function listKeywords(ctx: Ctx): Promise<Record<KeywordKind, KeywordItem[]>> {
  const out = {} as Record<KeywordKind, KeywordItem[]>;
  for (const kind of Object.keys(KEYWORD_COLUMN) as KeywordKind[]) {
    const col = KEYWORD_COLUMN[kind];
    const [used, preset] = await Promise.all([
      ctx.db.prepare(`SELECT ${col} AS v, COUNT(*) AS n FROM courses WHERE ${col} <> '' GROUP BY ${col}`).all<{ v: string; n: number }>(),
      ctx.db.prepare("SELECT value AS v FROM keywords WHERE kind = ?").bind(kind).all<{ v: string }>(),
    ]);
    const map = new Map<string, KeywordItem>();
    for (const r of used.results) {
      for (const v of kind === "category" ? splitCats(r.v) : [r.v]) map.set(v, { value: v, count: (map.get(v)?.count ?? 0) + r.n, preset: false });
    }
    for (const r of preset.results) map.set(r.v, { value: r.v, count: map.get(r.v)?.count ?? 0, preset: true });
    if (kind === "series") {
      const art = await ctx.db.prepare("SELECT series, edm_key, art_version FROM series_art").all<{ series: string; edm_key: string; art_version: number }>();
      for (const a of art.results) {
        const it = map.get(a.series) ?? { value: a.series, count: 0, preset: true };
        map.set(a.series, { ...it, edmUrl: pubUrl(a.edm_key, a.art_version) });
      }
    }
    out[kind] = [...map.values()].sort((a, b) => a.value.localeCompare(b.value, "zh-Hant"));
  }
  return out;
}

/** 複製這門課，建立下一梯：基本資料、章節架構照搬；活動日期、早鳥與限時免費、EDM／封面、附件、音檔不帶（避免共用同一份檔案）。新課程是草稿。 */
export async function duplicateCourse(ctx: Ctx, id: string, admin: Session) {
  const row = await ctx.db.prepare("SELECT * FROM courses WHERE id = ?").bind(id).first<Record<string, unknown>>();
  if (!row) return fail(404, "not_found", "找不到這門課程");
  const { results: lessons } = await ctx.db
    .prepare("SELECT title, sharer, sharer_rank, sharer_title, position, duration_minutes, media_type, media_ref, start_seconds, end_seconds, kind, is_full FROM lessons WHERE course_id = ? ORDER BY position")
    .bind(id)
    .all<{ title: string; sharer: string; sharer_rank: string; sharer_title: string; position: number; duration_minutes: number; media_type: MediaType; media_ref: string | null; start_seconds: number | null; end_seconds: number | null; kind: string; is_full: number }>();
  const newId = `c${randomId(7)}`;
  const series = String(row.series || "").trim() || String(row.title ?? "").slice(0, 60);
  const max = await ctx.db.prepare("SELECT COALESCE(MAX(sort_order), 0) AS m FROM courses").first<{ m: number }>();
  const keep = ["zone", "view_scope", "subtitle", "teacher", "teacher_rank", "teacher_title", "no_speaker", "is_package", "category", "price_twd", "min_rank_code", "theme", "description", "guidance_unit", "host_unit", "host_center_key", "review_group_id", "allow_president", "is_public", "price_tba", "hide_home", "brand_id", "diamond_free", "location", "location_none", "is_online", "chapter_covers", "auto_cover", "center_course"];
  const cols = ["id", "sort_order", "status", "title", "series", "created_by_sub", "edited_by_name", "edited_at", ...keep];
  const vals = [newId, (max?.m ?? 0) + 1, "draft", `${String(row.title ?? "")}（複製）`.slice(0, 120), series, admin.sub, admin.name.slice(0, 60), iso(), ...keep.map((k) => row[k] ?? null)];
  const stmts: D1PreparedStatement[] = [
    ctx.db.prepare(`INSERT INTO courses (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).bind(...vals),
    ...lessons.map((l) => {
      const audio = l.media_type === "audio"; // 音檔是這門課自己的檔案，不共用
      return ctx.db
        .prepare("INSERT INTO lessons (id, course_id, position, title, sharer, sharer_rank, sharer_title, duration_minutes, media_type, media_ref, start_seconds, end_seconds, kind, is_full) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(`${newId}-${randomId(6)}`, newId, l.position, l.title, l.sharer, l.sharer_rank, l.sharer_title, audio ? 0 : l.duration_minutes, audio ? "demo" : l.media_type, audio ? null : l.media_ref, audio ? null : l.start_seconds, audio ? null : l.end_seconds, l.kind, l.is_full);
    }),
    audit(ctx.db, admin.sub, "course.duplicate", "course", newId, id),
  ];
  if (!String(row.series || "").trim()) stmts.push(ctx.db.prepare("UPDATE courses SET series = ? WHERE id = ?").bind(series, id));
  await ctx.db.batch(stmts);
  return courseDetail(ctx, newId);
}

/** 把課程的「名稱、主講人、獎銜、職稱」套到這門課的主講人章節（沒有主講人章節就不動）。 */

export async function updateCourse(ctx: Ctx, id: string) {
  return updateCourseWith(ctx, id, await readJson<Record<string, unknown>>(ctx.req));
}
/** 儲存課程設定的核心（單一課程儲存與「套用到全系列課程」共用）；light＝不重建整份課程資料（批次套用用）。 */
export async function updateCourseWith(ctx: Ctx, id: string, body: Record<string, unknown>, light = false) {
  const { s: admin, can } = await courseRightsFor(ctx, id);
  const cur = await ctx.db.prepare("SELECT invite_only, status, view_scope, url_name, series, mat_url, host_center_key, guidance_unit, review_group_id, price_twd, is_public, price_tba, min_rank_code, updated_at, edited_by_name, event_start, event_end, location, title, is_list, teacher, no_speaker, zone FROM courses WHERE id = ?").bind(id).first<{ invite_only: number; zone: string | null; event_start: string | null; event_end: string | null; location: string | null; title: string; is_list: number; teacher: string | null; no_speaker: number; status: string; view_scope: string; url_name: string | null; series: string; mat_url: string | null; host_center_key: string | null; guidance_unit: string; review_group_id: string | null; price_twd: number; is_public: number; min_rank_code: string; price_tba: number; updated_at: string; edited_by_name: string }>();
  if (!cur) return fail(404, "not_found", "找不到這門課程");
  // 狀態：下架封存要「刪除」權限；從封存還原只有總部、會長、音控；其餘修改要「修改」權限。
  const onlyStatus = Object.keys(body).every((k) => k === "status" || k === "ifUpdatedAt" || k === "force");
  if (body.status === "archived" && cur.status !== "archived") {
    if (!can.remove) fail(403, "forbidden", "沒有下架封存這門課程的權限");
  } else if (cur.status === "archived" && body.status !== undefined && body.status !== "archived") {
    if (!can.restore) fail(403, "forbidden", "還原封存的課程只有總部、會長與音控可以做");
  } else if (!can.edit) fail(403, "forbidden", "沒有修改這門課程的權限");
  if (!onlyStatus && !can.edit) fail(403, "forbidden", "沒有修改這門課程的權限");
  // 別人剛改過：帶 ifUpdatedAt 的儲存，若資料已被改過就先提醒（force 仍要覆蓋）。
  if (typeof body.ifUpdatedAt === "string" && body.ifUpdatedAt !== cur.updated_at && body.force !== true)
    fail(409, "edit_conflict", `這門課程剛被${cur.edited_by_name || "其他管理者"}修改過，請重新載入後再改，或選擇仍要覆蓋`);
  const sets = await courseFields(ctx, body, false, admin);
  if (!sets.length) fail(400, "nothing_to_update", "沒有要更新的欄位");
  // 換了主辦中心：專屬網址在新中心底下重新產生（主辦中心沒變就維持原網址）。
  const newHost = sets.find(([c]) => c === "host_center_key");
  const aliasStmts: D1PreparedStatement[] = [];
  const keepOld = (reason: string) => {
    // 舊網址存成別名：之前分享出去的連結照樣打得開（開啟後網址列會自動換成新的）。
    if (cur.url_name) aliasStmts.push(ctx.db.prepare("INSERT OR REPLACE INTO course_url_aliases (scope, url_name, course_id) VALUES (?, ?, ?)").bind(cur.host_center_key ? centerKey(cur.host_center_key) : "", cur.url_name, id));
    sets.push(["url_name", null]);
    void reason;
  };
  if (newHost && newHost[1] !== cur.host_center_key) keepOld("host");
  else {
    // 主講人改了（或勾了「無」改用課程名稱）：專屬網址（/中心縮寫/英譯-編號）跟著換；英譯結果一樣（只是改錯字等）就不動。
    const setVal = (col: string) => sets.find(([c]) => c === col)?.[1];
    const noNow = (setVal("no_speaker") ?? cur.no_speaker) === 1;
    const touched = sets.some(([c]) => c === "teacher" || c === "no_speaker" || (c === "title" && noNow));
    if (touched && cur.url_name) {
      const src = noNow ? String(setVal("title") ?? cur.title) : String(setVal("teacher") ?? cur.teacher ?? "");
      const base = noNow ? romanizeTitle(src) : src.trim() ? romanizeName(src) : "";
      const oldBase = cur.url_name.replace(/-\d+$/, "");
      if (base && base.toLowerCase() !== oldBase.toLowerCase()) keepOld("name");
    }
  }
  const pick = (col: string, old: unknown) => (sets.find(([c]) => c === col) ?? [col, old])[1];
  // 付費課程的邀請碼：目前只有超級管理員能設定（杜杜龍 2026-11-20）；免費課程由有編輯權的人設定。
  if (sets.some(([c]) => c === "invite_code") && (Number(pick("price_twd", cur.price_twd)) > 0 || pick("price_tba", cur.price_tba) === 1) && !admin.roles.includes("super_admin")) fail(403, "invite_code_super_admin", "付費課程的邀請碼只有超級管理員可以設定");
  const legacyPublic = body.isPublic !== undefined && body.viewScope === undefined;
  if (legacyPublic) {
    // 舊寫法：isPublic true＝所有人；false 只在原本是「所有人」時改成「所有會員」。
    checkPublicFree(Number(pick("price_twd", cur.price_twd)), body.isPublic === true, pick("price_tba", cur.price_tba) === 1);
    if (body.isPublic === true) sets.push(["view_scope", "all"]);
    else if (cur.view_scope === "all") sets.push(["view_scope", "members"]);
  }
  deriveIsPublic(sets, cur);
  const serSet = sets.find(([c]) => c === "series");
  if (serSet && !String(serSet[1] ?? "").trim() && cur.zone !== "amway_brand") serSet[1] = UNCATEGORIZED; // 清掉系列＝回到「未分類」（品牌卡不受影響，它們本來就沒有系列）
  // 清單網址：同一個系列內不可重複（也不能撞到別份素材改名前的舊網址）；改名後舊網址記進別名永遠有效。
  const matSet = sets.find(([c]) => c === "mat_url");
  const matAlias: D1PreparedStatement[] = [];
  if (matSet) {
    const newName = matSet[1] as string | null;
    const ser = String(pick("series", cur.series) ?? "");
    if (newName) {
      const clash = await ctx.db.prepare("SELECT id FROM courses WHERE series = ? AND mat_url = ? COLLATE NOCASE AND id <> ? UNION SELECT course_id FROM material_url_aliases WHERE series = ? AND name = ? COLLATE NOCASE AND course_id <> ?").bind(ser, newName, id, ser, newName, id).first();
      if (clash) fail(400, "mat_url_taken", "這個清單網址已被這個系列的其他清單卡使用，請換一個");
    }
    if (cur.mat_url && cur.mat_url !== newName) matAlias.push(ctx.db.prepare("INSERT OR IGNORE INTO material_url_aliases (series, name, course_id) VALUES (?, ?, ?)").bind(cur.series, cur.mat_url, id));
  }
  await checkGuidanceGroup(ctx, pick("guidance_unit", cur.guidance_unit), pick("review_group_id", cur.review_group_id));
  const batchRes = await ctx.db.batch([
    ...matAlias,
    ...aliasStmts,
    ctx.db.prepare(`UPDATE courses SET ${sets.map(([c]) => `${c} = ?`).join(", ")}, updated_at = ?, edited_by_name = ?, edited_at = ? WHERE id = ?`).bind(...sets.map(([, v]) => v), iso(), admin.name.slice(0, 60), iso(), id),
    // 主講人章節的名稱、分享者、獎銜、職稱永遠等於課程基本資料：課程改了就一起同步。
    audit(ctx.db, admin.sub, "course.update", "course", id, sets.map(([c]) => c).join(",")),
  ]);
  const res = batchRes[matAlias.length + aliasStmts.length]!;
  if (res.meta?.changes === 0) fail(404, "not_found", "找不到這門課程");
  // 專區跟著「系列」走：同一個系列的課程一起換專區，避免同一張卡拆在兩個專區。
  const zoneSet = sets.find(([c]) => c === "zone");
  const serNow = String(pick("series", cur.series) ?? "");
  if (zoneSet && serNow && serNow !== UNCATEGORIZED) await ctx.db.prepare("UPDATE courses SET zone = ? WHERE series = ?").bind(zoneSet[1], serNow).run();
  await ensureCourseUrl(ctx, id);
  if (pick("status", cur.status) === "published" && cur.status !== "published") await notifyNewCourse(ctx, id);
  // 上課日期或地點改了：已報名的學員收到更新通知（報名＝訂閱，杜杜龍 2026-11-18）。
  const changed = (col: "event_start" | "event_end" | "location") => sets.some(([c, v]) => c === col && v !== cur[col]);
  if (cur.is_list !== 1 && cur.status === "published" && (changed("event_start") || changed("event_end") || changed("location"))) {
    await notifyEnrolled(ctx.db, id, `${cur.title.slice(0, 40)}時間或地點有更新`, "請打開課程頁確認最新的日期與地點", `/course/${id}`, admin.sub, null).catch(() => undefined);
  }
  return light ? ({ ok: true } as unknown as CourseDetail) : courseDetail(ctx, id);
}

export async function renumber(db: D1Database, courseId: string) {
  const { results } = await db.prepare("SELECT id FROM lessons WHERE course_id = ? ORDER BY position").bind(courseId).all<{ id: string }>();
  await db.batch([
    db.prepare("UPDATE lessons SET position = -position WHERE course_id = ?").bind(courseId),
    ...results.map((r, i) => db.prepare("UPDATE lessons SET position = ? WHERE id = ?").bind(i + 1, r.id)),
  ]);
}

export const seconds = (v: unknown): number | null | undefined => {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 24 * 3600) fail(400, "invalid_time", "時間格式不正確");
  return n;
};

/** 修改章節：名稱、影片來源（示範／YouTube／Mux）、時間軸區間。音檔由上傳流程設定。 */
/** 區塊的品牌（單選）與分類（可複選）。 */
export async function blockBrand(ctx: Ctx, v: unknown): Promise<string | null> {
  const id = typeof v === "string" ? v.trim() : "";
  if (!id) return null;
  if (!(await ctx.db.prepare("SELECT 1 AS ok FROM brand_logos WHERE id = ?").bind(id).first())) fail(400, "invalid_brand", "找不到這個品牌");
  return id;
}
export const blockCats = (v: unknown): string => (Array.isArray(v) ? joinCats(splitCats(v.filter((x): x is string => typeof x === "string").join(CAT_SEP))) : typeof v === "string" ? joinCats(splitCats(v)) : "").slice(0, 120);
/** 「主題」（原主講人標記）：每個區塊（或最前面還沒歸區塊的教材）只能有一個，勾新的時原本那個自動取消。 */
export function clearThemeInBlock(db: D1Database, courseId: string, id: string): D1PreparedStatement {
  return db
    .prepare(
      "UPDATE lessons SET is_speaker = 0 WHERE course_id = ?1 AND kind = 'material' AND is_speaker = 1 AND id <> ?2 AND position > COALESCE((SELECT MAX(position) FROM lessons WHERE course_id = ?1 AND kind = 'section' AND position < (SELECT position FROM lessons WHERE id = ?2)), -1) AND position < COALESCE((SELECT MIN(position) FROM lessons WHERE course_id = ?1 AND kind = 'section' AND position > (SELECT position FROM lessons WHERE id = ?2)), 1000000000)",
    )
    .bind(courseId, id);
}
export async function updateLesson(ctx: Ctx, id: string, admin: Session) {
  const body = await readJson<{ isSpeaker?: unknown; isSummary?: unknown; eventDate?: unknown; title?: unknown; sharer?: unknown; sharerRank?: unknown; sharerTitle?: unknown; mediaType?: unknown; mediaRef?: unknown; minutes?: unknown; startSeconds?: unknown; endSeconds?: unknown; inSheet?: unknown; brandId?: unknown; categories?: unknown }>(ctx.req);
  if (body.mediaType === "mux" && !admin.roles.includes("super_admin")) fail(403, "forbidden", "Mux 影片只有超級管理員可以設定，請改用 YouTube 或音檔");
  const cur = await ctx.db
    .prepare("SELECT course_id, kind, is_speaker, is_summary, media_type, media_ref, start_seconds, end_seconds FROM lessons WHERE id = ?")
    .bind(id)
    .first<{ course_id: string; kind: string; is_speaker: number; is_summary: number; media_type: MediaType; media_ref: string | null; start_seconds: number | null; end_seconds: number | null }>();
  if (!cur) return fail(404, "not_found", "找不到這個章節");
  const sets: [string, unknown][] = [];
  // 主講人：同一門課只能有一堂；勾新的這堂時，原本那堂自動取消（轉移）。教材不能當主講人。
  const clearSpeaker: D1PreparedStatement[] = [];
  if (body.isSpeaker !== undefined) {
    if (body.isSpeaker === true && cur.kind === "section") fail(400, "speaker_chapter_only", "區塊不能設為主題");
    if (body.isSpeaker === true) {
      if (cur.kind === "chapter") clearSpeaker.push(ctx.db.prepare("UPDATE lessons SET is_speaker = 0 WHERE course_id = ? AND kind = 'chapter' AND is_speaker = 1 AND id <> ?").bind(cur.course_id, id));
      else clearSpeaker.push(clearThemeInBlock(ctx.db, cur.course_id, id));
    }
    sets.push(["is_speaker", body.isSpeaker === true ? 1 : 0]);
    if (body.isSpeaker === true && body.isSummary === undefined && cur.kind === "chapter") sets.push(["is_summary", 0]); // 與「總結與銷售課程」互斥
  }
  // 總結與銷售課程：同一門課只能有一堂（勾新的，原本那堂轉移）；與主講人互斥；只有章節可以勾。
  const clearSummary: D1PreparedStatement[] = [];
  if (body.isSummary !== undefined) {
    if (body.isSummary === true && body.isSpeaker === true) fail(400, "summary_speaker_exclusive", "主講人與總結與銷售課程不能同時勾選");
    if (body.isSummary === true && cur.kind !== "chapter") fail(400, "summary_chapter_only", "只有章節可以設為總結與銷售課程");
    if (body.isSummary === true) {
      clearSummary.push(ctx.db.prepare("UPDATE lessons SET is_summary = 0 WHERE course_id = ? AND is_summary = 1 AND id <> ?").bind(cur.course_id, id));
      if (body.isSpeaker === undefined) sets.push(["is_speaker", 0]);
    }
    sets.push(["is_summary", body.isSummary === true ? 1 : 0]);
  }
  const title = text(body.title, 120);
  if (title !== undefined) {
    if (!title) fail(400, "title_required", "請輸入章節名稱");
    sets.push(["title", title]);
  }
  if (cur.kind === "section") {
    if (body.inSheet !== undefined) sets.push(["in_sheet", body.inSheet === false ? 0 : 1]);
    if (body.brandId !== undefined) sets.push(["brand_id", await blockBrand(ctx, body.brandId)]);
    if (body.categories !== undefined) sets.push(["categories", blockCats(body.categories)]);
  }
  const sharer = text(body.sharer, 60);
  if (sharer !== undefined) sets.push(["sharer", sharer]);
  const sharerTitle = text(body.sharerTitle, 50);
  if (sharerTitle !== undefined) sets.push(["sharer_title", sharerTitle]);
  if (sharerTitle) await noteJobTitle(ctx, sharerTitle);
  const sharerRank = text(body.sharerRank, 40);
  if (sharerRank !== undefined) {
    await assertCentralRank(ctx, sharerRank);
    sets.push(["sharer_rank", sharerRank]);
  }
  if (body.eventDate !== undefined) sets.push(["event_date", dayOrNull(body.eventDate)]);
  let type = cur.media_type;
  if (body.mediaType !== undefined) {
    const t = body.mediaType;
    const ref = typeof body.mediaRef === "string" ? body.mediaRef.trim() : "";
    if (t !== "demo" && t !== "youtube" && t !== "mux") fail(400, "invalid_media", "影片來源不正確");
    let mediaRef: string | null = null;
    if (t === "youtube") mediaRef = youtubeId(ref) ?? fail(400, "invalid_youtube", "請貼上 YouTube 影片網址或 11 碼影片 ID");
    else if (t === "mux") {
      if (!/^[A-Za-z0-9]{10,80}$/.test(ref)) fail(400, "invalid_mux", "請從 Mux 選擇影片");
      mediaRef = ref;
    }
    type = t as MediaType;
    sets.push(["media_type", t], ["media_ref", mediaRef], ["yt_checked_at", null]);
  }
  const start = seconds(body.startSeconds);
  const end = seconds(body.endSeconds);
  const finalStart = start === undefined ? cur.start_seconds : start;
  const finalEnd = end === undefined ? cur.end_seconds : end;
  if (finalStart != null && finalEnd != null && finalEnd <= finalStart) fail(400, "invalid_range", "結束時間必須晚於開始時間");
  if (start !== undefined) sets.push(["start_seconds", start]);
  if (end !== undefined) sets.push(["end_seconds", end]);
  const minutes = body.minutes === undefined ? undefined : Number(body.minutes);
  if (minutes !== undefined && (!Number.isInteger(minutes) || minutes < 0 || minutes > 1000)) fail(400, "invalid_minutes", "影片長度不正確");
  // 有設定區間時，章節長度＝區間長度（分鐘，無條件進位）。
  if (finalEnd != null && (start !== undefined || end !== undefined)) sets.push(["duration_minutes", Math.max(1, Math.ceil((finalEnd - (finalStart ?? 0)) / 60))]);
  else if (minutes !== undefined) sets.push(["duration_minutes", minutes]);
  if (!sets.length) fail(400, "nothing_to_update", "沒有要更新的欄位");
  // 主講人章節的名稱、分享者、獎銜、職稱一律等於課程基本資料（不接受另外填的值）。
  // 「總結」章節的名稱固定就是「總結」（杜杜龍 2026-11-16）：勾選當下與之後的每次修改，伺服器都強制。
  const nowSummary = body.isSummary === undefined ? cur.is_summary === 1 && body.isSpeaker !== true : body.isSummary === true;
  const speakerSets = sets;
  const finalSets: [string, unknown][] = nowSummary ? [...speakerSets.filter(([c]) => c !== "title"), ["title", SUMMARY_TITLE]] : speakerSets;
  await ctx.db.batch([
    ...clearSpeaker,
    ...clearSummary,
    ...(finalSets.length ? [ctx.db.prepare(`UPDATE lessons SET ${finalSets.map(([c]) => `${c} = ?`).join(", ")} WHERE id = ?`).bind(...finalSets.map(([, v]) => v), id)] : []),
    audit(ctx.db, admin.sub, "lesson.update", "lesson", id, sets.map(([c]) => c).join(",")),
  ]);
  if (cur.media_type === "audio" && type !== "audio" && cur.media_ref) await ctx.env.MEDIA?.delete(cur.media_ref).catch(() => undefined);
  const row = await ctx.db.prepare("SELECT media_type, media_ref FROM lessons WHERE id = ?").bind(id).first<{ media_type: string; media_ref: string | null }>();
  return { ok: true, mediaType: row?.media_type, mediaRef: row?.media_ref };
}

// ---------- 審核群組、通知範圍 ----------

/** 這位登入者看得到的通知：自己的、（管理員）寄給總部的、（會長）寄給自己中心會長的。 */
export function noticeScope(s: Session): { sql: string; args: unknown[] } {
  const parts = ["recipient_sub = ?"];
  const args: unknown[] = [s.sub];
  if (s.role === "admin") parts.push("recipient_role = 'admin'");
  if (s.roles.includes("president") && s.center) {
    parts.push("(recipient_role = 'president' AND recipient_center_key = ?)");
    args.push(s.center.key);
  }
  return { sql: `(${parts.join(" OR ")})`, args };
}

/** 中心自辦群組：該中心的會長、音控可管理。 */
export const canManageCenter = (s: Session, key: string) => !!s.center && s.center.key === key && (s.roles.includes("president") || s.roles.includes("sound"));

export async function requireGroupManager(ctx: Ctx, groupId: string): Promise<Session> {
  const s = requireMember(ctx);
  const g = await ctx.db.prepare("SELECT owner_center_key FROM review_groups WHERE id = ?").bind(groupId).first<{ owner_center_key: string | null }>();
  if (!g) return fail(404, "not_found", "找不到這個審核群組");
  // 總部群組（owner_center_key 為 NULL）只有秘書與超級管理員可以指派。
  if (s.role !== "admin" && !(g.owner_center_key && canManageCenter(s, g.owner_center_key))) fail(403, "forbidden", "沒有管理這個群組的權限");
  return s;
}

export async function listGroups(ctx: Ctx): Promise<ReviewGroup[]> {
  const s = requireMember(ctx);
  const manager = s.role === "admin" || s.roles.includes("president") || s.roles.includes("sound");
  // 小編：只能「選用」自己中心的群組（課程設定用），不能管理群組。
  const rights = await rightsOf(ctx);
  if (!manager && !rights.any) fail(403, "forbidden", "沒有管理審核群組的權限");
  const [g, m, c] = await ctx.db.batch([
    ctx.db.prepare("SELECT id, name, owner_center_key, owner_center_label FROM review_groups ORDER BY created_at"),
    ctx.db.prepare("SELECT group_id, center_key, center_label, member_sub, member_name, duty FROM review_group_members ORDER BY center_label, created_at"),
    ctx.db.prepare("SELECT id, title, review_group_id FROM courses WHERE review_group_id IS NOT NULL"),
  ]);
  type G = { id: string; name: string; owner_center_key: string | null; owner_center_label: string };
  type M = { group_id: string; center_key: string; center_label: string; member_sub: string; member_name: string; duty: Duty };
  return (g.results as G[])
    .filter((x) => s.role === "admin" || (x.owner_center_key && (canManageCenter(s, x.owner_center_key) || rights.centerKeys.has(x.owner_center_key))))
    .map((x) => ({
      id: x.id,
      name: x.name,
      ownerCenter: x.owner_center_key ? x.owner_center_label : null,
      courses: (c.results as { id: string; title: string; review_group_id: string }[]).filter((k) => k.review_group_id === x.id).map((k) => ({ id: k.id, title: k.title })),
      members: (m.results as M[]).filter((k) => k.group_id === x.id).map((k) => ({ centerKey: k.center_key, centerLabel: k.center_label, memberSub: k.member_sub, memberName: k.member_name, duty: k.duty })),
      canManage: s.role === "admin" || (!!x.owner_center_key && canManageCenter(s, x.owner_center_key)),
    }));
}

export const isoOrNull = (v: unknown): string | null | undefined => {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) fail(400, "invalid_date", "日期格式不正確");
  return d.toISOString();
};

// ---------- 課程留言板 ----------

export type CommentRow = { id: string; course_id: string; member_sub: string; member_name: string; body: string; status: "visible" | "hidden"; created_at: string; reports?: number; course_title?: string };
export const toComment = (r: CommentRow, s: Session): CourseComment => ({
  id: r.id,
  courseId: r.course_id,
  authorName: r.member_name,
  mine: r.member_sub === s.sub,
  body: r.body,
  hidden: r.status === "hidden",
  createdAt: r.created_at,
  ...(r.reports !== undefined ? { reports: r.reports, courseTitle: r.course_title } : {}),
});

export async function requireCourseForComments(ctx: Ctx, courseId: string): Promise<Session> {
  const s = requireMember(ctx);
  const c = await ctx.db.prepare("SELECT status FROM courses WHERE id = ?").bind(courseId).first<{ status: string }>();
  // 未上架的課程不開放留言；下架封存的課程，已報名的學員照常可以看與留言。
  if (!c || (c.status === "draft" && s.role !== "admin")) fail(404, "not_found", "找不到這門課程");
  return s;
}

export async function listComments(ctx: Ctx, courseId: string): Promise<CourseComment[]> {
  const s = await requireCourseForComments(ctx, courseId);
  // 一般會員看不到被隱藏的留言與自己封鎖的人；管理員看得到全部。
  const { results } = await ctx.db
    .prepare(
      `SELECT id, course_id, member_sub, member_name, body, status, created_at FROM course_comments c WHERE course_id = ?
       AND (? = 'admin' OR (status = 'visible' AND NOT EXISTS (SELECT 1 FROM comment_blocks b WHERE b.member_sub = ? AND b.blocked_sub = c.member_sub)))
       ORDER BY created_at DESC LIMIT 200`,
    )
    .bind(courseId, s.role, s.sub)
    .all<CommentRow>();
  return results.map((r) => toComment(r, s));
}

// ---------- router ----------


// ---------- 加入我的清單（杜杜龍 2026-11-21；邏輯在 my-lists.ts） ----------
/** 清單網址前綴＝安麗會員編號（取自會員中心）；模擬會員用代號。沒有編號就請會員先到會員中心填寫。 */
export async function listNumber(s: Session): Promise<string> {
  const raw = s.kind === "central" ? await memberNumberOf(s.sub, s.token) : `demo9${s.sub.replace(/[^a-z0-9]/gi, "")}`;
  return libraryNumber(raw) ?? fail(409, "no_member_number", "要先在會員中心填寫安麗會員編號，清單的分享網址才會建立");
}
export const listQuota = async (ctx: Ctx, sub: string) => {
  const app = (await loadConfig(ctx.db)).app;
  return quotaOf(ctx.db, sub, app.listBaseQuota, app.listUnlocks);
};
/** my-lists.ts 的錯誤轉成一般的 API 錯誤。 */
export async function listGuard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ListError) return fail(e.status, e.code, e.message);
    throw e;
  }
}

export type Handler = (ctx: Ctx, params: string[]) => Promise<unknown>;
