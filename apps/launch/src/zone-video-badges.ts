/**
 * 清單影片徽章（業主 2026-11-19）：從「安麗官方清單專區」「安麗品牌專區」的每個區塊隨機挑 1～2 支影片（區塊裡影片多於 5 支挑 2 支，否則 1 支），
 * 每支影片建立一枚徽章（condition_type = material_video），會員讀完（看完）該影片就解鎖；徽章圖固定用安麗 A 圖示（icon = "@amway"）。
 * 可重複執行：已經有徽章的區塊只補不足的數量，不會重抽、不會刪除既有徽章（避免會員已取得的徽章消失）。
 */
import type { D1Database } from "./d1.ts";

type Row = { id: string; course_id: string; kind: string; title: string; media_type: string | null; media_ref: string | null; link_block_id: string | null; course_title: string };

const randomId = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => (b % 36).toString(36)).join("");
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** 抽選：回傳這次新增的徽章數與全部清單影片徽章數。 */
export async function drawZoneVideoBadges(db: D1Database): Promise<{ added: number; total: number; groups: number }> {
  const { results } = await db
    .prepare(
      `SELECT l.id, l.course_id, l.kind, l.title, l.media_type, l.media_ref, l.link_block_id, c.title AS course_title
         FROM lessons l JOIN courses c ON c.id = l.course_id
        WHERE c.status = 'published' AND c.is_list = 1 AND COALESCE(c.zone, '') <> 'hglobal'
          AND COALESCE(c.view_scope, 'all') NOT IN ('link_login', 'link_guest') AND l.kind IN ('section', 'material')
        ORDER BY l.course_id, l.position`,
    )
    .all<Row>();
  const picked = new Set((await db.prepare("SELECT lesson_id FROM achievements WHERE condition_type = 'material_video' AND lesson_id IS NOT NULL").all<{ lesson_id: string }>()).results.map((r) => r.lesson_id));
  // 依清單、區塊分組（區塊＝章節種類 section，底下到下一個區塊之前的教材屬於它；連結區塊的內容在來源清單，不在這裡抽）。
  const groups: Row[][] = [];
  let cur: Row[] | null = null;
  let course = "";
  for (const r of results) {
    if (r.course_id !== course) {
      course = r.course_id;
      cur = [];
      groups.push(cur);
    }
    if (r.kind === "section") {
      cur = r.link_block_id ? null : [];
      if (cur) groups.push(cur);
    } else if (cur && r.media_type === "youtube" && r.media_ref) cur.push(r);
  }
  const base = Number((await db.prepare("SELECT COALESCE(MAX(sort_order), 0) AS n FROM achievements").first<{ n: number }>())?.n ?? 0);
  const inserts = [];
  let used = 0;
  let nGroups = 0;
  for (const g of groups) {
    if (!g.length) continue;
    nGroups += 1;
    const want = g.length > 5 ? 2 : 1;
    const have = g.filter((r) => picked.has(r.id)).length;
    const pool = g.filter((r) => !picked.has(r.id));
    for (let i = pool.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j]!, pool[i]!];
    }
    for (const r of pool.slice(0, Math.max(0, want - have))) {
      used += 1;
      inserts.push(
        db
          .prepare("INSERT INTO achievements (id, name, description, icon, condition_type, threshold, course_id, lesson_id, sort_order, difficulty) VALUES (?, ?, ?, '@amway', 'material_video', 1, ?, ?, ?, 1)")
          .bind(`ach-${randomId(8)}`, cut(`讀完：${r.title}`, 30), cut(`讀完「${r.title}」（${r.course_title}）`, 100), r.course_id, r.id, base + used),
      );
    }
  }
  for (let i = 0; i < inserts.length; i += 50) await db.batch(inserts.slice(i, i + 50));
  const total = Number((await db.prepare("SELECT COUNT(*) AS n FROM achievements WHERE condition_type = 'material_video'").first<{ n: number }>())?.n ?? 0);
  return { added: used, total, groups: nGroups };
}
