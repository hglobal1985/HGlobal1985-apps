/** 行動大學 API 路由：我的：會員資料、我的清單、我的書櫃、通知、推播、搜尋（杜杜龍 2026-11-27 從 api.ts 拆出；順序會影響比對，同一檔內照原本順序）。 */
import { loadCheckNotices, readCheckNotices } from "../check-notices.ts";
import { vapidPublicKey } from "../push.ts";
import { iconText, type Duty, type Notice, NOTICE_KINDS, FEATURES, type LibraryView, type LibraryUnlock, LIST_COVER_COLORS, UPGRADING_MSG } from "../contract.ts";
import { checkPassword, checkToken, libraryNumber, makeToken, pwActive } from "../library.ts";
import { checkTitle, copyList, createList, listStats, ownDetail, ownLists, ownedList, readItem, recordEvent, recordItemHit, setItem, refreshOwner, setNote, setSlug, viewPublic } from "../my-lists.ts";
import { centralDeleteAccount, lastSharerError, lookupSharerRank, rankBadges, centerKey, centralProfileView, centralSuggest, centralWriteField, centralEnableAmway, forgetMember, profileGaps, rankOptions, rankValue, saveContactEmail, validEmail } from "../central.ts";
import { type LibRow, REVIEW_FIELD_LABEL, canCreateCourse, canViewStats, cleanTitle, contactSettings, courseSubKey, createLibrary, emailKindsOf, fail, grantAchievements, iso, libItemBody, libItemOut, libItems, libOf, libOf2, libPwSets, libraryMine, listGuard, listNumber, listQuota, lockStatesOf, memberOf, myLibrary, noticeCategory, noticeScope, notify, pubUrl, purgeMember, randomId, rankLabelOf, ranks, readJson, requireMember, rightsOf, seriesSubKey, subscriptionState, syncContact } from "../api-core.ts";
import type { Handler } from "../api-core.ts";

