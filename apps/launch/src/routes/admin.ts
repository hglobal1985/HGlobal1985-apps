/** 行動大學 API 路由：管理：統計、名言、AI、徽章、書櫃、設定、檢舉（杜杜龍 2026-11-27 從 api.ts 拆出；順序會影響比對，同一檔內照原本順序）。 */
import { syncTreasureFromSeriesOrder } from "../treasure-box.ts";
import { HQ_SLUG, RESERVED_SLUGS } from "../short-links.ts";
import { drawZoneVideoBadges } from "../zone-video-badges.ts";
import { AI_MODELS, AiStopped, loadSelection, testConnection, loadSettings, loadSettings as loadAiSettings, todayUsed as aiTodayUsed, normalizeSelection, normalizeSettings, saveSelection, saveSettings } from "../ai-models.ts";
import { loadConfig, normalizeConfig, saveConfig } from "../ui-config.ts";
import { collectCfStats } from "../cf-stats.ts";
import { collectAppStats } from "../app-stats.ts";
import { FP_RE, netHash, ownerDevices, registerOwnerDevice, saveOwnerDevices, parseUsageQuery, usageTable } from "../usage.ts";
import { collectMuxStats } from "../mux-stats.ts";
import { achievementBody, aiModelsView, audit, canViewStats, cleanAnnouncement, fail, keywordChoices, listAchievements, randomId, readJson, registrationReport, registrationReportCsv, requireCourseStaff, requireMember, requireSuperAdmin } from "../api-core.ts";
import type { Handler } from "../api-core.ts";

