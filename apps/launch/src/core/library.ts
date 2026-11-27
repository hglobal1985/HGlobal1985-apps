/** 行動大學 API 共用核心：我的書櫃（杜杜龍 2026-11-27 從 api-core.ts 依功能拆出；api-core.ts 會全部轉出，舊的 import 不用改）。 */
import { HQ_UNIT, UNCATEGORIZED, type AttachmentType, type LibraryItem, type LibraryMine, LIBRARY_KEY_BADGES, VIEW_SCOPES, ZONES, UPGRADING_MSG } from "../contract.ts";
import { checkPasswordInput, expiresAt, hashPassword, libraryNumber, pwActive } from "../library.ts";
import { memberNumberOf, centralAddJobTitle, centerKey, centerList, rankOptionList, centralSuggest } from "../central.ts";
import type { D1Database } from "../d1.ts";
import { LINK_DEFAULT_TITLE, classifyLink, parseHttpsUrl } from "../links.ts";
import { fetchLinkTitle } from "../link-title.ts";
import { loadConfig } from "../ui-config.ts";
import { type Ctx, type Session, audit, fail, grantAchievements, iso, ranks, readJson, requireMember } from "./base.ts";
import { cleanTitle, courseDetail, ensureCourseUrl, notifyNewCourse } from "./course-admin.ts";
import { withSeriesDefaults } from "./series.ts";
import { THEMES, randomId } from "./media.ts";
import { isoOrNull } from "./keywords.ts";

// ---------- 我的書櫃（杜杜龍 2026-11-17） ----------
export type LibRow = { member_sub: string; number: string; owner_name: string; title: string; pw_hash: string | null; pw_salt: string | null; pw_expires_at: string | null; views: number };
export type LibItemRow = { id: string; kind: "shelf" | "book"; title: string; url: string | null; att_type: AttachmentType | null; event_date: string | null; start_seconds: number | null; end_seconds: number | null; pw_hash: string | null; pw_salt: string | null; pw_expires_at: string | null; position: number };
export const libOf = (db: D1Database, sub: string) => db.prepare("SELECT member_sub, number, owner_name, title, pw_hash, pw_salt, pw_expires_at, views FROM libraries WHERE member_sub = ?").bind(sub).first<LibRow>();
export const libOf2 = (db: D1Database, number: string) => db.prepare("SELECT member_sub, number, owner_name, title, pw_hash, pw_salt, pw_expires_at, views FROM libraries WHERE number = ?").bind(number).first<LibRow>();
export const libItems = async (db: D1Database, sub: string): Promise<LibItemRow[]> =>
  (await db.prepare("SELECT id, kind, title, url, att_type, event_date, start_seconds, end_seconds, pw_hash, pw_salt, pw_expires_at, position FROM library_items WHERE library_sub = ? ORDER BY position").bind(sub).all<LibItemRow>()).results;