export const myRoutes: [string, RegExp, Handler][] = [
  // ----- 加入我的清單 -----
  ["GET", /^\/my-lists$/, (ctx) => listGuard(async () => {
    const s = requireMember(ctx);
    if (s.name) await refreshOwner(ctx.db, s.sub, s.name, s.kind === "central" ? s.avatarUrl : null);
    const q = ctx.url.searchParams;
    const it = q.get("kind") && q.get("ref") ? readItem({ kind: q.get("kind"), ref: q.get("ref") }) : undefined;
    return { lists: await ownLists(ctx.db, s.sub, it), quota: await listQuota(ctx, s.sub) };
  })],
  ["POST", /^\/my-lists$/, (ctx) => listGuard(async () => {
    const s = requireMember(ctx);
    const b = await readJson<{ title?: unknown; kind?: unknown; ref?: unknown; ref2?: unknown }>(ctx.req);
    const title = checkTitle(b.title);
    const id = await createList(ctx.db, s, await listNumber(s), title, await listQuota(ctx, s.sub));
    if (b.kind && b.ref) await setItem(ctx.db, id, readItem(b), true);
    const it = b.kind && b.ref ? readItem(b) : undefined;
    return { id, lists: await ownLists(ctx.db, s.sub, it), quota: await listQuota(ctx, s.sub) };
  })],
  // 每個內容在我的幾份清單裡（全站所有「加入我的清單」按鈕共用一次查詢）。
  ["GET", /^\/my-lists\/marks$/, async (ctx) => {
    const s = requireMember(ctx);
    const { results } = await ctx.db.prepare("SELECT i.kind, i.ref, COUNT(*) AS n FROM my_list_items i JOIN my_lists l ON l.id = i.list_id WHERE l.owner_sub = ? GROUP BY i.kind, i.ref").bind(s.sub).all<{ kind: string; ref: string; n: number }>();
    return { marks: Object.fromEntries(results.map((r) => [`${r.kind}:${r.ref}`, r.n])) };
  }],
  ["GET", /^\/my-lists\/(l[\w]{4,20})$/, (ctx, [id]) => listGuard(async () => ownDetail(ctx.db, await ownedList(ctx.db, requireMember(ctx).sub, id!)))],
  ["PATCH", /^\/my-lists\/(l[\w]{4,20})$/, (ctx, [id]) => listGuard(async () => {
    const s = requireMember(ctx);
    const l = await ownedList(ctx.db, s.sub, id!);
    const b = await readJson<{ title?: unknown; slug?: unknown; coverItemId?: unknown; coverMode?: unknown; coverBgId?: unknown; coverColor?: unknown; coverText?: unknown; coverTextOn?: unknown }>(ctx.req);
    if (b.coverMode !== undefined) {
      // 封面類型：內容封面／自訂封面（管理員的底圖或單色＋文字）；會員不能上傳封面圖。
      if (b.coverMode !== "item" && b.coverMode !== "text") fail(400, "invalid_cover_mode", "封面類型不正確");
      await ctx.db.prepare("UPDATE my_lists SET cover_mode = ? WHERE id = ?").bind(b.coverMode, l.id).run();
    }
    if (b.coverBgId !== undefined) {
      const bid = typeof b.coverBgId === "string" && b.coverBgId ? b.coverBgId : null;
      if (bid && !(await ctx.db.prepare("SELECT 1 AS ok FROM list_cover_bgs WHERE id = ?").bind(bid).first())) fail(404, "not_found", "找不到這張底圖");
      await ctx.db.prepare("UPDATE my_lists SET cover_bg_id = ? WHERE id = ?").bind(bid, l.id).run();
    }
    if (b.coverColor !== undefined) {
      const col = typeof b.coverColor === "string" ? b.coverColor.toUpperCase() : "";
      if (col && !LIST_COVER_COLORS.some((x) => x.hex === col)) fail(400, "invalid_color", "請從色票選一種顏色");
      await ctx.db.prepare("UPDATE my_lists SET cover_color = ? WHERE id = ?").bind(col || null, l.id).run();
    }
    if (b.coverText !== undefined) {
      // 封面上的自訂文字（空＝用清單名稱）；最多 40 字。
      const t = typeof b.coverText === "string" ? b.coverText.trim().slice(0, 40) : "";
      await ctx.db.prepare("UPDATE my_lists SET cover_text = ? WHERE id = ?").bind(t || null, l.id).run();
    }
    if (b.coverTextOn !== undefined) await ctx.db.prepare("UPDATE my_lists SET cover_text_on = ? WHERE id = ?").bind(b.coverTextOn ? 1 : 0, l.id).run();
    if (b.title !== undefined) await ctx.db.prepare("UPDATE my_lists SET title = ? WHERE id = ?").bind(checkTitle(b.title), l.id).run();
    if (b.slug !== undefined) await setSlug(ctx.db, l, b.slug);
    if (b.coverItemId !== undefined) {
      const cid = typeof b.coverItemId === "string" && b.coverItemId ? b.coverItemId : null;
      if (cid && !(await ctx.db.prepare("SELECT 1 AS ok FROM my_list_items WHERE id = ? AND list_id = ?").bind(cid, l.id).first())) fail(404, "not_found", "找不到這個項目");
      // 指定某個內容當封面＝切到內容封面；取消指定＝回到預設的文字封面（除非同一次請求自己指定了封面類型）。
      await ctx.db.prepare(b.coverMode === undefined ? "UPDATE my_lists SET cover_item_id = ?, cover_mode = ? WHERE id = ?" : "UPDATE my_lists SET cover_item_id = ? WHERE id = ?").bind(...(b.coverMode === undefined ? [cid, cid ? "item" : "text", l.id] : [cid, l.id])).run();
    }
    return ownDetail(ctx.db, await ownedList(ctx.db, s.sub, l.id));
  })],
  ["DELETE", /^\/my-lists\/(l[\w]{4,20})$/, (ctx, [id]) => listGuard(async () => {
    const s = requireMember(ctx);
    const l = await ownedList(ctx.db, s.sub, id!);
    if (l.cover_key) await ctx.env.MEDIA?.delete(l.cover_key).catch(() => undefined);
    await ctx.db.batch([ctx.db.prepare("DELETE FROM my_list_items WHERE list_id = ?").bind(l.id), ctx.db.prepare("DELETE FROM my_list_visitors WHERE list_id = ?").bind(l.id), ctx.db.prepare("DELETE FROM my_list_hits WHERE list_id = ?").bind(l.id), ctx.db.prepare("DELETE FROM my_list_item_hits WHERE list_id = ?").bind(l.id), ctx.db.prepare("DELETE FROM my_list_events WHERE list_id = ?").bind(l.id), ctx.db.prepare("DELETE FROM my_lists WHERE id = ?").bind(l.id)]);
    return { ok: true };
  })],
  ["PUT", /^\/my-lists\/(l[\w]{4,20})\/item$/, (ctx, [id]) => listGuard(async () => {
    const s = requireMember(ctx);
    const l = await ownedList(ctx.db, s.sub, id!);
    const b = await readJson<{ kind?: unknown; ref?: unknown; ref2?: unknown; on?: unknown }>(ctx.req);
    return { count: await setItem(ctx.db, l.id, readItem(b), b.on !== false) };
  })],
  ["PATCH", /^\/my-lists\/(l[\w]{4,20})\/items\/(i[\w]{4,20})$/, (ctx, [id, itemId]) => listGuard(async () => {
    const s = requireMember(ctx);
    const l = await ownedList(ctx.db, s.sub, id!);
    await setNote(ctx.db, l.id, itemId!, (await readJson<{ note?: unknown }>(ctx.req)).note);
    return ownDetail(ctx.db, l);
  })],
  ["GET", /^\/my-lists\/(l[\w]{4,20})\/stats$/, (ctx, [id]) => listGuard(async () => listStats(ctx.db, (await ownedList(ctx.db, requireMember(ctx).sub, id!)).id))],
  // 清單主人按「分享」「複製連結」時記一次；訪客點開某個項目時該項目 +1（成效頁的分享成效、最受歡迎項目；杜杜龍 2026-11-22）。
  ["POST", /^\/my-lists\/(l[\w]{4,20})\/share$/, (ctx, [id]) => listGuard(async () => {
    const l = await ownedList(ctx.db, requireMember(ctx).sub, id!);
    await recordEvent(ctx.db, l.id, "share");
    return { ok: true };
  })],
  ["POST", /^\/my-lists\/view\/([\w-]{2,40})\/([\w-]{3,30})\/item\/(i[\w]{4,20})\/hit$/, (ctx, [number, slug, itemId]) => listGuard(async () => {
    await recordItemHit(ctx.db, number!, slug!, itemId!, ctx.session?.sub ?? null);
    return { ok: true };
  })],
  // 公開檢視（所有清單都公開，訪客也能看）；每次進入點擊 +1。
  ["POST", /^\/my-lists\/view\/([\w-]{2,40})\/([\w-]{3,30})$/, (ctx, [number, slug]) => listGuard(async () => {
    const b = await readJson<{ vid?: unknown; hint?: unknown; referrer?: unknown }>(ctx.req);
    const str = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : "");
    const view = await viewPublic(ctx.db, number!, slug!, str(b.vid, 40), ctx.session?.sub ?? null, str(b.hint, 30), str(b.referrer, 200));
    // 分享者的獎銜與徽章（Amway 資料：每次載入才向中央查，不保存）；查不到就只有頭像與姓名。超級管理員另外看得到查不到的原因（除錯用）。
    const sharer = await lookupSharerRank(ctx.env.CENTRAL_SERVICE_SECRET, view.ownerSub).catch(() => null);
    return { ...view, sharer, ...(sharer || !ctx.session?.roles.includes("super_admin") ? {} : { sharerError: lastSharerError }) };
  })],
  // 把別人的清單複製成自己的新清單（額度不夠會提示要完成哪個成就）。
  ["POST", /^\/my-lists\/view\/([\w-]{2,40})\/([\w-]{3,30})\/copy$/, (ctx, [number, slug]) => listGuard(async () => {
    const s = requireMember(ctx);
    return { id: await copyList(ctx.db, s, await listNumber(s), number!, slug!, await listQuota(ctx, s.sub)) };
  })],
  [
    "GET",
    /^\/me\/notification-settings$/,
    async (ctx) => {
      const s = requireMember(ctx);
      await syncContact(ctx, s).catch(() => undefined);
      return contactSettings(ctx, s);
    },
  ],
  [
    "PUT",
    /^\/me\/notification-settings$/,
    async (ctx) => {
      const s = requireMember(ctx);
      const body = await readJson<{ email?: unknown; notifyEmail?: unknown; emailKinds?: unknown }>(ctx.req);
      let email: string | null | undefined;
      if (body.email !== undefined) {
        if (body.email === null || body.email === "") email = null;
        else if (typeof body.email === "string" && validEmail(body.email.trim())) email = body.email.trim().toLowerCase();
        else return fail(400, "invalid_email", "Email 格式不正確");
      }
      if (body.notifyEmail !== undefined && typeof body.notifyEmail !== "boolean") return fail(400, "invalid_request", "通知方式格式不正確");
      await syncContact(ctx, s).catch(() => undefined);
      if (email !== undefined) {
        // 正本在會員中心：先寫回中央，成功才更新這裡的副本。
        if (s.kind === "central" && !(await saveContactEmail(s.sub, s.token, email))) return fail(502, "central_unavailable", UPGRADING_MSG);
        // 中央會員不在本地留副本；只有模擬會員（測試）寫本地欄位。
        if (s.kind !== "central")
          await ctx.db
            .prepare("INSERT INTO member_contacts (member_sub, email) VALUES (?, ?) ON CONFLICT(member_sub) DO UPDATE SET email = excluded.email, synced_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')")
            .bind(s.sub, email)
            .run();
      }
      if (typeof body.notifyEmail === "boolean") {
        await ctx.db
          .prepare("INSERT INTO member_contacts (member_sub, notify_email) VALUES (?, ?) ON CONFLICT(member_sub) DO UPDATE SET notify_email = excluded.notify_email")
          .bind(s.sub, body.notifyEmail ? 1 : 0)
          .run();
      }
      if (body.emailKinds && typeof body.emailKinds === "object") {
        const cur = (await ctx.db.prepare("SELECT email_kinds FROM member_contacts WHERE member_sub = ?").bind(s.sub).first<{ email_kinds: string | null }>())?.email_kinds ?? null;
        const next = { ...emailKindsOf(cur) } as Record<string, boolean>;
        for (const k of NOTICE_KINDS) {
          const v = (body.emailKinds as Record<string, unknown>)[k.key];
          if (typeof v === "boolean") next[k.key] = v;
        }
        await ctx.db.prepare("INSERT INTO member_contacts (member_sub, email_kinds) VALUES (?, ?) ON CONFLICT(member_sub) DO UPDATE SET email_kinds = excluded.email_kinds").bind(s.sub, JSON.stringify(next)).run();
      }
      return contactSettings(ctx, s);
    },
  ],
  [
    "GET",
    /^\/me$/,
    async (ctx) => {
      const s = ctx.session;
      if (!s) return { member: null };
      // fresh=1（開啟 App／重新整理／回到前景時）：丟掉這位會員在記憶體裡的會員中心資料快取，獎銜等資料立刻拿最新的。
      if (s.kind === "central" && ctx.url.searchParams.get("fresh") === "1") forgetMember(s.sub);
      const labels: Record<Duty, string> = { register: "報名窗口", collect: "收費窗口", review: "審核員" };
      // 向會員中心的幾個查詢彼此獨立，同時送出（以前是一個接一個，首頁會慢）。
      const central = s.kind === "central" ? s : null;
      const [{ results }, , rankMap, rv, opts, missing, badgeMap, canStats, rights] = await Promise.all([
        ctx.db.prepare("SELECT DISTINCT duty FROM review_group_members WHERE member_sub = ?").bind(s.sub).all<{ duty: Duty }>(),
        syncContact(ctx, s).catch(() => undefined),
        ranks(ctx.db),
        central ? rankValue(central.sub, central.token).catch(() => undefined) : undefined,
        central ? rankOptions(central.token).catch(() => new Map<string, string>()) : undefined,
        central ? profileGaps(central.sub, central.token, null).catch(() => []) : undefined,
        central ? rankBadges(central.token).catch(() => undefined) : undefined,
        canViewStats(ctx, s).catch(() => false),
        rightsOf(ctx),
      ]);
      const member = memberOf(s, rankMap, { duties: results.map((r) => labels[r.duty]) });
      member.canViewStats = canStats;
      if (rights.any) {
        member.courseRights = { all: rights.admin, create: canCreateCourse(rights), manageEditors: rights.admin || rights.staff, center: rights.center?.label ?? null, editor: rights.editor };
        if (rights.editor) member.titles = [...new Set([...member.titles, "小編"])];
      }
      // 被指派為窗口、小編的人登入時，補上／更新名單上的姓名（一次送出；有背景執行環境就不必等它）。
      const names = ctx.db.batch([
        ctx.db.prepare("UPDATE review_group_members SET member_name = ? WHERE member_sub = ? AND member_name <> ?").bind(s.name, s.sub, s.name),
        ctx.db.prepare("UPDATE course_editors SET member_name = ? WHERE member_sub = ? AND member_name <> ?").bind(s.name.slice(0, 60), s.sub, s.name.slice(0, 60)),
      ]).catch(() => undefined);
      if (ctx.defer) ctx.defer(names);
      else await names;
      if (central) {
        // 獎銜：值為空或「無／none」顯示「安麗寶寶」；其餘用中央選項的名稱，查不到退回本地階梯名稱。
        if (rv !== undefined) member.rankLabel = rv && rv !== "none" && rv !== "無" ? (opts?.get(rv) ?? rankLabelOf(rv, rankMap)) : "安麗寶寶";
        if (rv !== undefined) {
          // 徽章以中央為準（badge_url 完整網址＋圖案範圍）；中央沒有徽章就不顯示。暫時備援：中央讀不到時才用本地 R2 的舊圖庫。
          const b = badgeMap;
          const info = b && rv ? b.get(rv) : undefined;
          if (b && rv) {
            member.rankBadge = info?.url ?? null;
            member.rankBadgeArt = info ? { width: info.width, height: info.height, top: info.top, bottom: info.bottom } : null;
          }
        }
        // 會員中心資料有空白就提示（只傳「缺什麼」，不保存內容）。
        member.profileMissing = missing ?? [];
        // 資料不完整時，把視窗要用的資料一起帶回去（來源都已在快取，不用再問會員中心，視窗才能立刻顯示）。
        if (member.profileMissing.length) member.profileForm = (await centralProfileView(central.sub, central.token).catch(() => null)) ?? undefined;
      }
      return { member };
    },
  ],
  [
    "DELETE",
    /^\/me$/,
    async (ctx) => {
      // 清除這位會員在本 App 的所有資料（會員中心 webhook 通知刪除帳號時也走同一條）。
      const s = requireMember(ctx);
      await purgeMember(ctx.db, s.sub, s.sub, "member.delete_app_data");
      return { ok: true };
    },
  ],
  [
    "POST",
    /^\/me\/delete-account$/,
    async (ctx) => {
      // App 內直接刪除帳號（杜杜龍 2026-11-23；中央串接指令 2026-11-23.3 三、9）：App 先讓會員重新登入一次拿到 reauth_token，
      // 這裡用會員自己的 Token 呼叫中央刪除；中央成功才清掉本 App 的所有資料，失敗就完全不動並把中央的白話原因帶回。
      const s = requireMember(ctx);
      if (s.kind !== "central") return fail(400, "central_only", "只有中央會員可以使用");
      const body = await readJson<{ reauth_token?: unknown }>(ctx.req);
      const reauth = typeof body.reauth_token === "string" ? body.reauth_token : "";
      if (!reauth) return fail(422, "reauth_required", "請先重新登入確認，才能刪除帳號");
      const r = await centralDeleteAccount(s.sub, s.token, reauth);
      if (!r.ok) {
        // 中央 401 reauth_required 改成 422，避免 App 把它當成「登入過期」而自動換發重試。
        const status = r.code === "reauth_required" || r.status === 401 ? 422 : r.status >= 500 ? 502 : r.status;
        return fail(status, r.code === "unauthenticated" ? "reauth_required" : r.code, r.message);
      }
      await purgeMember(ctx.db, s.sub, s.sub, "member.delete_account_in_app");
      return { ok: true };
    },
  ],
  [
    "GET",
    /^\/center-subscription$/,
    async (ctx) => {
      // 中心訂閱：全部中心的顯示人數都從 688 開始算（杜杜龍 2026-11-17）；訪客也看得到人數。
      const label = (ctx.url.searchParams.get("center") ?? "").trim().slice(0, 60);
      if (!label) fail(400, "invalid_center", "請指定中心");
      return subscriptionState(ctx, centerKey(label));
    },
  ],
  [
    "POST",
    /^\/center-subscription$/,
    async (ctx) => {
      // 按一下訂閱、再按一下取消。
      const s = requireMember(ctx);
      const body = await readJson<{ center?: unknown }>(ctx.req);
      const label = typeof body.center === "string" ? body.center.trim().slice(0, 60) : "";
      if (!label) fail(400, "invalid_center", "請指定中心");
      const key = centerKey(label);
      const had = await ctx.db.prepare("SELECT 1 AS ok FROM center_subscriptions WHERE member_sub = ? AND center_key = ?").bind(s.sub, key).first();
      if (had) await ctx.db.prepare("DELETE FROM center_subscriptions WHERE member_sub = ? AND center_key = ?").bind(s.sub, key).run();
      else await ctx.db.prepare("INSERT OR IGNORE INTO center_subscriptions (member_sub, center_key) VALUES (?, ?)").bind(s.sub, key).run();
      return subscriptionState(ctx, key);
    },
  ],
  [
    "GET",
    /^\/series-subscription$/,
    async (ctx) => {
      // 中心訂閱：全部中心的顯示人數都從 688 開始算（杜杜龍 2026-11-17）；訪客也看得到人數。
      const label = (ctx.url.searchParams.get("series") ?? "").trim().slice(0, 60);
      if (!label) fail(400, "invalid_series", "請指定系列");
      return subscriptionState(ctx, seriesSubKey(label));
    },
  ],
  [
    "POST",
    /^\/series-subscription$/,
    async (ctx) => {
      // 按一下訂閱、再按一下取消。
      const s = requireMember(ctx);
      const body = await readJson<{ series?: unknown }>(ctx.req);
      const label = typeof body.series === "string" ? body.series.trim().slice(0, 60) : "";
      if (!label) fail(400, "invalid_series", "請指定系列");
      const key = seriesSubKey(label);
      const had = await ctx.db.prepare("SELECT 1 AS ok FROM center_subscriptions WHERE member_sub = ? AND center_key = ?").bind(s.sub, key).first();
      if (had) await ctx.db.prepare("DELETE FROM center_subscriptions WHERE member_sub = ? AND center_key = ?").bind(s.sub, key).run();
      else await ctx.db.prepare("INSERT OR IGNORE INTO center_subscriptions (member_sub, center_key) VALUES (?, ?)").bind(s.sub, key).run();
      return subscriptionState(ctx, key);
    },
  ],
  [
    "GET",
    /^\/course-subscription$/,
    async (ctx) => {
      // 課程／教材清單頁的訂閱人數與自己有沒有訂閱（訪客也看得到人數）。
      const id = (ctx.url.searchParams.get("course") ?? "").trim().slice(0, 40);
      if (!id || !(await ctx.db.prepare("SELECT 1 AS ok FROM courses WHERE id = ?").bind(id).first())) return fail(404, "not_found", "找不到這門課程");
      return subscriptionState(ctx, courseSubKey(id));
    },
  ],
  [
    "POST",
    /^\/course-subscription$/,
    async (ctx) => {
      // 按一下訂閱、再按一下取消。
      const s = requireMember(ctx);
      const body = await readJson<{ course?: unknown }>(ctx.req);
      const id = typeof body.course === "string" ? body.course.trim().slice(0, 40) : "";
      if (!id || !(await ctx.db.prepare("SELECT 1 AS ok FROM courses WHERE id = ?").bind(id).first())) return fail(404, "not_found", "找不到這門課程");
      const key = courseSubKey(id);
      const had = await ctx.db.prepare("SELECT 1 AS ok FROM center_subscriptions WHERE member_sub = ? AND center_key = ?").bind(s.sub, key).first();
      if (had) await ctx.db.prepare("DELETE FROM center_subscriptions WHERE member_sub = ? AND center_key = ?").bind(s.sub, key).run();
      else await ctx.db.prepare("INSERT OR IGNORE INTO center_subscriptions (member_sub, center_key) VALUES (?, ?)").bind(s.sub, key).run();
      return subscriptionState(ctx, key);
    },
  ],
  [
    "GET",
    /^\/search\/scenes$/,
    async (ctx) => {
      // 相簿照片的「場景」搜尋（杜杜龍 2026-11-24）：比對 AI 辨識出的場景、行為、物品標籤；依區塊分組。鎖住的課程（獎銜、瀏覽範圍）不回結果。
      const tokens = (ctx.url.searchParams.get("q") ?? "").trim().toLowerCase().split(/\s+/).filter((t) => t.length >= 1).slice(0, 3);
      if (!tokens.length || tokens.join("").length < 2) return { hits: [] };
      const like = (t: string) => `%${t.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
      type SceneRow = { id: string; r2_key: string; block_id: string; scene_text: string; block_title: string; course_id: string; course_title: string };
      const base = `SELECT cm.id, cm.r2_key, cm.owner_key AS block_id, cm.scene_text, l.title AS block_title, l.course_id, c.title AS course_title FROM cover_media cm JOIN lessons l ON l.id = cm.owner_key AND l.kind = 'section' JOIN courses c ON c.id = l.course_id WHERE cm.owner_kind = 'course' AND (cm.scene_status = 'done' OR cm.ocr_status = 'done') AND c.status = 'published'`;
      let { results } = await ctx.db
        .prepare(`${base} AND ${tokens.map(() => "lower(cm.scene_text || ' ' || cm.ocr_text) LIKE ? ESCAPE '\\'").join(" AND ")} ORDER BY cm.created_at DESC LIMIT 300`)
        .bind(...tokens.map(like))
        .all<SceneRow>();
      // 反向比對（杜杜龍 2026-11-25：說了一長句「洗蔬菜水果清潔劑…」卻找不到蔬菜水果的照片）：整句塞不進標籤時，
      // 改成「照片的某個標籤（至少 2 字、不是『室內』這類泛稱）出現在查詢句子裡」就算符合，命中標籤越多的照片越前面。
      let tagsOf: ((r: SceneRow) => string[]) | null = null;
      const { loadSearchSettings } = await import("../search-settings.ts");
      const sst = await loadSearchSettings(ctx.db);
      if (!results.length && sst.sceneReverse !== false) {
        const full = tokens.join("");
        const GENERIC = new Set(["室內", "室外", "圖片", "桌子", "椅子", "天花板", "窗戶", "燈光", "手指", "手腕", "手臂", "桌上物品"]);
        const hitTags = (r: SceneRow) => r.scene_text.split("，").map((t) => t.trim()).filter((t) => t.length >= 2 && !GENERIC.has(t) && full.includes(t.toLowerCase()));
        const all = await ctx.db.prepare(`${base} ORDER BY cm.created_at DESC LIMIT 3000`).all<SceneRow>();
        results = all.results.map((r) => [r, hitTags(r).length] as const).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([r]) => r);
        tagsOf = hitTags;
      }
      const locks = await lockStatesOf(ctx, results.map((r) => r.course_id));
      const groups = new Map<string, { blockId: string; courseId: string; courseTitle: string; blockTitle: string; count: number; tags: Set<string>; locked: boolean; lockLines: string[]; photos: { id: string; url: string }[] }>();
      for (const r of results) {
        const lk = locks.get(r.course_id)!;
        if (sst.showLocked === false && lk.locked && !lk.manages) continue;
        const g = groups.get(r.block_id) ?? { blockId: r.block_id, courseId: r.course_id, courseTitle: r.course_title, blockTitle: r.block_title, count: 0, tags: new Set<string>(), locked: lk.locked && !lk.manages, lockLines: lk.lines, photos: [] };
        g.count++;
        if (!g.locked && g.photos.length < Number(sst.sceneMaxPhotos ?? 40)) g.photos.push({ id: r.id, url: pubUrl(r.r2_key, 0) });
        for (const t of tagsOf ? tagsOf(r) : r.scene_text.split("，")) if (tagsOf || tokens.some((k) => t.toLowerCase().includes(k))) g.tags.add(t);
        groups.set(r.block_id, g);
      }
      return { hits: [...groups.values()].slice(0, 20).map((g) => ({ blockId: g.blockId, courseId: g.courseId, courseTitle: g.courseTitle, blockTitle: g.blockTitle, count: g.count, scene: [...g.tags].slice(0, 6).join("，"), ...(g.locked ? { locked: true, lockLines: g.lockLines } : { photos: g.photos }) })) };
    },
  ],
  [
    "GET",
    /^\/search\/semantic$/,
    async (ctx) => {
      // 語意搜尋（杜杜龍 2026-11-23）：只回「意思相近的課程與章節編號」；前端只顯示自己（依權限）已取得索引裡有的，所以這裡不洩漏任何內容。
      requireMember(ctx);
      const { semanticSearch } = await import("../semantic-search.ts");
      const r = await semanticSearch(ctx.env, ctx.db, ctx.url.searchParams.get("q") ?? "");
      // 沒有權限的內容也找得到（杜杜龍 2026-11-25）：標上 locked＋原因，畫面在縮圖中央蓋鎖頭；鎖住的圖片不給放大用的圖址。
      const locks = await lockStatesOf(ctx, r.extras.flatMap((h) => (h.courseId ? [h.courseId] : [])));
      const showLocked = (await (await import("../search-settings.ts")).loadSearchSettings(ctx.db)).showLocked !== false;
      const extras = [];
      for (const h of r.extras) {
        const lk = h.courseId ? locks.get(h.courseId) : undefined;
        if (lk && lk.locked && !lk.manages) {
          if (!showLocked) continue;
          const { image: _image, ...rest } = h;
          extras.push({ ...rest, locked: true, lockLines: lk.lines });
        } else extras.push(h);
      }
      return { ...r, extras };
    },
  ],
  [
    "GET",
    /^\/search\/phonetic$/,
    async (ctx) => {
      // 同音搜尋（杜杜龍 2026-11-24）：語音辨識錯字（一支援＝益之源）；不用 AI、訪客也能用，只回編號。
      const { phoneticSearch } = await import("../phonetic-search.ts");
      return phoneticSearch(ctx.db, ctx.url.searchParams.get("q") ?? "");
    },
  ],
  [
    "POST",
    /^\/me\/features$/,
    async (ctx) => {
      const s = requireMember(ctx);
      const { feature } = await readJson<{ feature?: unknown }>(ctx.req);
      if (typeof feature !== "string" || !(feature in FEATURES)) return fail(400, "invalid_feature", "功能代碼不正確");
      await ctx.db.prepare("INSERT INTO feature_uses (member_sub, feature) VALUES (?, ?) ON CONFLICT (member_sub, feature) DO UPDATE SET count = count + 1, last_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')").bind(s.sub, feature).run();
      // 只結算這個功能的徽章（便宜），達成就通知；其他徽章等會員打開學習成就頁再算。
      const defs = await ctx.db.prepare("SELECT a.id, a.name, a.icon, a.description FROM achievements a WHERE a.active = 1 AND a.condition_type = 'feature_used' AND a.feature = ? AND NOT EXISTS (SELECT 1 FROM member_achievements m WHERE m.member_sub = ? AND m.achievement_id = a.id) AND (SELECT count FROM feature_uses WHERE member_sub = ? AND feature = ?) >= a.threshold").bind(feature, s.sub, s.sub, feature).all<{ id: string; name: string; icon: string; description: string }>();
      if (defs.results.length)
        await ctx.db.batch(defs.results.flatMap((a) => [ctx.db.prepare("INSERT OR IGNORE INTO member_achievements (member_sub, achievement_id) VALUES (?, ?)").bind(s.sub, a.id), notify(ctx.db, { sub: s.sub }, "獲得學習徽章", `${iconText(a.icon)} ${a.name}：${a.description}`, "/achievements")]));
      return { ok: true };
    },
  ],
  ["GET", /^\/me\/achievements$/, async (ctx) => grantAchievements(ctx, requireMember(ctx).sub)],
  [
    "GET",
    /^\/notifications$/,
    async (ctx) => {
      const s = requireMember(ctx);
      const n = noticeScope(s);
      const { results } = await ctx.db
        // order_status：「有新的報名待審核」這類通知連到 /admin/orders/<報名編號>，用那筆報名現在的狀態判斷有沒有處理過（杜杜龍 2026-11-23）。
        .prepare(`SELECT id, title, body, link, read_at, created_at, (SELECT o.status FROM orders o WHERE notifications.link LIKE '/admin/orders/%' AND o.id = substr(notifications.link, 15)) AS order_status FROM notifications WHERE ${n.sql} ORDER BY created_at DESC LIMIT 100`)
        .bind(...n.args)
        .all<{ id: string; title: string; body: string; link: string; read_at: string | null; created_at: string; order_status: string | null }>();
      return results.map((x): Notice => {
        const category = noticeCategory(x.title, x.link);
        // 審核相關而且還沒處理：待審報名的通知看那筆報名是不是還在待審（就算已讀也算）；其他審核通知（結果、申請進度…）看有沒有讀過。
        const pending = category === "review" && (x.order_status !== null ? x.order_status === "pending" : !x.read_at);
        return { id: x.id, title: x.title, body: x.body, link: x.link, read: !!x.read_at, createdAt: x.created_at, category, ...(pending ? { pending: true } : {}) };
      });
    },
  ],
  [
    "POST",
    /^\/library-invites\/([\w-]{6,40})\/accept$/,
    async (ctx, [code]) => {
      const s = requireMember(ctx);
      if (s.kind !== "central") return fail(403, "central_only", "請用會員中心帳號登入後再接受邀請");
      if (await libOf(ctx.db, s.sub)) return fail(409, "already_has_library", "你已經有「我的書櫃」了");
      const inv = await ctx.db.prepare("SELECT code, expires_at, used_by FROM library_invites WHERE code = ?").bind(code).first<{ code: string; expires_at: string; used_by: string | null }>();
      if (!inv || inv.used_by || Date.parse(inv.expires_at) < Date.now()) return fail(404, "invite_invalid", "這個邀請網址已失效或已被使用");
      const made = await createLibrary(ctx, s);
      if (!made.ok) return fail(made.code === "number_taken" ? 409 : 400, made.code, made.message);
      await ctx.db.prepare("UPDATE library_invites SET used_by = ? WHERE code = ? AND used_by IS NULL").bind(s.sub, code).run();
      return libraryMine(ctx, s.sub);
    },
  ],
  ["GET", /^\/library\/mine$/, async (ctx) => libraryMine(ctx, requireMember(ctx).sub)],
  [
    "PUT",
    /^\/library\/mine$/,
    async (ctx) => {
      const { s } = await myLibrary(ctx);
      const body = await readJson<{ title?: unknown; password?: unknown; passwordDays?: unknown }>(ctx.req);
      const sets: [string, unknown][] = [];
      if (body.title !== undefined) {
        const t = cleanTitle(body.title);
        if (!t) return fail(400, "title_required", "請輸入書櫃名稱");
        sets.push(["title", t]);
      }
      sets.push(...(await libPwSets(body)));
      if (sets.length) await ctx.db.prepare(`UPDATE libraries SET ${sets.map(([c]) => `${c} = ?`).join(", ")} WHERE member_sub = ?`).bind(...sets.map(([, v]) => v), s.sub).run();
      return libraryMine(ctx, s.sub);
    },
  ],
  [
    "POST",
    /^\/library\/mine\/items$/,
    async (ctx) => {
      const { s } = await myLibrary(ctx);
      const body = await readJson<Record<string, unknown>>(ctx.req);
      const kind = body.kind === "shelf" ? "shelf" : "book";
      if (kind === "book" && body.url === undefined) return fail(400, "invalid_url", "請貼上外部連結");
      const sets = await libItemBody(ctx, body, kind);
      const pos = ((await ctx.db.prepare("SELECT COALESCE(MAX(position), 0) AS p FROM library_items WHERE library_sub = ?").bind(s.sub).first<{ p: number }>())?.p ?? 0) + 1;
      const cols = ["id", "library_sub", "position", "kind", ...sets.map(([c]) => c)];
      const id = `b${randomId(8)}`;
      await ctx.db.prepare(`INSERT INTO library_items (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).bind(id, s.sub, pos, kind, ...sets.map(([, v]) => v)).run();
      return libraryMine(ctx, s.sub);
    },
  ],
  [
    "PATCH",
    /^\/library\/mine\/items\/([\w-]{1,40})$/,
    async (ctx, [id]) => {
      const { s } = await myLibrary(ctx);
      const cur = await ctx.db.prepare("SELECT kind FROM library_items WHERE id = ? AND library_sub = ?").bind(id, s.sub).first<{ kind: "shelf" | "book" }>();
      if (!cur) return fail(404, "not_found", "找不到這一格");
      const sets = await libItemBody(ctx, await readJson<Record<string, unknown>>(ctx.req), cur.kind);
      if (sets.length) await ctx.db.prepare(`UPDATE library_items SET ${sets.map(([c]) => `${c} = ?`).join(", ")} WHERE id = ? AND library_sub = ?`).bind(...sets.map(([, v]) => v), id, s.sub).run();
      return libraryMine(ctx, s.sub);
    },
  ],
  [
    "DELETE",
    /^\/library\/mine\/items\/([\w-]{1,40})$/,
    async (ctx, [id]) => {
      const { s } = await myLibrary(ctx);
      await ctx.db.prepare("DELETE FROM library_items WHERE id = ? AND library_sub = ?").bind(id, s.sub).run();
      return libraryMine(ctx, s.sub);
    },
  ],
  [
    "POST",
    /^\/library\/mine\/items\/order$/,
    async (ctx) => {
      const { s } = await myLibrary(ctx);
      const body = await readJson<{ ids?: unknown }>(ctx.req);
      const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string") : [];
      const cur = (await libItems(ctx.db, s.sub)).map((r) => r.id);
      if (ids.length !== cur.length || new Set(ids).size !== ids.length || ids.some((i) => !cur.includes(i))) return fail(400, "invalid_order", "順序不正確，請重新整理後再試");
      await ctx.db.batch(ids.map((i, k) => ctx.db.prepare("UPDATE library_items SET position = ? WHERE id = ? AND library_sub = ?").bind(k + 1, i, s.sub)));
      return libraryMine(ctx, s.sub);
    },
  ],
  [
    "POST",
    /^\/library\/view\/([\w-]{3,40})$/,
    async (ctx, [raw]): Promise<LibraryView> => {
      // 公開檢視（不用登入）：網址是 /會員編號。整座書櫃有密碼就要先解鎖（憑證 tokens.lib）；有密碼的書要各自解鎖（tokens.items[id]）。擁有者本人永遠看得到全部。
      const number = libraryNumber(raw);
      const lib = number ? await ctx.db.prepare("SELECT member_sub, number, owner_name, title, pw_hash, pw_salt, pw_expires_at, views FROM libraries WHERE number = ?").bind(number).first<LibRow>() : null;
      if (!lib) return fail(404, "not_found", "找不到這個書櫃");
      const body = await readJson<{ tokens?: { lib?: unknown; items?: Record<string, unknown> } }>(ctx.req).catch(() => ({}) as { tokens?: { lib?: unknown; items?: Record<string, unknown> } });
      const owner = ctx.session?.sub === lib.member_sub;
      const base = { number: lib.number, title: lib.title, ownerName: lib.owner_name, owner };
      if (!owner && lib.pw_hash) {
        const open = pwActive(lib.pw_expires_at) && (await checkToken(body.tokens?.lib, lib.pw_hash, "lib"));
        if (!open) return { ...base, locked: true, lockExpired: !pwActive(lib.pw_expires_at), items: [] };
      }
      if (!owner) await ctx.db.prepare("UPDATE libraries SET views = views + 1 WHERE member_sub = ?").bind(lib.member_sub).run();
      const items = await Promise.all((await libItems(ctx.db, lib.member_sub)).map(async (r) => libItemOut(r, owner, !!r.pw_hash && pwActive(r.pw_expires_at) && (await checkToken(body.tokens?.items?.[r.id], r.pw_hash, r.id)))));
      return { ...base, locked: false, lockExpired: false, items };
    },
  ],
  [
    "POST",
    /^\/library\/view\/([\w-]{3,40})\/unlock$/,
    async (ctx, [raw]): Promise<LibraryUnlock> => {
      const number = libraryNumber(raw);
      const lib = number ? await libOf2(ctx.db, number) : null;
      if (!lib) return fail(404, "not_found", "找不到這個書櫃");
      const body = await readJson<{ password?: unknown; itemId?: unknown }>(ctx.req);
      const pw = typeof body.password === "string" ? body.password : "";
      let hash = lib.pw_hash, salt = lib.pw_salt, exp = lib.pw_expires_at, scope = "lib";
      if (typeof body.itemId === "string") {
        const it = await ctx.db.prepare("SELECT pw_hash, pw_salt, pw_expires_at FROM library_items WHERE id = ? AND library_sub = ?").bind(body.itemId, lib.member_sub).first<{ pw_hash: string | null; pw_salt: string | null; pw_expires_at: string | null }>();
        if (!it) return fail(404, "not_found", "找不到這本書");
        hash = it.pw_hash; salt = it.pw_salt; exp = it.pw_expires_at; scope = body.itemId;
      }
      if (!hash || !salt) return fail(400, "no_password", "這裡沒有設定密碼");
      if (!pwActive(exp)) return fail(403, "password_expired", "這個密碼已經失效，請向書櫃主人索取新的密碼");
      if (!(await checkPassword(pw, hash, salt))) return fail(403, "wrong_password", "密碼不正確");
      return makeToken(hash, scope, exp);
    },
  ],
  // 「繳作業」分頁（杜杜龍 2026-11-28）：即時向繳作業系統讀、不存副本；要放在 /notifications/<id>/read 之前，避免 check 被當成通知編號。
  ["GET", /^\/notifications\/check$/, async (ctx) => loadCheckNotices(ctx.env, requireMember(ctx).sub)],
  [
    "POST",
    /^\/notifications\/check\/read$/,
    async (ctx) => {
      const s = requireMember(ctx);
      const b = await readJson<{ id?: unknown }>(ctx.req);
      return { ok: await readCheckNotices(ctx.env, s.sub, typeof b.id === "string" ? b.id : undefined) };
    },
  ],
  [
    "POST",
    /^\/notifications\/read-all$/,
    async (ctx) => {
      const n = noticeScope(requireMember(ctx));
      await ctx.db.prepare(`UPDATE notifications SET read_at = ? WHERE read_at IS NULL AND ${n.sql}`).bind(iso(), ...n.args).run();
      return { ok: true };
    },
  ],
  [
    "POST",
    /^\/notifications\/([\w-]+)\/read$/,
    async (ctx, [id]) => {
      const n = noticeScope(requireMember(ctx));
      await ctx.db.prepare(`UPDATE notifications SET read_at = COALESCE(read_at, ?) WHERE id = ? AND ${n.sql}`).bind(iso(), id, ...n.args).run();
      return { ok: true };
    },
  ],
  [
    "GET",
    /^\/me\/central-profile$/,
    async (ctx) => {
      const s = requireMember(ctx);
      if (s.kind !== "central") return fail(400, "central_only", "只有中央會員可以使用");
      return (await centralProfileView(s.sub, s.token)) ?? fail(502, "central_unavailable", UPGRADING_MSG);
    },
  ],
  [
    "PUT",
    /^\/me\/central-profile$/,
    async (ctx) => {
      const s = requireMember(ctx);
      if (s.kind !== "central") return fail(400, "central_only", "只有中央會員可以使用");
      const body = await readJson<{ changes?: unknown; key?: unknown; value?: unknown; enableAmway?: unknown }>(ctx.req);
      type Change = { key: "legal_name" | "display_name" | "contact_email" | "education_system" | "education_center" | "rank" | "upline_platinum" | "upline_diamond"; value: string | null };
      const keys = ["legal_name", "display_name", "contact_email", "education_system", "education_center", "rank", "upline_platinum", "upline_diamond"] as const;
      const enable = body.enableAmway === true;
      const raw = Array.isArray(body.changes) ? body.changes : enable ? [] : [{ key: body.key, value: body.value }];
      if ((!raw.length && !enable) || raw.length > 8) return fail(400, "invalid_request", "沒有要儲存的內容");
      const changes: Change[] = [];
      for (const r of raw as { key?: unknown; value?: unknown }[]) {
        const key = keys.find((k) => k === r?.key);
        if (!key) return fail(400, "invalid_field", "不能修改這個欄位");
        const v = typeof r.value === "string" ? r.value.trim().slice(0, key === "contact_email" ? 254 : 50) : r.value === null ? null : undefined;
        if (v === undefined) return fail(400, "invalid_value", "內容格式不正確");
        if (key === "contact_email" && v && !validEmail(v.toLowerCase())) return fail(400, "invalid_email", "Email 格式不正確");
        changes.push({ key, value: v === "" ? null : key === "contact_email" ? v!.toLowerCase() : v });
      }
      // 資料正本在會員中心：直接寫過去（不保存、不寫日誌）。獎銜以外的欄位同時送出，最後再送獎銜（中央 2026-11-23.1 起獎銜不再被系統、中心卡住，順序只是習慣）。
      const errors: string[] = [];
      let systemNotice: string | null = null; // 中央擋下「自訂系統含寰宇中心名稱」(use_hglobal_center)：原文回給畫面顯示在系統欄下方，不當一般錯誤
      let pending = false;
      // 勾選「我是 Amway 會員」（杜杜龍 2026-11-19：資料視窗內直接勾）：先開啟，後面的系統、中心、獎銜才寫得進去。
      if (enable) {
        const msg = await centralEnableAmway(s.token);
        if (msg) errors.push(msg);
      }
      const pendingKeys: Change[] = [];
      const write = async (c: Change) => {
        if (c.key === "contact_email") {
          if (!(await saveContactEmail(s.sub, s.token, c.value))) errors.push("Email：會員中心暫時無法儲存");
          return;
        }
        const r = await centralWriteField(s.token, c.key, c.value);
        if (!r.ok) {
          if (c.key === "education_system" && r.reason === "use_hglobal_center") systemNotice = r.message;
          else errors.push(r.message);
        } else if (r.status === "pending") {
          pending = true;
          pendingKeys.push(c);
        }
      };
      if (!errors.length) {
        await Promise.all(changes.filter((c) => c.key !== "rank").map(write));
        const rank = changes.find((c) => c.key === "rank");
        if (rank) await write(rank);
      }
      // 送出申請的紀錄（杜杜龍 2026-11-19）：每個需要審核的欄位留一筆，申請人的通知頁也留一則「已送出」。
      for (const c of pendingKeys) {
        const label = REVIEW_FIELD_LABEL[c.key];
        if (!label || !c.value) continue;
        await ctx.db.batch([
          ctx.db.prepare("INSERT INTO review_log (id, field_key, field_label, applicant_sub, applicant_name) VALUES (?, ?, ?, ?, ?)").bind(crypto.randomUUID(), c.key, label, s.sub, s.name),
          notify(ctx.db, { sub: s.sub }, `已送出「${label}」申請，等待審核`, "審核結果會通知你，也會保留在這裡", "/notices"),
        ]).catch(() => undefined);
      }
      forgetMember(s.sub);
      // 把最新的欄位狀態一起回傳，畫面不用再多問一趟。
      const form = await centralProfileView(s.sub, s.token).catch(() => null);
      return { ok: errors.length === 0 && !systemNotice, errors, pending, form, systemNotice };
    },
  ],
  [
    "GET",
    /^\/me\/vocab$/,
    async (ctx) => {
      const s = requireMember(ctx);
      if (s.kind !== "central") return [];
      const pool = ctx.url.searchParams.get("pool");
      if (pool !== "education_system" && pool !== "education_center" && pool !== "job_title" && pool !== "upline_platinum" && pool !== "upline_diamond") return fail(400, "invalid_pool", "不支援這個詞庫");
      return centralSuggest(s.token, pool, ctx.url.searchParams.get("q") ?? "");
    },
  ],
  [
    "GET",
    /^\/search-settings$/,
    async (ctx) => {
      // 搜尋參數（公開，前端的模糊、字元、排序、語意開關用；杜杜龍 2026-11-25）。
      const { loadSearchSettings } = await import("../search-settings.ts");
      return loadSearchSettings(ctx.db);
    },
  ],
  [
    "GET",
    /^\/search-synonyms$/,
    async (ctx) => {
      // 自訂關聯詞（公開，給搜尋用；杜杜龍 2026-11-25）。
      const { results } = await ctx.db.prepare("SELECT terms FROM search_synonyms ORDER BY id").all<{ terms: string }>();
      return { groups: results.map((r) => JSON.parse(r.terms) as string[]) };
    },
  ],
  [
    "GET",
    /^\/push\/key$/,
    // 手機推播：瀏覽器訂閱用的公鑰；沒設定金鑰時 publicKey 為 null（畫面顯示「尚未開放」）。
    async (ctx) => ({ publicKey: vapidPublicKey(ctx.env) }),
  ],
  [
    "POST",
    /^\/push\/subscribe$/,
    async (ctx) => {
      const s = requireMember(ctx);
      const body = await readJson<{ endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } }>(ctx.req);
      const endpoint = typeof body.endpoint === "string" ? body.endpoint : "";
      const p256dh = typeof body.keys?.p256dh === "string" ? body.keys.p256dh : "";
      const auth = typeof body.keys?.auth === "string" ? body.keys.auth : "";
      let ok = false;
      try {
        ok = new URL(endpoint).protocol === "https:" && endpoint.length < 1000 && /^[A-Za-z0-9_-]{80,100}$/.test(p256dh) && /^[A-Za-z0-9_-]{16,30}$/.test(auth);
      } catch {
        ok = false;
      }
      if (!ok) return fail(400, "invalid_subscription", "推播訂閱資料不正確，請重新開啟推播");
      await ctx.db
        .prepare("INSERT INTO push_subscriptions (endpoint, member_sub, p256dh, auth, role, roles, center_key, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET member_sub = excluded.member_sub, p256dh = excluded.p256dh, auth = excluded.auth, role = excluded.role, roles = excluded.roles, center_key = excluded.center_key, user_agent = excluded.user_agent, failures = 0")
        .bind(endpoint, s.sub, p256dh, auth, s.role, s.roles.join(","), s.center?.key ?? null, (ctx.req.headers.get("user-agent") ?? "").slice(0, 200))
        .run();
      return { ok: true };
    },
  ],
  [
    "POST",
    /^\/push\/unsubscribe$/,
    async (ctx) => {
      const s = requireMember(ctx);
      const body = await readJson<{ endpoint?: unknown }>(ctx.req);
      if (typeof body.endpoint === "string") await ctx.db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ? AND member_sub = ?").bind(body.endpoint, s.sub).run();
      return { ok: true };
    },
  ],
  [
    "POST",
    /^\/push\/test$/,
    async (ctx) => {
      // 「傳一則測試通知給我」：建立一則站內通知，送出後會自動推播到自己所有已開啟的裝置。
      const s = requireMember(ctx);
      await notify(ctx.db, { sub: s.sub }, "推播測試", "看到這則就代表手機推播已經開好了 🎉", "/notices").run();
      // 回報這個帳號有幾支裝置開了推播（共用的推播設定卡會顯示「已送出到 N 支裝置」；0 支就提示重新開啟）。
      const devices = (await ctx.db.prepare("SELECT COUNT(*) AS n FROM push_subscriptions WHERE member_sub = ?").bind(s.sub).first<{ n: number }>())?.n ?? 0;
      return { devices, ok: devices };
    },
  ],
];