export const adminRoutes: [string, RegExp, Handler][] = [
  [
    "PUT",
    /^\/admin\/ui-config$/,
    async (ctx) => {
      const s = requireSuperAdmin(ctx);
      const body = await readJson<Record<string, unknown>>(ctx.req);
      // 只更新有傳的欄位，其餘保留目前設定。
      const cur = await loadConfig(ctx.db);
      const bodyApp = (body.app && typeof body.app === "object" ? body.app : {}) as { rec?: object };
      const next = normalizeConfig({ ...cur, ...body, ribbons: { ...cur.ribbons, ...((body.ribbons as object) ?? {}) }, app: { ...cur.app, ...bodyApp, rec: { ...cur.app.rec, ...(bodyApp.rec ?? {}) } }, share: { ...cur.share, ...((body.share as object) ?? {}) } });
      // 食譜短網址前綴改名（杜杜龍 2026-11-26）：新前綴不能撞到網站頁面或別人的短網址；舊前綴自動存成別名，已分享出去的網址照樣打得開。
      if (next.share.recipePrefix !== cur.share.recipePrefix) {
        const np = next.share.recipePrefix;
        if (RESERVED_SLUGS.has(np) || np === HQ_SLUG || np === "series" || np === "recipe") return fail(400, "slug_reserved", `「${np}」是網站保留的路徑，請換一個`);
        const used = (await ctx.db.prepare("SELECT 1 AS ok FROM short_links WHERE slug = ? COLLATE NOCASE UNION SELECT 1 FROM short_link_aliases WHERE slug = ? COLLATE NOCASE").bind(np, np).first()) !== null;
        if (used) return fail(409, "slug_taken", `「${np}」已經是別的短網址，請換一個`);
        next.share.recipeAliases = [...new Set([cur.share.recipePrefix, ...cur.share.recipeAliases])].filter((x) => x !== np).slice(0, 20);
      }
      await saveConfig(ctx.db, next);
      if (body.seriesOrder !== undefined) await syncTreasureFromSeriesOrder(ctx.db).catch(() => undefined); // 品牌館卡片順序 → 成交百寶箱區塊順序
      await audit(ctx.db, s.sub, "ui_config.update", "ui_config", "ui_config", Object.keys(body).join(",")).run();
      return next;
    },
  ],
  [
    "GET",
    /^\/admin\/stats\/mux$/,
    async (ctx) => {
      const s = requireMember(ctx);
      if (!(await canViewStats(ctx, s))) fail(403, "forbidden", "沒有查看統計分析的權限");
      return collectMuxStats(ctx.env);
    },
  ],
  // 本人裝置登記（杜杜龍 2026-11-26，超級管理員）：在那台裝置上按「登記這台裝置」，之後相同特徵的操作一律算本人。
  ["GET", /^\/admin\/usage\/devices$/, async (ctx) => {
    requireSuperAdmin(ctx);
    const here = await netHash(ctx.req.headers.get("cf-connecting-ip") ?? "");
    return { devices: (await ownerDevices(ctx.db)).map((d) => ({ fp: d.fp, label: d.label, at: d.at, nets: d.nets.length, here: d.nets.includes(here) })) };
  }],
  ["POST", /^\/admin\/usage\/devices$/, async (ctx) => {
    const s = requireSuperAdmin(ctx);
    const body = await readJson<{ fp?: unknown; label?: unknown }>(ctx.req);
    if (typeof body.fp !== "string" || !FP_RE.test(body.fp)) return fail(400, "invalid_device", "讀不到這台裝置的特徵");
    const ip = ctx.req.headers.get("cf-connecting-ip") ?? "";
    if (!ip) return fail(400, "no_network", "讀不到目前的網路位置");
    const list = await registerOwnerDevice(ctx.db, body.fp, (typeof body.label === "string" ? body.label.trim() : "").slice(0, 40), ip);
    await audit(ctx.db, s.sub, "usage.owner_device.add", "usage", "device", body.fp).run();
    return { devices: list.map((d) => ({ fp: d.fp, label: d.label, at: d.at, nets: d.nets.length, here: true })) };
  }],
  ["POST", /^\/admin\/usage\/devices\/remove$/, async (ctx) => {
    const s = requireSuperAdmin(ctx);
    const body = await readJson<{ fp?: unknown }>(ctx.req);
    const list = (await ownerDevices(ctx.db)).filter((d) => d.fp !== body.fp);
    await saveOwnerDevices(ctx.db, list);
    await audit(ctx.db, s.sub, "usage.owner_device.remove", "usage", "device", String(body.fp ?? "")).run();
    return { devices: list };
  }],
  ["GET", /^\/admin\/usage$/, async (ctx) => {
    const s = requireMember(ctx);
    if (!(await canViewStats(ctx, s))) fail(403, "forbidden", "沒有查看統計分析的權限");
    return usageTable(ctx.db, parseUsageQuery(ctx.url));
  }],
  [
    "GET",
    /^\/admin\/stats\/app$/,
    async (ctx) => {
      const s = requireMember(ctx);
      if (!(await canViewStats(ctx, s))) fail(403, "forbidden", "沒有查看統計分析的權限");
      return collectAppStats(ctx.db);
    },
  ],
  [
    "GET",
    /^\/admin\/stats\/cloudflare$/,
    async (ctx) => {
      const s = requireMember(ctx);
      if (!(await canViewStats(ctx, s))) fail(403, "forbidden", "沒有查看統計分析的權限");
      return collectCfStats(ctx.env);
    },
  ],
  [
    "POST",
    /^\/admin\/achievements\/draw-videos$/,
    async (ctx) => {
      const s = requireSuperAdmin(ctx);
      const r = await drawZoneVideoBadges(ctx.db);
      await ctx.db.batch([audit(ctx.db, s.sub, "achievement.draw_videos", "achievement", "-", `added=${r.added}`)]);
      return r;
    },
  ],
  [
    "GET",
    /^\/admin\/achievement-targets$/,
    async (ctx) => {
      // 成就「指定學習」的搜尋：依關鍵字找教材（章節或有影片的教材）、課程卡、系列卡，最多 20 筆。
      requireSuperAdmin(ctx);
      const q = (ctx.url.searchParams.get("q") ?? "").trim().slice(0, 40);
      const kind = ctx.url.searchParams.get("kind");
      const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
      if (kind === "lesson") {
        const { results } = await ctx.db.prepare("SELECT l.id, l.title, c.title AS sub FROM lessons l JOIN courses c ON c.id = l.course_id WHERE (l.kind = 'chapter' OR (l.kind = 'material' AND COALESCE(l.media_ref, '') <> '')) AND (l.title LIKE ?1 ESCAPE '\\' OR c.title LIKE ?1 ESCAPE '\\') ORDER BY c.title, l.position LIMIT 20").bind(like).all<{ id: string; title: string; sub: string }>();
        return results;
      }
      if (kind === "course") {
        const { results } = await ctx.db.prepare("SELECT id, title, COALESCE(series, '') AS sub FROM courses WHERE title LIKE ?1 ESCAPE '\\' ORDER BY title LIMIT 20").bind(like).all<{ id: string; title: string; sub: string }>();
        return results;
      }
      if (kind === "series") {
        const { results } = await ctx.db.prepare("SELECT series AS id, series AS title, COUNT(*) || ' 門課程' AS sub FROM courses WHERE COALESCE(series, '') <> '' AND series LIKE ?1 ESCAPE '\\' GROUP BY series ORDER BY series LIMIT 20").bind(like).all<{ id: string; title: string; sub: string }>();
        return results;
      }
      fail(400, "invalid_kind", "搜尋種類不正確");
    },
  ],
  ["GET", /^\/admin\/achievements$/, async (ctx) => (requireSuperAdmin(ctx), listAchievements(ctx))],
  [
    "POST",
    /^\/admin\/achievements$/,
    async (ctx) => {
      const s = requireSuperAdmin(ctx);
      const body = await readJson<Record<string, unknown>>(ctx.req);
      const sets = await achievementBody(ctx, body, true);
      if (sets.find(([c]) => c === "condition_type")?.[1] === "course_completed" && !sets.find(([c]) => c === "course_id")?.[1]) fail(400, "course_required", "請選擇要學完的課程");
      const id = `ach-${randomId(8)}`;
      const max = await ctx.db.prepare("SELECT COALESCE(MAX(sort_order), 0) AS m FROM achievements").first<{ m: number }>();
      const cols = ["id", "sort_order", ...sets.map(([c]) => c)];
      await ctx.db.batch([
        ctx.db.prepare(`INSERT INTO achievements (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).bind(id, (max?.m ?? 0) + 1, ...sets.map(([, v]) => v)),
        audit(ctx.db, s.sub, "achievement.create", "achievement", id, String(body.name ?? "")),
      ]);
      return listAchievements(ctx);
    },
  ],
  [
    "PATCH",
    /^\/admin\/achievements\/([\w-]+)$/,
    async (ctx, [id]) => {
      const s = requireSuperAdmin(ctx);
      const sets = await achievementBody(ctx, await readJson<Record<string, unknown>>(ctx.req), false);
      if (!sets.length) fail(400, "nothing_to_update", "沒有要更新的欄位");
      const [res] = await ctx.db.batch([ctx.db.prepare(`UPDATE achievements SET ${sets.map(([c]) => `${c} = ?`).join(", ")} WHERE id = ?`).bind(...sets.map(([, v]) => v), id), audit(ctx.db, s.sub, "achievement.update", "achievement", id, sets.map(([c]) => c).join(","))]);
      if (res.meta?.changes === 0) return fail(404, "not_found", "找不到這個徽章");
      return listAchievements(ctx);
    },
  ],
  [
    "DELETE",
    /^\/admin\/achievements\/([\w-]+)$/,
    async (ctx, [id]) => {
      const s = requireSuperAdmin(ctx);
      const [, , res] = await ctx.db.batch([ctx.db.prepare("DELETE FROM member_achievements WHERE achievement_id = ?").bind(id), audit(ctx.db, s.sub, "achievement.delete", "achievement", id), ctx.db.prepare("DELETE FROM achievements WHERE id = ?").bind(id)]);
      if (res.meta?.changes === 0) return fail(404, "not_found", "找不到這個徽章");
      return listAchievements(ctx);
    },
  ],
  // ---------- 我的書櫃 ----------
  [
    "POST",
    /^\/admin\/library-invites$/,
    async (ctx) => {
      // 超級管理員產生「指定書櫃擁有者」的邀請網址：24 小時、一次有效；對方登入後按接受，書櫃網址用他在會員中心的會員編號。
      const s = requireSuperAdmin(ctx);
      const code = randomId(14);
      await ctx.db.prepare("INSERT INTO library_invites (code, created_by, expires_at) VALUES (?, ?, ?)").bind(code, s.sub, new Date(Date.now() + 24 * 3600_000).toISOString()).run();
      return { code };
    },
  ],
  [
    "GET",
    /^\/admin\/libraries$/,
    async (ctx) => {
      requireSuperAdmin(ctx);
      const { results } = await ctx.db.prepare("SELECT l.member_sub AS sub, l.number, l.title, l.owner_name AS owner, l.views, l.created_at AS createdAt, (SELECT COUNT(*) FROM library_items i WHERE i.library_sub = l.member_sub AND i.kind = 'book') AS books FROM libraries l ORDER BY l.created_at").all<{ sub: string; number: string; title: string; owner: string; views: number; createdAt: string; books: number }>();
      return results;
    },
  ],
  [
    "DELETE",
    /^\/admin\/libraries\/([\w-]{1,80})$/,
    async (ctx, [sub]) => {
      const s = requireSuperAdmin(ctx);
      await ctx.db.batch([ctx.db.prepare("DELETE FROM library_items WHERE library_sub = ?").bind(sub), ctx.db.prepare("DELETE FROM libraries WHERE member_sub = ?").bind(sub), audit(ctx.db, s.sub, "library.remove", "library", sub)]);
      return { ok: true };
    },
  ],
  ["GET", /^\/admin\/reports\/registrations$/, async (ctx) => registrationReport(ctx)],
  ["GET", /^\/admin\/reports\/registrations\.csv$/, async (ctx) => registrationReportCsv(ctx)],
  [
    "GET",
    /^\/admin\/quotes$/,
    async (ctx) => {
      requireSuperAdmin(ctx);
      const { results } = await ctx.db.prepare("SELECT id, body AS text FROM quotes ORDER BY created_at DESC").all<{ id: string; text: string }>();
      return results;
    },
  ],
  [
    "POST",
    /^\/admin\/quotes$/,
    async (ctx) => {
      const s = requireSuperAdmin(ctx);
      const text = cleanAnnouncement((await readJson<{ text?: unknown }>(ctx.req)).text);
      if (!text) return fail(400, "text_required", "請輸入金句（120 字以內）");
      const id = crypto.randomUUID();
      await ctx.db.prepare("INSERT INTO quotes (id, body, created_by) VALUES (?, ?, ?)").bind(id, text, s.sub).run();
      return { id, text };
    },
  ],
  [
    "PATCH",
    /^\/admin\/quotes\/([\w-]+)$/,
    async (ctx, [id]) => {
      requireSuperAdmin(ctx);
      const text = cleanAnnouncement((await readJson<{ text?: unknown }>(ctx.req)).text);
      if (!text) return fail(400, "text_required", "請輸入金句（120 字以內）");
      const r = await ctx.db.prepare("UPDATE quotes SET body = ? WHERE id = ?").bind(text, id).run();
      if (r.meta?.changes === 0) return fail(404, "not_found", "找不到這則金句");
      return { id, text };
    },
  ],
  [
    "DELETE",
    /^\/admin\/quotes\/([\w-]+)$/,
    async (ctx, [id]) => {
      requireSuperAdmin(ctx);
      await ctx.db.prepare("DELETE FROM quotes WHERE id = ?").bind(id).run();
      return { ok: true };
    },
  ],
  [
    "POST",
    /^\/admin\/ai\/run-now$/,
    async (ctx) => {
      // 設定 › AI 文字辨識「立即開始辨識」（杜杜龍 2026-11-26）：不等每 10 分鐘的排程，馬上在這個請求裡跑一輪（最多約 70 秒（Cloudflare 連線上限約 100 秒），依「辨識優先順序與開關」）；
      // 前端會連續呼叫直到沒有待辨識或額度用完。
      const s = requireSuperAdmin(ctx);
      const { runAiBatch } = await import("../ai-batch.ts");
      const r = await runAiBatch(ctx.env, ctx.db, { budgetSec: 70 });
      await audit(ctx.db, s.sub, "ai.run_now", "setting", "ai_batch", `done=${r.done} stopped=${r.stopped}`).run();
      return r;
    },
  ],
  [
    "GET",
    /^\/admin\/ai\/progress$/,
    async (ctx) => {
      // 設定 › AI 文字辨識：中心 EDM 文字辨識、相簿場景辨識的完成張數與進度，以及今天的 AI 額度（已用、剩餘）。
      requireSuperAdmin(ctx);
      const [ocr, scene, photoOcr, st, used] = await Promise.all([
        ctx.db
          .prepare("SELECT center_key AS grp, COUNT(*) AS total, SUM(ocr_status = 'done') AS done, SUM(ocr_status = 'failed') AS failed FROM cover_media WHERE owner_kind = 'center' AND scope = 'edm' AND kind = 'image' GROUP BY center_key ORDER BY total DESC")
          .all<{ grp: string | null; total: number; done: number; failed: number }>(),
        ctx.db
          .prepare("SELECT * FROM (SELECT cm.owner_key AS grp, c.title || ' › ' || l.title AS label, COUNT(*) AS total, SUM(cm.scene_status = 'done') AS done, SUM(cm.scene_status = 'failed') AS failed FROM cover_media cm JOIN lessons l ON l.id = cm.owner_key AND l.kind = 'section' JOIN courses c ON c.id = l.course_id WHERE cm.owner_kind = 'course' AND cm.kind = 'image' GROUP BY cm.owner_key UNION ALL SELECT 'recipes' AS grp, '食譜（全部食譜照片）' AS label, COUNT(*) AS total, SUM(cm.scene_status = 'done') AS done, SUM(cm.scene_status = 'failed') AS failed FROM cover_media cm WHERE cm.owner_kind = 'course' AND cm.owner_key LIKE 'rcp:%' AND cm.kind = 'image' HAVING COUNT(*) > 0) ORDER BY total DESC")
          .all<{ grp: string; label: string; total: number; done: number; failed: number }>(),
        ctx.db
          .prepare("SELECT cm.owner_key AS grp, c.title || ' › ' || l.title AS label, COUNT(*) AS total, SUM(cm.ocr_status = 'done') AS done, SUM(cm.ocr_status = 'failed') AS failed FROM cover_media cm JOIN lessons l ON l.id = cm.owner_key AND l.kind = 'section' JOIN courses c ON c.id = l.course_id WHERE cm.owner_kind = 'course' AND cm.kind = 'image' GROUP BY cm.owner_key ORDER BY total DESC")
          .all<{ grp: string; label: string; total: number; done: number; failed: number }>(),
        loadAiSettings(ctx.db),
        aiTodayUsed(ctx.db),
      ]);
      const pack = (rows: { label: string; total: number; done: number; failed: number }[]) => {
        const total = rows.reduce((n, r) => n + r.total, 0);
        const done = rows.reduce((n, r) => n + (r.done ?? 0), 0);
        const failed = rows.reduce((n, r) => n + (r.failed ?? 0), 0);
        return { total, done, failed, pending: total - done - failed, groups: rows.map((r) => ({ label: r.label, total: r.total, done: r.done ?? 0, failed: r.failed ?? 0 })) };
      };
      return {
        ocr: pack(ocr.results.map((r) => ({ label: r.grp || "（未知中心）", total: r.total, done: r.done, failed: r.failed }))),
        scene: pack(scene.results),
        photoOcr: pack(photoOcr.results),
        ai: { capEnabled: st.capEnabled, dailyCap: st.dailyCap, used, remaining: Math.max(0, st.dailyCap - used) },
        jobs: await (async () => {
          const ss = await (await import("../search-settings.ts")).loadSearchSettings(ctx.db);
          return [
            { key: "edm", label: "中心 EDM 文字辨識", on: ss.aiOnEdm !== false, prio: Number(ss.aiPrioEdm ?? 1) },
            { key: "photoOcr", label: "相簿照片文字辨識（OCR）", on: ss.photoOcrEnabled !== false, prio: Number(ss.aiPrioPhotoOcr ?? 2) },
            { key: "scene", label: "相簿場景標籤辨識", on: ss.aiOnScene !== false, prio: Number(ss.aiPrioScene ?? 3) },
          ].sort((a, b) => a.prio - b.prio);
        })(),
      };
    },
  ],
  [
    "GET",
    /^\/admin\/(categories|series|locations)$/,
    async (ctx, [what]) => {
      const who = await requireCourseStaff(ctx);
      const kind = what === "categories" ? "category" : what === "series" ? "series" : "location";
      return keywordChoices(ctx, kind, who.role !== "admin" ? (who.center?.key ?? "") : null);
    },
  ],
  ["GET", /^\/admin\/ai-models$/, async (ctx) => (requireSuperAdmin(ctx), aiModelsView(ctx))],
  [
    "PUT",
    /^\/admin\/ai-models$/,
    async (ctx) => {
      const s = requireSuperAdmin(ctx);
      const body = await readJson<Record<string, unknown>>(ctx.req);
      const cur = await loadSettings(ctx.db);
      const st = normalizeSettings({ ...cur, ...(body.settings as object) }, cur);
      const sel = normalizeSelection({ ...(await loadSelection(ctx.db)), ...(body.selection as object) });
      // 只用免費額度時，不能選沒有免費額度的外部模型
      const paid = AI_MODELS.find((m) => m.needsKey && Object.values(sel).includes(m.id));
      if (st.freeOnly && paid) fail(409, "free_only", `目前設定為「只用免費模型」，「${paid.name}」沒有免費額度，請先關閉「只用免費模型」`);
      await saveSelection(ctx.db, sel);
      await saveSettings(ctx.db, st);
      await audit(ctx.db, s.sub, "ai_models.set", "ui_settings", "ai_models", JSON.stringify({ sel, st })).run();
      return aiModelsView(ctx);
    },
  ],
  [
    "POST",
    /^\/admin\/ai-models\/test$/,
    async (ctx) => {
      requireSuperAdmin(ctx);
      const body = await readJson<Record<string, unknown>>(ctx.req);
      try {
        return { ok: true, message: await testConnection(ctx.env, ctx.db, String(body.target ?? "")), view: await aiModelsView(ctx) };
      } catch (e) {
        if (e instanceof AiStopped) fail(429, "ai_stopped", e.message);
        fail(502, "ai_test_failed", (e as Error).message);
      }
    },
  ],
  [
    "GET",
    /^\/admin\/search-settings$/,
    async (ctx) => {
      requireSuperAdmin(ctx);
      const { loadSearchSettings, PARAMS, GROUPS } = await import("../search-settings.ts");
      return { values: await loadSearchSettings(ctx.db), params: PARAMS, groups: GROUPS };
    },
  ],
  [
    "PUT",
    /^\/admin\/search-settings$/,
    async (ctx) => {
      const s = requireSuperAdmin(ctx);
      const body = await readJson<{ values?: unknown; reset?: unknown }>(ctx.req);
      const { saveSearchSettings, defaultSearchSettings } = await import("../search-settings.ts");
      const values = await saveSearchSettings(ctx.db, body.reset === true ? defaultSearchSettings() : body.values);
      await audit(ctx.db, s.sub, "search_settings.save", "setting", "search_settings", body.reset === true ? "reset" : Object.keys((body.values ?? {}) as object).join(",")).run();
      return { values };
    },
  ],
  [
    "GET",
    /^\/admin\/search-settings\/test$/,
    async (ctx) => {
      requireSuperAdmin(ctx);
      const { semanticDebug } = await import("../semantic-search.ts");
      return semanticDebug(ctx.env, ctx.db, ctx.url.searchParams.get("q") ?? "");
    },
  ],
  [
    "GET",
    /^\/admin\/search-synonyms$/,
    async (ctx) => {
      requireSuperAdmin(ctx);
      const { synonymsToText } = await import("../synonyms.ts");
      const { results } = await ctx.db.prepare("SELECT terms FROM search_synonyms ORDER BY id").all<{ terms: string }>();
      return { text: synonymsToText(results.map((r) => JSON.parse(r.terms) as string[])) };
    },
  ],
  [
    "PUT",
    /^\/admin\/search-synonyms$/,
    async (ctx) => {
      const s = requireSuperAdmin(ctx);
      const body = await readJson<{ text?: unknown }>(ctx.req);
      const { parseSynonymText } = await import("../synonyms.ts");
      const groups = parseSynonymText(typeof body.text === "string" ? body.text.slice(0, 20000) : "");
      await ctx.db.batch([
        ctx.db.prepare("DELETE FROM search_synonyms"),
        ...groups.map((g) => ctx.db.prepare("INSERT INTO search_synonyms (terms) VALUES (?)").bind(JSON.stringify(g))),
        audit(ctx.db, s.sub, "search_synonyms.save", "setting", "search_synonyms", String(groups.length)),
      ]);
      (await import("../phonetic-search.ts")).resetSynonymCache();
      return { ok: true, groups: groups.length };
    },
  ],
];
