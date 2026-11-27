/** 行動大學 API 路由：中心：中心頁、中心資訊、課表、公告、訂閱（杜杜龍 2026-11-27 從 api.ts 拆出；順序會影響比對，同一檔內照原本順序）。 */
import { renameForType, shrinkImage } from "../image-store.ts";
import { type CenterArt, UPGRADING_MSG } from "../contract.ts";
import { ensureCentersReconciled } from "../center-reconcile.ts";
import { centerKey, centerList } from "../central.ts";
import { sniffImage } from "../media.ts";
import { type CoverRect, HOME_BC_KEY, VIEW_BASE, audit, bcTarget, broadcastsOf, bumpView, canManageBc, fail, notify, notifySubscribers, parseCoverRect, pubUrl, readJson, requireCenterArt, requireMember, scheduleYm, schedulesOf, seriesSubKey } from "../api-core.ts";
import type { Handler } from "../api-core.ts";

export const centersRoutes: [string, RegExp, Handler][] = [
  [
    "GET",
    /^\/center-schedules$/,
    async (ctx) => {
      // 中心每月課表（公開）：新的月份在前。
      const label = (ctx.url.searchParams.get("center") ?? "").trim().slice(0, 60);
      if (!label) fail(400, "invalid_center", "請指定中心");
      return schedulesOf(ctx.db, centerKey(label));
    },
  ],
  [
    "PUT",
    /^\/admin\/center-schedules$/,
    async (ctx) => {
      // 上傳（或更換）某個月的課表圖：?center=中心&ym=2026-11，內文是圖片檔。新月份上架時通知訂閱者。
      const { s, center } = await requireCenterArt(ctx, ctx.url.searchParams.get("center"));
      const ym = scheduleYm(ctx.url.searchParams.get("ym"));
      const bucket = ctx.env.MEDIA ?? fail(503, "storage_not_ready", "圖片儲存空間尚未啟用");
      const data = new Uint8Array(await ctx.req.arrayBuffer());
      if (!data.byteLength || data.byteLength > 8 * 1024 * 1024) fail(413, "invalid_size", "圖片大小需在 8MB 以內（上傳時會自動壓縮）");
      const img = sniffImage(data) ?? fail(400, "invalid_image", "請上傳 JPG、PNG 或 WebP 圖片");
      const old = await ctx.db.prepare("SELECT image_key AS k FROM center_schedules WHERE center_key = ? AND ym = ?").bind(center.key, ym).first<{ k: string }>();
      const shrunk = await shrinkImage(ctx.env, data.buffer as ArrayBuffer, img.type, "edm"); // 課表有小字，用 EDM 的高畫質設定
      const key = `schedule/${crypto.randomUUID().slice(0, 8)}/${crypto.randomUUID()}.${renameForType("x.jpg", shrunk.type).split(".").pop()}`;
      await bucket.put(key, shrunk.data, { httpMetadata: { contentType: shrunk.type } });
      await ctx.db.batch([
        ctx.db
          .prepare("INSERT INTO center_schedules (center_key, ym, center_label, image_key, edited_by) VALUES (?, ?, ?, ?, ?) ON CONFLICT(center_key, ym) DO UPDATE SET image_key = excluded.image_key, center_label = excluded.center_label, edited_by = excluded.edited_by, version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')")
          .bind(center.key, ym, center.label, key, s.sub),
        audit(ctx.db, s.sub, "center.schedule_upload", "center", center.key, ym),
      ]);
      if (old?.k) await bucket.delete(old.k).catch(() => undefined);
      // 新月份才通知訂閱者（更換同月的圖不重複通知）；上傳的人自己會收到確認。
      if (!old) {
        const sent = await notifySubscribers(ctx.db, center.key, `${center.label}${ym.replace("-", "年")}月課表上架`, "點進中心頁查看本月課程安排", `/courses?center=${encodeURIComponent(center.label)}`, s.sub);
        await notify(ctx.db, { sub: s.sub }, "已送出「課表上架」通知", `${center.label}${ym.replace("-", "年")}月（通知了 ${sent} 位訂閱者）`, `/courses?center=${encodeURIComponent(center.label)}`).run();
      }
      return schedulesOf(ctx.db, center.key);
    },
  ],
  [
    "DELETE",
    /^\/admin\/center-schedules$/,
    async (ctx) => {
      const { s, center } = await requireCenterArt(ctx, ctx.url.searchParams.get("center"));
      const ym = scheduleYm(ctx.url.searchParams.get("ym"));
      const old = await ctx.db.prepare("SELECT image_key AS k FROM center_schedules WHERE center_key = ? AND ym = ?").bind(center.key, ym).first<{ k: string }>();
      await ctx.db.batch([ctx.db.prepare("DELETE FROM center_schedules WHERE center_key = ? AND ym = ?").bind(center.key, ym), audit(ctx.db, s.sub, "center.schedule_remove", "center", center.key, ym)]);
      if (old?.k) await ctx.env.MEDIA?.delete(old.k).catch(() => undefined);
      return schedulesOf(ctx.db, center.key);
    },
  ],
  [
    "GET",
    /^\/broadcasts$/,
    async (ctx) => {
      // 公告（公開）：?home=1＝首頁；?center=中心名稱 與／或 ?series=系列名稱＝該中心＋該系列的公告（中心課程頁、系列頁都用這支）。新的在前。
      const q = ctx.url.searchParams;
      const keys: string[] = [];
      if (q.get("home")) keys.push(HOME_BC_KEY);
      const center = (q.get("center") ?? "").trim().slice(0, 60);
      if (center) keys.push(centerKey(center));
      const series = (q.get("series") ?? "").trim().slice(0, 100);
      if (series) keys.push(seriesSubKey(series));
      return broadcastsOf(ctx, keys);
    },
  ],
  [
    "POST",
    /^\/admin\/broadcasts$/,
    async (ctx) => {
      // 新增一則公告：scope＝center／series／home；中心與系列公告新增時通知訂閱者。
      const body = await readJson<{ scope?: unknown; name?: unknown; text?: unknown }>(ctx.req);
      const t = await bcTarget(ctx, body.scope, body.name);
      const text = typeof body.text === "string" ? body.text.trim().slice(0, 300) : "";
      if (!text) fail(400, "text_required", "請輸入公告內容");
      const id = crypto.randomUUID();
      await ctx.db.batch([ctx.db.prepare("INSERT INTO center_broadcasts (id, center_key, body, edited_by) VALUES (?, ?, ?, ?)").bind(id, t.key, text, t.s.sub), audit(ctx.db, t.s.sub, `broadcast.add.${t.scope}`, "broadcast", t.key, id)]);
      if (t.scope === "center") await notifySubscribers(ctx.db, t.key, `${t.label}廣播公告`, text.slice(0, 80), `/courses?center=${encodeURIComponent(t.label)}`);
      if (t.scope === "series") await notifySubscribers(ctx.db, t.key, `${t.label}廣播公告`, text.slice(0, 80), `/series/${encodeURIComponent(t.label)}`);
      return broadcastsOf(ctx, [t.key]);
    },
  ],
  [
    "PATCH",
    /^\/admin\/broadcasts\/([\w-]+)$/,
    async (ctx, [id]) => {
      const row = await ctx.db.prepare("SELECT center_key AS k FROM center_broadcasts WHERE id = ?").bind(id).first<{ k: string }>();
      if (!row) return fail(404, "not_found", "找不到這則公告");
      requireMember(ctx);
      if (!(await canManageBc(ctx, row.k))) fail(403, "forbidden", "沒有修改這則公告的權限");
      const body = await readJson<{ text?: unknown }>(ctx.req);
      const text = typeof body.text === "string" ? body.text.trim().slice(0, 300) : "";
      if (!text) fail(400, "text_required", "請輸入公告內容");
      await ctx.db.prepare("UPDATE center_broadcasts SET body = ?, edited_by = ? WHERE id = ?").bind(text, ctx.session!.sub, id).run();
      return broadcastsOf(ctx, [row.k]);
    },
  ],
  [
    "DELETE",
    /^\/admin\/broadcasts\/([\w-]+)$/,
    async (ctx, [id]) => {
      const row = await ctx.db.prepare("SELECT center_key AS k FROM center_broadcasts WHERE id = ?").bind(id).first<{ k: string }>();
      if (!row) return fail(404, "not_found", "找不到這則公告");
      requireMember(ctx);
      if (!(await canManageBc(ctx, row.k))) fail(403, "forbidden", "沒有刪除這則公告的權限");
      await ctx.db.prepare("DELETE FROM center_broadcasts WHERE id = ?").bind(id).run();
      return broadcastsOf(ctx, [row.k]);
    },
  ],
  [
    "PUT",
    /^\/admin\/center-broadcast-seconds$/,
    async (ctx) => {
      const body = await readJson<{ center?: unknown; seconds?: unknown }>(ctx.req);
      const { center } = await requireCenterArt(ctx, typeof body.center === "string" ? body.center : null);
      const n = Number(body.seconds);
      if (!Number.isFinite(n) || n < 1 || n > 60) fail(400, "invalid_seconds", "輪播秒數請填 1～60");
      await ctx.db.prepare("INSERT INTO center_broadcast_cfg (center_key, seconds) VALUES (?, ?) ON CONFLICT(center_key) DO UPDATE SET seconds = excluded.seconds").bind(center.key, Math.round(n)).run();
      return broadcastsOf(ctx, [center.key]);
    },
  ],
  [
    "POST",
    /^\/center-views$/,
    async (ctx) => {
      // 中心專屬頁點閱計數：每進入一次就 +1（杜杜龍 2026-11-16：不分是否同一人；2026-11-17：訪客也算、重新整理也算）；回傳累計次數。
      const body = await readJson<{ center?: unknown }>(ctx.req);
      const label = typeof body.center === "string" ? body.center.trim().slice(0, 60) : "";
      if (!label) fail(400, "invalid_center", "請指定中心");
      const key = centerKey(label);
      return { total: VIEW_BASE + (await bumpView(ctx.db, "center", key)) };
    },
  ],
  [
    "GET",
    /^\/center-views$/,
    async (ctx) => {
      requireMember(ctx);
      const label = (ctx.url.searchParams.get("center") ?? "").trim();
      const n = label ? await ctx.db.prepare("SELECT total AS n FROM page_views WHERE kind = 'center' AND key = ?").bind(centerKey(label)).first<{ n: number }>() : null;
      return { total: VIEW_BASE + (n?.n ?? 0) };
    },
  ],
  [
    "GET",
    /^\/centers$/,
    async (ctx) => {
      // 只用會員中心的清單（正本）。不混入本地資料；中央暫時查不到時，用最近一次成功的清單（存在 central_snapshots），還是沒有就回報錯誤。
      // 沒登入的訪客（只能看公開課程）讀的是最近一次成功的副本，所以「所有中心」清單不會是空白（杜杜龍 2026-11-17）。
      const s = ctx.session;
      if (s && s.kind !== "central") return ["台北中心", "台中中心", "高雄中心"];
      const snap = await ctx.db.prepare("SELECT value FROM central_snapshots WHERE key = 'centers'").first<{ value: string }>();
      const saved = (() => {
        try {
          const v = JSON.parse(snap?.value ?? "[]") as unknown;
          return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
        } catch {
          return [];
        }
      })();
      if (!s) {
        if (!saved.length) fail(503, "central_unavailable", UPGRADING_MSG);
        await ensureCentersReconciled(ctx.db, saved);
        return saved;
      }
      const refresh = async (): Promise<string[]> => {
        const list = await centerList(s.token);
        if (!list.length) {
          if (saved.length) return saved;
          fail(503, "central_unavailable", UPGRADING_MSG);
        }
        await ensureCentersReconciled(ctx.db, list);
        if (JSON.stringify(list) !== JSON.stringify(saved)) await ctx.db.prepare("INSERT INTO central_snapshots (key, value) VALUES ('centers', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')").bind(JSON.stringify(list)).run();
        return list;
      };
      // 速度（杜杜龍 2026-11-20：寰宇大學「教育中心」區塊比其他區塊晚約 2 秒才出現）：已有最近一次成功的副本就立刻回傳，
      // 向中央確認最新清單、同步改名等工作放到背景（下次進來就是新的）；還沒有副本（第一次）才等中央。
      if (saved.length && ctx.defer) {
        ctx.defer(refresh().catch((e) => console.error("centers refresh", e instanceof Error ? e.message : "error")));
        return saved;
      }
      return refresh();
    },
  ],
  // ---------- 中心 EDM（全部課程頁選了中心才顯示） ----------
  [
    "GET",
    /^\/center-art$/,
    async (ctx): Promise<CenterArt[]> => {
      // 中心封面（杜杜龍 2026-11-23）：每次讀取，從該中心「封面上傳庫」（cover_media 的封面區照片）隨機挑一張；沒有任何封面照片才退回舊的單張首頁圖。
      const [arts, pics] = await Promise.all([
        ctx.db
          .prepare("SELECT center_key, center_label, edm_key, art_version, cover_key, cover_rect, edm_view_y FROM center_art ORDER BY center_label")
          .all<{ center_key: string; center_label: string; edm_key: string; art_version: number; cover_key: string | null; cover_rect: string | null; edm_view_y: number }>(),
        ctx.db
          .prepare("SELECT center_key, owner_key, r2_key FROM cover_media WHERE owner_kind = 'center' AND scope = 'cover' AND kind = 'image' AND center_key IS NOT NULL")
          .all<{ center_key: string; owner_key: string; r2_key: string }>(),
      ]);
      const byKey = new Map<string, { label: string; keys: string[] }>();
      for (const p of pics.results) {
        const e = byKey.get(p.center_key) ?? { label: p.owner_key || p.center_key, keys: [] };
        e.keys.push(p.r2_key);
        byKey.set(p.center_key, e);
      }
      const pick = (keys: string[]) => pubUrl(keys[Math.floor(Math.random() * keys.length)]!, 0);
      const out: CenterArt[] = arts.results.map((r) => {
        const lib = byKey.get(r.center_key);
        byKey.delete(r.center_key);
        const url = lib ? pick(lib.keys) : null;
        return {
          centerKey: r.center_key,
          center: r.center_label,
          edmUrl: url ?? pubUrl(r.edm_key, r.art_version),
          coverUrl: url ?? (r.cover_key ? pubUrl(r.cover_key, r.art_version) : null),
          coverRect: url ? null : parseCoverRect(r.cover_rect),
          edmViewY: url ? 0 : r.edm_view_y,
        };
      });
      for (const [k, lib] of byKey) {
        const url = pick(lib.keys);
        out.push({ centerKey: k, center: lib.label, edmUrl: url, coverUrl: url, coverRect: null, edmViewY: 0 });
      }
      return out;
    },
  ],
  [
    "PUT",
    /^\/admin\/center-art$/,
    async (ctx) => {
      const { s, center } = await requireCenterArt(ctx, ctx.url.searchParams.get("center"));
      const bucket = ctx.env.MEDIA ?? fail(503, "storage_not_ready", "圖片儲存空間尚未啟用");
      const data = new Uint8Array(await ctx.req.arrayBuffer());
      const max = 8 * 1024 * 1024;
      if (!data.byteLength || data.byteLength > max) fail(413, "invalid_size", `圖片大小需在 ${max / 1024 / 1024}MB 以內（上傳時會自動壓縮）`);
      const img = sniffImage(data) ?? fail(400, "invalid_image", "請上傳 JPG、PNG 或 WebP 圖片");
      const old = await ctx.db.prepare("SELECT edm_key AS k FROM center_art WHERE center_key = ?").bind(center.key).first<{ k: string }>();
      const key = `center/${crypto.randomUUID().slice(0, 8)}/${crypto.randomUUID()}.${img.ext}`;
      const shrunk = await shrinkImage(ctx.env, data.buffer as ArrayBuffer, img.type, "center");
      await bucket.put(key, shrunk.data, { httpMetadata: { contentType: shrunk.type } });
      await ctx.db.batch([
        ctx.db
          .prepare("INSERT INTO center_art (center_key, center_label, edm_key) VALUES (?, ?, ?) ON CONFLICT(center_key) DO UPDATE SET edm_key = excluded.edm_key, center_label = excluded.center_label, cover_rect = NULL, edm_view_y = 0, art_version = art_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')")
          .bind(center.key, center.label, key),
        audit(ctx.db, s.sub, "center.edm_upload", "center", center.key, key),
      ]);
      if (old?.k) await bucket.delete(old.k).catch(() => undefined);
      return { ok: true };
    },
  ],
  [
    "GET",
    /^\/center-info$/,
    async (ctx): Promise<Record<string, string>> => {
      // 各教育中心的地址（沒有設定的中心不在裡面）。登入會員都能讀。
      requireMember(ctx);
      const { results } = await ctx.db.prepare("SELECT center_key, address FROM center_info WHERE address <> ''").all<{ center_key: string; address: string }>();
      return Object.fromEntries(results.map((r) => [r.center_key, r.address]));
    },
  ],
  [
    "PUT",
    /^\/admin\/center-info$/,
    async (ctx) => {
      // 設定教育中心的地址（權限同中心 EDM）。空白＝清除。
      const { s, center } = await requireCenterArt(ctx, ctx.url.searchParams.get("center"));
      const body = await readJson<{ address?: unknown }>(ctx.req);
      const address = typeof body.address === "string" ? body.address.trim().slice(0, 120) : "";
      if (!address) {
        await ctx.db.batch([ctx.db.prepare("DELETE FROM center_info WHERE center_key = ?").bind(center.key), audit(ctx.db, s.sub, "center.address_clear", "center", center.key)]);
      } else {
        await ctx.db.batch([
          ctx.db
            .prepare("INSERT INTO center_info (center_key, center_label, address) VALUES (?, ?, ?) ON CONFLICT(center_key) DO UPDATE SET address = excluded.address, center_label = excluded.center_label, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')")
            .bind(center.key, center.label, address),
          audit(ctx.db, s.sub, "center.address_set", "center", center.key, address),
        ]);
      }
      return { ok: true };
    },
  ],
  [
    "GET",
    /^\/center-names$/,
    async (ctx): Promise<Record<string, string>> => {
      // 教育中心的自訂顯示名稱（沒有設定的中心不在裡面，前端用預設格式）。登入會員都能讀。
      requireMember(ctx);
      const { results } = await ctx.db.prepare("SELECT center_key, display_name FROM center_names").all<{ center_key: string; display_name: string }>();
      return Object.fromEntries(results.map((r) => [r.center_key, r.display_name]));
    },
  ],
  [
    "PUT",
    /^\/admin\/center-name$/,
    async (ctx) => {
      // 自訂教育中心的顯示名稱（權限同中心 EDM）。空白＝還原預設。整個行動大學顯示中心名稱的地方都會跟著變。
      const { s, center } = await requireCenterArt(ctx, ctx.url.searchParams.get("center"));
      const body = await readJson<{ name?: unknown }>(ctx.req);
      const name = typeof body.name === "string" ? body.name.trim().slice(0, 30) : "";
      if (!name) {
        await ctx.db.batch([ctx.db.prepare("DELETE FROM center_names WHERE center_key = ?").bind(center.key), audit(ctx.db, s.sub, "center.name_reset", "center", center.key)]);
      } else {
        await ctx.db.batch([
          ctx.db
            .prepare("INSERT INTO center_names (center_key, center_label, display_name) VALUES (?, ?, ?) ON CONFLICT(center_key) DO UPDATE SET display_name = excluded.display_name, center_label = excluded.center_label, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')")
            .bind(center.key, center.label, name),
          audit(ctx.db, s.sub, "center.name_set", "center", center.key, name),
        ]);
      }
      return { ok: true };
    },
  ],
  [
    "PUT",
    /^\/admin\/center-art\/cover$/,
    async (ctx) => {
      // 中心卡用的 16:9 封面：管理者在瀏覽器從中心 EDM 裁切、壓縮後上傳（先要有中心 EDM）。
      const { s, center } = await requireCenterArt(ctx, ctx.url.searchParams.get("center"));
      const bucket = ctx.env.MEDIA ?? fail(503, "storage_not_ready", "圖片儲存空間尚未啟用");
      const old = await ctx.db.prepare("SELECT cover_key AS k FROM center_art WHERE center_key = ?").bind(center.key).first<{ k: string | null }>();
      if (!old) fail(409, "no_edm", "請先上傳中心 EDM");
      const data = new Uint8Array(await ctx.req.arrayBuffer());
      if (!data.byteLength || data.byteLength > 8 * 1024 * 1024) fail(413, "invalid_size", "封面大小需在 8MB 以內（上傳時會自動壓縮）"); // 中心封面照片畫質高，上限放寬
      const img = sniffImage(data) ?? fail(400, "invalid_image", "請上傳 JPG、PNG 或 WebP 圖片");
      const key = `center/${crypto.randomUUID().slice(0, 8)}/cover-${crypto.randomUUID()}.${img.ext}`;
      const shrunk = await shrinkImage(ctx.env, data.buffer as ArrayBuffer, img.type, "center");
      await bucket.put(key, shrunk.data, { httpMetadata: { contentType: shrunk.type } });
      await ctx.db.batch([
        ctx.db.prepare("UPDATE center_art SET cover_key = ?, art_version = art_version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE center_key = ?").bind(key, center.key),
        audit(ctx.db, s.sub, "center.cover_upload", "center", center.key, key),
      ]);
      if (old?.k) await bucket.delete(old.k).catch(() => undefined);
      return { ok: true };
    },
  ],
  [
    "PATCH",
    /^\/admin\/center-art$/,
    async (ctx) => {
      // 封面框（占 EDM 寬高的比例）與預設停留位置永遠同步：預設位置＝封面框上緣。
      const { s, center } = await requireCenterArt(ctx, ctx.url.searchParams.get("center"));
      const body = await readJson<{ coverRect?: unknown }>(ctx.req);
      const r = body.coverRect as Partial<CoverRect> | null | undefined;
      const ok = !!r && [r.x, r.y, r.w].every((n) => typeof n === "number" && Number.isFinite(n)) && r.w! > 0 && r.w! <= 1 && r.x! >= 0 && r.x! + r.w! <= 1.0001 && r.y! >= 0 && r.y! <= 1;
      if (!ok) fail(400, "invalid_cover_rect", "封面裁切範圍不正確");
      const rect = { x: Math.round(r!.x! * 10000) / 10000, y: Math.round(r!.y! * 10000) / 10000, w: Math.round(r!.w! * 10000) / 10000 };
      const res = await ctx.db.prepare("UPDATE center_art SET cover_rect = ?, edm_view_y = ?, art_version = art_version + 1 WHERE center_key = ?").bind(JSON.stringify(rect), rect.y, center.key).run();
      if (!res.meta?.changes) fail(409, "no_edm", "請先上傳中心 EDM");
      await ctx.db.batch([audit(ctx.db, s.sub, "center.cover_rect", "center", center.key, JSON.stringify(rect))]);
      return { ok: true };
    },
  ],
  [
    "DELETE",
    /^\/admin\/center-art$/,
    async (ctx) => {
      const { s, center } = await requireCenterArt(ctx, ctx.url.searchParams.get("center"));
      const old = await ctx.db.prepare("SELECT edm_key AS k, cover_key AS c FROM center_art WHERE center_key = ?").bind(center.key).first<{ k: string; c: string | null }>();
      await ctx.db.batch([ctx.db.prepare("DELETE FROM center_art WHERE center_key = ?").bind(center.key), audit(ctx.db, s.sub, "center.edm_remove", "center", center.key)]);
      if (old?.k) await ctx.env.MEDIA?.delete(old.k).catch(() => undefined);
      if (old?.c) await ctx.env.MEDIA?.delete(old.c).catch(() => undefined);
      return { ok: true };
    },
  ],
];
