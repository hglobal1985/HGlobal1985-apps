import type { D1Database, Env } from "./d1.ts";
import { brandCardId } from "./brand-cards.ts";
import { loadConfig, saveConfig } from "./ui-config.ts";

/**
 * 成交百寶箱 ↔ 安麗品牌館（業主 2026-11-24）：
 * - 「成交百寶箱」課程卡裡，每個品牌一個區塊（名稱、logo＝品牌資料，內容只存這一份）。
 * - 每張品牌卡的最前面多一個「成交百寶箱」連結區塊，內容與封面＝成交百寶箱裡同品牌的區塊（沿用 lessons.link_block_id）。
 * - 13 個品牌的順序兩邊共用：品牌館的卡片順序（ui_config.seriesOrder 的 c:cb品牌編號）＝成交百寶箱的區塊順序，任一邊調整另一邊跟著變。
 */
export const TREASURE_COURSE_ID = "cqqxw4z2";
export const TREASURE_TITLE = "成交百寶箱";
const BRAND_KEY = "c:cb";
const short = () => crypto.randomUUID().slice(0, 6);

export async function treasureCourseId(db: D1Database): Promise<string | null> {
  const row = await db.prepare("SELECT id FROM courses WHERE id = ? OR title = ? ORDER BY id = ? DESC LIMIT 1").bind(TREASURE_COURSE_ID, TREASURE_TITLE, TREASURE_COURSE_ID).first<{ id: string }>();
  return row?.id ?? null;
}

/** 目前品牌順序：品牌館卡片的手動排序優先，沒排到的依「設定 › 品牌 Logo」的順序接在後面。 */
async function brandOrder(db: D1Database): Promise<string[]> {
  const brands = (await db.prepare("SELECT id FROM brand_logos ORDER BY sort_order, created_at").all<{ id: string }>()).results.map((b) => b.id);
  const known = new Set(brands);
  const so = (await loadConfig(db)).seriesOrder;
  const listed = so.filter((k) => k.startsWith(BRAND_KEY)).map((k) => k.slice(BRAND_KEY.length)).filter((id) => known.has(id));
  const uniq = [...new Set(listed)];
  return [...uniq, ...brands.filter((id) => !uniq.includes(id))];
}

/** 把成交百寶箱的品牌區塊（連同底下的教材）依品牌順序重排；沒變就不動，回傳有沒有重排。 */
export async function reorderTreasureBlocks(db: D1Database, courseId: string, order: string[]): Promise<boolean> {
  const rows = (await db.prepare("SELECT id, kind, brand_id, position FROM lessons WHERE course_id = ? ORDER BY position").bind(courseId).all<{ id: string; kind: string; brand_id: string | null; position: number }>()).results;
  type G = { head: (typeof rows)[number] | null; rows: typeof rows };
  const groups: G[] = [{ head: null, rows: [] }];
  for (const r of rows) {
    if (r.kind === "section") groups.push({ head: r, rows: [r] });
    else groups[groups.length - 1]!.rows.push(r);
  }
  const rank = new Map(order.map((id, i) => [id, i]));
  const slotIdx = groups.map((g, i) => (g.head?.brand_id && rank.has(g.head.brand_id) ? i : -1)).filter((i) => i >= 0);
  const sorted = slotIdx.map((i) => groups[i]!).sort((a, b) => rank.get(a.head!.brand_id!)! - rank.get(b.head!.brand_id!)!);
  const next = [...groups];
  slotIdx.forEach((gi, k) => (next[gi] = sorted[k]!));
  const flat = next.flatMap((g) => g.rows);
  if (flat.every((r, i) => r.id === rows[i]!.id)) return false;
  const slots = rows.map((r) => r.position).sort((a, b) => a - b);
  await db.batch([
    db.prepare("UPDATE lessons SET position = -position - 1 WHERE course_id = ?").bind(courseId),
    ...flat.map((r, i) => db.prepare("UPDATE lessons SET position = ? WHERE id = ?").bind(slots[i]!, r.id)),
  ]);
  return true;
}

/** 品牌館卡片順序改了（或新增品牌）→ 成交百寶箱的區塊跟著排。 */
export async function syncTreasureFromSeriesOrder(db: D1Database): Promise<void> {
  const course = await treasureCourseId(db);
  if (!course) return;
  await reorderTreasureBlocks(db, course, await brandOrder(db));
}

