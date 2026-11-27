/** 行動大學 API 路由：報名與審核：報名紀錄、審核群組、審核邀請、職務（杜杜龍 2026-11-27 從 api.ts 拆出；順序會影響比對，同一檔內照原本順序）。 */
import { DEMO_MEMBERS, type EditorCandidate, type CentralReviews, UPGRADING_MSG } from "../contract.ts";
import { lookupUplines, lookupLegalNames, centerMembers, centralDecide, centralReviews, staffAssign, staffSearch, centerKey, rankOptions } from "../central.ts";
import type { D1PreparedStatement } from "../d1.ts";
import { ORDER_SELECT, type OrderRow, REVIEW_FIELD_LABEL, addOrderEvent, assertCentralCenters, audit, canManageCenter, cancelOrder, createOrders, editorCenter, editorFlagText, editorFlags, fail, hydrateOrders, inviteOf, inviteState, iso, listEditors, listGroups, notify, orderDetail, randomId, readJson, reportPayment, requireGroupManager, requireMember, reviewCsv, reviewList, reviewOrder, reviewText, rightsOf, sha256, text } from "../api-core.ts";
import type { Handler } from "../api-core.ts";

export const ordersRoutes: [string, RegExp, Handler][] = [
  ["POST", /^\/orders$/, async (ctx) => createOrders(ctx, await readJson(ctx.req))],
  ["POST", /^\/orders\/([\w-]+)\/cancel$/, async (ctx, [id]) => cancelOrder(ctx, id)],
  ["POST", /^\/orders\/([\w-]+)\/payments$/, async (ctx, [id]) => reportPayment(ctx, id!, await readJson(ctx.req))],
  [
    "DELETE",
    /^\/orders\/([\w-]+)\/payments\/([\w-]+)$/,
    async (ctx, [orderId, payId]) => {
      const s = requireMember(ctx);
      const o = await ctx.db.prepare("SELECT member_sub, status FROM orders WHERE id = ?").bind(orderId).first<{ member_sub: string; status: string }>();
      if (!o || o.member_sub !== s.sub) return fail(404, "not_found", "找不到這筆報名");
      if (o.status !== "pending") fail(409, "not_pending", "這筆報名已處理完畢，不能刪除回報紀錄");
      const r = await ctx.db.prepare("DELETE FROM order_payments WHERE id = ? AND order_id = ?").bind(payId, orderId).run();
      if (r.meta?.changes === 0) return fail(404, "not_found", "找不到這筆回報");
      await audit(ctx.db, s.sub, "order.payment_delete", "order", orderId, payId).run();
      return orderDetail(ctx, orderId);
    },
  ],
  [
    "GET",
    /^\/orders$/,
    async (ctx) => {
      const s = requireMember(ctx);
      const { results } = await ctx.db.prepare(`${ORDER_SELECT} WHERE o.member_sub = ? ORDER BY o.created_at DESC LIMIT 200`).bind(s.sub).all<OrderRow>();
      return hydrateOrders(ctx.db, results);
    },
  ],
  ["GET", /^\/orders\/([\w-]+)$/, async (ctx, [id]) => orderDetail(ctx, id)],
  ["POST", /^\/orders\/([\w-]+)\/events$/, async (ctx, [id]) => addOrderEvent(ctx, id, await readJson(ctx.req))],
  [
    "GET",
    /^\/staff-roles\/access$/,
    async (ctx): Promise<{ available: boolean; assignable: { value: string; label: string }[] }> => {
      // 設定頁入口：只有中央判斷有權限的人才顯示（任何非 200 都當沒有權限）；只回職務選項，不回名單。
      const s = requireMember(ctx);
      if (s.kind !== "central") return { available: false, assignable: [] };
      const r = await staffSearch(s.token);
      return { available: r.available, assignable: r.assignable };
    },
  ],
  [
    "GET",
    /^\/staff-roles\/center-members$/,
    async (ctx) => {
      // 依中心列出會員（杜杜龍 2026-11-21）：用本人 Token 向中央讀同中心名單（權限與範圍全由中央判斷）；名單不保存、搜尋字不寫日誌。
      const s = requireMember(ctx);
      if (s.kind !== "central") return fail(403, "forbidden", "只有中央會員可以使用");
      const center = (ctx.url.searchParams.get("center") ?? "").trim().slice(0, 100);
      if (!center) return fail(400, "center_required", "請先選擇中心");
      try {
        const page = await centerMembers(s.token, { q: (ctx.url.searchParams.get("q") ?? "").trim().slice(0, 30), cursor: ctx.url.searchParams.get("cursor"), center, limit: 30 });
        return { center: page.center?.label ?? center, members: page.members, next: page.next };
      } catch (e) {
        const err = e as { status?: number; code?: string };
        if (err.code === "field_not_allowed") return fail(503, "central_field_not_allowed", "會員中心尚未開放「顯示名稱」給行動大學：請超級管理員到會員中心後台「平台設定」勾選 display_name");
        if (err.status === 403) return fail(403, "central_forbidden", "會員中心不允許查詢這個中心的名單");
        if (err.status === 404) return fail(404, "unknown_center", "會員中心找不到這個中心");
        return fail(503, "central_unavailable", UPGRADING_MSG);
      }
    },
  ],
  [
    "GET",
    /^\/staff-roles$/,
    async (ctx) => {
      // 查人（杜杜龍 2026-11-21）：不帶 q＝有職務的人；q 要 2～30 字。用本人 Token、不保存名單與搜尋字、不寫日誌。
      const s = requireMember(ctx);
      if (s.kind !== "central") return fail(403, "forbidden", "只有中央會員可以使用");
      const q = (ctx.url.searchParams.get("q") ?? "").trim();
      if (q && (q.length < 2 || q.length > 30)) return fail(422, "invalid_query", "搜尋字請輸入 2 到 30 個字");
      const r = await staffSearch(s.token, q || undefined);
      if (!r.available) return fail(403, "forbidden", "你沒有指派職務的權限");
      return r;
    },
  ],
  [
    "PUT",
    /^\/staff-roles\/([\w.-]{1,80})$/,
    async (ctx, [memberId]) => {
      // 指派職務：body.roles 是「事後完整清單」；成功時回中央最新的 roles 讓畫面更新。
      const s = requireMember(ctx);
      if (s.kind !== "central") return fail(403, "forbidden", "只有中央會員可以使用");
      const body = await readJson<{ roles?: unknown }>(ctx.req);
      if (!Array.isArray(body.roles) || body.roles.length > 30 || body.roles.some((x) => typeof x !== "string" || !x || x.length > 60)) return fail(422, "invalid_roles", "職務清單格式不正確");
      const r = await staffAssign(s.token, memberId!, [...new Set(body.roles as string[])]);
      if (r.status === 200) return { roles: r.roles ?? (body.roles as string[]) };
      if (r.status === 403) return fail(403, "forbidden", "你沒有權限指派這個職務或這位會員");
      if (r.status === 404) return fail(404, "not_found", "找不到這位會員");
      if (r.status === 422) return fail(422, "invalid_roles", "中央不接受這個職務組合");
      return fail(r.status === 429 ? 429 : 503, "central_unavailable", UPGRADING_MSG);
    },
  ],
  [
    "GET",
    /^\/central-reviews$/,
    async (ctx): Promise<CentralReviews> => {
      // 通知頁「審核」分類：中央的獎銜、中心新申請（即時讀取、不保存）。非中央會員或沒有權限＝available:false。
      const s = requireMember(ctx);
      if (s.kind !== "central") return { available: false, scope: null, reviews: [] };
      const res = await centralReviews(s.token);
      // 申請人的本名與上手白金／鑽石（中央即時提供、不保存；任何一項讀不到就不顯示那一項）。
      const subs = res.reviews.map((r) => r.member_id).filter((x): x is string => !!x);
      if (subs.length) {
        const [names, uplines] = await Promise.all([lookupLegalNames(ctx.env.CENTRAL_SERVICE_SECRET, subs).catch(() => new Map<string, string>()), lookupUplines(ctx.env.CENTRAL_SERVICE_SECRET, subs).catch(() => undefined)]);
        res.reviews = res.reviews.map((r) => (r.member_id ? { ...r, legal_name: names.get(r.member_id) ?? null, upline_platinum: uplines?.get(r.member_id)?.platinum ?? null, upline_diamond: uplines?.get(r.member_id)?.diamond ?? null } : r));
      }
      return res;
    },
  ],
  [
    "GET",
    /^\/central-reviews\/history$/,
    async (ctx) => {
      // 已處理的申請紀錄（保留，不會從通知頁消失）：自己處理過的；超級管理員看全部。
      const s = requireMember(ctx);
      const sql = "SELECT id, field_label, COALESCE(NULLIF(applicant_name, ''), (SELECT r2.applicant_name FROM review_log r2 WHERE r2.applicant_sub = review_log.applicant_sub AND r2.applicant_sub IS NOT NULL AND r2.applicant_name <> '' ORDER BY r2.created_at DESC LIMIT 1), '') AS applicant_name, applicant_sub, from_text, to_text, final_text, status, decided_by_name, decided_at FROM review_log WHERE status <> 'pending'" + (s.role === "admin" ? "" : " AND decided_by_sub = ?") + " ORDER BY decided_at DESC LIMIT 100";
      const { results } = await (s.role === "admin" ? ctx.db.prepare(sql) : ctx.db.prepare(sql).bind(s.sub)).all<{ id: string; field_label: string; applicant_name: string; applicant_sub: string | null; from_text: string; to_text: string; final_text: string; status: string; decided_by_name: string; decided_at: string }>();
      // 申請人的本名與上手白金／鑽石（中央即時提供、不保存；讀不到就不顯示）。
      const subs = [...new Set(results.map((r) => r.applicant_sub).filter((x): x is string => !!x))].slice(0, 100);
      const [legal, uplines] = subs.length ? await Promise.all([lookupLegalNames(ctx.env.CENTRAL_SERVICE_SECRET, subs).catch(() => new Map<string, string>()), lookupUplines(ctx.env.CENTRAL_SERVICE_SECRET, subs).catch(() => undefined)]) : [new Map<string, string>(), undefined];
      // 獎銜顯示正式中文名稱（資料裡存的是代號）。
      const names = s.kind === "central" ? await rankOptions(s.token).catch(() => new Map<string, string>()) : new Map<string, string>();
      return results.map(({ applicant_sub: sub, ...r0 }) => {
        const r = { ...r0, legal_name: (sub && legal.get(sub)) || null, upline_platinum: (sub && uplines?.get(sub)?.platinum) || null, upline_diamond: (sub && uplines?.get(sub)?.diamond) || null, has_member: !!sub };
        return r.field_label === "獎銜" ? { ...r, from_text: names.get(r.from_text) ?? r.from_text, to_text: names.get(r.to_text) ?? r.to_text, final_text: names.get(r.final_text) ?? r.final_text } : r;
      });
    },
  ],
  [
    "POST",
    /^\/central-reviews\/([\w-]{1,64})\/decision$/,
    async (ctx, [id]) => {
      const s = requireMember(ctx);
      if (s.kind !== "central") return fail(403, "forbidden", "只有中央會員可以審核");
      const body = await readJson<{ decision?: unknown; value?: unknown; item?: { display_name?: unknown; field_key?: unknown; field_label?: unknown; current_value?: unknown; requested_value?: unknown } }>(ctx.req);
      if (body.decision !== "approve" && body.decision !== "reject") return fail(400, "invalid_decision", "請選擇通過或不通過");
      // 「修改後通過」（杜杜龍 2026-11-20，中央串接指令 2026-11-20.1）：只有通過能帶修改後的值（文字，或 {option, custom_text}）。
      const val = body.value;
      const validVal = typeof val === "string" ? val.trim().length > 0 && val.length <= 200 : !!val && typeof val === "object" && typeof (val as { option?: unknown }).option === "string";
      if (val !== undefined && (body.decision !== "approve" || !validVal)) return fail(422, "invalid_value", "修改後的內容格式不正確，只有「通過」可以修改內容");
      const r = await centralDecide(s.token, id, body.decision, typeof val === "string" ? val.trim() : val);
      const code = r.status;
      if (code === 200) {
        // 申請人（member_id）與欄位由中央回應直接提供（只在這次處理中使用，不另外保存）。
        const who = typeof r.body?.member_id === "string" ? r.body.member_id : null;
        const key = typeof r.body?.field_key === "string" ? r.body.field_key : "";
        const modified = r.body?.modified === true;
        const it = body.item ?? {};
        const fkey = typeof it.field_key === "string" ? it.field_key : key;
        const flabel = typeof it.field_label === "string" && it.field_label ? it.field_label.slice(0, 20) : REVIEW_FIELD_LABEL[fkey] ?? "申請";
        const name = typeof it.display_name === "string" ? it.display_name.trim().slice(0, 60) : "";
        const to = reviewText(it.requested_value);
        const final = modified ? reviewText(val) : "";
        const result = body.decision === "approve" ? "approved" : "rejected";
        // 對應申請時留的待審紀錄：先用申請人編號，其次「欄位＋申請內容＋名稱」，最後同欄位同內容只有一筆時。
        let found = who ? await ctx.db.prepare("SELECT id, applicant_sub FROM review_log WHERE status = 'pending' AND applicant_sub = ? AND field_key = ? ORDER BY created_at DESC LIMIT 1").bind(who, fkey).first<{ id: string; applicant_sub: string | null }>() : null;
        if (!found) found = await ctx.db.prepare("SELECT id, applicant_sub FROM review_log WHERE status = 'pending' AND field_key = ? AND applicant_name = ? AND ? <> '' ORDER BY created_at LIMIT 1").bind(fkey, name, name).first<{ id: string; applicant_sub: string | null }>();
        if (!found) {
          const alt = (await ctx.db.prepare("SELECT id, applicant_sub FROM review_log WHERE status = 'pending' AND field_key = ? LIMIT 2").bind(fkey).all<{ id: string; applicant_sub: string | null }>()).results;
          if (alt.length === 1) found = alt[0]!;
        }
        const names = fkey === "rank" ? await rankOptions(s.token).catch(() => new Map<string, string>()) : new Map<string, string>();
        const nameOf = (v: string) => (fkey === "rank" && v ? names.get(v) ?? v : v); // 獎銜用正式中文名稱，不用代號
        const shown = nameOf(final || to);
        const target = who ?? found?.applicant_sub ?? null;
        const stmts: D1PreparedStatement[] = [];
        if (found) stmts.push(ctx.db.prepare("UPDATE review_log SET status = ?, decided_by_sub = ?, decided_by_name = ?, decided_at = ?, from_text = ?, to_text = ?, final_text = ?, applicant_sub = COALESCE(applicant_sub, ?), applicant_name = CASE WHEN applicant_name IS NULL OR applicant_name = '' THEN ? ELSE applicant_name END WHERE id = ?").bind(result, s.sub, s.name, iso(), reviewText(it.current_value), to, final, who, name, found.id));
        else stmts.push(ctx.db.prepare("INSERT INTO review_log (id, field_key, field_label, applicant_sub, applicant_name, from_text, to_text, final_text, status, decided_by_sub, decided_by_name, decided_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), fkey, flabel, who, name, reviewText(it.current_value), to, final, result, s.sub, s.name, iso()));
        if (target) {
          const title = result === "approved" ? (modified ? `你的${flabel}申請經審核者修改後通過` : `你的${flabel}申請已通過`) : `你的${flabel}申請未通過`;
          const note = result === "approved" ? `${modified ? `審核者把「${nameOf(to)}」修改為「${shown}」後通過。` : shown ? `申請內容：${shown}。` : ""}到「設定」頁看最新的資料` : `${shown ? `申請內容：${shown}。` : ""}到「設定」頁看最新的資料`;
          stmts.push(notify(ctx.db, { sub: target }, title, note, "/settings"));
        }
        await ctx.db.batch(stmts).catch(() => undefined);
        return { ok: true, modified };
      }
      if (code === 422) return fail(422, "invalid_value", "修改後的內容不符合規則，請重新選擇");
      if (code === 403) return fail(403, "forbidden", "這個申請不屬於您負責的中心，或不能改成其他中心");
      if (code === 404) return fail(404, "not_pending", "這筆申請已被處理過，請重新整理");
      return fail(502, "central_unavailable", UPGRADING_MSG);
    },
  ],
  ["GET", /^\/admin\/orders$/, async (ctx) => hydrateOrders(ctx.db, (await reviewList(ctx)).rows.slice(0, 300))],
  ["GET", /^\/admin\/orders\.csv$/, async (ctx) => reviewCsv(ctx)],
  ["POST", /^\/admin\/orders\/([\w-]+)\/review$/, async (ctx, [id]) => reviewOrder(ctx, id, await readJson(ctx.req))],
  ["GET", /^\/admin\/review-groups$/, async (ctx) => listGroups(ctx)],
  [
    "POST",
    /^\/admin\/review-groups$/,
    async (ctx) => {
      const s = requireMember(ctx);
      const body = await readJson<{ name?: unknown; ownerCenter?: unknown }>(ctx.req);
      const name = text(body.name, 60) || fail(400, "name_required", "請輸入群組名稱");
      // 總部群組只有秘書與超級管理員可建立；會長、音控只能建立自己中心的群組。
      const own = text(body.ownerCenter, 100) || null;
      if (s.role !== "admin" && !(own && canManageCenter(s, centerKey(own)))) fail(403, "forbidden", "沒有建立這個群組的權限");
      if (own) await assertCentralCenters(ctx, [own]);
      const id = `g${randomId(8)}`;
      await ctx.db.batch([
        ctx.db.prepare("INSERT INTO review_groups (id, name, owner_center_key, owner_center_label, created_by_sub) VALUES (?, ?, ?, ?, ?)").bind(id, name, own ? centerKey(own) : null, own ?? "", s.sub),
        audit(ctx.db, s.sub, "group.create", "review_group", id, name),
      ]);
      return listGroups(ctx);
    },
  ],
  [
    "PATCH",
    /^\/admin\/review-groups\/([\w-]+)$/,
    async (ctx, [id]) => {
      const s = await requireGroupManager(ctx, id);
      const name = text((await readJson<{ name?: unknown }>(ctx.req)).name, 60) || fail(400, "name_required", "請輸入群組名稱");
      await ctx.db.batch([ctx.db.prepare("UPDATE review_groups SET name = ? WHERE id = ?").bind(name, id), audit(ctx.db, s.sub, "group.rename", "review_group", id, name)]);
      return listGroups(ctx);
    },
  ],
  [
    "DELETE",
    /^\/admin\/review-groups\/([\w-]+)$/,
    async (ctx, [id]) => {
      const s = await requireGroupManager(ctx, id);
      await ctx.db.batch([
        ctx.db.prepare("UPDATE courses SET review_group_id = NULL WHERE review_group_id = ?").bind(id),
        ctx.db.prepare("DELETE FROM review_groups WHERE id = ?").bind(id),
        audit(ctx.db, s.sub, "group.delete", "review_group", id),
      ]);
      return listGroups(ctx);
    },
  ],
  [
    "POST",
    /^\/admin\/review-groups\/([\w-]+)\/members$/,
    async (ctx, [id]) => {
      const s = await requireGroupManager(ctx, id);
      const body = await readJson<{ memberSub?: unknown; duty?: unknown; center?: unknown; remove?: unknown }>(ctx.req);
      const sub = typeof body.memberSub === "string" ? body.memberSub.trim() : "";
      if (!/^[\w-]{3,128}$/.test(sub)) fail(400, "invalid_member", "請貼上正確的會員 ID（對方在「設定」頁可以看到）");
      if (body.duty !== "register" && body.duty !== "collect" && body.duty !== "review") fail(400, "invalid_duty", "請選擇職責");
      const label = text(body.center, 100) ?? "";
      const key = label ? centerKey(label) : "";
      if (body.remove === true) {
        await ctx.db.batch([
          ctx.db.prepare("DELETE FROM review_group_members WHERE group_id = ? AND center_key = ? AND member_sub = ? AND duty = ?").bind(id, key, sub, body.duty),
          audit(ctx.db, s.sub, "group.member_remove", "review_group", id, `${sub}:${body.duty}`),
        ]);
        return listGroups(ctx);
      }
      if (label) await assertCentralCenters(ctx, [label]);
      // 姓名：先用對方曾留下的報名姓名；對方下次登入時會自動更新。
      const known = await ctx.db
        .prepare("SELECT member_name AS n FROM review_group_members WHERE member_sub = ? AND member_name <> '' UNION SELECT member_name_snapshot FROM orders WHERE member_sub = ? LIMIT 1")
        .bind(sub, sub)
        .first<{ n: string }>();
      await ctx.db.batch([
        ctx.db
          .prepare("INSERT OR IGNORE INTO review_group_members (group_id, center_key, center_label, member_sub, member_name, duty, added_by_sub) VALUES (?, ?, ?, ?, ?, ?, ?)")
          .bind(id, key, label, sub, sub === s.sub ? s.name : (known?.n ?? ""), body.duty, s.sub),
        audit(ctx.db, s.sub, "group.member_add", "review_group", id, `${sub}:${body.duty}`),
        notify(ctx.db, { sub }, "你已被指派為課程報名審核人員", `群組：${(await ctx.db.prepare("SELECT name FROM review_groups WHERE id = ?").bind(id).first<{ name: string }>())?.name ?? ""}${label ? `｜${label}` : "｜全部中心"}`, "/admin/orders"),
      ]);
      return listGroups(ctx);
    },
  ],
  // ---------- 小編（各中心的課程編輯人員，只存在行動大學） ----------
  ["GET", /^\/admin\/editors$/, async (ctx) => listEditors(ctx)],
  [
    "GET",
    /^\/admin\/editors\/candidates$/,
    async (ctx) => {
      const s = requireMember(ctx);
      const rights = await rightsOf(ctx);
      const center = await editorCenter(ctx, rights, ctx.url.searchParams.get("center"));
      const q = (ctx.url.searchParams.get("q") ?? "").trim().slice(0, 30);
      const taken = new Set((await ctx.db.prepare("SELECT member_sub FROM course_editors WHERE center_key = ?").bind(center.key).all<{ member_sub: string }>()).results.map((r) => r.member_sub));
      if (s.kind !== "central") {
        // 本機測試：用模擬會員代替會員中心的名單。
        const list = DEMO_MEMBERS.filter((d) => d.center && centerKey(d.center) === center.key && d.sub !== s.sub && (!q || d.name.includes(q)));
        return { center: center.label, members: list.map((d): EditorCandidate => ({ memberId: d.sub, name: d.name, avatarUrl: null, signedIn: true, already: taken.has(d.sub) })), next: null };
      }
      try {
        const page = await centerMembers(s.token, { q, cursor: ctx.url.searchParams.get("cursor"), center: rights.admin ? center.label : null, limit: 30 });
        return { center: page.center?.label ?? center.label, members: page.members.map((m): EditorCandidate => ({ ...m, already: taken.has(m.memberId) })), next: page.next };
      } catch (e) {
        const err = e as { status?: number; code?: string };
        if (err.code === "field_not_allowed") fail(503, "central_field_not_allowed", "會員中心尚未開放「顯示名稱」給行動大學：請超級管理員到會員中心後台「平台設定」勾選 display_name");
        if (err.status === 403) fail(403, "central_forbidden", "會員中心不允許查詢這個中心的名單（需要該中心已審核的音控或會長職務）");
        if (err.status === 404) fail(404, "unknown_center", "會員中心找不到這個中心");
        if (err.status === 422) fail(400, "center_required", "請先選擇中心");
        return fail(503, "central_unavailable", UPGRADING_MSG);
      }
    },
  ],
  [
    "POST",
    /^\/admin\/editors$/,
    async (ctx) => {
      const s = requireMember(ctx);
      const rights = await rightsOf(ctx);
      const body = await readJson<Record<string, unknown>>(ctx.req);
      const center = await editorCenter(ctx, rights, typeof body.center === "string" ? body.center : null);
      const sub = typeof body.memberId === "string" ? body.memberId.trim() : "";
      if (!/^[\w-]{3,128}$/.test(sub)) fail(400, "invalid_member", "請從名單選擇會員");
      if (sub === s.sub) fail(400, "invalid_member", "不能指派自己");
      const name = text(body.name, 60) ?? "";
      const flags = editorFlags(body, { create: true, editOthers: false, deleteOthers: false });
      const existed = await ctx.db.prepare("SELECT 1 AS ok FROM course_editors WHERE center_key = ? AND member_sub = ?").bind(center.key, sub).first();
      if (existed) fail(409, "already_editor", "這位會員已經是這個中心的小編");
      await ctx.db.batch([
        ctx.db
          .prepare("INSERT INTO course_editors (center_key, center_label, member_sub, member_name, can_create, can_edit_others, can_delete_others, added_by_sub) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
          .bind(center.key, center.label, sub, name, flags.create ? 1 : 0, flags.editOthers ? 1 : 0, flags.deleteOthers ? 1 : 0, s.sub),
        notify(ctx.db, { sub }, `您已被指派為「${center.label}」的小編`, `${s.name || "管理者"}指派您協助編輯${center.label}的課程與章節。權限：${editorFlagText(flags)}。登入寰宇行動大學後，在課程介紹頁上方按「編輯」即可開始。`, "/courses"),
        audit(ctx.db, s.sub, "editor.add", "course_editor", sub, `${center.label}:${editorFlagText(flags)}`),
      ]);
      return listEditors(ctx, center);
    },
  ],
  [
    "PATCH",
    /^\/admin\/editors\/([\w-]+)$/,
    async (ctx, [sub]) => {
      const s = requireMember(ctx);
      const rights = await rightsOf(ctx);
      const body = await readJson<Record<string, unknown>>(ctx.req);
      const center = await editorCenter(ctx, rights, typeof body.center === "string" ? body.center : null);
      const cur = await ctx.db.prepare("SELECT can_create, can_edit_others, can_delete_others FROM course_editors WHERE center_key = ? AND member_sub = ?").bind(center.key, sub).first<{ can_create: number; can_edit_others: number; can_delete_others: number }>();
      if (!cur) return fail(404, "not_found", "找不到這位小編");
      const flags = editorFlags(body, { create: cur.can_create === 1, editOthers: cur.can_edit_others === 1, deleteOthers: cur.can_delete_others === 1 });
      await ctx.db.batch([
        ctx.db.prepare("UPDATE course_editors SET can_create = ?, can_edit_others = ?, can_delete_others = ?, updated_at = ? WHERE center_key = ? AND member_sub = ?").bind(flags.create ? 1 : 0, flags.editOthers ? 1 : 0, flags.deleteOthers ? 1 : 0, iso(), center.key, sub),
        audit(ctx.db, s.sub, "editor.update", "course_editor", sub!, `${center.label}:${editorFlagText(flags)}`),
      ]);
      return listEditors(ctx, center);
    },
  ],
  [
    "DELETE",
    /^\/admin\/editors\/([\w-]+)$/,
    async (ctx, [sub]) => {
      const s = requireMember(ctx);
      const rights = await rightsOf(ctx);
      const center = await editorCenter(ctx, rights, ctx.url.searchParams.get("center"));
      const [res] = await ctx.db.batch([
        ctx.db.prepare("DELETE FROM course_editors WHERE center_key = ? AND member_sub = ?").bind(center.key, sub),
        audit(ctx.db, s.sub, "editor.remove", "course_editor", sub!, center.label),
      ]);
      if (res.meta?.changes === 0) fail(404, "not_found", "找不到這位小編");
      await ctx.db.batch([notify(ctx.db, { sub: sub! }, `您已不是「${center.label}」的小編`, `${s.name || "管理者"}取消了您在${center.label}的小編身分；之前的課程仍保留。`, "/courses")]);
      return listEditors(ctx, center);
    },
  ],
  [
    "GET",
    /^\/review-invites\/([a-f0-9]{36})$/,
    async (ctx, [token]) => {
      const s = requireMember(ctx);
      const inv = await inviteOf(ctx, token);
      return { courseId: inv.course_id, courseTitle: inv.title, expiresAt: inv.expires_at, state: inviteState(inv, s.sub) };
    },
  ],
  [
    "POST",
    /^\/review-invites\/([a-f0-9]{36})\/accept$/,
    async (ctx, [token]) => {
      const s = requireMember(ctx);
      const inv = await inviteOf(ctx, token);
      const st = inviteState(inv, s.sub);
      if (st === "expired") fail(410, "invite_expired", "這個邀請網址已超過 24 小時，請對方重新產生");
      if (st === "used") fail(410, "invite_used", "這個邀請網址已經被別人使用過了");
      if (st === "open") {
        await ctx.db.batch([
          ctx.db.prepare("UPDATE review_invites SET used_by_sub = ?, used_at = ? WHERE token_hash = ? AND used_by_sub IS NULL").bind(s.sub, iso(), await sha256(token)),
          ctx.db.prepare("INSERT OR REPLACE INTO course_reviewers (course_id, member_sub, member_name, added_by_sub) VALUES (?, ?, ?, ?)").bind(inv.course_id, s.sub, s.name.slice(0, 60), inv.created_by_sub),
          audit(ctx.db, s.sub, "course.reviewer_accept", "course", inv.course_id),
          notify(ctx.db, { sub: inv.created_by_sub }, "審核人員已加入", `${s.name}｜${inv.title}`, `/course/${inv.course_id}`),
          notify(ctx.db, { sub: s.sub }, "你已成為課程報名審核人員", inv.title, "/admin/orders"),
        ]);
      }
      return { courseId: inv.course_id, courseTitle: inv.title };
    },
  ],
];