export const libItemOut = (r: LibItemRow, owner: boolean, unlocked: boolean): LibraryItem => {
  const locked = !owner && !!r.pw_hash && !unlocked;
  return {
    id: r.id, kind: r.kind, title: r.title, url: locked ? null : r.url, type: r.att_type, eventDate: r.event_date,
    start: locked ? null : r.start_seconds, end: locked ? null : r.end_seconds, locked,
    ...(owner ? { pwSet: !!r.pw_hash, pwExpiresAt: r.pw_expires_at, pwExpired: !!r.pw_hash && !pwActive(r.pw_expires_at) } : {}),
  };
};
/** 建立書櫃（邀請接受、集滿徽章自動解鎖共用）：需要中央會員編號；失敗回傳白話原因。 */
export async function createLibrary(ctx: Ctx, s: Session): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  if (s.kind !== "central") return { ok: false, code: "central_only", message: "請用會員中心帳號登入" };
  const number = libraryNumber(await memberNumberOf(s.sub, s.token));
  if (!number) return { ok: false, code: "no_member_number", message: "請先到會員中心填寫你的安麗會員編號，再回來" };
  if (await ctx.db.prepare("SELECT 1 AS ok FROM libraries WHERE number = ?").bind(number).first()) return { ok: false, code: "number_taken", message: "這個會員編號的書櫃已經存在（例如配偶共用同一個編號），請洽管理員" };
  await ctx.db.batch([ctx.db.prepare("INSERT INTO libraries (member_sub, number, owner_name, title) VALUES (?, ?, ?, ?)").bind(s.sub, number, s.name, `${s.name}的書櫃`), audit(ctx.db, s.sub, "library.create", "library", s.sub, number)]);
  return { ok: true };
}
export async function libraryMine(ctx: Ctx, sub: string): Promise<LibraryMine> {
  let lib = await libOf(ctx.db, sub);
  let keys: LibraryMine["keys"];
  if (!lib && ctx.session?.kind === "central") {
    // 獲得任意 100 枚徽章就自動解鎖書櫃鑰匙（杜杜龍 2026-11-17）；會員編號等問題留在 blocked 讓畫面提示。
    const have = (await grantAchievements(ctx, sub)).filter((a) => a.earned).length;
    const need = (await loadConfig(ctx.db)).app.libraryKeyBadges ?? LIBRARY_KEY_BADGES;
    keys = { have, need };
    if (have >= need) {
      const r = await createLibrary(ctx, ctx.session);
      if (r.ok) lib = await libOf(ctx.db, sub);
      else keys.blocked = r.message;
    }
  }
  if (!lib) return { library: null, items: [], keys };
  return { library: { number: lib.number, title: lib.title, ownerName: lib.owner_name, views: lib.views, pwSet: !!lib.pw_hash, pwExpiresAt: lib.pw_expires_at, pwExpired: !!lib.pw_hash && !pwActive(lib.pw_expires_at) }, items: (await libItems(ctx.db, sub)).map((r) => libItemOut(r, true, true)) };
}
/** 書櫃密碼欄位：password 字串＝設定（可帶 passwordDays）、null＝關閉密碼、沒傳＝不動。 */
export async function libPwSets(body: { password?: unknown; passwordDays?: unknown }): Promise<[string, unknown][]> {
  if (body.password === undefined) return [];
  if (body.password === null || body.password === "") return [["pw_hash", null], ["pw_salt", null], ["pw_expires_at", null]];
  const chk = checkPasswordInput(body.password, body.passwordDays);
  if (!chk.ok) return fail(400, "invalid_password", chk.message);
  const h = await hashPassword(chk.password);
  return [["pw_hash", h.hash], ["pw_salt", h.salt], ["pw_expires_at", expiresAt(chk.days)]];
}
export async function myLibrary(ctx: Ctx): Promise<{ s: Session; lib: LibRow }> {
  const s = requireMember(ctx);
  const lib = await libOf(ctx.db, s.sub);
  if (!lib) return fail(403, "no_library", "你還沒有「我的書櫃」");
  return { s, lib };
}
export async function libItemBody(ctx: Ctx, body: Record<string, unknown>, kind: "shelf" | "book"): Promise<[string, unknown][]> {
  const sets: [string, unknown][] = [];
  const title = cleanTitle(body.title);
  if (body.title !== undefined) {
    if (!title && kind === "shelf") return fail(400, "title_required", "請輸入書架名稱");
    if (title) sets.push(["title", title]);
  }
  if (kind === "book" && body.url !== undefined) {
    const u = parseHttpsUrl(body.url);
    if (!u) return fail(400, "invalid_url", "請輸入 https 開頭的有效網址");
    sets.push(["url", u.toString()], ["att_type", classifyLink(u)]);
    if (!title && body.title === undefined) sets.push(["title", cleanTitle(await fetchLinkTitle(u)) || LINK_DEFAULT_TITLE[classifyLink(u)]]);
  }
  if (kind === "book") {
    if (body.eventDate !== undefined) sets.push(["event_date", dayOrNull(body.eventDate)]);
    for (const [k, col] of [["startSeconds", "start_seconds"], ["endSeconds", "end_seconds"]] as const) if (body[k] !== undefined) sets.push([col, body[k] === null ? null : Math.max(0, Math.floor(Number(body[k])) || 0)]);
    sets.push(...(await libPwSets(body as { password?: unknown; passwordDays?: unknown })));
  }
  return sets;
}

export const dayOrNull = (v: unknown): string | null =>
  v === null || v === "" ? null : typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : fail(400, "invalid_date", "活動日期格式請用 2026-12-01");
export const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : undefined);

