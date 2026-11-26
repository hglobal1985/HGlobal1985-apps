import type { D1Database, Env } from "./d1.ts";

/** 品牌資訊卡（杜杜龍 2026-11-18）：每個品牌 logo 一張清單卡卡，放在「安麗品牌專區」，封面用品牌 logo。 */
/** 杜杜龍可能改過清單名稱，所以優先用固定編號找。 */
export const NEW_PRODUCT_LIST_ID = "cxnfbadr";
export const NEW_PRODUCT_LIST_TITLE = "安麗新品與特惠直播培訓";
export const BRAND_CARD_BLOCKS = ["新品特惠培訓直播", "產品示範", "宣傳短片", "媒體曝光", "專家說", "其他未分類"] as const;
/** 「產品示範」區塊封面的範本圖（橫式 16:9、直式），放在 R2 的固定位置，建卡時各複製一份給各卡（刪除某卡的封面不會影響別張）。 */
export const DEMO_COVER_WIDE = "system/brand-demo-wide.jpg";
export const DEMO_COVER_TALL = "system/brand-demo-tall.jpg";

export const brandCardId = (brandId: string) => `cb${brandId}`;
const short = () => crypto.randomUUID().slice(0, 6);

/** 為還沒有資訊卡的品牌補建一張；已有的不動（可重複執行）。回傳新建的張數。 */
export async function ensureBrandCards(env: Env, only?: string): Promise<number> {
  const db: D1Database = env.DB;
  const brands = (await db.prepare("SELECT id, name FROM brand_logos ORDER BY name").all<{ id: string; name: string }>()).results.filter((b) => !only || b.id === only);
  if (!brands.length) return 0;
  const have = new Set((await db.prepare("SELECT id FROM courses WHERE id LIKE 'cb%' AND is_list = 1 AND zone = 'amway_brand'").all<{ id: string }>()).results.map((r) => r.id));
  const missing = brands.filter((b) => !have.has(brandCardId(b.id)));
  if (!missing.length) return 0;
  const source = await db.prepare("SELECT id FROM courses WHERE is_list = 1 AND (id = ? OR title = ?) ORDER BY id = ? DESC LIMIT 1").bind(NEW_PRODUCT_LIST_ID, NEW_PRODUCT_LIST_TITLE, NEW_PRODUCT_LIST_ID).first<{ id: string }>();
  const wide = env.MEDIA ? await env.MEDIA.get(DEMO_COVER_WIDE).catch(() => null) : null;
  const tall = env.MEDIA ? await env.MEDIA.get(DEMO_COVER_TALL).catch(() => null) : null;
  const wideBytes = wide ? await new Response(wide.body).arrayBuffer() : null;
  const tallBytes = tall ? await new Response(tall.body).arrayBuffer() : null;
  let made = 0;
  for (const b of missing) {
    const cardId = brandCardId(b.id);
    // 新品清單裡對應這個品牌的區塊；沒有就補一個（空的），之後兩邊都可以加教材。
    let linkId: string | null = null;
    if (source) {
      const sec = await db.prepare("SELECT id FROM lessons WHERE course_id = ? AND kind = 'section' AND brand_id = ? ORDER BY position LIMIT 1").bind(source.id, b.id).first<{ id: string }>();
      linkId = sec?.id ?? null;
      if (!linkId) {
        const max = await db.prepare("SELECT COALESCE(MAX(position), 0) AS m FROM lessons WHERE course_id = ?").bind(source.id).first<{ m: number }>();
        linkId = `${source.id}-${short()}`;
        await db.prepare("INSERT INTO lessons (id, course_id, position, title, kind, brand_id, categories, in_sheet, media_type) VALUES (?, ?, ?, ?, 'section', ?, '', 1, 'demo')").bind(linkId, source.id, (max?.m ?? 0) + 1, b.name, b.id).run();
      }
    }
    const order = ((await db.prepare("SELECT COALESCE(MAX(sort_order), 0) AS m FROM courses").first<{ m: number }>())?.m ?? 0) + 1;
    const stmts = [
      db
        .prepare(
          "INSERT INTO courses (id, sort_order, status, created_by_sub, edited_by_name, title, is_list, view_scope, is_public, allow_president, brand_id, zone, price_twd, min_rank_code, host_unit, series, block_photos) VALUES (?, ?, 'published', 'system', '系統', ?, 1, 'all', 1, 1, ?, 'amway_brand', 0, 'none', '', '', 1)",
        )
        .bind(cardId, order, b.name, b.id),
    ];
    for (const [i, title] of BRAND_CARD_BLOCKS.entries()) {
      const id = `${cardId}-s${i + 1}`;
      let coverKey: string | null = null;
      let posterKey: string | null = null;
      if (title === "產品示範") {
        if (wideBytes) {
          coverKey = `lesson/${id}/${crypto.randomUUID()}.jpg`;
          await env.MEDIA!.put(coverKey, wideBytes, { httpMetadata: { contentType: "image/jpeg" } });
        }
        if (tallBytes) {
          posterKey = `lesson/${id}/${crypto.randomUUID()}.jpg`;
          await env.MEDIA!.put(posterKey, tallBytes, { httpMetadata: { contentType: "image/jpeg" } });
        }
      }
      stmts.push(
        db
          .prepare("INSERT INTO lessons (id, course_id, position, title, kind, categories, in_sheet, media_type, cover_key, poster_key, link_block_id) VALUES (?, ?, ?, ?, 'section', '', 1, 'demo', ?, ?, ?)")
          .bind(id, cardId, i + 1, title, coverKey, posterKey, i === 0 ? linkId : null),
      );
    }
    await db.batch(stmts);
    made++;
  }
  return made;
}