/** 成交百寶箱的區塊順序改了 → 品牌館卡片的手動排序跟著改（其他系列、課程的排序位置不動）。 */
export async function syncSeriesOrderFromTreasure(db: D1Database): Promise<void> {
  const course = await treasureCourseId(db);
  if (!course) return;
  const blocks = (await db.prepare("SELECT brand_id FROM lessons WHERE course_id = ? AND kind = 'section' AND brand_id IS NOT NULL ORDER BY position").bind(course).all<{ brand_id: string }>()).results.map((r) => r.brand_id);
  if (!blocks.length) return;
  const cfg = await loadConfig(db);
  const keys = [...new Set(blocks)].map((id) => `${BRAND_KEY}${id}`);
  const at = cfg.seriesOrder.findIndex((k) => k.startsWith(BRAND_KEY));
  const rest = cfg.seriesOrder.filter((k) => !k.startsWith(BRAND_KEY));
  const seriesOrder = at < 0 ? [...rest, ...keys] : [...rest.slice(0, at), ...keys, ...rest.slice(at)];
  if (seriesOrder.length === cfg.seriesOrder.length && seriesOrder.every((k, i) => k === cfg.seriesOrder[i])) return;
  await saveConfig(db, { ...cfg, seriesOrder });
}

/**
 * 補齊：成交百寶箱裡每個品牌一個區塊（名稱跟著品牌）＋每張品牌卡最前面的「成交百寶箱」連結區塊。可重複執行；回傳新建的區塊數。
 * only＝只處理這個品牌（新增品牌、品牌改名時用）。
 */
export async function ensureTreasureLinks(env: Env, only?: string): Promise<number> {
  const db: D1Database = env.DB;
  const course = await treasureCourseId(db);
  if (!course) return 0;
  const brands = (await db.prepare("SELECT id, name FROM brand_logos ORDER BY sort_order, created_at").all<{ id: string; name: string }>()).results.filter((b) => !only || b.id === only);
  if (!brands.length) return 0;
  const blocks = (await db.prepare("SELECT id, brand_id, title FROM lessons WHERE course_id = ? AND kind = 'section' AND brand_id IS NOT NULL").bind(course).all<{ id: string; brand_id: string; title: string }>()).results;
  let max = (await db.prepare("SELECT COALESCE(MAX(position), 0) AS m FROM lessons WHERE course_id = ?").bind(course).first<{ m: number }>())?.m ?? 0;
  let made = 0;
  for (const b of brands) {
    let block = blocks.find((x) => x.brand_id === b.id);
    if (!block) {
      block = { id: `${course}-${short()}`, brand_id: b.id, title: b.name };
      await db.prepare("INSERT INTO lessons (id, course_id, position, title, kind, brand_id, categories, in_sheet, media_type) VALUES (?, ?, ?, ?, 'section', ?, '', 1, 'demo')").bind(block.id, course, ++max, b.name, b.id).run();
      made++;
    } else if (block.title !== b.name) await db.prepare("UPDATE lessons SET title = ? WHERE id = ?").bind(b.name, block.id).run();
    const cardId = brandCardId(b.id);
    if (!(await db.prepare("SELECT 1 AS ok FROM courses WHERE id = ? AND zone = 'amway_brand'").bind(cardId).first())) continue;
    const linkId = `${cardId}-treasure`;
    const have = await db.prepare("SELECT link_block_id AS l, title FROM lessons WHERE id = ?").bind(linkId).first<{ l: string | null; title: string }>();
    if (!have) {
      // 插在最前面：整張卡的順序先全部往後挪一格（先變負數避開唯一鍵），再放在第 1 個。
      await db.batch([
        db.prepare("UPDATE lessons SET position = -position - 1 WHERE course_id = ?").bind(cardId),
        db.prepare("UPDATE lessons SET position = -position WHERE course_id = ?").bind(cardId),
        db.prepare("INSERT INTO lessons (id, course_id, position, title, kind, categories, in_sheet, media_type, link_block_id) VALUES (?, ?, 1, ?, 'section', '', 1, 'demo', ?)").bind(linkId, cardId, TREASURE_TITLE, block.id),
      ]);
    } else if (have.l !== block.id || have.title !== TREASURE_TITLE) await db.prepare("UPDATE lessons SET link_block_id = ?, title = ? WHERE id = ?").bind(block.id, TREASURE_TITLE, linkId).run();
  }
  if (made) await syncTreasureFromSeriesOrder(db);
  return made;
}