/** 封面裁切框（占 EDM 圖片寬高的比例）：x、y 是左上角，w 是寬；高由 16:9 算出。 */
export type CoverRect = { x: number; y: number; w: number };
export function parseCoverRect(raw: string | null): CoverRect | null {
  if (!raw) return null;
  try {
    const r = JSON.parse(raw) as Partial<CoverRect>;
    return [r.x, r.y, r.w].every((n) => typeof n === "number" && Number.isFinite(n)) ? (r as CoverRect) : null;
  } catch {
    return null;
  }
}
export async function courseFields(ctx: Ctx, body: Record<string, unknown>, creating: boolean, who: Session) {
  const centerOnly = who.role !== "admin"; // 會長、音控：主辦單位固定是自己的中心，不能自稱總部指導，審核群組只能用自己中心的
  const sets: [string, unknown][] = [];
  // 清單卡（只在建立時決定）：完全公開、免費，沒有主講人與章節。
  if (creating && body.isList === true) sets.push(["is_list", 1], ["is_public", 1], ["price_twd", 0]);
  const t = text(body.title, 120);
  if (t !== undefined) {
    if (!t) fail(400, "title_required", "請輸入課程名稱");
    sets.push(["title", t]);
  } else if (creating) fail(400, "title_required", "請輸入課程名稱");
  if (body.category !== undefined) {
    const raw = Array.isArray(body.category) ? body.category.filter((x): x is string => typeof x === "string").join(CAT_SEP) : typeof body.category === "string" ? body.category : "";
    sets.push(["category", joinCats(splitCats(raw)).slice(0, 120)]);
  }
  for (const [k, col, max] of [["subtitle", "subtitle", 200], ["teacher", "teacher", 60], ["teacherTitle", "teacher_title", 50], ["description", "description", 5000]] as const) {
    const v = text(body[k], max);
    if (v !== undefined) sets.push([col, v]);
    if (k === "teacherTitle" && v) await noteJobTitle(ctx, v);
  }
  const teacherRank = text(body.teacherRank, 40);
  if (teacherRank !== undefined) {
    await assertCentralRank(ctx, teacherRank);
    sets.push(["teacher_rank", teacherRank]);
  }
  // 勾了「無」（沒有主講人、獎銜、職稱；杜杜龍 2026-11-19）：三個欄位一律清空；取消勾選就回到可以填。
  if (body.isPackage !== undefined && !(creating && body.isList === true)) sets.push(["is_package", body.isPackage === true ? 1 : 0]);
  if (body.noSpeaker !== undefined) {
    const no = body.noSpeaker === true;
    for (let i = sets.length - 1; i >= 0 && no; i--) if (["teacher", "teacher_rank", "teacher_title"].includes(sets[i]![0])) sets.splice(i, 1);
    sets.push(["no_speaker", no ? 1 : 0]);
    if (no) sets.push(["teacher", ""], ["teacher_rank", ""], ["teacher_title", ""]);
  }
  if (body.priceTwd !== undefined) {
    const n = Number(body.priceTwd);
    if (!Number.isInteger(n) || n < 0 || n > 10_000_000) fail(400, "invalid_price", "費用請輸入 0 以上的整數");
    sets.push(["price_twd", n]);
  }
  if (body.theme !== undefined) {
    if (!THEMES.includes(String(body.theme))) fail(400, "invalid_theme", "封面顏色不正確");
    sets.push(["theme", body.theme]);
  }
  if (body.minRankCode !== undefined) {
    if (typeof body.minRankCode !== "string" || !(await ranks(ctx.db)).has(body.minRankCode)) fail(400, "invalid_rank", "獎銜不存在");
    sets.push(["min_rank_code", body.minRankCode]);
  }
  if (body.status !== undefined) {
    if (body.status !== "draft" && body.status !== "published" && body.status !== "archived") fail(400, "invalid_status", "狀態不正確");
    sets.push(["status", body.status]);
  }
  if (body.allowPresident !== undefined) sets.push(["allow_president", body.allowPresident === true ? 1 : 0]);
  if (body.inviteOnly !== undefined) sets.push(["invite_only", body.inviteOnly === true ? 1 : 0]);
  if (body.inviteCode !== undefined) sets.push(["invite_code", typeof body.inviteCode === "string" ? body.inviteCode.trim().slice(0, 40) : ""]);
  if (body.viewScope !== undefined) {
    if (!(VIEW_SCOPES as string[]).includes(String(body.viewScope))) fail(400, "invalid_view_scope", "「誰可以瀏覽」的選項不正確");
    sets.push(["view_scope", body.viewScope]);
  } else if (creating && body.isPublic !== undefined) sets.push(["view_scope", body.isPublic === true ? "all" : "members"]);
  if (body.isPublic !== undefined) sets.push(["is_public", body.isPublic === true ? 1 : 0]);
  if (body.priceTba !== undefined) sets.push(["price_tba", body.priceTba === true ? 1 : 0]);
  const loc = text(body.location, 100);
  if (loc !== undefined) sets.push(["location", loc]);
  if (body.locationNone !== undefined) sets.push(["location_none", body.locationNone === true ? 1 : 0]);
  if (body.isOnline !== undefined) sets.push(["is_online", body.isOnline === true ? 1 : 0]);
  if (body.chapterCovers !== undefined) sets.push(["chapter_covers", body.chapterCovers === true ? 1 : 0]);
  if (body.blockPhotos !== undefined) sets.push(["block_photos", body.blockPhotos === true ? 1 : 0]);
  // 短影音專輯：勾了的課程，其章節與影音教材在「單元」頁歸類為短影音。
  if (body.isShorts !== undefined) sets.push(["is_shorts", body.isShorts === true ? 1 : 0]);
  if (body.earlyBird !== undefined) {
    if (body.earlyBird === true) {
      const price = Number(body.earlyPriceTwd);
      const until = body.earlyUntil;
      if (!Number.isInteger(price) || price < 1 || price > 10_000_000) fail(400, "invalid_early_price", "早鳥優惠價請輸入 1 以上的整數");
      if (typeof until !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(until) || Number.isNaN(Date.parse(until))) fail(400, "invalid_early_until", "請選擇早鳥優惠的截止日期");
      const base = sets.find(([c]) => c === "price_twd")?.[1];
      if (typeof base === "number" && price >= base) fail(400, "invalid_early_price", "早鳥優惠價必須低於原價");
      sets.push(["early_bird", 1], ["early_price_twd", price], ["early_until", until]);
    } else sets.push(["early_bird", 0], ["early_price_twd", null], ["early_until", null]);
  }
  // 素材的第二層短網址（只有超級管理員）：英文小寫、數字、短橫線；是否重複在儲存時檢查。
  const matUrl = text(body.matUrl, 60);
  if (matUrl !== undefined) {
    if (!who.roles.includes("super_admin")) fail(403, "mat_url_super_admin_only", "只有超級管理員可以設定清單網址");
    const v = matUrl.trim().toLowerCase();
    if (v && !/^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])$/.test(v)) fail(400, "invalid_mat_url", "清單網址只能用英文、數字和短橫線（至少 2 個字）");
    if (v && ["edit", "share", "api", "new", "admin", "series", "course", "courses"].includes(v)) fail(400, "reserved_mat_url", "這個名稱是系統保留字，請換一個");
    sets.push(["mat_url", v || null]);
  }
  const series = text(body.series, 60);
  if (series !== undefined) {
    // 設定「系列」只限超級管理員（杜杜龍 2026-11-16）。
    if (!who.roles.includes("super_admin")) fail(403, "series_super_admin_only", "只有超級管理員可以設定系列");
    sets.push(["series", series]);
  }
  if (body.zone !== undefined) {
    // 專區只限超級管理員設定（杜杜龍 2026-11-18）；空字串＝依類型預設。
    if (!who.roles.includes("super_admin")) fail(403, "zone_super_admin_only", "只有超級管理員可以設定專區");
    const z = typeof body.zone === "string" ? body.zone : "";
    if (z && !ZONES.some((x) => x.id === z)) fail(400, "invalid_zone", "專區不正確");
    sets.push(["zone", z]);
  }
  if (body.diamondFree !== undefined) sets.push(["diamond_free", body.diamondFree === true ? 1 : 0]);
  if (body.hideFromHome !== undefined) sets.push(["hide_home", body.hideFromHome === true ? 1 : 0]);
  if (body.brandId !== undefined) {
    const id = typeof body.brandId === "string" ? body.brandId.trim() : "";
    if (id && !(await ctx.db.prepare("SELECT 1 AS ok FROM brand_logos WHERE id = ?").bind(id).first())) fail(400, "invalid_brand", "找不到這個品牌");
    sets.push(["brand_id", id || null]);
  }
  // 封面框與預設停留位置永遠同步：有 coverRect 時，預設位置＝封面框上緣（edm_view_y 由它算出，不接受另外指定）。
  // 只改預設位置（沒有封面框）時，封面框作廢（NULL），免得兩者不一致。
  if (body.coverRect !== undefined) {
    if (body.coverRect === null) sets.push(["cover_rect", null]);
    else {
      const r = body.coverRect as Partial<CoverRect>;
      const ok = r && [r.x, r.y, r.w].every((n) => typeof n === "number" && Number.isFinite(n)) && r.w! > 0 && r.w! <= 1 && r.x! >= 0 && r.x! + r.w! <= 1.0001 && r.y! >= 0 && r.y! <= 1;
      if (!ok) fail(400, "invalid_cover_rect", "封面裁切範圍不正確");
      const rect = { x: Math.round(r.x! * 10000) / 10000, y: Math.round(r.y! * 10000) / 10000, w: Math.round(r.w! * 10000) / 10000 };
      sets.push(["cover_rect", JSON.stringify(rect)], ["edm_view_y", rect.y]);
    }
  } else if (body.edmViewY !== undefined) {
    const y = Number(body.edmViewY);
    if (!Number.isFinite(y) || y < 0 || y > 1) fail(400, "invalid_view", "EDM 預設位置不正確");
    sets.push(["edm_view_y", y], ["cover_rect", null]);
  }
  const guidance = text(body.guidanceUnit, 60);
  if (centerOnly && guidance === HQ_UNIT) fail(403, "forbidden", `指導單位「${HQ_UNIT}」只有總部管理員可以設定`);
  if (guidance !== undefined) sets.push(["guidance_unit", guidance]);
  // 主辦單位可以複選（總部管理員）：存成「、」分隔文字；權限與審核仍以第一個中心（非寰宇總部）為準。
  const hostList = Array.isArray(body.hostUnit)
    ? splitCats(body.hostUnit.filter((x): x is string => typeof x === "string").join(CAT_SEP))
    : typeof body.hostUnit === "string"
      ? splitCats(body.hostUnit)
      : undefined;
  const host = hostList === undefined ? undefined : joinCats(hostList).slice(0, 300);
  if (!centerOnly && hostList) await assertCentralCenters(ctx, hostList.filter((x) => x !== HQ_UNIT));
  if (centerOnly) {
    const center = who.center ?? fail(403, "forbidden", "需要有所屬中心才能管理課程");
    if (creating || host !== undefined) sets.push(["host_unit", center.label], ["host_center_key", center.key]);
  } else if (host !== undefined) {
    const firstCenter = hostList?.find((x) => x !== HQ_UNIT);
    sets.push(["host_unit", host], ["host_center_key", firstCenter ? centerKey(firstCenter) : null]);
  }
  if (body.eventStart !== undefined || body.eventEnd !== undefined) {
    const day = (v: unknown) => (v === null || v === "" || v === undefined ? null : typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : fail(400, "invalid_date", "活動日期格式請用 2026-12-01"));
    const start = day(body.eventStart);
    const end = day(body.eventEnd);
    if (end && !start) fail(400, "invalid_date", "請先填活動開始日期");
    if (start && end && end < start) fail(400, "invalid_date", "活動結束日不能早於開始日"); // 連續天數不設上限（杜杜龍 2026-11-19）
    sets.push(["event_start", start], ["event_end", end && end !== start ? end : null]);
  }
  for (const [k, col] of [["freeFrom", "free_from"], ["freeUntil", "free_until"]] as const) {
    const v = isoOrNull(body[k]);
    if (v !== undefined) sets.push([col, v]);
  }
  if (body.reviewGroupId !== undefined) {
    if (body.reviewGroupId === null || body.reviewGroupId === "") sets.push(["review_group_id", null]);
    else {
      const g = await ctx.db.prepare("SELECT owner_center_key FROM review_groups WHERE id = ?").bind(String(body.reviewGroupId)).first<{ owner_center_key: string | null }>();
      if (!g) fail(400, "invalid_group", "審核群組不存在");
      if (centerOnly && g?.owner_center_key !== who.center?.key) fail(403, "forbidden", "只能使用自己中心的審核群組");
      sets.push(["review_group_id", body.reviewGroupId]);
    }
  }
  return sets;
}

