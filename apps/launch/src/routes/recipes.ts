/** 行動大學 API 路由：食譜（杜杜龍 2026-11-27 從 api.ts 拆出；順序會影響比對，同一檔內照原本順序）。 */
import { BODY_MAX, CATEGORY_MAX, cleanBody, cleanTitle as cleanRecipeTitle, assignNumber, deleteRecipe, listRecipes, newId as newRecipeId, purgeStaleDrafts } from "../recipes.ts";
import { lookupLegalNames, lookupCenterLabels, staffSearch, centerKey } from "../central.ts";
import { audit, fail, notify, pubUrl, readJson, recipeDetail, recipeManager, recipeRow, requireMember, requireRecipeEdit, requireSuperAdmin } from "../api-core.ts";
import type { Handler } from "../api-core.ts";

export const recipesRoutes: [string, RegExp, Handler][] = [
  // ---------- 食譜專區（杜杜龍 2026-11-26；規則與資料在 recipes.ts） ----------
  [
    "GET",
    /^\/recipes$/,
    async (ctx) => {
      if (ctx.defer) ctx.defer(purgeStaleDrafts(ctx.db, ctx.env).catch(() => undefined));
      const manager = await recipeManager(ctx);
      const r = await listRecipes(ctx.db, { me: ctx.session?.sub ?? null, manager, q: (ctx.url.searchParams.get("q") ?? "").trim().slice(0, 40), pub: (k) => pubUrl(k, 0) });
      return { ...r, manager, admin: !!ctx.session?.roles.includes("super_admin"), canSubmit: !!ctx.session } satisfies import("../contract.ts").RecipesResponse;
    },
  ],
  [
    "POST",
    /^\/recipes$/,
    async (ctx) => {
      // 開始編輯一道新食譜：先建一筆草稿（照片要有地方放）；按「儲存」才送出，放棄或沒存的草稿會被刪掉。
      const s = requireMember(ctx);
      const id = newRecipeId();
      await ctx.db.prepare("INSERT INTO recipes (id, author_sub, author_name, author_center_key, author_center_label) VALUES (?, ?, ?, ?, ?)").bind(id, s.sub, (s.name ?? "").slice(0, 60), s.center?.key ?? "", s.center?.label ?? "").run(); // 上傳者所屬中心：自動抓、不可手動改
      return { id };
    },
  ],
  [
    "GET",
    /^\/recipes\/([a-z0-9]{6,16})$/,
    async (ctx, [id]) => recipeDetail(ctx, await recipeRow(ctx, id!)),
  ],
  [
    "PUT",
    /^\/recipes\/([a-z0-9]{6,16})$/,
    async (ctx, [id]) => {
      // 修改或送出：finish＝true 代表按了「儲存」（名稱必填；草稿 → 管理者直接發佈、會員進待審核）；false 只存內容（不改狀態）。
      const { s, row, manager } = await requireRecipeEdit(ctx, id!);
      const b = await readJson<{ title?: unknown; categoryId?: unknown; body?: unknown; finish?: unknown }>(ctx.req);
      const title = cleanRecipeTitle(b.title);
      const body = cleanBody(b.body);
      const categoryId = typeof b.categoryId === "string" ? b.categoryId.slice(0, 20) : "";
      if (b.finish === true && !title) return fail(400, "title_required", "請輸入食譜名稱");
      if (typeof b.body === "string" && b.body.length > BODY_MAX) return fail(400, "body_too_long", `食譜文字最多 ${BODY_MAX} 字`);
      if (categoryId && !(await ctx.db.prepare("SELECT 1 AS ok FROM recipe_categories WHERE id = ?").bind(categoryId).first())) return fail(400, "invalid_category", "找不到這個分類");
      const status = b.finish === true && row.status === "draft" ? (manager ? "published" : "pending") : row.status;
      const submitted = status === "pending" && row.status === "draft";
      await ctx.db.batch([
        ctx.db.prepare("UPDATE recipes SET title = ?, category_id = ?, body = ?, status = ?, updated_at = datetime('now') WHERE id = ?").bind(title, categoryId, body, status, id),
        audit(ctx.db, s.sub, "recipe.save", "recipe", id!, status),
        ...(submitted ? [notify(ctx.db, { role: "admin" }, "有新的食譜投稿，等待審核", `${s.name ?? "會員"} 投稿了「${title}」，請到食譜專區審核。`, `/recipe/${id}`)] : []),
      ]);
      if (b.finish === true && row.status === "draft") await assignNumber(ctx.db, id!);
      return recipeDetail(ctx, await recipeRow(ctx, id!));
    },
  ],
  [
    "POST",
    /^\/recipes\/([a-z0-9]{6,16})\/approve$/,
    async (ctx, [id]) => {
      // 審核：核准會員投稿（只有管理者；不核准就刪除）。
      const s = requireMember(ctx);
      if (!(await recipeManager(ctx))) return fail(403, "forbidden", "只有管理者可以審核食譜");
      const row = await recipeRow(ctx, id!);
      if (row.status !== "pending") return fail(409, "not_pending", "這道食譜不是待審核狀態");
      await ctx.db.batch([
        ctx.db.prepare("UPDATE recipes SET status = 'published', updated_at = datetime('now') WHERE id = ?").bind(id),
        audit(ctx.db, s.sub, "recipe.approve", "recipe", id!),
        notify(ctx.db, { sub: row.author_sub }, "你投稿的食譜已通過審核", `「${row.title}」已經發佈，所有人都看得到了。`, `/recipe/${id}`),
      ]);
      return { ok: true };
    },
  ],
  [
    "DELETE",
    /^\/recipes\/([a-z0-9]{6,16})$/,
    async (ctx, [id]) => {
      const { s } = await requireRecipeEdit(ctx, id!);
      await deleteRecipe(ctx.db, ctx.env, id!);
      await audit(ctx.db, s.sub, "recipe.delete", "recipe", id!).run();
      return { ok: true };
    },
  ],
  [
    "GET",
    /^\/admin\/recipe-authors$/,
    async (ctx) => {
      // 更換食譜上傳者時挑會員（只有超級管理員）：從行動大學已註冊（用過的）會員裡找，暱稱與本名都能搜尋。
      // 暱稱＝本站記的 member_profiles；本名只在這一次搜尋時向會員中心讀（記憶體短暫快取，不存資料庫、不寫日誌、不記搜尋字）。
      requireSuperAdmin(ctx);
      const q = (ctx.url.searchParams.get("q") ?? "").trim().slice(0, 30);
      if (q.length < 1) return { members: [] };
      const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      const [byNick, pool] = await Promise.all([
        ctx.db.prepare("SELECT sub, name, avatar FROM member_profiles WHERE name <> '' AND name LIKE ? ESCAPE '\\' ORDER BY updated_at DESC LIMIT 20").bind(like).all<{ sub: string; name: string; avatar: string }>(),
        ctx.db.prepare("SELECT sub, name, avatar FROM member_profiles WHERE name <> '' ORDER BY updated_at DESC LIMIT 400").all<{ sub: string; name: string; avatar: string }>(),
      ]);
      const chunks: string[][] = [];
      for (let i = 0; i < pool.results.length; i += 100) chunks.push(pool.results.slice(i, i + 100).map((p) => p.sub));
      const legal = new Map<string, string>();
      for (const m of await Promise.all(chunks.map((c) => lookupLegalNames(ctx.env.CENTRAL_SERVICE_SECRET, c).catch(() => new Map<string, string>())))) for (const [k, v] of m) legal.set(k, v);
      const ql = q.toLowerCase();
      const out = new Map<string, { sub: string; name: string; legalName: string; avatar: string | null; center: string }>();
      for (const p of [...byNick.results, ...pool.results.filter((p) => (legal.get(p.sub) ?? "").toLowerCase().includes(ql))]) {
        if (out.size >= 20) break;
        if (!out.has(p.sub)) out.set(p.sub, { sub: p.sub, name: p.name, legalName: legal.get(p.sub) ?? "", avatar: p.avatar || null, center: "" });
      }
      // 還沒用過行動大學的會員（不在 member_profiles）：向會員中心依暱稱搜尋（2～30 字，任何啟用中的會員，附所屬中心；杜杜龍 2026-11-26 回報查不到會員）。
      if (ctx.session?.kind === "central" && q.length >= 2) {
        const st = await staffSearch(ctx.session.token, q).catch(() => null);
        const extra = (st?.members ?? []).filter((m) => !out.has(m.memberId));
        const names = extra.length ? await lookupLegalNames(ctx.env.CENTRAL_SERVICE_SECRET, extra.map((m) => m.memberId)).catch(() => new Map<string, string>()) : new Map<string, string>();
        for (const m of st?.members ?? []) {
          if (out.size >= 20) break;
          const mine = out.get(m.memberId);
          if (mine) mine.center = m.center;
          else out.set(m.memberId, { sub: m.memberId, name: m.name, legalName: names.get(m.memberId) ?? "", avatar: null, center: m.center });
        }
      }
      return { members: [...out.values()] };
    },
  ],
  [
    "PUT",
    /^\/admin\/recipes\/([a-z0-9]{6,16})\/author$/,
    async (ctx, [id]) => {
      // 更換食譜上傳者（只有超級管理員）：新上傳者的暱稱、所屬中心一起換（中心取自會員中心，不可手動填）。
      const s = requireSuperAdmin(ctx);
      const b = await readJson<{ sub?: unknown; name?: unknown }>(ctx.req);
      const sub = typeof b.sub === "string" ? b.sub.slice(0, 80) : "";
      await recipeRow(ctx, id!);
      let prof = sub ? await ctx.db.prepare("SELECT name FROM member_profiles WHERE sub = ? AND name <> ''").bind(sub).first<{ name: string }>() : null;
      let label = "";
      if (!prof && sub && s.kind === "central") {
        // 還沒用過行動大學的會員：再向會員中心確認這位會員存在（暱稱與所屬中心都以會員中心為準，不信任畫面傳來的）。
        const nm = typeof (b as { name?: unknown }).name === "string" ? ((b as { name: string }).name).slice(0, 30) : "";
        const hit = nm.length >= 2 ? (await staffSearch(s.token, nm).catch(() => null))?.members.find((m) => m.memberId === sub) : undefined;
        if (hit) {
          prof = { name: hit.name };
          label = hit.center;
          await ctx.db.prepare("INSERT OR IGNORE INTO member_profiles (sub, name) VALUES (?, ?)").bind(sub, hit.name.slice(0, 60)).run(); // 只記顯示名稱（之後搜尋、上傳者標記用）
        }
      }
      if (!prof) return fail(404, "member_not_found", "找不到這位會員");
      if (!label) label = (await lookupCenterLabels(ctx.env.CENTRAL_SERVICE_SECRET, [sub]).catch(() => new Map<string, string>())).get(sub) ?? "";
      await ctx.db.batch([
        ctx.db.prepare("UPDATE recipes SET author_sub = ?, author_name = ?, author_center_key = ?, author_center_label = ?, updated_at = datetime('now') WHERE id = ?").bind(sub, prof.name.slice(0, 60), label ? centerKey(label) : "", label, id),
        audit(ctx.db, s.sub, "recipe.author", "recipe", id!, sub),
      ]);
      return recipeDetail(ctx, await recipeRow(ctx, id!));
    },
  ],
  [
    "POST",
    /^\/recipes\/categories$/,
    async (ctx) => {
      const s = requireMember(ctx);
      if (!(await recipeManager(ctx))) return fail(403, "forbidden", "只有有權限的人可以新增分類");
      const b = await readJson<{ name?: unknown }>(ctx.req);
      const name = typeof b.name === "string" ? b.name.trim() : "";
      if (!name || name.length > CATEGORY_MAX) return fail(400, "invalid_name", `分類名稱要 1 到 ${CATEGORY_MAX} 個字`);
      if (await ctx.db.prepare("SELECT 1 AS ok FROM recipe_categories WHERE name = ?").bind(name).first()) return fail(409, "name_taken", "已經有同名的分類");
      const id = newRecipeId();
      await ctx.db.prepare("INSERT INTO recipe_categories (id, name, position, created_by) VALUES (?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM recipe_categories), ?)").bind(id, name, s.sub).run();
      return { id };
    },
  ],
  [
    "PUT",
    /^\/recipes\/categories\/([a-z0-9]{3,16})$/,
    async (ctx, [id]) => {
      requireMember(ctx);
      if (!(await recipeManager(ctx))) return fail(403, "forbidden", "只有有權限的人可以改分類名稱");
      const b = await readJson<{ name?: unknown }>(ctx.req);
      const name = typeof b.name === "string" ? b.name.trim() : "";
      if (!name || name.length > CATEGORY_MAX) return fail(400, "invalid_name", `分類名稱要 1 到 ${CATEGORY_MAX} 個字`);
      if (await ctx.db.prepare("SELECT 1 AS ok FROM recipe_categories WHERE name = ? AND id <> ?").bind(name, id).first()) return fail(409, "name_taken", "已經有同名的分類");
      await ctx.db.prepare("UPDATE recipe_categories SET name = ? WHERE id = ?").bind(name, id).run();
      return { ok: true };
    },
  ],
  [
    "DELETE",
    /^\/recipes\/categories\/([a-z0-9]{3,16})$/,
    async (ctx, [id]) => {
      // 刪除分類：只有超級管理員；裡面的食譜變成「未分類」。
      requireSuperAdmin(ctx);
      await ctx.db.batch([ctx.db.prepare("UPDATE recipes SET category_id = '' WHERE category_id = ?").bind(id), ctx.db.prepare("DELETE FROM recipe_categories WHERE id = ?").bind(id)]);
      return { ok: true };
    },
  ],
  [
    "GET",
    /^\/recipes\/([a-z0-9]{6,16})\/cover$/,
    async (ctx, [id]) => {
      // 食譜的 LINE 預覽卡縮圖（杜杜龍 2026-11-26）：食譜封面照片（第一張）裁成 1200×630 的 JPEG。
      // 相簿照片可能存成 AVIF／WebP，LINE 預覽讀不到，所以這裡一律轉成 JPEG；只給已發佈的食譜；轉檔失敗就回原圖。
      const r = await ctx.db
        .prepare("SELECT m.r2_key AS k FROM recipes r JOIN cover_media m ON m.owner_kind = 'course' AND m.owner_key = 'rcp:' || r.id AND m.kind = 'image' WHERE r.id = ? AND r.status = 'published' ORDER BY m.position LIMIT 1")
        .bind(id)
        .first<{ k: string }>();
      const obj = r && ctx.env.MEDIA ? await ctx.env.MEDIA.get(r.k) : null;
      if (!obj) return new Response("Not found", { status: 404 });
      const type = obj.httpMetadata?.contentType ?? "image/jpeg";
      if (ctx.env.IMAGES) {
        try {
          const out = await ctx.env.IMAGES.input(obj.body).transform({ width: 1200, height: 630, fit: "cover" }).output({ format: "image/jpeg", quality: 85 });
          return new Response(await out.response().arrayBuffer(), { headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=86400", "x-content-type-options": "nosniff" } });
        } catch {
          const again = await ctx.env.MEDIA!.get(r!.k);
          if (again) return new Response(again.body, { headers: { "content-type": type, "cache-control": "public, max-age=300", "x-content-type-options": "nosniff" } });
        }
      }
      return new Response(obj.body, { headers: { "content-type": type, "cache-control": "public, max-age=300", "x-content-type-options": "nosniff" } });
    },
  ],
];