/** 指導單位為寰宇總部的課程，只能套用總部群組（由秘書、超級管理員指派審核人員）。 */
export async function checkGuidanceGroup(ctx: Ctx, guidance: unknown, groupId: unknown) {
  if (guidance !== HQ_UNIT || !groupId) return;
  const g = await ctx.db.prepare("SELECT owner_center_key FROM review_groups WHERE id = ?").bind(String(groupId)).first<{ owner_center_key: string | null }>();
  if (g?.owner_center_key) fail(400, "hq_group_required", `指導單位為「${HQ_UNIT}」的課程只能使用總部的審核群組`);
}

/** 完全公開（訪客免登入可看）只限免費課程，避免付費內容被公開。 */
export function checkPublicFree(price: number, isPublic: boolean, tba = false) {
  if (isPublic && tba) fail(400, "public_must_be_free", "費用尚未公布的課程不能設為「完全公開」");
  if (isPublic && price > 0) fail(400, "public_must_be_free", "「完全公開」只能用在免費課程；請先把費用改成 0");
}

/** is_public＝訪客也能看、免費、費用已公布、而且沒有獎銜限制（有獎銜限制＝訪客只能看介紹，不能直接看內容也不能報名；杜杜龍 2026-11-17 規則 B）。 */
export function deriveIsPublic(sets: [string, unknown][], cur: { view_scope: string; price_twd: number; price_tba: number; min_rank_code?: string; invite_only?: number } | null) {
  if (!sets.some(([c]) => ["view_scope", "price_twd", "price_tba", "min_rank_code", "invite_only"].includes(c))) return;
  const pick = (col: string, old: unknown) => (sets.find(([c]) => c === col) ?? [col, old])[1];
  const pub = ["all", "link_guest"].includes(String(pick("view_scope", cur?.view_scope ?? "all"))) && Number(pick("price_twd", cur?.price_twd ?? 0)) === 0 && pick("price_tba", cur?.price_tba ?? 0) !== 1 && String(pick("min_rank_code", cur?.min_rank_code ?? "none")) === "none" && Number(pick("invite_only", cur?.invite_only ?? 0)) !== 1;
  const i = sets.findIndex(([c]) => c === "is_public");
  if (i >= 0) sets.splice(i, 1);
  sets.push(["is_public", pub ? 1 : 0]);
}

export async function createCourse(ctx: Ctx, admin: Session) {
  const body = await readJson<Record<string, unknown>>(ctx.req);
  await withSeriesDefaults(ctx, body); // 系列最後一次「套用到全系列課程」的設定，當新課程的預設值
  const sets = await courseFields(ctx, body, true, admin);
  checkPublicFree(Number(sets.find(([c]) => c === "price_twd")?.[1] ?? 0), sets.find(([c]) => c === "is_public")?.[1] === 1, sets.find(([c]) => c === "price_tba")?.[1] === 1);
  if (!sets.some(([c]) => c === "allow_president")) sets.push(["allow_president", 1]); // 新課程預設「會長不受獎銜限制也可報名」
  if (!sets.some(([c]) => c === "view_scope")) sets.push(["view_scope", "all"]); // 新課程（含清單）預設「所有人含訪客」（杜杜龍 2026-11-17）
  deriveIsPublic(sets, null);
  // 沒有系列的教材卡一律放進「未分類」系列（只有超級管理員看得到；杜杜龍 2026-11-20：必須設定系列才會顯示在課程首頁）。
  if (!String(sets.find(([c]) => c === "series")?.[1] ?? "").trim()) {
    const at = sets.findIndex(([c]) => c === "series");
    if (at >= 0) sets[at] = ["series", UNCATEGORIZED];
    else sets.push(["series", UNCATEGORIZED]);
  }
  await checkGuidanceGroup(ctx, body.guidanceUnit, body.reviewGroupId);
  const id = `c${randomId(7)}`;
  const max = await ctx.db.prepare("SELECT COALESCE(MAX(sort_order), 0) AS m FROM courses").first<{ m: number }>();
  // 新課程一律先是草稿（小編也一樣，自己再決定上架）；記下建立者。
  // 新增「清單卡」＝自動直接上架（杜杜龍 2026-11-18）；課程仍先是草稿。
  const isListNew = sets.some(([c, v]) => c === "is_list" && (v === 1 || v === true));
  const status = isListNew || sets.find(([c]) => c === "status")?.[1] === "published" ? "published" : "draft";
  const rest = sets.filter(([c]) => c !== "status");
  const cols = ["id", "sort_order", "status", "created_by_sub", "edited_by_name", "edited_at", ...rest.map(([c]) => c)];
  const vals = [id, (max?.m ?? 0) + 1, status, admin.sub, admin.name.slice(0, 60), iso(), ...rest.map(([, v]) => v)];
  // 新增課程不預設建立第一堂章節（杜杜龍 2026-11-16），章節一律在課程頁按「新增章節」。
  await ctx.db.batch([
    ctx.db.prepare(`INSERT INTO courses (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).bind(...vals),
    audit(ctx.db, admin.sub, "course.create", "course", id, String(body.title ?? "")),
  ]);
  await ensureCourseUrl(ctx, id);
  if (status === "published") await notifyNewCourse(ctx, id);
  return courseDetail(ctx, id);
}

/** 中心名稱必須是會員中心清單裡的（行動大學不可自行新增）；示範登入不檢查。 */
/** 獎銜只能是會員中心選單裡的代碼（空字串＝不填）。中央查不到清單時不擋（以免中央暫時故障無法存檔）；測試帳號不檢查。 */
export async function assertCentralRank(ctx: Ctx, code: string): Promise<void> {
  const s = ctx.session;
  if (!code || !s || s.kind !== "central") return;
  const list = await rankOptionList(s.token);
  if (list.length && !list.some((o) => o.value === code)) fail(400, "invalid_rank", "獎銜不在會員中心的選單內");
}

/**
 * 新職稱同步到中央（杜杜龍 2026-11-15）：儲存課程主講人／章節分享者的職稱時，若中央詞庫還沒有這個詞，就放進待送清單並嘗試送出。
 * 失敗、中央還沒開放「新增職稱」都不影響課程儲存，之後再儲存時自動補送。
 */
export async function noteJobTitle(ctx: Ctx, value: string | undefined): Promise<void> {
  const v = (value ?? "").trim();
  try {
    const s = ctx.session;
    if (v && s && s.kind === "central") {
      const known = await centralSuggest(s.token, "job_title", v);
      if (!known.some((x) => x.trim().toLowerCase() === v.toLowerCase())) await ctx.db.prepare("INSERT OR IGNORE INTO job_title_outbox (value) VALUES (?)").bind(v).run();
    }
    const { results } = await ctx.db.prepare("SELECT value FROM job_title_outbox WHERE tries < 30 ORDER BY created_at LIMIT 5").all<{ value: string }>();
    for (const r of results) {
      const out = await centralAddJobTitle(ctx.env.CENTRAL_SERVICE_SECRET, r.value);
      if (out === "ok" || out === "rejected") await ctx.db.prepare("DELETE FROM job_title_outbox WHERE value = ?").bind(r.value).run(); // 被中央退回（400／403）的不重送
      else if (out === "retry") await ctx.db.prepare("UPDATE job_title_outbox SET tries = tries + 1 WHERE value = ?").bind(r.value).run();
      else break; // 中央還沒開放：不用一直試
    }
  } catch {
    /* 不影響儲存 */
  }
}

export async function assertCentralCenters(ctx: Ctx, labels: string[]): Promise<void> {
  const s = ctx.session;
  if (!s || s.kind !== "central" || !labels.length) return;
  const list = await centerList(s.token);
  if (!list.length) fail(503, "central_unavailable", UPGRADING_MSG);
  const known = new Set(list.map(centerKey));
  const bad = labels.find((l) => !known.has(centerKey(l)));
  if (bad) fail(400, "unknown_center", `「${bad}」不在會員中心的中心清單裡；中心名稱以會員中心為準，行動大學不能自行新增`);
}

/** 分類可以複選：存成「、」分隔的文字（例如「達標班、會議」）。 */
export const CAT_SEP = "、";
export const splitCats = (v: string): string[] => [...new Set(v.split(/[、,，;；\n]+/).map((x) => x.trim()).filter(Boolean))];
export const joinCats = (list: string[]): string => list.join(CAT_SEP);
